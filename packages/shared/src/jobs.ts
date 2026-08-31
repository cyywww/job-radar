import { z } from 'zod';

export const sourceTypeSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/);
export const sourceHealthStatusSchema = z.enum([
  'unknown',
  'healthy',
  'degraded',
  'unavailable',
]);

export const jobTechSourceConfigSchema = z
  .object({
    kind: z.literal('jobtech'),
    queryMode: z.literal('confirmed_profile_roles'),
    pageSize: z.number().int().min(1).max(100),
    maxPages: z.number().int().min(1).max(100),
    detailConcurrency: z.number().int().min(1).max(10),
    requestTimeoutMs: z.number().int().min(100).max(120_000),
    maxRetries: z.number().int().min(0).max(5),
    retryBaseDelayMs: z.number().int().min(10).max(10_000),
    minRequestIntervalMs: z.number().int().min(0).max(10_000),
    missingThreshold: z.number().int().min(1).max(10),
    userAgent: z.string().trim().min(1).max(240),
  })
  .strict();

export const sourceConfigSchema = z.discriminatedUnion('kind', [
  jobTechSourceConfigSchema,
]);

export const sourceSchema = z
  .object({
    id: z.string().uuid(),
    type: sourceTypeSchema,
    name: z.string().trim().min(1).max(120),
    baseUrl: z.string().url(),
    enabled: z.boolean(),
    config: sourceConfigSchema,
    lastSuccessAt: z.string().datetime({ offset: true }).nullable(),
    lastError: z.string().max(500).nullable(),
    healthStatus: sourceHealthStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const sourcesResponseSchema = z
  .object({ sources: z.array(sourceSchema) })
  .strict();

export const remoteModeSchema = z.enum(['onsite', 'hybrid', 'remote', 'unknown']);

export const normalizedJobSchema = z
  .object({
    externalId: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(500),
    company: z.string().trim().min(1).max(500),
    location: z.string().trim().min(1).max(500),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    deadline: z.string().datetime({ offset: true }).nullable(),
    descriptionText: z.string().min(1),
    descriptionHtml: z.string().min(1).nullable(),
    sourceUrl: z.string().url(),
    canonicalUrl: z.string().url(),
    remoteMode: remoteModeSchema,
    employmentType: z.string().trim().min(1).max(240).nullable(),
    sourceActive: z.boolean(),
    rawData: z.record(z.string(), z.unknown()),
  })
  .strict();

export const scanStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
]);
export const sourceRunStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'partial',
  'failed',
  'cancelled',
]);

export const runCountsSchema = z
  .object({
    discovered: z.number().int().nonnegative(),
    fetched: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .strict();

export const sourceRunSchema = z
  .object({
    id: z.string().uuid(),
    scanRunId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceName: z.string().min(1),
    status: sourceRunStatusSchema,
    queries: z.array(z.string()),
    resultSetComplete: z.boolean().nullable(),
    pagesFetched: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    counts: runCountsSchema,
    errorSummary: z.string().max(500).nullable(),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const scanRunSchema = z
  .object({
    id: z.string().uuid(),
    status: scanStatusSchema,
    profileVersion: z.number().int().positive(),
    counts: runCountsSchema,
    errorSummary: z.string().max(500).nullable(),
    cancelRequestedAt: z.string().datetime({ offset: true }).nullable(),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    sourceRuns: z.array(sourceRunSchema),
  })
  .strict();

export const createScanRequestSchema = z
  .object({ sourceIds: z.array(z.string().uuid()).min(1).max(20).optional() })
  .strict()
  .default({});
export const scansQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
  .strict();
export const scansResponseSchema = z.object({ scans: z.array(scanRunSchema) }).strict();

export const jobSummarySchema = z
  .object({
    id: z.string().uuid(),
    company: z.string().min(1),
    title: z.string().min(1),
    location: z.string().min(1),
    remoteMode: remoteModeSchema,
    employmentType: z.string().nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    deadline: z.string().datetime({ offset: true }).nullable(),
    firstSeenAt: z.string().datetime({ offset: true }),
    lastSeenAt: z.string().datetime({ offset: true }),
    active: z.boolean(),
    closedAt: z.string().datetime({ offset: true }).nullable(),
    canonicalUrl: z.string().url(),
    currentSnapshotId: z.string().uuid(),
    sourceCount: z.number().int().positive(),
  })
  .strict();

export const jobSourceSchema = z
  .object({
    sourceId: z.string().uuid(),
    sourceName: z.string().min(1),
    sourceJobId: z.string().min(1),
    sourceUrl: z.string().url(),
    firstSeenAt: z.string().datetime({ offset: true }),
    lastSeenAt: z.string().datetime({ offset: true }),
    consecutiveMisses: z.number().int().nonnegative(),
    active: z.boolean(),
  })
  .strict();

export const jobSnapshotSummarySchema = z
  .object({
    id: z.string().uuid(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    fetchedAt: z.string().datetime({ offset: true }),
    rawResponseStored: z.literal(true),
  })
  .strict();

export const jobSnapshotSchema = jobSnapshotSummarySchema.extend({
  descriptionText: z.string().min(1),
  descriptionHtml: z.string().nullable(),
});

export const jobDetailSchema = jobSummarySchema
  .extend({
    sources: z.array(jobSourceSchema).min(1),
    snapshot: jobSnapshotSchema,
    history: z.array(jobSnapshotSummarySchema),
  })
  .strict();

export const jobsQuerySchema = z
  .object({
    active: z
      .enum(['true', 'false', 'all'])
      .default('true')
      .transform((value) => (value === 'all' ? null : value === 'true')),
    search: z.string().trim().max(200).default(''),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export const jobsResponseSchema = z
  .object({
    jobs: z.array(jobSummarySchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourceHealthStatus = z.infer<typeof sourceHealthStatusSchema>;
export type JobTechSourceConfig = z.infer<typeof jobTechSourceConfigSchema>;
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type RemoteMode = z.infer<typeof remoteModeSchema>;
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;
export type RunCounts = z.infer<typeof runCountsSchema>;
export type SourceRun = z.infer<typeof sourceRunSchema>;
export type ScanRun = z.infer<typeof scanRunSchema>;
export type CreateScanRequest = z.infer<typeof createScanRequestSchema>;
export type JobsQuery = z.infer<typeof jobsQuerySchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
