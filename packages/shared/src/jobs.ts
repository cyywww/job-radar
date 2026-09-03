import { z } from 'zod';

export const sourceTypeSchema = z.enum(['jobtech', 'generic_web']);
export const sourceSupportLevelSchema = z.enum(['supported', 'limited']);
export const sourceHealthStatusSchema = z.enum([
  'unknown',
  'healthy',
  'degraded',
  'unavailable',
]);

export const sourceErrorCategorySchema = z.enum([
  'rate_limited',
  'timeout',
  'transport',
  'http_client',
  'http_server',
  'invalid_response',
  'not_found',
  'configuration',
  'unsafe_url',
  'partial_detail',
  'cancelled',
  'connector_unavailable',
  'unexpected',
]);

const requestPolicyShape = {
  detailConcurrency: z.number().int().min(1).max(10),
  requestTimeoutMs: z.number().int().min(100).max(120_000),
  maxRetries: z.number().int().min(0).max(5),
  retryBaseDelayMs: z.number().int().min(10).max(10_000),
  minRequestIntervalMs: z.number().int().min(0).max(10_000),
  missingThreshold: z.number().int().min(1).max(10),
  userAgent: z.string().trim().min(1).max(240),
};

export const jobTechSourceConfigSchema = z
  .object({
    kind: z.literal('jobtech'),
    queryMode: z.literal('confirmed_profile_roles'),
    occupationField: z.literal('apaJ_2ja_LuF'),
    pageSize: z.number().int().min(1).max(100),
    maxPages: z.number().int().min(1).max(20),
    ...requestPolicyShape,
  })
  .strict();

const companyNameSchema = z.string().trim().min(1).max(240);

const publicHttpsUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS is required')
  .refine((value) => !new URL(value).username && !new URL(value).password, {
    message: 'URL credentials are not allowed',
  });

export const genericWebSourceConfigSchema = z
  .object({
    kind: z.literal('generic_web'),
    startUrl: publicHttpsUrlSchema,
    companyName: companyNameSchema,
    maxPostings: z.number().int().min(1).max(500),
    ...requestPolicyShape,
  })
  .strict();

export const sourceConfigSchema = z.discriminatedUnion('kind', [
  jobTechSourceConfigSchema,
  genericWebSourceConfigSchema,
]);

export function sourceSupportForType(type: string): {
  supportLevel: z.infer<typeof sourceSupportLevelSchema>;
  reason: string;
} {
  const supportedType = sourceTypeSchema.parse(type);
  return supportedType === 'jobtech'
    ? {
        supportLevel: 'supported',
        reason: 'Primary Sweden source: official public JobTech API filtered to Data/IT.',
      }
    : {
        supportLevel: 'limited',
        reason:
          'Optional one-page HTTPS source accepting schema.org JobPosting JSON-LD only.',
      };
}

