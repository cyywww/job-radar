import type { FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';

import {
  ConnectorCancelledError,
  ConnectorRequestError,
  GenericWebConnector,
  JobTechConnector,
  mapWithConcurrency,
  type ConnectorContext,
  type DiscoveredJob,
  type JobConnector,
} from '@job-radar/connectors';
import {
  JobRepository,
  ProfileRepository,
  ScanAlreadyActiveError,
  SourceRepositoryError,
  type DatabaseClient,
} from '@job-radar/db';
import {
  sourceTestResultSchema,
  type CreateSourceRequest,
  type CreateScanRequest,
  type RunCounts,
  type ReprocessJobsResult,
  type ScanRun,
  type Source,
  type SourceErrorCategory,
  type SourceTestResult,
  type SourceView,
  type UpdateSourceRequest,
} from '@job-radar/shared';

import type { ScoringCoordinator } from './scoring-coordinator.js';

export class ScanCoordinatorError extends Error {
  public constructor(
    public readonly code:
      | 'SCAN_ALREADY_RUNNING'
      | 'SCAN_PROFILE_NOT_READY'
      | 'SCAN_SOURCE_NOT_FOUND'
      | 'SCAN_JOB_NOT_FOUND'
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
  readonly scoring?: ScoringCoordinator;
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

function safeError(error: unknown): {
  summary: string;
  category: SourceErrorCategory;
} {
  if (error instanceof ConnectorRequestError) {
    return { summary: error.message.slice(0, 500), category: error.category };
  }
  if (error instanceof ZodError) {
    return {
      summary: 'Connector response did not match its schema',
      category: 'invalid_response',
    };
  }
  return { summary: 'Connector failed unexpectedly', category: 'unexpected' };
}

export class ScanCoordinator {
  private readonly jobs: JobRepository;
  private readonly profiles: ProfileRepository;
  private readonly connectors: ReadonlyMap<string, JobConnector>;
  private readonly now: () => Date;
  private readonly scoring: ScoringCoordinator | undefined;
  private active: ActiveExecution | null = null;

  public constructor(
    database: DatabaseClient,
    private readonly logger: FastifyBaseLogger,
    options: ScanCoordinatorOptions = {},
  ) {
    this.jobs = new JobRepository(database);
    this.profiles = new ProfileRepository(database);
    this.now = options.now ?? (() => new Date());
    this.scoring = options.scoring;
    const connectors = options.connectors ?? [
      new JobTechConnector(),
      new GenericWebConnector(),
    ];
    this.connectors = new Map(connectors.map((connector) => [connector.type, connector]));
    this.jobs.ensureDefaultSources(this.now());
  }

  public listSources(includeDeleted = false): SourceView[] {
    return this.jobs.listSourceViews(includeDeleted);
  }

  public createSource(input: CreateSourceRequest): SourceView {
    const source = this.jobs.createSource(input, this.now());
    return this.jobs.getSourceView(source.id)!;
  }

  public updateSource(sourceId: string, input: UpdateSourceRequest): SourceView {
    this.jobs.updateSource(sourceId, input, this.now());
    return this.jobs.getSourceView(sourceId)!;
  }

  public deleteSource(sourceId: string): void {
    this.jobs.deleteSource(sourceId, this.now());
  }

  public async testSource(sourceId: string): Promise<SourceTestResult> {
    const source = this.jobs.getSource(sourceId);
    if (!source) {
      throw new SourceRepositoryError('SOURCE_NOT_FOUND', 'Source does not exist');
    }
    const connector = this.connectors.get(source.type);
    const checkedAt = this.now();
    let retryCount = 0;

    if (!connector) {
      const message = `No connector is registered for source type ${source.type}`;
      this.jobs.updateSourceHealth(
        source.id,
        'unavailable',
        message,
        'connector_unavailable',
        checkedAt,
      );
      return sourceTestResultSchema.parse({
        source: this.jobs.getSourceView(source.id),
        status: 'unavailable',
        errorCategory: 'connector_unavailable',
        message,
        retryCount,
        checkedAt: checkedAt.toISOString(),
      });
    }

    const context: ConnectorContext = {
      source,
      queries: [],
      signal: new AbortController().signal,
      onRetry: () => {
        retryCount += 1;
      },
    };
    try {
      const health = await connector.healthCheck(context);
      const category = health.status === 'unavailable' ? 'connector_unavailable' : null;
      this.jobs.updateSourceHealth(
        source.id,
        health.status,
        health.message,
        category,
        checkedAt,
        health.status === 'healthy',
      );
      return sourceTestResultSchema.parse({
        source: this.jobs.getSourceView(source.id),
        status: health.status,
        errorCategory: category,
        message: health.message,
        retryCount,
        checkedAt: checkedAt.toISOString(),
      });
    } catch (error) {
      const safe = safeError(error);
      this.jobs.updateSourceHealth(
        source.id,
        'unavailable',
        safe.summary,
        safe.category,
        checkedAt,
      );
      return sourceTestResultSchema.parse({
        source: this.jobs.getSourceView(source.id),
        status: 'unavailable',
        errorCategory: safe.category,
        message: safe.summary,
        retryCount,
        checkedAt: checkedAt.toISOString(),
      });
    }
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
    let run: ScanRun;
    try {
      run = this.jobs.createScan(profile.version, selectedSources, queries, this.now());
    } catch (error) {
      if (error instanceof ScanAlreadyActiveError) {
        throw new ScanCoordinatorError(
          'SCAN_ALREADY_RUNNING',
          'A scan is already queued or running in the local database',
        );
      }
      throw error;
    }
    const controller = new AbortController();
    const promise = this.execute(run.id, selectedSources, queries, controller.signal)
      .catch(() => undefined)
      .finally(() => {
        if (this.active?.runId === run.id) this.active = null;
      });
    this.active = { runId: run.id, controller, promise };
    return run;
  }

  public startJobRefresh(jobId: string): { scan: ScanRun; jobId: string } {
    if (this.active) {
      throw new ScanCoordinatorError(
        'SCAN_ALREADY_RUNNING',
        'A scan is already running in this local process',
      );
    }
    const profile = this.profiles.getConfirmedView();
    if (!profile) {
      throw new ScanCoordinatorError(
        'SCAN_PROFILE_NOT_READY',
        'A confirmed Profile is required before refreshing a job',
      );
    }
    const target = this.jobs.getJobRefreshTarget(jobId);
    if (!target || !target.source.enabled) {
      throw new ScanCoordinatorError(
        'SCAN_JOB_NOT_FOUND',
        'The job has no enabled current source to refresh',
      );
    }
    let run: ScanRun;
    try {
      run = this.jobs.createScan(profile.version, [target.source], [], this.now());
    } catch (error) {
      if (error instanceof ScanAlreadyActiveError) {
        throw new ScanCoordinatorError(
          'SCAN_ALREADY_RUNNING',
          'A scan is already queued or running in the local database',
        );
      }
      throw error;
    }
    const controller = new AbortController();
    const promise = this.executeJobRefresh(
      run.id,
      target.source,
      target.externalId,
      jobId,
      controller.signal,
    )
      .catch(() => undefined)
      .finally(() => {
        if (this.active?.runId === run.id) this.active = null;
      });
    this.active = { runId: run.id, controller, promise };
    return { scan: run, jobId };
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

  public reprocessJobs(): ReprocessJobsResult {
    if (this.active || this.jobs.hasActiveScan()) {
      throw new ScanCoordinatorError(
        'SCAN_ALREADY_RUNNING',
        'Wait for the active scan before reprocessing historical jobs',
      );
    }
    try {
      const result = this.jobs.reprocessJobs(this.now());
      const profile = this.profiles.getConfirmedView();
      if (profile) this.scoring?.syncAllJobs(profile.version);
      return result;
    } catch (error) {
      if (error instanceof ScanAlreadyActiveError) {
        throw new ScanCoordinatorError(
          'SCAN_ALREADY_RUNNING',
          'Wait for the active scan before reprocessing historical jobs',
        );
      }
      throw error;
    }
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
          errorCategory: 'cancelled',
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
    let failureStage:
      'health' | 'discovery' | 'detail' | 'persist' | 'lifecycle' | 'scoring' = 'health';
    this.jobs.markSourceRunRunning(runId, source.id, this.now());
    const connector = this.connectors.get(source.type);

    if (!connector) {
      const errorSummary = `No connector is registered for source type ${source.type}`;
      counts.failed = 1;
      this.jobs.updateSourceHealth(
        source.id,
        'unavailable',
        errorSummary,
        'connector_unavailable',
        this.now(),
      );
      this.jobs.completeSourceRun(runId, source.id, {
        status: 'failed',
        resultSetComplete,
        pagesFetched,
        counts,
        errorCategory: 'connector_unavailable',
        errorSummary,
        failureStage: 'health',
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
      this.jobs.markSourceRunStage(runId, source.id, 'health');
      const health = await connector.healthCheck(context);
      if (health.status === 'unavailable') {
        throw new ConnectorRequestError(
          health.message ?? `${source.name} is unavailable`,
          'connector_unavailable',
        );
      }
      this.jobs.updateSourceHealth(
        source.id,
        health.status,
        health.message,
        null,
        this.now(),
      );
      failureStage = 'discovery';
      this.jobs.markSourceRunStage(runId, source.id, 'discovery');
      const discovery = await connector.discover(context);
      pagesFetched = discovery.pagesFetched;
      resultSetComplete = discovery.complete;
      counts.discovered = discovery.jobs.length;
      this.jobs.updateSourceRunProgress(runId, source.id, {
        counts,
        pagesFetched,
        resultSetComplete,
      });
      const concurrency = source.config.detailConcurrency;
      failureStage = 'detail';
      this.jobs.markSourceRunStage(runId, source.id, 'detail');
      const results = await mapWithConcurrency(
        discovery.jobs,
        concurrency,
        signal,
        async (discovered) => {
          const raw = await connector.fetchDetail(discovered, context);
          return connector.normalize(raw);
        },
      );

      counts.failed = results.filter((result) => result.status === 'rejected').length;
      counts.fetched = results.length - counts.failed;
      this.jobs.updateSourceRunProgress(runId, source.id, {
        counts,
        pagesFetched,
        resultSetComplete,
      });

      failureStage = 'persist';
      this.jobs.markSourceRunStage(runId, source.id, 'persist');
      let persisted = 0;
      for (const result of results) {
        if (signal.aborted) throw new ConnectorCancelledError();
        if (result.status === 'rejected') continue;
        const normalized = await result.value;
        const ingested = this.jobs.ingestJob(source, runId, normalized, this.now());
        counts[ingested.outcome] += 1;
        if (ingested.closed) counts.closed += 1;
        persisted += 1;
        if (persisted % 25 === 0) {
          this.jobs.updateSourceRunProgress(runId, source.id, {
            counts,
            pagesFetched,
            resultSetComplete,
          });
        }
        const scoringProfile = this.profiles.getConfirmedView();
        if (scoringProfile) this.scoring?.syncJob(ingested.jobId, scoringProfile.version);
      }
      this.jobs.updateSourceRunProgress(runId, source.id, {
        counts,
        pagesFetched,
        resultSetComplete,
      });

      const partial = counts.failed > 0;
      const seenIds = new Set(discovery.jobs.map((job) => job.externalId));
      failureStage = 'lifecycle';
      this.jobs.markSourceRunStage(runId, source.id, 'lifecycle');
      counts.closed += this.jobs.applyLifecycle(
        source,
        seenIds,
        discovery.complete && !partial,
        this.now(),
      );
      this.jobs.updateSourceRunProgress(runId, source.id, {
        counts,
        pagesFetched,
        resultSetComplete,
      });
      failureStage = 'scoring';
      this.jobs.markSourceRunStage(runId, source.id, 'scoring');
      const scoringProfile = this.profiles.getConfirmedView();
      if (scoringProfile) this.scoring?.syncAllJobs(scoringProfile.version);
      const errorSummary = partial
        ? `${counts.failed} discovered job detail${counts.failed === 1 ? '' : 's'} failed`
        : null;
      if (partial) {
        this.jobs.updateSourceHealth(
          source.id,
          'degraded',
          errorSummary,
          'partial_detail',
          this.now(),
        );
      } else {
        this.jobs.updateSourceHealth(
          source.id,
          health.status,
          health.message,
          null,
          this.now(),
          true,
        );
      }
      this.jobs.completeSourceRun(runId, source.id, {
        status: partial ? 'partial' : 'succeeded',
        resultSetComplete,
        pagesFetched,
        counts,
        errorCategory: partial ? 'partial_detail' : null,
        errorSummary,
        failureStage: partial ? 'detail' : null,
        finishedAt: this.now(),
      });
    } catch (error) {
      const cancelled = signal.aborted || error instanceof ConnectorCancelledError;
      const safe = cancelled
        ? { summary: 'Scan cancelled', category: 'cancelled' as const }
        : safeError(error);
      const errorSummary = safe.summary;
      if (!cancelled) counts.failed = Math.max(1, counts.failed);
      this.jobs.updateSourceHealth(
        source.id,
        cancelled ? 'degraded' : 'unavailable',
        errorSummary,
        safe.category,
        this.now(),
      );
      this.jobs.completeSourceRun(runId, source.id, {
        status: cancelled ? 'cancelled' : 'failed',
        resultSetComplete,
        pagesFetched,
        counts,
        errorCategory: safe.category,
        errorSummary,
        failureStage: cancelled ? null : failureStage,
        finishedAt: this.now(),
      });
    }
  }

  private async executeJobRefresh(
    runId: string,
    source: Source,
    externalId: string,
    jobId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const counts = newCounts();
    let failureStage: 'health' | 'discovery' | 'detail' | 'persist' | 'scoring' =
      'health';
    this.jobs.markScanRunning(runId, this.now());
    this.jobs.markSourceRunRunning(runId, source.id, this.now());
    const connector = this.connectors.get(source.type);
    if (!connector) {
      counts.failed = 1;
      this.jobs.completeSourceRun(runId, source.id, {
        status: 'failed',
        resultSetComplete: null,
        pagesFetched: 0,
        counts,
        errorCategory: 'connector_unavailable',
        errorSummary: 'No connector is registered for this source type',
        failureStage: 'health',
        finishedAt: this.now(),
      });
      this.jobs.completeScan(runId, this.now());
      return;
    }
    const context: ConnectorContext = {
      source,
      queries: [],
      signal,
      onRetry: () => this.jobs.incrementSourceRetry(runId, source.id),
    };
    try {
      this.jobs.markSourceRunStage(runId, source.id, 'health');
      const health = await connector.healthCheck(context);
      if (health.status === 'unavailable') {
        throw new ConnectorRequestError(
          health.message ?? `${source.name} is unavailable`,
          'connector_unavailable',
        );
      }
      let discovered: DiscoveredJob = { externalId, rawSummary: { id: externalId } };
      let pagesFetched = 0;
      if (source.type === 'generic_web') {
        failureStage = 'discovery';
        this.jobs.markSourceRunStage(runId, source.id, 'discovery');
        const discovery = await connector.discover(context);
        pagesFetched = discovery.pagesFetched;
        const match = discovery.jobs.find((job) => job.externalId === externalId);
        if (!match) {
          throw new ConnectorRequestError(
            'The selected job is no longer present on its current source page',
            'not_found',
          );
        }
        discovered = match;
      }
      counts.discovered = 1;
      this.jobs.updateSourceRunProgress(runId, source.id, {
        counts,
        pagesFetched,
        resultSetComplete: null,
      });
      failureStage = 'detail';
      this.jobs.markSourceRunStage(runId, source.id, 'detail');
      const raw = await connector.fetchDetail(discovered, context);
      const normalized = await connector.normalize(raw);
      counts.fetched = 1;
      this.jobs.updateSourceRunProgress(runId, source.id, {
        counts,
        pagesFetched,
        resultSetComplete: null,
      });
      failureStage = 'persist';
      this.jobs.markSourceRunStage(runId, source.id, 'persist');
      const ingested = this.jobs.ingestJob(source, runId, normalized, this.now());
      if (ingested.jobId !== jobId) {
        throw new ConnectorRequestError(
          'The refreshed source identity no longer resolves to the selected job',
          'invalid_response',
        );
      }
      counts[ingested.outcome] += 1;
      this.jobs.updateSourceRunProgress(runId, source.id, {
        counts,
        pagesFetched,
        resultSetComplete: null,
      });
      failureStage = 'scoring';
      this.jobs.markSourceRunStage(runId, source.id, 'scoring');
      this.scoring?.syncJob(jobId, this.profiles.getConfirmedView()!.version);
      this.jobs.updateSourceHealth(source.id, 'healthy', null, null, this.now(), true);
      this.jobs.completeSourceRun(runId, source.id, {
        status: 'succeeded',
        resultSetComplete: null,
        pagesFetched,
        counts,
        errorCategory: null,
        errorSummary: null,
        failureStage: null,
        finishedAt: this.now(),
      });
    } catch (error) {
      const cancelled = signal.aborted || error instanceof ConnectorCancelledError;
      const safe = cancelled
        ? { summary: 'Refresh cancelled', category: 'cancelled' as const }
        : safeError(error);
      if (!cancelled) counts.failed = 1;
      this.jobs.updateSourceHealth(
        source.id,
        cancelled ? 'degraded' : 'unavailable',
        safe.summary,
        safe.category,
        this.now(),
      );
      this.jobs.completeSourceRun(runId, source.id, {
        status: cancelled ? 'cancelled' : 'failed',
        resultSetComplete: null,
        pagesFetched: 0,
        counts,
        errorCategory: safe.category,
        errorSummary: safe.summary,
        failureStage: cancelled ? null : failureStage,
        finishedAt: this.now(),
      });
    }
    this.jobs.completeScan(runId, this.now());
  }
}
