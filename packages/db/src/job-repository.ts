import { createHash, randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';

import {
  ashbySourceConfigSchema,
  greenhouseSourceConfigSchema,
  jobDetailSchema,
  jobSummarySchema,
  jobTechSourceConfigSchema,
  leverSourceConfigSchema,
  scanRunSchema,
  sourceSchema,
  sourceViewSchema,
  type CreateSourceRequest,
  type JobDetail,
  type JobSummary,
  type JobsQuery,
  type NormalizedJob,
  type RunCounts,
  type ScanRun,
  type Source,
  type SourceErrorCategory,
  type SourceHealthStatus,
  type SourceRun,
  type SourceView,
  type UpdateSourceRequest,
} from '@job-radar/shared';

import type { DatabaseClient } from './database.js';
import {
  jobSnapshots,
  jobSources,
  jobs,
  scanRuns,
  sourceRuns,
  sources,
} from './schema.js';

export const DEFAULT_JOBTECH_SOURCE_ID = '70000000-0000-4000-8000-000000000001';

const DEFAULT_REQUEST_POLICY = {
  detailConcurrency: 4,
  requestTimeoutMs: 10_000,
  maxRetries: 3,
  retryBaseDelayMs: 300,
  minRequestIntervalMs: 150,
  missingThreshold: 3,
  userAgent: 'Job-Radar/0.1 (local-first personal job search)',
} as const;

export const DEFAULT_JOBTECH_SOURCE_CONFIG = jobTechSourceConfigSchema.parse({
  kind: 'jobtech',
  queryMode: 'confirmed_profile_roles',
  pageSize: 25,
  maxPages: 4,
  ...DEFAULT_REQUEST_POLICY,
});

export class SourceRepositoryError extends Error {
  public constructor(
    public readonly code:
      'SOURCE_NOT_FOUND' | 'SOURCE_CONFLICT' | 'SOURCE_INVALID_UPDATE',
    message: string,
  ) {
    super(message);
    this.name = 'SourceRepositoryError';
  }
}

const emptyCounts = (): RunCounts => ({
  discovered: 0,
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  closed: 0,
  failed: 0,
});

function date(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function hashRawData(rawData: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(rawData)))
    .digest('hex');
}