export const sourceSchema = z
  .object({
    id: z.string().uuid(),
    type: sourceTypeSchema,
    name: z.string().trim().min(1).max(120),
    baseUrl: z.string().url(),
    enabled: z.boolean(),
    configurationState: z.enum(['enabled', 'paused', 'deleted']),
    deletedAt: z.string().datetime({ offset: true }).nullable(),
    config: sourceConfigSchema,
    supportLevel: sourceSupportLevelSchema,
    supportReason: z.string().min(1).max(1_000),
    configVersion: z.number().int().positive(),
    lastSuccessAt: z.string().datetime({ offset: true }).nullable(),
    lastError: z.string().max(500).nullable(),
    lastErrorCategory: sourceErrorCategorySchema.nullable(),
    healthStatus: sourceHealthStatusSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const createSourceRequestSchema = z
  .object({
    type: z.literal('generic_web'),
    name: z.string().trim().min(1).max(120),
    companyName: companyNameSchema,
    startUrl: publicHttpsUrlSchema,
  })
  .strict();

export const updateSourceRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    companyName: companyNameSchema.optional(),
    startUrl: publicHttpsUrlSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one change is required');

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
    sourceMetadata: z.record(z.string(), z.unknown()),
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

export const runStageSchema = z.enum([
  'queued',
  'health',
  'discovery',
  'detail',
  'persist',
  'lifecycle',
  'scoring',
  'complete',
]);

export const sourceRunSchema = z
  .object({
    id: z.string().uuid(),
    scanRunId: z.string().uuid(),
    sourceId: z.string().uuid(),
    sourceName: z.string().min(1),
    configVersion: z.number().int().positive(),
    status: sourceRunStatusSchema,
    stage: runStageSchema,
    failureStage: z
      .enum(['health', 'discovery', 'detail', 'persist', 'lifecycle', 'scoring'])
      .nullable(),
    queries: z.array(z.string()),
    resultSetComplete: z.boolean().nullable(),
    pagesFetched: z.number().int().nonnegative(),
    retryCount: z.number().int().nonnegative(),
    counts: runCountsSchema,
    errorCategory: sourceErrorCategorySchema.nullable(),
    errorSummary: z.string().max(500).nullable(),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const sourceMetricsSchema = z
  .object({
    totalRuns: z.number().int().nonnegative(),
    successfulRuns: z.number().int().nonnegative(),
    partialRuns: z.number().int().nonnegative(),
    failedRuns: z.number().int().nonnegative(),
    cancelledRuns: z.number().int().nonnegative(),
    totalRetries: z.number().int().nonnegative(),
    jobsDiscovered: z.number().int().nonnegative(),
    jobsFetched: z.number().int().nonnegative(),
    jobsCreated: z.number().int().nonnegative(),
    jobsUpdated: z.number().int().nonnegative(),
    jobsFailed: z.number().int().nonnegative(),
  })
  .strict();

export const sourceViewSchema = sourceSchema
  .extend({
    metrics: sourceMetricsSchema,
    latestRun: sourceRunSchema.nullable(),
  })
  .strict();

export const sourcesResponseSchema = z
  .object({ sources: z.array(sourceViewSchema) })
  .strict();

export const sourceTestResultSchema = z
  .object({
    source: sourceViewSchema,
    status: sourceHealthStatusSchema,
    errorCategory: sourceErrorCategorySchema.nullable(),
    message: z.string().max(500).nullable(),
    retryCount: z.number().int().nonnegative(),
    checkedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const scanRunSchema = z
  .object({
    id: z.string().uuid(),
    status: scanStatusSchema,
    stage: runStageSchema,
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
    lastChangedAt: z.string().datetime({ offset: true }),
    active: z.boolean(),
    lifecycleStatus: z.enum(['open', 'possibly_closed', 'closed']),
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
    sourceType: sourceTypeSchema,
    sourceJobId: z.string().min(1),
    sourceUrl: z.string().url(),
    firstSeenAt: z.string().datetime({ offset: true }),
    lastSeenAt: z.string().datetime({ offset: true }),
    consecutiveMisses: z.number().int().nonnegative(),
    active: z.boolean(),
    lastChangedAt: z.string().datetime({ offset: true }),
    matchStrategy: z.enum([
      'new_job',
      'source_external_id',
      'canonical_url',
      'content_fingerprint',
      'company_title_location_published',
      'reprocessed',
    ]),
    matchExplanation: z.string().min(1).max(1_000),
    sourceMetadataStored: z.literal(true),
  })
  .strict();

export const jobSnapshotSummarySchema = z
  .object({
    id: z.string().uuid(),
    sourceId: z.string().uuid().nullable(),
    sourceName: z.string().min(1).nullable(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    company: z.string().min(1),
    title: z.string().min(1),
    location: z.string().min(1),
    deadline: z.string().datetime({ offset: true }).nullable(),
    changedFields: z.array(
      z.enum(['initial', 'description', 'location', 'deadline', 'title', 'company']),
    ),
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

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourceHealthStatus = z.infer<typeof sourceHealthStatusSchema>;
export type SourceErrorCategory = z.infer<typeof sourceErrorCategorySchema>;
export type JobTechSourceConfig = z.infer<typeof jobTechSourceConfigSchema>;
export type GenericWebSourceConfig = z.infer<typeof genericWebSourceConfigSchema>;
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type SourceView = z.infer<typeof sourceViewSchema>;
export type SourceTestResult = z.infer<typeof sourceTestResultSchema>;
export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export type UpdateSourceRequest = z.infer<typeof updateSourceRequestSchema>;
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;
export type RunCounts = z.infer<typeof runCountsSchema>;
export type SourceRun = z.infer<typeof sourceRunSchema>;
export type ScanRun = z.infer<typeof scanRunSchema>;
export type CreateScanRequest = z.infer<typeof createScanRequestSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;
