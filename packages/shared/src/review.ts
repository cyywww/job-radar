import { z } from 'zod';

import {
  jobDetailSchema,
  jobSummarySchema,
  remoteModeSchema,
  scanRunSchema,
  sourceHealthStatusSchema,
} from './jobs.js';
import {
  jobRequirementSchema,
  jobScoreSchema,
  scoreReviewStateSchema,
  scoringAttemptSchema,
  scoringTaskSchema,
  scoringTaskStatusSchema,
} from './scoring.js';

export const STRONG_MATCH_THRESHOLD = 80;
export const SAVED_JOB_FILTERS_VERSION = 1;

export const triageStatusSchema = z.enum(['new', 'shortlisted', 'ignored', 'archived']);

export const triageRecordSchema = z
  .object({
    jobId: z.string().uuid(),
    status: triageStatusSchema,
    note: z.string().max(500).nullable(),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const updateTriageRequestSchema = z
  .object({
    status: triageStatusSchema,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const updateTriageResponseSchema = z
  .object({
    current: triageRecordSchema,
    previous: triageRecordSchema,
  })
  .strict();

export const bulkTriageRequestSchema = z
  .object({
    jobIds: z.array(z.string().uuid()).min(1).max(100),
    status: triageStatusSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.jobIds).size !== value.jobIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['jobIds'],
        message: 'Job IDs must be unique',
      });
    }
  });

export const bulkTriageResponseSchema = z
  .object({
    current: z.array(triageRecordSchema),
    previous: z.array(triageRecordSchema),
  })
  .strict();

export const restoreTriageRequestSchema = z
  .object({
    records: z
      .array(
        z
          .object({
            jobId: z.string().uuid(),
            status: triageStatusSchema,
            note: z.string().max(500).nullable(),
            updatedAt: z.string().datetime({ offset: true }).nullable(),
          })
          .strict()
          .superRefine((record, context) => {
            if (
              record.updatedAt === null &&
              (record.status !== 'new' || record.note !== null)
            ) {
              context.addIssue({
                code: 'custom',
                path: ['updatedAt'],
                message: 'Only an implicit new triage record can omit updatedAt',
              });
            }
          }),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.records.map(({ jobId }) => jobId)).size !== value.records.length) {
      context.addIssue({
        code: 'custom',
        path: ['records'],
        message: 'Job IDs must be unique',
      });
    }
  });

export const restoreTriageResponseSchema = z
  .object({ current: z.array(triageRecordSchema) })
  .strict();

export const scoreDisplayStateSchema = z.enum([
  'unscored',
  'pending',
  'running',
  'failed',
  'retry_wait',
  'review',
  'scored',
  'gate_failed',
]);

export const jobScoreSummarySchema = z
  .object({
    state: scoreDisplayStateSchema,
    taskId: z.string().uuid().nullable(),
    taskStatus: scoringTaskStatusSchema.nullable(),
    matchScore: z.number().int().min(0).max(100).nullable(),
    rankingScore: z.number().int().min(0).max(100).nullable(),
    eligible: z.boolean().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    unknownCount: z.number().int().nonnegative(),
    reviewState: scoreReviewStateSchema.nullable(),
    scoringVersion: z.string().min(1).max(80).nullable(),
    lastErrorCode: z.string().max(80).nullable(),
    lastErrorSummary: z.string().max(500).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.state === 'gate_failed' &&
      (value.matchScore !== null || value.rankingScore !== null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['matchScore'],
        message: 'Gate failure cannot be represented by numeric scores',
      });
    }
  });

export const reviewJobSummarySchema = jobSummarySchema
  .extend({
    triage: triageRecordSchema,
    score: jobScoreSummarySchema,
    sourceNames: z.array(z.string().min(1)).min(1),
    extractedSkills: z.array(z.string().min(1).max(120)).max(200),
  })
  .strict();

export const jobSortFieldSchema = z.enum([
  'matchScore',
  'rankingScore',
  'publishedAt',
  'deadline',
  'lastChangedAt',
]);
export const sortDirectionSchema = z.enum(['asc', 'desc']);
export const lifecycleFilterSchema = z.enum(['open', 'possibly_closed', 'closed']);
export const gateFilterSchema = z.enum(['passed', 'failed', 'unscored']);

const optionalFilterText = z.string().trim().min(1).max(160).optional();

