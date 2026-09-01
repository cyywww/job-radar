import { z } from 'zod';

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const requirementIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const jdSnippetSchema = boundedText(500);

export const fitSchema = z.enum(['full', 'partial', 'none', 'unknown']);
export const evidenceDepthSchema = z.enum(['mentioned', 'demonstrated', 'outcome']);
export const scoringDimensionSchema = z.enum([
  'required_skills',
  'skill_depth',
  'responsibilities',
  'seniority',
  'domain',
  'location',
  'soft_preferences',
  'eligibility',
]);

export const extractedSkillSchema = z
  .object({
    id: requirementIdSchema,
    name: boundedText(120),
    minimumYears: z.number().finite().min(0).max(80).nullable(),
    jdSnippet: jdSnippetSchema,
  })
  .strict();

export const extractedResponsibilitySchema = z
  .object({
    id: requirementIdSchema,
    text: boundedText(500),
    jdSnippet: jdSnippetSchema,
  })
  .strict();

export const extractedLanguageSchema = z
  .object({
    id: requirementIdSchema,
    language: boundedText(100),
    requirement: z.enum(['required', 'preferred']),
    minimumProficiency: z.enum([
      'basic',
      'conversational',
      'professional',
      'fluent',
      'native',
      'unknown',
    ]),
    jdSnippet: jdSnippetSchema,
  })
  .strict();

export const extractedWorkAuthorizationSchema = z
  .object({
    policy: z.enum([
      'not_stated',
      'authorized_in_country',
      'citizenship_required',
      'no_sponsorship',
      'sponsorship_available',
      'unknown',
    ]),
    countries: z.array(boundedText(100)).max(20),
    jdSnippet: jdSnippetSchema.nullable(),
  })
  .strict();

export const extractedEducationSchema = z
  .object({
    required: z.boolean(),
    level: z.enum([
      'secondary',
      'vocational',
      'bachelor',
      'master',
      'doctorate',
      'unspecified',
    ]),
    fields: z.array(boundedText(120)).max(20),
    jdSnippet: jdSnippetSchema.nullable(),
  })
  .strict();

export const extractedDomainSchema = z
  .object({
    id: requirementIdSchema,
    name: boundedText(120),
    requirement: z.enum(['required', 'preferred', 'context']),
    jdSnippet: jdSnippetSchema,
  })
  .strict();

export const extractedLocationPolicySchema = z
  .object({
    workMode: z.enum(['onsite', 'hybrid', 'remote', 'mixed', 'unknown']),
    locations: z.array(boundedText(160)).max(30),
    remoteCountries: z.array(boundedText(100)).max(30),
    onsiteDaysPerWeek: z.number().int().min(0).max(7).nullable(),
    jdSnippet: jdSnippetSchema.nullable(),
  })
  .strict();

export const extractedSalarySchema = z
  .object({
    minimum: z.number().finite().nonnegative().nullable(),
    maximum: z.number().finite().nonnegative().nullable(),
    currency: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    period: z.enum(['hour', 'month', 'year']).nullable(),
    jdSnippet: jdSnippetSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.minimum !== null &&
      value.maximum !== null &&
      value.maximum < value.minimum
    ) {
      context.addIssue({
        code: 'custom',
        path: ['maximum'],
        message: 'Salary maximum must not be below minimum',
      });
    }
  });

export const extractedSecurityClearanceSchema = z
  .object({
    required: z.boolean(),
    name: boundedText(120).nullable(),
    citizenshipCountries: z.array(boundedText(100)).max(20),
    jdSnippet: jdSnippetSchema.nullable(),
  })
  .strict();

export const matchedEvidenceSchema = z
  .object({
    requirementId: requirementIdSchema,
    dimension: scoringDimensionSchema,
    jdSnippet: jdSnippetSchema,
    profileEvidenceId: z.string().uuid(),
    explanation: boundedText(500),
    evidenceDepth: evidenceDepthSchema,
  })
  .strict();

export const extractedGapSchema = z
  .object({
    requirementId: requirementIdSchema.nullable(),
    dimension: scoringDimensionSchema,
    severity: z.enum(['required', 'preferred', 'informational']),
    requirement: boundedText(300),
    explanation: boundedText(500),
  })
  .strict();

export const extractedUnknownSchema = z
  .object({
    code: boundedText(80),
    dimension: scoringDimensionSchema,
    question: boundedText(300),
    explanation: boundedText(500),
  })
  .strict();

