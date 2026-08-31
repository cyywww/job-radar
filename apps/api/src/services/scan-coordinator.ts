import type { FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';

import {
  ConnectorCancelledError,
  ConnectorRequestError,
  JobTechConnector,
  mapWithConcurrency,
  type ConnectorContext,
  type JobConnector,
} from '@job-radar/connectors';
import { JobRepository, ProfileRepository, type DatabaseClient } from '@job-radar/db';
import {
  type CreateScanRequest,
  type RunCounts,
  type ScanRun,
  type Source,
} from '@job-radar/shared';

export class ScanCoordinatorError extends Error {
  public constructor(
    public readonly code:
      | 'SCAN_ALREADY_RUNNING'
      | 'SCAN_PROFILE_NOT_READY'
      | 'SCAN_SOURCE_NOT_FOUND'
      | 'SCAN_NOT_FOUND'
      | 'SCAN_NOT_CANCELLABLE',
    message: string,
  ) {
    super(message);
    this.name = 'ScanCoordinatorError';
  }
}

export interface ScanCoordinatorOptions {
  readonly connectors?: readonly JobConnector[];
  readonly now?: () => Date;
}

interface ActiveExecution {
  readonly runId: string;
  readonly controller: AbortController;
  readonly promise: Promise<void>;
}

function newCounts(): RunCounts {
  return {
    discovered: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    closed: 0,
    failed: 0,
  };
}

function safeErrorSummary(error: unknown): string {
  if (error instanceof ConnectorRequestError) return error.message.slice(0, 500);
  if (error instanceof ZodError) return 'Connector response did not match its schema';
  return 'Connector failed unexpectedly';
}

export class ScanCoordinator {
  private readonly jobs: JobRepository;
  private readonly profiles: ProfileRepository;
  private readonly connectors: ReadonlyMap<string, JobConnector>;
  private readonly now: () => Date;
  private active: ActiveExecution | null = null;

  public constructor(
    database: DatabaseClient,
    private readonly logger: FastifyBaseLogger,
    options: ScanCoordinatorOptions = {},
  ) {
    this.jobs = new JobRepository(database);
    this.profiles = new ProfileRepository(database);
    this.now = options.now ?? (() => new Date());
    const connectors = options.connectors ?? [new JobTechConnector()];
    this.connectors = new Map(connectors.map((connector) => [connector.type, connector]));
    this.jobs.ensureDefaultSources(this.now());
  }

  public listSources(): Source[] {
    return this.jobs.listSources();
  }

  public start(request: CreateScanRequest): ScanRun {
    if (this.active) {
      throw new ScanCoordinatorError(
        'SCAN_ALREADY_RUNNING',
        'A scan is already running in this local process',
      );
    }
    const profile = this.profiles.getConfirmedView();
    const roles = profile?.preferences?.data.targetRoles ?? [];
    if (!profile || !profile.preferences || roles.length === 0) {
      throw new ScanCoordinatorError(
        'SCAN_PROFILE_NOT_READY',
        'Confirm at least one target role before starting a scan',
      );
    }

    const selectedSources = this.jobs
      .getSources(request.sourceIds)
      .filter((source) => source.enabled);
    if (
      selectedSources.length === 0 ||
      (request.sourceIds && selectedSources.length !== new Set(request.sourceIds).size)
    ) {
      throw new ScanCoordinatorError(
        'SCAN_SOURCE_NOT_FOUND',
        'One or more requested sources do not exist or are disabled',
      );
    }

    const queries = [...new Set(roles.map((role) => role.trim()).filter(Boolean))];
    const run = this.jobs.createScan(
      profile.version,
      selectedSources,
      queries,
      this.now(),
    );
    const controller = new AbortController();
    const promise = this.execute(run.id, selectedSources, queries, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.active?.runId === run.id) this.active = null;
      });
    this.active = { runId: run.id, controller, promise };
    return run;
  }

  public get(runId: string): ScanRun {
    const run = this.jobs.getScan(runId);
    if (!run) throw new ScanCoordinatorError('SCAN_NOT_FOUND', 'Scan run does not exist');
    return run;
  }

  public list(limit: number): ScanRun[] {
    return this.jobs.listScans(limit);
  }

  public cancel(runId: string): ScanRun {
    const run = this.jobs.getScan(runId);
    if (!run) throw new ScanCoordinatorError('SCAN_NOT_FOUND', 'Scan run does not exist');
    if (!this.jobs.requestCancellation(runId, this.now())) {
      throw new ScanCoordinatorError(
        'SCAN_NOT_CANCELLABLE',
        'Scan run has already reached a terminal state',
      );
    }
    if (this.active?.runId === runId) this.active.controller.abort();
    return this.jobs.getScan(runId)!;
  }

  public async close(): Promise<void> {
    if (!this.active) return;
    this.active.controller.abort();
    await this.active.promise;
  }

  private async execute(
    runId: string,
    selectedSources: readonly Source[],
    queries: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    this.jobs.markScanRunning(runId, this.now());
    for (const source of selectedSources) {
      if (signal.aborted) {
        this.jobs.completeSourceRun(runId, source.id, {
          status: 'cancelled',
          resultSetComplete: null,
          pagesFetched: 0,
          counts: newCounts(),
          errorSummary: 'Scan cancelled',
          finishedAt: this.now(),
        });
        continue;
      }
      await this.executeSource(runId, source, queries, signal);
    }
    const completed = this.jobs.completeScan(runId, this.now());
    this.logger.info(
      {
        scanRunId: runId,
        status: completed.status,
        counts: completed.counts,
      },
      'Scan completed',
    );
  }

  private async executeSource(
    runId: string,
    source: Source,
    queries: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    const counts = newCounts();
    let pagesFetched = 0;
    let resultSetComplete: boolean | null = null;
    this.jobs.markSourceRunRunning(runId, source.id, this.now());
    const connector = this.connectors.get(source.type);

    if (!connector) {
      const errorSummary = `No connector is registered for source type ${source.type}`;
      counts.failed = 1;
      this.jobs.updateSourceHealth(source.id, 'unavailable', errorSummary, this.now());
      this.jobs.completeSourceRun(runId, source.id, {
        status: 'failed',
        resultSetComplete,
        pagesFetched,
        counts,
        errorSummary,
        finishedAt: this.now(),
      });
      return;
    }

    const context: ConnectorContext = {
      source,
      queries,
      signal,
      onRetry: () => this.jobs.incrementSourceRetry(runId, source.id),
    };

    try {
      await connector.healthCheck(context);
      this.jobs.updateSourceHealth(source.id, 'healthy', null, this.now());
      const discovery = await connector.discover(context);
      pagesFetched = discovery.pagesFetched;
      resultSetComplete = discovery.complete;
      counts.discovered = discovery.jobs.length;
      const concurrency =
        source.config.kind === 'jobtech' ? source.config.detailConcurrency : 1;
      const results = await mapWithConcurrency(
        discovery.jobs,
        concurrency,
        signal,
        async (discovered) => {
          const raw = await connector.fetchDetail(discovered, context);
          return connector.normalize(raw);
        },
      );

      for (const result of results) {
        if (signal.aborted) throw new ConnectorCancelledError();
        if (result.status === 'rejected') {
          counts.failed += 1;
          continue;
        }
        const normalized = await result.value;
        counts.fetched += 1;
        const ingested = this.jobs.ingestJob(source, runId, normalized, this.now());
        counts[ingested.outcome] += 1;
        if (ingested.closed) counts.closed += 1;
      }

      const seenIds = new Set(discovery.jobs.map((job) => job.externalId));
      counts.closed += this.jobs.applyLifecycle(
        source,
        seenIds,
        discovery.complete,
        this.now(),
      );
      const partial = counts.failed > 0;
      const errorSummary = partial
        ? `${counts.failed} discovered job detail${counts.failed === 1 ? '' : 's'} failed`
        : null;
      if (partial) {
        this.jobs.updateSourceHealth(source.id, 'degraded', errorSummary, this.now());
      } else {
        this.jobs.updateSourceHealth(source.id, 'healthy', null, this.now(), true);
      }
      this.jobs.completeSourceRun(runId, source.id, {
        status: partial ? 'partial' : 'succeeded',
        resultSetComplete,
        pagesFetched,
        counts,
        errorSummary,
        finishedAt: this.now(),
      });
    } catch (error) {
      const cancelled = signal.aborted || error instanceof ConnectorCancelledError;
      const errorSummary = cancelled ? 'Scan cancelled' : safeErrorSummary(error);
      if (!cancelled) counts.failed = Math.max(1, counts.failed);
      this.jobs.updateSourceHealth(
        source.id,
        cancelled ? 'degraded' : 'unavailable',
        errorSummary,
        this.now(),
      );
      this.jobs.completeSourceRun(runId, source.id, {
        status: cancelled ? 'cancelled' : 'failed',
        resultSetComplete,
        pagesFetched,
        counts,
        errorSummary,
        finishedAt: this.now(),
      });
    }
  }
}