export const reviewJobsQuerySchema = z
  .object({
    search: z.string().trim().max(200).default(''),
    triage: triageStatusSchema.optional(),
    location: optionalFilterText,
    remoteMode: remoteModeSchema.optional(),
    company: optionalFilterText,
    sourceId: z.string().uuid().optional(),
    lifecycle: lifecycleFilterSchema.optional(),
    gate: gateFilterSchema.optional(),
    scoreStatus: scoreDisplayStateSchema.optional(),
    reviewState: scoreReviewStateSchema.optional(),
    includeClosed: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    sort: jobSortFieldSchema.default('rankingScore'),
    direction: sortDirectionSchema.default('desc'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
  })
  .strict();

export const reviewJobsResponseSchema = z
  .object({
    jobs: z.array(reviewJobSummarySchema),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export const feedbackTypeSchema = z.enum([
  'job_specific',
  'scoring_rule',
  'preference',
  'profile_correction',
]);

export const createFeedbackRequestSchema = z
  .object({
    type: feedbackTypeSchema,
    suggestedScore: z.number().int().min(0).max(100).nullable().optional(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const scoreFeedbackSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    scoreId: z.string().uuid().nullable(),
    type: feedbackTypeSchema,
    originalScore: z.number().int().min(0).max(100).nullable(),
    suggestedScore: z.number().int().min(0).max(100).nullable(),
    reason: z.string().min(1).max(1_000),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const updateScoreReviewRequestSchema = z
  .object({
    state: z.enum(['pending', 'approved', 'rejected']),
    reason: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const scoreReviewEventSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    scoreId: z.string().uuid(),
    previousState: scoreReviewStateSchema,
    state: z.enum(['pending', 'approved', 'rejected']),
    reason: z.string().min(1).max(1_000),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const jobReviewDetailSchema = z
  .object({
    job: jobDetailSchema,
    triage: triageRecordSchema,
    currentScore: jobScoreSchema.nullable(),
    currentRequirement: jobRequirementSchema.nullable(),
    scoreHistory: z.array(jobScoreSchema),
    tasks: z.array(scoringTaskSchema),
    attempts: z.array(scoringAttemptSchema),
    feedback: z.array(scoreFeedbackSchema),
    reviewHistory: z.array(scoreReviewEventSchema),
  })
  .strict();

export const bulkRescoreRequestSchema = z
  .object({ jobIds: z.array(z.string().uuid()).min(1).max(100) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.jobIds).size !== value.jobIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['jobIds'],
        message: 'Job IDs must be unique',
      });
    }
  });

export const bulkRescoreResponseSchema = z
  .object({ tasks: z.array(scoringTaskSchema) })
  .strict();

export const retryFailedScoringRequestSchema = z
  .object({ limit: z.number().int().min(1).max(100).default(25) })
  .strict();

export const retryFailedScoringResponseSchema = z
  .object({ tasks: z.array(scoringTaskSchema) })
  .strict();

export const refreshJobResponseSchema = z
  .object({ scan: scanRunSchema, jobId: z.string().uuid() })
  .strict();

export const dashboardSourceHealthSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1),
    enabled: z.boolean(),
    healthStatus: sourceHealthStatusSchema,
    lastSuccessAt: z.string().datetime({ offset: true }).nullable(),
    lastError: z.string().max(500).nullable(),
  })
  .strict();

export const dashboardResponseSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    todayBoundary: z.string().datetime({ offset: true }),
    profileReady: z.boolean(),
    strongMatchThreshold: z.literal(STRONG_MATCH_THRESHOLD),
    counts: z
      .object({
        newToday: z.number().int().nonnegative(),
        strongMatches: z.number().int().nonnegative(),
        pendingScoring: z.number().int().nonnegative(),
        pendingReview: z.number().int().nonnegative(),
        closed: z.number().int().nonnegative(),
      })
      .strict(),
    sources: z.array(dashboardSourceHealthSchema),
    latestScan: scanRunSchema.nullable(),
    topJobs: z.array(reviewJobSummarySchema).max(10),
  })
  .strict();

export const scanPhaseSchema = z.enum([
  'queued',
  'health',
  'discovery',
  'detail',
  'persist',
  'lifecycle',
  'scoring',
  'complete',
]);

export const scanEventSchema = z
  .object({
    scan: scanRunSchema,
    phase: scanPhaseSchema,
    terminal: z.boolean(),
    emittedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const savedJobFiltersSchema = z
  .object({
    version: z.literal(SAVED_JOB_FILTERS_VERSION),
    view: z.enum(['table', 'cards']),
    filters: z
      .object({
        search: z.string().trim().max(200),
        triage: triageStatusSchema.optional(),
        location: optionalFilterText,
        remoteMode: remoteModeSchema.optional(),
        company: optionalFilterText,
        sourceId: z.string().uuid().optional(),
        lifecycle: lifecycleFilterSchema.optional(),
        gate: gateFilterSchema.optional(),
        scoreStatus: scoreDisplayStateSchema.optional(),
        reviewState: scoreReviewStateSchema.optional(),
        includeClosed: z.boolean(),
        sort: jobSortFieldSchema,
        direction: sortDirectionSchema,
      })
      .strict(),
  })
  .strict();

export type TriageStatus = z.infer<typeof triageStatusSchema>;
export type TriageRecord = z.infer<typeof triageRecordSchema>;
export type UpdateTriageRequest = z.infer<typeof updateTriageRequestSchema>;
export type BulkTriageRequest = z.infer<typeof bulkTriageRequestSchema>;
export type JobScoreSummary = z.infer<typeof jobScoreSummarySchema>;
export type ReviewJobSummary = z.infer<typeof reviewJobSummarySchema>;
export type ReviewJobsQuery = z.infer<typeof reviewJobsQuerySchema>;
export type FeedbackType = z.infer<typeof feedbackTypeSchema>;
export type CreateFeedbackRequest = z.infer<typeof createFeedbackRequestSchema>;
export type ScoreFeedback = z.infer<typeof scoreFeedbackSchema>;
export type ScoreReviewEvent = z.infer<typeof scoreReviewEventSchema>;
export type JobReviewDetail = z.infer<typeof jobReviewDetailSchema>;
export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
export type ScanEvent = z.infer<typeof scanEventSchema>;
export type SavedJobFilters = z.infer<typeof savedJobFiltersSchema>;