export const jobExtractionSchema = z
  .object({
    requiredSkills: z.array(extractedSkillSchema).max(100),
    preferredSkills: z.array(extractedSkillSchema).max(100),
    responsibilities: z.array(extractedResponsibilitySchema).max(100),
    seniority: z.enum([
      'intern',
      'junior',
      'mid',
      'senior',
      'lead',
      'manager',
      'director',
      'executive',
      'unknown',
    ]),
    yearsRequired: z.number().finite().min(0).max(80).nullable(),
    languages: z.array(extractedLanguageSchema).max(30),
    workAuthorization: extractedWorkAuthorizationSchema,
    education: extractedEducationSchema,
    domain: z.array(extractedDomainSchema).max(30),
    locationPolicy: extractedLocationPolicySchema,
    salary: extractedSalarySchema,
    securityClearance: extractedSecurityClearanceSchema,
    matchedEvidence: z.array(matchedEvidenceSchema).max(300),
    gaps: z.array(extractedGapSchema).max(200),
    unknowns: z.array(extractedUnknownSchema).max(200),
    seniorityFit: fitSchema,
    roleFit: fitSchema,
    confidence: z.number().finite().min(0).max(1),
    extractorVersion: boundedText(80),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = [
      ...value.requiredSkills,
      ...value.preferredSkills,
      ...value.responsibilities,
      ...value.languages,
      ...value.domain,
    ].map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Extracted requirement IDs must be unique',
      });
    }
  });

export const gateReasonCodeSchema = z.enum([
  'job_closed',
  'company_excluded',
  'role_type_excluded',
  'work_authorization',
  'citizenship',
  'location',
  'remote_compatibility',
  'required_language',
  'security_clearance',
]);

export const gateReasonSchema = z
  .object({
    code: gateReasonCodeSchema,
    outcome: z.enum(['pass', 'fail', 'unknown']),
    explanation: boundedText(500),
  })
  .strict();

export const eligibilityGateResultSchema = z
  .object({
    eligible: z.boolean(),
    reasons: z.array(gateReasonSchema).min(1).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.eligible === value.reasons.some(({ outcome }) => outcome === 'fail')) {
      context.addIssue({
        code: 'custom',
        path: ['eligible'],
        message: 'Eligibility must be false exactly when at least one Gate reason fails',
      });
    }
  });

export const scoreComponentSchema = z
  .object({
    weight: z.number().int().min(0).max(100),
    ratio: z.number().finite().min(0).max(1),
    points: z.number().int().min(0).max(100),
    explanation: boundedText(500),
  })
  .strict();

export const scoreBreakdownSchema = z
  .object({
    requiredSkills: scoreComponentSchema,
    skillDepth: scoreComponentSchema,
    responsibilities: scoreComponentSchema,
    seniority: scoreComponentSchema,
    domain: scoreComponentSchema,
    location: scoreComponentSchema,
    softPreferences: scoreComponentSchema,
  })
  .strict();

export const rankingFactorsSchema = z
  .object({
    freshnessBoost: z.number().int().min(0).max(5),
    targetCompanyBoost: z.number().int().min(0).max(3),
    uncertaintyPenalty: z.number().int().min(0).max(10),
  })
  .strict();

export const scoringTaskStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'review',
]);
export const scoreReviewStateSchema = z.enum([
  'not_required',
  'pending',
  'approved',
  'rejected',
]);

export const scoringJobInputSchema = z
  .object({
    jobId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    company: boundedText(240),
    title: boundedText(240),
    location: boundedText(240),
    remoteMode: z.enum(['onsite', 'hybrid', 'remote', 'unknown']),
    employmentType: boundedText(120).nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
    active: z.boolean(),
    descriptionText: z.string().min(1).max(200_000),
    fetchedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const scoringTaskSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    profileVersion: z.number().int().positive(),
    extractorVersion: boundedText(80),
    scoringVersion: boundedText(80),
    status: scoringTaskStatusSchema,
    attemptCount: z.number().int().nonnegative(),
    maxAttempts: z.number().int().positive(),
    retryAt: z.string().datetime({ offset: true }).nullable(),
    lastErrorCode: boundedText(80).nullable(),
    lastErrorSummary: boundedText(500).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    invalidatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const scoringTokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.cachedInputTokens > value.inputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['cachedInputTokens'],
        message: 'Cached input tokens cannot exceed input tokens',
      });
    }
    if (value.reasoningOutputTokens > value.outputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['reasoningOutputTokens'],
        message: 'Reasoning output tokens cannot exceed output tokens',
      });
    }
    if (value.totalTokens !== value.inputTokens + value.outputTokens) {
      context.addIssue({
        code: 'custom',
        path: ['totalTokens'],
        message: 'Total tokens must equal input plus output tokens',
      });
    }
  });

