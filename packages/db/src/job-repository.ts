import { createHash, randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';

import {
  ashbySourceConfigSchema,
  canonicalizeJobUrl,
  compositeJobIdentity,
  genericWebSourceConfigSchema,
  greenhouseSourceConfigSchema,
  jobDetailSchema,
  jobSummarySchema,
  jobTechSourceConfigSchema,
  leverSourceConfigSchema,
  normalizeDescription,
  normalizeIdentityText,
  scanRunSchema,
  sourceSchema,
  sourceCapabilityForType,
  sourceViewSchema,
  teamtailorSourceConfigSchema,
  type CreateSourceRequest,
  type JobDetail,
  type JobSummary,
  type JobsQuery,
  type NormalizedJob,
  type ReprocessJobsResult,
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
  jobMergeEvents,
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

export class ScanAlreadyActiveError extends Error {
  public constructor() {
    super('A durable scan is already queued or running');
    this.name = 'ScanAlreadyActiveError';
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

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sourceFromRow(row: typeof sources.$inferSelect): Source {
  const capability = sourceCapabilityForType(row.type);
  return sourceSchema.parse({
    id: row.id,
    type: row.type,
    name: row.name,
    baseUrl: row.baseUrl,
    enabled: row.enabled,
    config: row.config,
    supportLevel: capability.supportLevel,
    supportReason: capability.reason,
    configVersion: row.configVersion,
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
    let values: Pick<
      typeof sources.$inferInsert,
      'type' | 'baseUrl' | 'config' | 'enabled'
    >;
    if (input.type === 'greenhouse') {
      values = {
        type: input.type,
        baseUrl: 'https://boards-api.greenhouse.io',
        enabled: true,
        config: greenhouseSourceConfigSchema.parse({
          kind: 'greenhouse',
          boardToken: input.identifier,
          companyName: input.companyName,
          ...common,
        }),
      };
    } else if (input.type === 'lever') {
      values = {
        type: input.type,
        baseUrl:
          input.region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co',
        enabled: true,
        config: leverSourceConfigSchema.parse({
          kind: 'lever',
          site: input.identifier,
          companyName: input.companyName,
          region: input.region,
          pageSize: 50,
          maxPages: 20,
          ...common,
        }),
      };
    } else if (input.type === 'ashby') {
      values = {
        type: input.type,
        baseUrl: 'https://api.ashbyhq.com',
        enabled: true,
        config: ashbySourceConfigSchema.parse({
          kind: 'ashby',
          boardName: input.identifier,
          companyName: input.companyName,
          includeCompensation: input.includeCompensation,
          ...common,
        }),
      };
    } else if (input.type === 'teamtailor') {
      const origins = {
        eu: 'https://api.teamtailor.com',
        na: 'https://api.na.teamtailor.com',
        au: 'https://api.au.teamtailor.com',
      } as const;
      values = {
        type: input.type,
        baseUrl: origins[input.region],
        enabled: false,
        config: teamtailorSourceConfigSchema.parse({
          kind: 'teamtailor',
          companyName: input.companyName,
          region: input.region,
          apiTokenEnv: input.apiTokenEnv,
          pageSize: 30,
          maxPages: 20,
          ...common,
        }),
      };
    } else {
      const startUrl = canonicalizeJobUrl(input.startUrl);
      values = {
        type: input.type,
        baseUrl: startUrl,
        enabled: false,
        config: genericWebSourceConfigSchema.parse({
          kind: 'generic_web',
          companyName: input.companyName,
          startUrl,
          maxPostings: 200,
          ...common,
        }),
      };
    }

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
      (input.region !== undefined &&
        current.config.kind !== 'lever' &&
        current.config.kind !== 'teamtailor') ||
      (input.includeCompensation !== undefined && current.config.kind !== 'ashby') ||
      (input.apiTokenEnv !== undefined && current.config.kind !== 'teamtailor') ||
      (input.startUrl !== undefined && current.config.kind !== 'generic_web') ||
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
    } else if (config.kind === 'teamtailor') {
      const region =
        input.region === 'eu' || input.region === 'na' || input.region === 'au'
          ? input.region
          : config.region;
      config = teamtailorSourceConfigSchema.parse({
        ...config,
        region,
        ...(input.companyName ? { companyName: input.companyName } : {}),
        ...(input.apiTokenEnv ? { apiTokenEnv: input.apiTokenEnv } : {}),
      });
      baseUrl = {
        eu: 'https://api.teamtailor.com',
        na: 'https://api.na.teamtailor.com',
        au: 'https://api.au.teamtailor.com',
      }[region];
    } else if (config.kind === 'generic_web') {
      const startUrl = input.startUrl
        ? canonicalizeJobUrl(input.startUrl)
        : config.startUrl;
      config = genericWebSourceConfigSchema.parse({
        ...config,
        startUrl,
        ...(input.companyName ? { companyName: input.companyName } : {}),
      });
      baseUrl = startUrl;
    }

    if (
      config.kind === 'lever' &&
      input.region &&
      !['global', 'eu'].includes(input.region)
    ) {
      throw new SourceRepositoryError(
        'SOURCE_INVALID_UPDATE',
        'This region does not apply to Lever',
      );
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
        configVersion:
          JSON.stringify(config) === JSON.stringify(current.config)
            ? current.configVersion
            : current.configVersion + 1,
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

  public hasActiveScan(): boolean {
    return Boolean(
      this.client.db
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(or(eq(scanRuns.status, 'queued'), eq(scanRuns.status, 'running')))
        .get(),
    );
  }

  public createScan(
    profileVersion: number,
    selectedSources: readonly Source[],
    queries: readonly string[],
    now = new Date(),
  ): ScanRun {
    const scanRunId = randomUUID();
    this.client.db.transaction((transaction) => {
      const existing = transaction
        .select({ id: scanRuns.id })
        .from(scanRuns)
        .where(or(eq(scanRuns.status, 'queued'), eq(scanRuns.status, 'running')))
        .get();
      if (existing) throw new ScanAlreadyActiveError();
      transaction
        .insert(scanRuns)
        .values({
          id: scanRunId,
          status: 'queued',
          dedupeKey: 'active-scan',
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
            configVersion: source.configVersion,
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
    const canonicalUrl = canonicalizeJobUrl(normalized.canonicalUrl);
    const sourceUrl = canonicalizeJobUrl(normalized.sourceUrl);
    const deadline = normalized.deadline ? new Date(normalized.deadline) : null;
    const publishedAt = normalized.publishedAt ? new Date(normalized.publishedAt) : null;
    const descriptionFingerprint = hashText(
      normalizeDescription(normalized.descriptionText),
    );
    const contentHash = hashText(
      JSON.stringify({
        company: normalizeIdentityText(normalized.company),
        title: normalizeIdentityText(normalized.title),
        location: normalizeIdentityText(normalized.location),
        deadline: deadline?.toISOString() ?? null,
        description: normalizeDescription(normalized.descriptionText),
      }),
    );
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
      type MatchStrategy =
        | 'new_job'
        | 'source_external_id'
        | 'canonical_url'
        | 'content_fingerprint'
        | 'company_title_location_published';
      let matchStrategy: MatchStrategy = existingSource
        ? 'source_external_id'
        : 'new_job';
      let matchEvidence: Record<string, unknown> = existingSource
        ? {
            sourceId: source.id,
            externalId: normalized.externalId,
            explanation: 'Matched the stable external ID within the same source.',
          }
        : {
            explanation: 'No prior deterministic identity matched; created a new job.',
          };

      if (!existingJob && !existingSource) {
        const sameSourceJobIds = new Set(
          transaction
            .select({ jobId: jobSources.jobId })
            .from(jobSources)
            .where(eq(jobSources.sourceId, source.id))
            .all()
            .map(({ jobId }) => jobId),
        );
        const candidates = transaction
          .select()
          .from(jobs)
          .orderBy(asc(jobs.firstSeenAt), asc(jobs.id))
          .all()
          .filter((candidate) => !sameSourceJobIds.has(candidate.id));
        const unique = (
          matches: Array<(typeof candidates)[number]>,
        ): (typeof candidates)[number] | undefined =>
          matches.length === 1 ? matches[0] : undefined;

        existingJob = unique(
          candidates.filter((candidate) => {
            try {
              return canonicalizeJobUrl(candidate.canonicalUrl) === canonicalUrl;
            } catch {
              return false;
            }
          }),
        );
        if (existingJob) {
          matchStrategy = 'canonical_url';
          matchEvidence = {
            canonicalUrl,
            explanation: 'Canonical URLs match after removing tracking and fragments.',
          };
        }

        if (!existingJob) {
          existingJob = unique(
            candidates.filter(
              (candidate) =>
                candidate.contentFingerprint === descriptionFingerprint &&
                normalizeIdentityText(candidate.company) ===
                  normalizeIdentityText(normalized.company) &&
                normalizeIdentityText(candidate.title) ===
                  normalizeIdentityText(normalized.title) &&
                normalizeIdentityText(candidate.location) ===
                  normalizeIdentityText(normalized.location),
            ),
          );
          if (existingJob) {
            matchStrategy = 'content_fingerprint';
            matchEvidence = {
              contentFingerprint: descriptionFingerprint,
              company: normalizeIdentityText(normalized.company),
              title: normalizeIdentityText(normalized.title),
              location: normalizeIdentityText(normalized.location),
              explanation:
                'Company, title, location, and normalized full-description fingerprint match.',
            };
          }
        }

        if (!existingJob) {
          const identity = compositeJobIdentity({
            company: normalized.company,
            title: normalized.title,
            location: normalized.location,
            publishedAt,
          });
          if (identity) {
            existingJob = unique(
              candidates.filter(
                (candidate) =>
                  compositeJobIdentity({
                    company: candidate.company,
                    title: candidate.title,
                    location: candidate.location,
                    publishedAt: candidate.publishedAt,
                  }) === identity,
              ),
            );
            if (existingJob) {
              matchStrategy = 'company_title_location_published';
              matchEvidence = {
                compositeIdentity: identity,
                explanation:
                  'A single existing job matched normalized company, title, location, and publication date.',
              };
            }
          }
        }
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
            lastChangedAt: now,
            contentFingerprint: descriptionFingerprint,
            canonicalSourceId: source.id,
            active: shouldBeActive,
            closedAt: shouldBeActive ? null : now,
            canonicalUrl,
          })
          .run();
      } else {
        transaction
          .update(jobs)
          .set({
            lastSeenAt: now,
          })
          .where(eq(jobs.id, jobId))
          .run();
      }

      const previousSnapshot = transaction
        .select()
        .from(jobSnapshots)
        .where(and(eq(jobSnapshots.jobId, jobId), eq(jobSnapshots.sourceId, source.id)))
        .orderBy(desc(jobSnapshots.fetchedAt), desc(jobSnapshots.id))
        .get();
      const changedFields: Array<
        'initial' | 'description' | 'location' | 'deadline' | 'title' | 'company'
      > = [];
      if (!previousSnapshot) {
        changedFields.push('initial');
      } else {
        if (
          normalizeDescription(previousSnapshot.descriptionText) !==
          normalizeDescription(normalized.descriptionText)
        )
          changedFields.push('description');
        if (
          normalizeIdentityText(previousSnapshot.location) !==
          normalizeIdentityText(normalized.location)
        )
          changedFields.push('location');
        if (
          (previousSnapshot.deadline?.getTime() ?? null) !== (deadline?.getTime() ?? null)
        )
          changedFields.push('deadline');
        if (
          normalizeIdentityText(previousSnapshot.title) !==
          normalizeIdentityText(normalized.title)
        )
          changedFields.push('title');
        if (
          normalizeIdentityText(previousSnapshot.company) !==
          normalizeIdentityText(normalized.company)
        )
          changedFields.push('company');
      }

      const existingSnapshot = transaction
        .select()
        .from(jobSnapshots)
        .where(
          and(
            eq(jobSnapshots.jobId, jobId),
            eq(jobSnapshots.sourceId, source.id),
            eq(jobSnapshots.contentHash, contentHash),
          ),
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
            sourceId: source.id,
            scanRunId,
            contentHash,
            company: normalized.company,
            title: normalized.title,
            location: normalized.location,
            deadline,
            descriptionText: normalized.descriptionText,
            descriptionHtml: normalized.descriptionHtml,
            rawJson: normalized.rawData,
            changedFields,
            fetchedAt: now,
          })
          .run();
      }

      if (existingSource) {
        transaction
          .update(jobSources)
          .set({
            sourceUrl,
            lastSeenAt: now,
            lastSeenScanRunId: scanRunId,
            consecutiveMisses: 0,
            active: shouldBeActive,
            lastChangedAt:
              existingSnapshot && existingSource.active === shouldBeActive
                ? existingSource.lastChangedAt
                : now,
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
            sourceUrl,
            firstSeenAt: now,
            lastSeenAt: now,
            lastSeenScanRunId: scanRunId,
            consecutiveMisses: 0,
            active: shouldBeActive,
            lastChangedAt: now,
            matchStrategy,
            matchEvidence,
            sourceMetadata: normalized.sourceMetadata,
          })
          .run();
      }

      if (existingJob && !existingSource && matchStrategy !== 'new_job') {
        transaction
          .insert(jobMergeEvents)
          .values({
            id: randomUUID(),
            jobId,
            sourceId: source.id,
            sourceJobId: normalized.externalId,
            scanRunId,
            matchStrategy,
            evidence: matchEvidence,
            createdAt: now,
          })
          .run();
      }

      const isCanonicalSource =
        !existingJob ||
        existingJob.canonicalSourceId === null ||
        existingJob.canonicalSourceId === source.id;
      if (isCanonicalSource) {
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
            canonicalUrl,
            contentFingerprint: descriptionFingerprint,
            canonicalSourceId: source.id,
            currentSnapshotId: snapshotId,
            ...(!existingSnapshot ? { lastChangedAt: now } : {}),
          })
          .where(eq(jobs.id, jobId))
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
          ...(existingJob && existingJob.active !== active ? { lastChangedAt: now } : {}),
        })
        .where(eq(jobs.id, jobId))
        .run();

      return {
        outcome: !existingJob
          ? 'created'
          : existingSource && existingSnapshot
            ? 'unchanged'
            : 'updated',
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
          .set({
            consecutiveMisses: misses,
            active: misses < missingThreshold,
            ...(misses >= missingThreshold ? { lastChangedAt: now } : {}),
          })
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
          .set({
            active,
            closedAt: active ? null : (job.closedAt ?? now),
            ...(job.active !== active ? { lastChangedAt: now } : {}),
          })
          .where(eq(jobs.id, jobId))
          .run();
      }
    });

    return closed;
  }

  public reprocessJobs(now = new Date()): ReprocessJobsResult {
    if (this.hasActiveScan()) throw new ScanAlreadyActiveError();
    const initialJobs = this.client.db
      .select()
      .from(jobs)
      .orderBy(asc(jobs.firstSeenAt), asc(jobs.id))
      .all();
    const snapshotsBefore =
      this.client.db
        .select({ count: sql<number>`count(*)` })
        .from(jobSnapshots)
        .get()?.count ?? 0;
    let canonicalUrlsUpdated = 0;
    let fingerprintsUpdated = 0;
    let merged = 0;

    this.client.db.transaction((transaction) => {
      for (const job of initialJobs) {
        const snapshot = job.currentSnapshotId
          ? transaction
              .select()
              .from(jobSnapshots)
              .where(eq(jobSnapshots.id, job.currentSnapshotId))
              .get()
          : undefined;
        if (!snapshot) continue;
        let canonicalUrl = job.canonicalUrl;
        try {
          canonicalUrl = canonicalizeJobUrl(job.canonicalUrl);
        } catch {
          // Historical invalid URLs remain visible but are never fetched by reprocessing.
        }
        const fingerprint = hashText(normalizeDescription(snapshot.descriptionText));
        if (canonicalUrl !== job.canonicalUrl) canonicalUrlsUpdated += 1;
        if (fingerprint !== job.contentFingerprint) fingerprintsUpdated += 1;
        const links = transaction
          .select()
          .from(jobSources)
          .where(eq(jobSources.jobId, job.id))
          .orderBy(asc(jobSources.firstSeenAt), asc(jobSources.sourceId))
          .all();
        const firstLink = links[0];
        for (const link of links) {
          try {
            const sourceUrl = canonicalizeJobUrl(link.sourceUrl);
            if (sourceUrl === link.sourceUrl) continue;
            canonicalUrlsUpdated += 1;
            transaction
              .update(jobSources)
              .set({ sourceUrl })
              .where(
                and(
                  eq(jobSources.jobId, link.jobId),
                  eq(jobSources.sourceId, link.sourceId),
                ),
              )
              .run();
          } catch {
            // Historical invalid source URLs remain visible but are never fetched here.
          }
        }
        transaction
          .update(jobs)
          .set({
            canonicalUrl,
            contentFingerprint: fingerprint,
            canonicalSourceId: job.canonicalSourceId ?? firstLink?.sourceId ?? null,
          })
          .where(eq(jobs.id, job.id))
          .run();
        if (firstLink) {
          transaction
            .update(jobSnapshots)
            .set({ sourceId: firstLink.sourceId })
            .where(and(eq(jobSnapshots.jobId, job.id), isNull(jobSnapshots.sourceId)))
            .run();
        }
      }

      let changed = true;
      while (changed) {
        changed = false;
        const current = transaction
          .select()
          .from(jobs)
          .orderBy(asc(jobs.firstSeenAt), asc(jobs.id))
          .all();
        type CurrentJob = (typeof current)[number];
        type ReprocessStrategy =
          'canonical_url' | 'content_fingerprint' | 'company_title_location_published';
        const sourceSets = new Map(
          current.map((job) => [
            job.id,
            new Set(
              transaction
                .select({ sourceId: jobSources.sourceId })
                .from(jobSources)
                .where(eq(jobSources.jobId, job.id))
                .all()
                .map(({ sourceId }) => sourceId),
            ),
          ]),
        );
        const findUniqueMatch = (
          subject: CurrentJob,
        ): { job: CurrentJob; strategy: ReprocessStrategy } | null => {
          const subjectSources = sourceSets.get(subject.id) ?? new Set<string>();
          const candidates = current.filter(
            (candidate) =>
              candidate.id !== subject.id &&
              ![...(sourceSets.get(candidate.id) ?? new Set<string>())].some((sourceId) =>
                subjectSources.has(sourceId),
              ),
          );
          const select = (
            matches: CurrentJob[],
            strategy: ReprocessStrategy,
          ): { job: CurrentJob; strategy: ReprocessStrategy } | null | undefined =>
            matches.length === 0
              ? undefined
              : matches.length === 1
                ? { job: matches[0]!, strategy }
                : null;

          const urlMatch = select(
            candidates.filter(
              (candidate) => candidate.canonicalUrl === subject.canonicalUrl,
            ),
            'canonical_url',
          );
          if (urlMatch !== undefined) return urlMatch;

          const contentMatch = select(
            candidates.filter(
              (candidate) =>
                subject.contentFingerprint !== '' &&
                subject.contentFingerprint === candidate.contentFingerprint &&
                normalizeIdentityText(subject.company) ===
                  normalizeIdentityText(candidate.company) &&
                normalizeIdentityText(subject.title) ===
                  normalizeIdentityText(candidate.title) &&
                normalizeIdentityText(subject.location) ===
                  normalizeIdentityText(candidate.location),
            ),
            'content_fingerprint',
          );
          if (contentMatch !== undefined) return contentMatch;

          const composite = compositeJobIdentity({
            company: subject.company,
            title: subject.title,
            location: subject.location,
            publishedAt: subject.publishedAt,
          });
          if (!composite) return null;
          return (
            select(
              candidates.filter(
                (candidate) =>
                  compositeJobIdentity({
                    company: candidate.company,
                    title: candidate.title,
                    location: candidate.location,
                    publishedAt: candidate.publishedAt,
                  }) === composite,
              ),
              'company_title_location_published',
            ) ?? null
          );
        };

        for (let keeperIndex = 0; keeperIndex < current.length; keeperIndex += 1) {
          const keeper = current[keeperIndex];
          if (!keeper) continue;
          const match = findUniqueMatch(keeper);
          if (!match) continue;
          const duplicateIndex = current.findIndex((job) => job.id === match.job.id);
          if (duplicateIndex < keeperIndex) continue;
          const reverse = findUniqueMatch(match.job);
          if (
            !reverse ||
            reverse.job.id !== keeper.id ||
            reverse.strategy !== match.strategy
          ) {
            continue;
          }
          const duplicate = match.job;
          const strategy = match.strategy;
          const explanation = `Historical jobs were deterministically merged during reprocessing by ${strategy.replaceAll('_', ' ')}.`;
          transaction
            .update(jobSnapshots)
            .set({ jobId: keeper.id })
            .where(eq(jobSnapshots.jobId, duplicate.id))
            .run();
          transaction
            .update(jobSources)
            .set({
              jobId: keeper.id,
              matchStrategy: 'reprocessed',
              matchEvidence: { explanation, originalStrategy: strategy },
            })
            .where(eq(jobSources.jobId, duplicate.id))
            .run();
          transaction
            .update(jobMergeEvents)
            .set({ jobId: keeper.id })
            .where(eq(jobMergeEvents.jobId, duplicate.id))
            .run();
          transaction
            .insert(jobMergeEvents)
            .values({
              id: randomUUID(),
              jobId: keeper.id,
              absorbedJobId: duplicate.id,
              matchStrategy: 'reprocessed',
              evidence: { explanation, originalStrategy: strategy },
              createdAt: now,
            })
            .run();
          transaction
            .update(jobs)
            .set({
              firstSeenAt:
                keeper.firstSeenAt < duplicate.firstSeenAt
                  ? keeper.firstSeenAt
                  : duplicate.firstSeenAt,
              lastSeenAt:
                keeper.lastSeenAt > duplicate.lastSeenAt
                  ? keeper.lastSeenAt
                  : duplicate.lastSeenAt,
              lastChangedAt: now,
              active: keeper.active || duplicate.active,
              closedAt: keeper.active || duplicate.active ? null : keeper.closedAt,
            })
            .where(eq(jobs.id, keeper.id))
            .run();
          transaction.delete(jobs).where(eq(jobs.id, duplicate.id)).run();
          merged += 1;
          changed = true;
          break;
        }
      }
    });

    const snapshotsAfter =
      this.client.db
        .select({ count: sql<number>`count(*)` })
        .from(jobSnapshots)
        .get()?.count ?? 0;
    if (snapshotsAfter !== snapshotsBefore) {
      throw new Error('Job reprocessing changed immutable snapshot history');
    }
    return {
      processed: initialJobs.length,
      canonicalUrlsUpdated,
      fingerprintsUpdated,
      merged,
      snapshotsPreserved: snapshotsAfter,
    };
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
        sourceType: source.type,
        sourceJobId: link.sourceJobId,
        sourceUrl: link.sourceUrl,
        firstSeenAt: link.firstSeenAt.toISOString(),
        lastSeenAt: link.lastSeenAt.toISOString(),
        consecutiveMisses: link.consecutiveMisses,
        active: link.active,
        lastChangedAt: link.lastChangedAt.toISOString(),
        matchStrategy: link.matchStrategy,
        matchExplanation:
          typeof link.matchEvidence.explanation === 'string'
            ? link.matchEvidence.explanation
            : 'Deterministic source identity was recorded.',
        sourceMetadataStored: true,
      })),
      snapshot: {
        id: snapshot.id,
        sourceId: snapshot.sourceId,
        sourceName:
          sourceRows.find(({ source }) => source.id === snapshot.sourceId)?.source.name ??
          null,
        contentHash: snapshot.contentHash,
        company: snapshot.company,
        title: snapshot.title,
        location: snapshot.location,
        deadline: date(snapshot.deadline),
        changedFields: snapshot.changedFields,
        descriptionText: snapshot.descriptionText,
        descriptionHtml: snapshot.descriptionHtml,
        fetchedAt: snapshot.fetchedAt.toISOString(),
        rawResponseStored: true,
      },
      history: history.map((entry) => ({
        id: entry.id,
        sourceId: entry.sourceId,
        sourceName:
          sourceRows.find(({ source }) => source.id === entry.sourceId)?.source.name ??
          null,
        contentHash: entry.contentHash,
        company: entry.company,
        title: entry.title,
        location: entry.location,
        deadline: date(entry.deadline),
        changedFields: entry.changedFields,
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
      lastChangedAt: row.lastChangedAt.toISOString(),
      active: row.active,
      lifecycleStatus: this.lifecycleStatus(row.id, row.active),
      closedAt: date(row.closedAt),
      canonicalUrl: row.canonicalUrl,
      currentSnapshotId: row.currentSnapshotId,
      sourceCount,
    });
  }

  private lifecycleStatus(
    jobId: string,
    active: boolean,
  ): 'open' | 'possibly_closed' | 'closed' {
    if (!active) return 'closed';
    const confirmedOpen = this.client.db
      .select({ jobId: jobSources.jobId })
      .from(jobSources)
      .where(
        and(
          eq(jobSources.jobId, jobId),
          eq(jobSources.active, true),
          eq(jobSources.consecutiveMisses, 0),
        ),
      )
      .get();
    return confirmedOpen ? 'open' : 'possibly_closed';
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
      configVersion: run.configVersion,
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
            configVersion: latest.configVersion,
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