function sourceFromRow(row: typeof sources.$inferSelect): Source {
  return sourceSchema.parse({
    id: row.id,
    type: row.type,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    config: row.config,
    lastSuccessAt: date(row.lastSuccessAt),
    lastError: row.lastError,
    lastErrorCategory: row.lastErrorCategory,
    healthStatus: row.healthStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function countsFromRow(
  row: Pick<
    typeof sourceRuns.$inferSelect,
    | 'discoveredCount'
    | 'fetchedCount'
    | 'createdCount'
    | 'updatedCount'
    | 'unchangedCount'
    | 'closedCount'
    | 'failedCount'
  >,
): RunCounts {
  return {
    discovered: row.discoveredCount,
    fetched: row.fetchedCount,
    created: row.createdCount,
    updated: row.updatedCount,
    unchanged: row.unchangedCount,
    closed: row.closedCount,
    failed: row.failedCount,
  };
}

export interface IngestResult {
  readonly outcome: 'created' | 'updated' | 'unchanged';
  readonly closed: boolean;
}

export interface CompleteSourceRunInput {
  readonly status: 'succeeded' | 'partial' | 'failed' | 'cancelled';
  readonly resultSetComplete: boolean | null;
  readonly pagesFetched: number;
  readonly counts: RunCounts;
  readonly errorCategory: SourceErrorCategory | null;
  readonly errorSummary: string | null;
  readonly finishedAt: Date;
}

export class JobRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public ensureDefaultSources(now = new Date()): Source {
    const existing = this.client.db
      .select()
      .from(sources)
      .where(eq(sources.id, DEFAULT_JOBTECH_SOURCE_ID))
      .get();
    if (!existing) {
      this.client.db
        .insert(sources)
        .values({
          id: DEFAULT_JOBTECH_SOURCE_ID,
          type: 'jobtech',
          name: 'JobTech / Platsbanken',
          baseUrl: 'https://jobsearch.api.jobtechdev.se',
          enabled: true,
          config: DEFAULT_JOBTECH_SOURCE_CONFIG,
          healthStatus: 'unknown',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    return sourceFromRow(
      this.client.db
        .select()
        .from(sources)
        .where(eq(sources.id, DEFAULT_JOBTECH_SOURCE_ID))
        .get()!,
    );
  }

  public listSources(): Source[] {
    return this.client.db
      .select()
      .from(sources)
      .where(isNull(sources.deletedAt))
      .orderBy(sources.name)
      .all()
      .map(sourceFromRow);
  }

  public getSource(sourceId: string): Source | null {
    const row = this.client.db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), isNull(sources.deletedAt)))
      .get();
    return row ? sourceFromRow(row) : null;
  }

  public createSource(input: CreateSourceRequest, now = new Date()): Source {
    const id = randomUUID();
    const common = { ...DEFAULT_REQUEST_POLICY };
    const values =
      input.type === 'greenhouse'
        ? {
            type: input.type,
            baseUrl: 'https://boards-api.greenhouse.io',
            config: greenhouseSourceConfigSchema.parse({
              kind: 'greenhouse',
              boardToken: input.identifier,
              companyName: input.companyName,
              ...common,
            }),
          }
        : input.type === 'lever'
          ? {
              type: input.type,
              baseUrl:
                input.region === 'eu'
                  ? 'https://api.eu.lever.co'
                  : 'https://api.lever.co',
              config: leverSourceConfigSchema.parse({
                kind: 'lever',
                site: input.identifier,
                companyName: input.companyName,
                region: input.region,
                pageSize: 50,
                maxPages: 20,
                ...common,
              }),
            }
          : {
              type: input.type,
              baseUrl: 'https://api.ashbyhq.com',
              config: ashbySourceConfigSchema.parse({
                kind: 'ashby',
                boardName: input.identifier,
                companyName: input.companyName,
                includeCompensation: input.includeCompensation,
                ...common,
              }),
            };

    const conflict = this.client.db
      .select({ id: sources.id })
      .from(sources)
      .where(
        and(
          eq(sources.type, input.type),
          eq(sources.name, input.name),
          isNull(sources.deletedAt),
        ),
      )
      .get();
    if (conflict) {
      throw new SourceRepositoryError(
        'SOURCE_CONFLICT',
        'A source with this type and name already exists',
      );
    }

    this.client.db
      .insert(sources)
      .values({
        id,
        name: input.name,
        enabled: true,
        healthStatus: 'unknown',
        createdAt: now,
        updatedAt: now,
        ...values,
      })
      .run();
    return this.getSource(id)!;
  }

  public updateSource(
    sourceId: string,
    input: UpdateSourceRequest,
    now = new Date(),
  ): Source {
    const current = this.getSource(sourceId);
    if (!current) {
      throw new SourceRepositoryError('SOURCE_NOT_FOUND', 'Source does not exist');
    }

    if (
      (input.region !== undefined && current.config.kind !== 'lever') ||
      (input.includeCompensation !== undefined && current.config.kind !== 'ashby') ||
      ((input.companyName !== undefined || input.identifier !== undefined) &&
        current.config.kind === 'jobtech')
    ) {
      throw new SourceRepositoryError(
        'SOURCE_INVALID_UPDATE',
        'This setting does not apply to the selected source type',
      );
    }

    let config = current.config;
    let baseUrl = current.baseUrl;
    if (config.kind === 'greenhouse') {
      config = greenhouseSourceConfigSchema.parse({
        ...config,
        ...(input.companyName ? { companyName: input.companyName } : {}),
        ...(input.identifier ? { boardToken: input.identifier } : {}),
      });
    } else if (config.kind === 'lever') {
      const region = input.region ?? config.region;
      config = leverSourceConfigSchema.parse({
        ...config,
        region,
        ...(input.companyName ? { companyName: input.companyName } : {}),
        ...(input.identifier ? { site: input.identifier } : {}),
      });
      baseUrl = region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co';
    } else if (config.kind === 'ashby') {
      config = ashbySourceConfigSchema.parse({
        ...config,
        ...(input.companyName ? { companyName: input.companyName } : {}),
        ...(input.identifier ? { boardName: input.identifier } : {}),
        ...(input.includeCompensation === undefined
          ? {}
          : { includeCompensation: input.includeCompensation }),
      });
    }

    if (input.name && input.name !== current.name) {
      const conflict = this.client.db
        .select({ id: sources.id })
        .from(sources)
        .where(
          and(
            eq(sources.type, current.type),
            eq(sources.name, input.name),
            isNull(sources.deletedAt),
          ),
        )
        .get();
      if (conflict) {
        throw new SourceRepositoryError(
          'SOURCE_CONFLICT',
          'A source with this type and name already exists',
        );
      }
    }

    this.client.db
      .update(sources)
      .set({
        name: input.name ?? current.name,
        enabled: input.enabled ?? current.enabled,
        baseUrl,
        config,
        updatedAt: now,
      })
      .where(eq(sources.id, sourceId))
      .run();
    return this.getSource(sourceId)!;
  }

  public deleteSource(sourceId: string, now = new Date()): void {
    if (!this.getSource(sourceId)) {
      throw new SourceRepositoryError('SOURCE_NOT_FOUND', 'Source does not exist');
    }
    this.client.db
      .update(sources)
      .set({ enabled: false, deletedAt: now, updatedAt: now })
      .where(eq(sources.id, sourceId))
      .run();
  }

  public listSourceViews(): SourceView[] {
    return this.listSources().map((source) => this.sourceView(source));
  }

  public getSourceView(sourceId: string): SourceView | null {
    const source = this.getSource(sourceId);
    return source ? this.sourceView(source) : null;
  }

  public getSources(sourceIds?: readonly string[]): Source[] {
    const rows = sourceIds
      ? this.client.db
          .select()
          .from(sources)
          .where(and(inArray(sources.id, [...sourceIds]), isNull(sources.deletedAt)))
          .all()
      : this.client.db
          .select()
          .from(sources)
          .where(and(eq(sources.enabled, true), isNull(sources.deletedAt)))
          .all();
    return rows.map(sourceFromRow);
  }

  public updateSourceHealth(
    sourceId: string,
    status: SourceHealthStatus,
    errorSummary: string | null,
    errorCategory: SourceErrorCategory | null,
    now: Date,
    recordSuccess = false,
  ): void {
    this.client.db
      .update(sources)
      .set({
        healthStatus: status,
        lastError: errorSummary,
        lastErrorCategory: errorCategory,
        ...(recordSuccess ? { lastSuccessAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(sources.id, sourceId))
      .run();
  }

  public createScan(
    profileVersion: number,
    selectedSources: readonly Source[],
    queries: readonly string[],
    now = new Date(),
  ): ScanRun {
    const scanRunId = randomUUID();
    this.client.db.transaction((transaction) => {
      transaction
        .insert(scanRuns)
        .values({
          id: scanRunId,
          status: 'queued',
          profileVersion,
          createdAt: now,
        })
        .run();
      for (const source of selectedSources) {
        transaction
          .insert(sourceRuns)
          .values({
            id: randomUUID(),
            scanRunId,
            sourceId: source.id,
            status: 'queued',
            queries: [...queries],
            createdAt: now,
          })
          .run();
      }
    });
    return this.getScan(scanRunId)!;
  }

  public markScanRunning(scanRunId: string, startedAt: Date): void {
    this.client.db
      .update(scanRuns)
      .set({ status: 'running', startedAt })
      .where(eq(scanRuns.id, scanRunId))
      .run();
  }

  public markSourceRunRunning(
    scanRunId: string,
    sourceId: string,
    startedAt: Date,
  ): void {
    this.client.db
      .update(sourceRuns)
      .set({ status: 'running', startedAt })
      .where(and(eq(sourceRuns.scanRunId, scanRunId), eq(sourceRuns.sourceId, sourceId)))
      .run();
  }

  public incrementSourceRetry(scanRunId: string, sourceId: string): void {
    this.client.db
      .update(sourceRuns)
      .set({ retryCount: sql`${sourceRuns.retryCount} + 1` })
      .where(and(eq(sourceRuns.scanRunId, scanRunId), eq(sourceRuns.sourceId, sourceId)))
      .run();
  }

  public ingestJob(
    source: Source,
    scanRunId: string,
    normalized: NormalizedJob,
    now: Date,
  ): IngestResult {
    const contentHash = hashRawData(normalized.rawData);
    const deadline = normalized.deadline ? new Date(normalized.deadline) : null;
    const publishedAt = normalized.publishedAt ? new Date(normalized.publishedAt) : null;
    const shouldBeActive =
      normalized.sourceActive &&
      (deadline === null || deadline.getTime() > now.getTime());

    return this.client.db.transaction((transaction): IngestResult => {
      const existingSource = transaction
        .select()
        .from(jobSources)
        .where(
          and(
            eq(jobSources.sourceId, source.id),
            eq(jobSources.sourceJobId, normalized.externalId),
          ),
        )
        .get();
      const canonicalKey = `${source.type}:${source.id}:${normalized.externalId}`;
      let existingJob = existingSource
        ? transaction.select().from(jobs).where(eq(jobs.id, existingSource.jobId)).get()
        : transaction
            .select()
            .from(jobs)
            .where(eq(jobs.canonicalKey, canonicalKey))
            .get();
      if (!existingJob && !existingSource) {
        const candidates = transaction
          .select({ job: jobs })
          .from(jobs)
          .innerJoin(jobSnapshots, eq(jobSnapshots.id, jobs.currentSnapshotId))
          .where(
            and(
              eq(
                sql`lower(trim(${jobs.company}))`,
                normalized.company.trim().toLowerCase(),
              ),
              eq(sql`lower(trim(${jobs.title}))`, normalized.title.trim().toLowerCase()),
              eq(
                sql`lower(trim(${jobs.location}))`,
                normalized.location.trim().toLowerCase(),
              ),
              eq(jobSnapshots.descriptionText, normalized.descriptionText),
            ),
          )
          .all();
        existingJob = candidates
          .map(({ job }) => job)
          .find(
            (candidate) =>
              !transaction
                .select({ jobId: jobSources.jobId })
                .from(jobSources)
                .where(
                  and(
                    eq(jobSources.jobId, candidate.id),
                    eq(jobSources.sourceId, source.id),
                  ),
                )
                .get(),
          );
      }
      const jobId = existingJob?.id ?? randomUUID();

      if (!existingJob) {
        transaction
          .insert(jobs)
          .values({
            id: jobId,
            canonicalKey,
            company: normalized.company,
            title: normalized.title,
            location: normalized.location,
            remoteMode: normalized.remoteMode,
            employmentType: normalized.employmentType,
            publishedAt,
            deadline,
            firstSeenAt: now,
            lastSeenAt: now,
            active: shouldBeActive,
            closedAt: shouldBeActive ? null : now,
            canonicalUrl: normalized.canonicalUrl,
          })
          .run();
      } else {
        transaction
          .update(jobs)
          .set({
            company: normalized.company,
            title: normalized.title,
            location: normalized.location,
            remoteMode: normalized.remoteMode,
            employmentType: normalized.employmentType,
            publishedAt,
            deadline,
            lastSeenAt: now,
            active: shouldBeActive,
            closedAt: shouldBeActive ? null : (existingJob.closedAt ?? now),
            canonicalUrl: normalized.canonicalUrl,
          })
          .where(eq(jobs.id, jobId))
          .run();
      }

      if (existingSource) {
        transaction
          .update(jobSources)
          .set({
            sourceUrl: normalized.sourceUrl,
            lastSeenAt: now,
            lastSeenScanRunId: scanRunId,
            consecutiveMisses: 0,
            active: shouldBeActive,
            sourceMetadata: normalized.sourceMetadata,
          })
          .where(and(eq(jobSources.jobId, jobId), eq(jobSources.sourceId, source.id)))
          .run();
      } else {
        transaction
          .insert(jobSources)
          .values({
            jobId,
            sourceId: source.id,
            sourceJobId: normalized.externalId,
            sourceUrl: normalized.sourceUrl,
            firstSeenAt: now,
            lastSeenAt: now,
            lastSeenScanRunId: scanRunId,
            consecutiveMisses: 0,
            active: shouldBeActive,
            sourceMetadata: normalized.sourceMetadata,
          })
          .run();
      }

      const hasActiveSource = transaction
        .select({ jobId: jobSources.jobId })
        .from(jobSources)
        .where(and(eq(jobSources.jobId, jobId), eq(jobSources.active, true)))
        .get();
      const active = Boolean(hasActiveSource);
      transaction
        .update(jobs)
        .set({
          active,
          closedAt: active ? null : (existingJob?.closedAt ?? now),
        })
        .where(eq(jobs.id, jobId))
        .run();

      const existingSnapshot = transaction
        .select()
        .from(jobSnapshots)
        .where(
          and(eq(jobSnapshots.jobId, jobId), eq(jobSnapshots.contentHash, contentHash)),
        )
        .get();
      let snapshotId = existingSnapshot?.id;
      if (!snapshotId) {
        snapshotId = randomUUID();
        transaction
          .insert(jobSnapshots)
          .values({
            id: snapshotId,
            jobId,
            contentHash,
            descriptionText: normalized.descriptionText,
            descriptionHtml: normalized.descriptionHtml,
            rawJson: normalized.rawData,
            fetchedAt: now,
          })
          .run();
      }
      transaction
        .update(jobs)
        .set({ currentSnapshotId: snapshotId })
        .where(eq(jobs.id, jobId))
        .run();

      return {
        outcome: !existingJob ? 'created' : existingSnapshot ? 'unchanged' : 'updated',
        closed: Boolean(existingJob?.active && !active),
      };
    });
  }

  public applyLifecycle(
    source: Source,
    seenExternalIds: ReadonlySet<string>,
    resultSetComplete: boolean,
    now: Date,
  ): number {
    const missingThreshold = source.config.missingThreshold;
    let closed = 0;

    this.client.db.transaction((transaction) => {
      const links = transaction
        .select()
        .from(jobSources)
        .where(eq(jobSources.sourceId, source.id))
        .all();
      const affectedJobIds = new Set<string>();

      for (const link of links) {
        affectedJobIds.add(link.jobId);
        if (!resultSetComplete || seenExternalIds.has(link.sourceJobId) || !link.active) {
          continue;
        }
        const misses = link.consecutiveMisses + 1;
        transaction
          .update(jobSources)
          .set({ consecutiveMisses: misses, active: misses < missingThreshold })
          .where(
            and(eq(jobSources.jobId, link.jobId), eq(jobSources.sourceId, source.id)),
          )
          .run();
      }

      for (const jobId of affectedJobIds) {
        const job = transaction.select().from(jobs).where(eq(jobs.id, jobId)).get();
        if (!job) continue;
        const hasActiveSource = transaction
          .select({ jobId: jobSources.jobId })
          .from(jobSources)
          .where(and(eq(jobSources.jobId, jobId), eq(jobSources.active, true)))
          .get();
        const active = Boolean(hasActiveSource);
        if (job.active && !active) closed += 1;
        transaction
          .update(jobs)
          .set({ active, closedAt: active ? null : (job.closedAt ?? now) })
          .where(eq(jobs.id, jobId))
          .run();
      }
    });

    return closed;
  }

  public completeSourceRun(
    scanRunId: string,
    sourceId: string,
    input: CompleteSourceRunInput,
  ): void {
    this.client.db
      .update(sourceRuns)
      .set({
        status: input.status,
        resultSetComplete: input.resultSetComplete,
        pagesFetched: input.pagesFetched,
        discoveredCount: input.counts.discovered,
        fetchedCount: input.counts.fetched,
        createdCount: input.counts.created,
        updatedCount: input.counts.updated,
        unchangedCount: input.counts.unchanged,
        closedCount: input.counts.closed,
        failedCount: input.counts.failed,
        errorCategory: input.errorCategory,
        errorSummary: input.errorSummary,
        finishedAt: input.finishedAt,
      })
      .where(and(eq(sourceRuns.scanRunId, scanRunId), eq(sourceRuns.sourceId, sourceId)))
      .run();
  }

  public requestCancellation(scanRunId: string, now = new Date()): boolean {
    const run = this.client.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, scanRunId))
      .get();
    if (!run || ['succeeded', 'partial', 'failed', 'cancelled'].includes(run.status)) {
      return false;
    }
    this.client.db
      .update(scanRuns)
      .set({ cancelRequestedAt: now })
      .where(eq(scanRuns.id, scanRunId))
      .run();
    return true;
  }

  public completeScan(scanRunId: string, now = new Date()): ScanRun {
    const runs = this.client.db
      .select()
      .from(sourceRuns)
      .where(eq(sourceRuns.scanRunId, scanRunId))
      .all();
    const scan = this.client.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, scanRunId))
      .get();
    if (!scan) throw new Error('Scan run does not exist');

    const counts = runs.reduce<RunCounts>((total, run) => {
      const current = countsFromRow(run);
      for (const key of Object.keys(total) as Array<keyof RunCounts>) {
        total[key] += current[key];
      }
      return total;
    }, emptyCounts());
    const statuses = runs.map((run) => run.status);
    const status =
      scan.cancelRequestedAt !== null || statuses.includes('cancelled')
        ? 'cancelled'
        : statuses.every((value) => value === 'succeeded')
          ? 'succeeded'
          : statuses.some((value) => value === 'succeeded' || value === 'partial')
            ? 'partial'
            : 'failed';
    const errorSummary =
      runs
        .flatMap((run) => (run.errorSummary ? [run.errorSummary] : []))
        .filter((value, index, all) => all.indexOf(value) === index)
        .join('; ')
        .slice(0, 500) || null;

    this.client.db
      .update(scanRuns)
      .set({
        status,
        discoveredCount: counts.discovered,
        fetchedCount: counts.fetched,
        createdCount: counts.created,
        updatedCount: counts.updated,
        unchangedCount: counts.unchanged,
        closedCount: counts.closed,
        failedCount: counts.failed,
        errorSummary,
        finishedAt: now,
      })
      .where(eq(scanRuns.id, scanRunId))
      .run();
    return this.getScan(scanRunId)!;
  }

  public getScan(scanRunId: string): ScanRun | null {
    const row = this.client.db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, scanRunId))
      .get();
    return row ? this.scanFromRow(row) : null;
  }

  public listScans(limit: number): ScanRun[] {
    return this.client.db
      .select()
      .from(scanRuns)
      .orderBy(desc(scanRuns.createdAt))
      .limit(limit)
      .all()
      .map((row) => this.scanFromRow(row));
  }

  public listJobs(query: JobsQuery): {
    jobs: JobSummary[];
    total: number;
    limit: number;
    offset: number;
  } {
    const searchPattern = `%${query.search.toLocaleLowerCase()}%`;
    const activeCondition =
      query.active === null ? undefined : eq(jobs.active, query.active);
    const searchCondition = query.search
      ? or(
          like(sql`lower(${jobs.title})`, searchPattern),
          like(sql`lower(${jobs.company})`, searchPattern),
          like(sql`lower(${jobs.location})`, searchPattern),
        )
      : undefined;
    const condition =
      activeCondition && searchCondition
        ? and(activeCondition, searchCondition)
        : (activeCondition ?? searchCondition);
    const countRow = this.client.db
      .select({ value: sql<number>`count(*)` })
      .from(jobs)
      .where(condition)
      .get();
    const rows = this.client.db
      .select({ job: jobs, sourceCount: sql<number>`count(${jobSources.sourceId})` })
      .from(jobs)
      .leftJoin(jobSources, eq(jobSources.jobId, jobs.id))
      .where(condition)
      .groupBy(jobs.id)
      .orderBy(desc(jobs.publishedAt), desc(jobs.firstSeenAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();

    return {
      jobs: rows.map(({ job, sourceCount }) => this.jobSummary(job, sourceCount)),
      total: countRow?.value ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  }

  public getJob(jobId: string): JobDetail | null {
    const job = this.client.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job?.currentSnapshotId) return null;
    const snapshot = this.client.db
      .select()
      .from(jobSnapshots)
      .where(eq(jobSnapshots.id, job.currentSnapshotId))
      .get();
    if (!snapshot) return null;
    const sourceRows = this.client.db
      .select({ link: jobSources, source: sources })
      .from(jobSources)
      .innerJoin(sources, eq(sources.id, jobSources.sourceId))
      .where(eq(jobSources.jobId, jobId))
      .all();
    const history = this.client.db
      .select()
      .from(jobSnapshots)
      .where(eq(jobSnapshots.jobId, jobId))
      .orderBy(desc(jobSnapshots.fetchedAt))
      .all();

    return jobDetailSchema.parse({
      ...this.jobSummary(job, sourceRows.length),
      sources: sourceRows.map(({ link, source }) => ({
        sourceId: source.id,
        sourceName: source.name,
        sourceJobId: link.sourceJobId,
        sourceUrl: link.sourceUrl,
        firstSeenAt: link.firstSeenAt.toISOString(),
        lastSeenAt: link.lastSeenAt.toISOString(),
        consecutiveMisses: link.consecutiveMisses,
        active: link.active,
        sourceMetadataStored: true,
      })),
      snapshot: {
        id: snapshot.id,
        contentHash: snapshot.contentHash,
        descriptionText: snapshot.descriptionText,
        descriptionHtml: snapshot.descriptionHtml,
        fetchedAt: snapshot.fetchedAt.toISOString(),
        rawResponseStored: true,
      },
      history: history.map((entry) => ({
        id: entry.id,
        contentHash: entry.contentHash,
        fetchedAt: entry.fetchedAt.toISOString(),
        rawResponseStored: true,
      })),
    });
  }

  private jobSummary(row: typeof jobs.$inferSelect, sourceCount: number): JobSummary {
    if (!row.currentSnapshotId) throw new Error('Job is missing its current snapshot');
    return jobSummarySchema.parse({
      id: row.id,
      company: row.company,
      title: row.title,
      location: row.location,
      remoteMode: row.remoteMode,
      employmentType: row.employmentType,
      publishedAt: date(row.publishedAt),
      deadline: date(row.deadline),
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      active: row.active,
      closedAt: date(row.closedAt),
      canonicalUrl: row.canonicalUrl,
      currentSnapshotId: row.currentSnapshotId,
      sourceCount,
    });
  }

  private scanFromRow(row: typeof scanRuns.$inferSelect): ScanRun {
    const runs = this.client.db
      .select({ run: sourceRuns, sourceName: sources.name })
      .from(sourceRuns)
      .innerJoin(sources, eq(sources.id, sourceRuns.sourceId))
      .where(eq(sourceRuns.scanRunId, row.id))
      .orderBy(sourceRuns.createdAt)
      .all();
    const sourceRunViews: SourceRun[] = runs.map(({ run, sourceName }) => ({
      id: run.id,
      scanRunId: run.scanRunId,
      sourceId: run.sourceId,
      sourceName,
      status: run.status,
      queries: run.queries,
      resultSetComplete: run.resultSetComplete,
      pagesFetched: run.pagesFetched,
      retryCount: run.retryCount,
      counts: countsFromRow(run),
      errorCategory: run.errorCategory,
      errorSummary: run.errorSummary,
      startedAt: date(run.startedAt),
      finishedAt: date(run.finishedAt),
      createdAt: run.createdAt.toISOString(),
    }));

    return scanRunSchema.parse({
      id: row.id,
      status: row.status,
      profileVersion: row.profileVersion,
      counts: {
        discovered: row.discoveredCount,
        fetched: row.fetchedCount,
        created: row.createdCount,
        updated: row.updatedCount,
        unchanged: row.unchangedCount,
        closed: row.closedCount,
        failed: row.failedCount,
      },
      errorSummary: row.errorSummary,
      cancelRequestedAt: date(row.cancelRequestedAt),
      startedAt: date(row.startedAt),
      finishedAt: date(row.finishedAt),
      createdAt: row.createdAt.toISOString(),
      sourceRuns: sourceRunViews,
    });
  }

  private sourceView(source: Source): SourceView {
    const runs = this.client.db
      .select()
      .from(sourceRuns)
      .where(eq(sourceRuns.sourceId, source.id))
      .orderBy(desc(sourceRuns.createdAt))
      .all();
    const metrics = runs.reduce(
      (total, run) => {
        total.totalRuns += 1;
        if (run.status === 'succeeded') total.successfulRuns += 1;
        if (run.status === 'partial') total.partialRuns += 1;
        if (run.status === 'failed') total.failedRuns += 1;
        if (run.status === 'cancelled') total.cancelledRuns += 1;
        total.totalRetries += run.retryCount;
        total.jobsDiscovered += run.discoveredCount;
        total.jobsFetched += run.fetchedCount;
        total.jobsCreated += run.createdCount;
        total.jobsUpdated += run.updatedCount;
        total.jobsFailed += run.failedCount;
        return total;
      },
      {
        totalRuns: 0,
        successfulRuns: 0,
        partialRuns: 0,
        failedRuns: 0,
        cancelledRuns: 0,
        totalRetries: 0,
        jobsDiscovered: 0,
        jobsFetched: 0,
        jobsCreated: 0,
        jobsUpdated: 0,
        jobsFailed: 0,
      },
    );
    const latest = runs[0];

    return sourceViewSchema.parse({
      ...source,
      metrics,
      latestRun: latest
        ? {
            id: latest.id,
            scanRunId: latest.scanRunId,
            sourceId: latest.sourceId,
            sourceName: source.name,
            status: latest.status,
            queries: latest.queries,
            resultSetComplete: latest.resultSetComplete,
            pagesFetched: latest.pagesFetched,
            retryCount: latest.retryCount,
            counts: countsFromRow(latest),
            errorCategory: latest.errorCategory,
            errorSummary: latest.errorSummary,
            startedAt: date(latest.startedAt),
            finishedAt: date(latest.finishedAt),
            createdAt: latest.createdAt.toISOString(),
          }
        : null,
    });
  }
}