export const scoringAttemptSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    attemptNumber: z.number().int().positive(),
    outcome: z.enum(['succeeded', 'failed', 'cancelled', 'timeout', 'invalid_output']),
    provider: z.literal('codex_cli'),
    model: boundedText(120),
    errorCode: boundedText(80).nullable(),
    errorSummary: boundedText(500).nullable(),
    outputBytes: z.number().int().nonnegative(),
    usage: scoringTokenUsageSchema.nullable(),
    startedAt: z.string().datetime({ offset: true }),
    finishedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const scoringConfigurationSchema = z
  .object({
    ready: z.boolean(),
    provider: z.literal('codex_cli'),
    model: boundedText(120).nullable(),
  })
  .strict();

export const jobRequirementSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    jobId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    profileVersion: z.number().int().positive(),
    extractorVersion: boundedText(80),
    extraction: jobExtractionSchema,
    confidence: z.number().finite().min(0).max(1),
    provider: z.literal('codex_cli'),
    model: boundedText(120),
    createdAt: z.string().datetime({ offset: true }),
    invalidatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const jobScoreSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    requirementId: z.string().uuid(),
    jobId: z.string().uuid(),
    snapshotId: z.string().uuid(),
    profileVersion: z.number().int().positive(),
    scoringVersion: boundedText(80),
    eligible: z.boolean(),
    gateReasons: z.array(gateReasonSchema).min(1),
    matchScore: z.number().int().min(0).max(100).nullable(),
    rankingScore: z.number().int().min(0).max(100).nullable(),
    rankingFactors: rankingFactorsSchema.nullable(),
    breakdown: scoreBreakdownSchema.nullable(),
    matchedEvidence: z.array(matchedEvidenceSchema),
    gaps: z.array(extractedGapSchema),
    unknowns: z.array(extractedUnknownSchema),
    confidence: z.number().finite().min(0).max(1),
    provider: z.literal('codex_cli'),
    model: boundedText(120),
    reviewState: scoreReviewStateSchema,
    explanation: boundedText(1_000),
    rankingAsOf: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    invalidatedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const hasScores =
      value.matchScore !== null &&
      value.rankingScore !== null &&
      value.rankingFactors !== null &&
      value.breakdown !== null;
    if (value.eligible !== hasScores) {
      context.addIssue({
        code: 'custom',
        path: ['matchScore'],
        message:
          'Eligible scores require numeric results; ineligible Gate results forbid them',
      });
    }
  });

export const scoringQueueQuerySchema = z
  .object({
    status: scoringTaskStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const scoringQueueResponseSchema = z
  .object({ tasks: z.array(scoringTaskSchema) })
  .strict();
export const scoringBackfillRequestSchema = z
  .object({ includeClosed: z.boolean().default(false) })
  .strict();
export const scoringBackfillResultSchema = z
  .object({
    queued: z.number().int().nonnegative(),
    invalidated: z.number().int().nonnegative(),
  })
  .strict();
export const scoringProcessRequestSchema = z
  .object({ limit: z.number().int().min(1).max(25).default(1) })
  .strict();
export const scoringProcessResultSchema = z
  .object({
    claimed: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    pendingRetry: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    usage: scoringTokenUsageSchema,
  })
  .strict();
export const jobScoringHistorySchema = z
  .object({
    current: jobScoreSchema.nullable(),
    requirements: z.array(jobRequirementSchema),
    scores: z.array(jobScoreSchema),
    tasks: z.array(scoringTaskSchema),
    attempts: z.array(scoringAttemptSchema),
  })
  .strict();

export type JobExtraction = z.infer<typeof jobExtractionSchema>;
export type ScoringJobInput = z.infer<typeof scoringJobInputSchema>;
export type MatchedEvidence = z.infer<typeof matchedEvidenceSchema>;
export type ExtractedGap = z.infer<typeof extractedGapSchema>;
export type ExtractedUnknown = z.infer<typeof extractedUnknownSchema>;
export type EligibilityGateResult = z.infer<typeof eligibilityGateResultSchema>;
export type GateReason = z.infer<typeof gateReasonSchema>;
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type RankingFactors = z.infer<typeof rankingFactorsSchema>;
export type ScoringTask = z.infer<typeof scoringTaskSchema>;
export type ScoringTaskStatus = z.infer<typeof scoringTaskStatusSchema>;
export type ScoringTokenUsage = z.infer<typeof scoringTokenUsageSchema>;
export type ScoringAttempt = z.infer<typeof scoringAttemptSchema>;
export type ScoringConfiguration = z.infer<typeof scoringConfigurationSchema>;
export type JobRequirement = z.infer<typeof jobRequirementSchema>;
export type JobScore = z.infer<typeof jobScoreSchema>;
export type ScoringBackfillResult = z.infer<typeof scoringBackfillResultSchema>;
export type ScoringProcessResult = z.infer<typeof scoringProcessResultSchema>;
