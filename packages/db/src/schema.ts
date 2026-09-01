import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type {
  EligibilityGateResult,
  ExtractedGap,
  ExtractedUnknown,
  JobExtraction,
  MatchedEvidence,
  RankingFactors,
  ScoreBreakdown,
  SourceConfig,
  SourceErrorCategory,
} from '@job-radar/shared';

export const systemMetadata = sqliteTable('system_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  currentVersion: integer('current_version').notNull(),
  currentVersionId: text('current_version_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const profileVersions = sqliteTable(
  'profile_versions',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'confirmed'] }).notNull(),
    changeSummary: text('change_summary').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('profile_versions_profile_version_uq').on(table.profileId, table.version),
    index('profile_versions_profile_created_idx').on(table.profileId, table.createdAt),
    check('profile_versions_version_positive', sql`${table.version} > 0`),
  ],
);

export const profileEvidenceSources = sqliteTable(
  'profile_evidence_sources',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: ['user_input', 'pasted_text', 'file_upload', 'deterministic_stub'],
    }).notNull(),
    label: text('label').notNull(),
    originalFilename: text('original_filename'),
    contentHash: text('content_hash'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('profile_evidence_sources_profile_idx').on(table.profileId)],
);

export const profileFacts = sqliteTable(
  'profile_facts',
  {
    evidenceId: text('evidence_id').primaryKey(),
    id: text('id').notNull(),
    versionId: text('version_id')
      .notNull()
      .references(() => profileVersions.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'basics',
        'work_experience',
        'education_experience',
        'skill',
        'language',
        'certification',
        'project',
      ],
    }).notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => profileEvidenceSources.id, { onDelete: 'restrict' }),
    confirmationStatus: text('confirmation_status', {
      enum: ['pending', 'confirmed', 'rejected'],
    }).notNull(),
    evidenceExcerpt: text('evidence_excerpt'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('profile_facts_version_id_uq').on(table.versionId, table.id),
    index('profile_facts_version_kind_idx').on(table.versionId, table.kind),
    index('profile_facts_version_status_idx').on(
      table.versionId,
      table.confirmationStatus,
    ),
    index('profile_facts_source_idx').on(table.sourceId),
  ],
);

export const profilePreferences = sqliteTable(
  'profile_preferences',
  {
    evidenceId: text('evidence_id').primaryKey(),
    id: text('id').notNull(),
    versionId: text('version_id')
      .notNull()
      .unique()
      .references(() => profileVersions.id, { onDelete: 'cascade' }),
    data: text('data', { mode: 'json' }).notNull(),
    sourceId: text('source_id')
      .notNull()
      .references(() => profileEvidenceSources.id, { onDelete: 'restrict' }),
    confirmationStatus: text('confirmation_status', {
      enum: ['pending', 'confirmed', 'rejected'],
    }).notNull(),
    evidenceExcerpt: text('evidence_excerpt'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('profile_preferences_source_idx').on(table.sourceId)],
);

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    config: text('config_json', { mode: 'json' }).$type<SourceConfig>().notNull(),
    configVersion: integer('config_version').notNull().default(1),
    lastSuccessAt: integer('last_success_at', { mode: 'timestamp_ms' }),
    lastError: text('last_error'),
    lastErrorCategory: text('last_error_category').$type<SourceErrorCategory>(),
    healthStatus: text('health_status', {
      enum: ['unknown', 'healthy', 'degraded', 'unavailable'],
    }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('sources_type_name_uq')
      .on(table.type, table.name)
      .where(sql`${table.deletedAt} is null`),
    index('sources_enabled_idx').on(table.enabled),
  ],
);

export const scanRuns = sqliteTable(
  'scan_runs',
  {
    id: text('id').primaryKey(),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'],
    }).notNull(),
    dedupeKey: text('dedupe_key'),
    profileVersion: integer('profile_version').notNull(),
    discoveredCount: integer('discovered_count').notNull().default(0),
    fetchedCount: integer('fetched_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    closedCount: integer('closed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    errorSummary: text('error_summary'),
    cancelRequestedAt: integer('cancel_requested_at', { mode: 'timestamp_ms' }),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('scan_runs_created_idx').on(table.createdAt),
    index('scan_runs_status_idx').on(table.status),
    uniqueIndex('scan_runs_active_dedupe_uq')
      .on(table.dedupeKey)
      .where(sql`${table.status} in ('queued', 'running')`),
    check('scan_runs_profile_version_positive', sql`${table.profileVersion} > 0`),
  ],
);

export const sourceRuns = sqliteTable(
  'source_runs',
  {
    id: text('id').primaryKey(),
    scanRunId: text('scan_run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    status: text('status', {
      enum: ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'],
    }).notNull(),
    configVersion: integer('config_version').notNull().default(1),
    queries: text('queries_json', { mode: 'json' }).$type<string[]>().notNull(),
    resultSetComplete: integer('result_set_complete', { mode: 'boolean' }),
    pagesFetched: integer('pages_fetched').notNull().default(0),
    retryCount: integer('retry_count').notNull().default(0),
    discoveredCount: integer('discovered_count').notNull().default(0),
    fetchedCount: integer('fetched_count').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    unchangedCount: integer('unchanged_count').notNull().default(0),
    closedCount: integer('closed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    errorCategory: text('error_category').$type<SourceErrorCategory>(),
    errorSummary: text('error_summary'),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('source_runs_scan_source_uq').on(table.scanRunId, table.sourceId),
    index('source_runs_scan_idx').on(table.scanRunId),
    index('source_runs_source_created_idx').on(table.sourceId, table.createdAt),
  ],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    canonicalKey: text('canonical_key').notNull(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    location: text('location').notNull(),
    remoteMode: text('remote_mode', {
      enum: ['onsite', 'hybrid', 'remote', 'unknown'],
    }).notNull(),
    employmentType: text('employment_type'),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    deadline: integer('deadline', { mode: 'timestamp_ms' }),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastChangedAt: integer('last_changed_at', { mode: 'timestamp_ms' }).notNull(),
    contentFingerprint: text('content_fingerprint').notNull(),
    canonicalSourceId: text('canonical_source_id').references(() => sources.id, {
      onDelete: 'restrict',
    }),
    active: integer('active', { mode: 'boolean' }).notNull(),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
    canonicalUrl: text('canonical_url').notNull(),
    currentSnapshotId: text('current_snapshot_id'),
  },
  (table) => [
    uniqueIndex('jobs_canonical_key_uq').on(table.canonicalKey),
    index('jobs_active_published_idx').on(table.active, table.publishedAt),
    index('jobs_company_title_idx').on(table.company, table.title),
    index('jobs_deadline_idx').on(table.deadline),
  ],
);

export const jobSources = sqliteTable(
  'job_sources',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'restrict' }),
    sourceJobId: text('source_job_id').notNull(),
    sourceUrl: text('source_url').notNull(),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenScanRunId: text('last_seen_scan_run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'restrict' }),
    consecutiveMisses: integer('consecutive_misses').notNull().default(0),
    active: integer('active', { mode: 'boolean' }).notNull(),
    lastChangedAt: integer('last_changed_at', { mode: 'timestamp_ms' }).notNull(),
    matchStrategy: text('match_strategy', {
      enum: [
        'new_job',
        'source_external_id',
        'canonical_url',
        'content_fingerprint',
        'company_title_location_published',
        'reprocessed',
      ],
    }).notNull(),
    matchEvidence: text('match_evidence_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceMetadata: text('source_metadata_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'`),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.sourceId] }),
    uniqueIndex('job_sources_source_job_uq').on(table.sourceId, table.sourceJobId),
    index('job_sources_job_idx').on(table.jobId),
    index('job_sources_source_active_idx').on(table.sourceId, table.active),
  ],
);

export const jobSnapshots = sqliteTable(
  'job_snapshots',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    contentHash: text('content_hash').notNull(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    location: text('location').notNull(),
    deadline: integer('deadline', { mode: 'timestamp_ms' }),
    descriptionText: text('description_text').notNull(),
    descriptionHtml: text('description_html'),
    rawJson: text('raw_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceId: text('source_id').references(() => sources.id, {
      onDelete: 'restrict',
    }),
    scanRunId: text('scan_run_id').references(() => scanRuns.id, {
      onDelete: 'restrict',
    }),
    changedFields: text('changed_fields_json', { mode: 'json' })
      .$type<
        Array<'initial' | 'description' | 'location' | 'deadline' | 'title' | 'company'>
      >()
      .notNull()
      .default(sql`'[]'`),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('job_snapshots_job_source_hash_uq').on(
      table.jobId,
      table.sourceId,
      table.contentHash,
    ),
    index('job_snapshots_job_fetched_idx').on(table.jobId, table.fetchedAt),
    index('job_snapshots_source_fetched_idx').on(table.sourceId, table.fetchedAt),
  ],
);

export const jobMergeEvents = sqliteTable(
  'job_merge_events',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    absorbedJobId: text('absorbed_job_id'),
    sourceId: text('source_id').references(() => sources.id, { onDelete: 'restrict' }),
    sourceJobId: text('source_job_id'),
    scanRunId: text('scan_run_id').references(() => scanRuns.id, {
      onDelete: 'restrict',
    }),
    matchStrategy: text('match_strategy').notNull(),
    evidence: text('evidence_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('job_merge_events_job_created_idx').on(table.jobId, table.createdAt),
    index('job_merge_events_source_idx').on(table.sourceId),
  ],
);

export const scoringTasks = sqliteTable(
  'scoring_tasks',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => jobSnapshots.id, { onDelete: 'restrict' }),
    profileVersion: integer('profile_version').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    scoringVersion: text('scoring_version').notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'succeeded', 'failed', 'review'],
    }).notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    retryAt: integer('retry_at', { mode: 'timestamp_ms' }),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    lastErrorCode: text('last_error_code'),
    lastErrorSummary: text('last_error_summary'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    invalidatedAt: integer('invalidated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    uniqueIndex('scoring_tasks_identity_uq').on(
      table.jobId,
      table.snapshotId,
      table.profileVersion,
      table.extractorVersion,
      table.scoringVersion,
    ),
    index('scoring_tasks_claim_idx').on(
      table.status,
      table.invalidatedAt,
      table.retryAt,
      table.createdAt,
    ),
    index('scoring_tasks_job_created_idx').on(table.jobId, table.createdAt),
    check('scoring_tasks_profile_version_positive', sql`${table.profileVersion} > 0`),
    check('scoring_tasks_attempt_count_valid', sql`${table.attemptCount} >= 0`),
    check('scoring_tasks_max_attempts_positive', sql`${table.maxAttempts} > 0`),
  ],
);

export const jobRequirements = sqliteTable(
  'job_requirements',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => scoringTasks.id, { onDelete: 'restrict' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => jobSnapshots.id, { onDelete: 'restrict' }),
    profileVersion: integer('profile_version').notNull(),
    extractorVersion: text('extractor_version').notNull(),
    extraction: text('extraction_json', { mode: 'json' })
      .$type<JobExtraction>()
      .notNull(),
    confidence: integer('confidence_micros').notNull(),
    provider: text('provider', { enum: ['codex_cli'] }).notNull(),
    model: text('model').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    invalidatedAt: integer('invalidated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('job_requirements_job_created_idx').on(table.jobId, table.createdAt),
    index('job_requirements_task_idx').on(table.taskId),
    check('job_requirements_profile_version_positive', sql`${table.profileVersion} > 0`),
    check(
      'job_requirements_confidence_range',
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1000000`,
    ),
  ],
);

export const jobScores = sqliteTable(
  'job_scores',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => scoringTasks.id, { onDelete: 'restrict' }),
    requirementId: text('requirement_id')
      .notNull()
      .references(() => jobRequirements.id, { onDelete: 'restrict' }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    snapshotId: text('snapshot_id')
      .notNull()
      .references(() => jobSnapshots.id, { onDelete: 'restrict' }),
    profileVersion: integer('profile_version').notNull(),
    scoringVersion: text('scoring_version').notNull(),
    eligible: integer('eligible', { mode: 'boolean' }).notNull(),
    jobActive: integer('job_active', { mode: 'boolean' }).notNull(),
    gateReasons: text('gate_reasons_json', { mode: 'json' })
      .$type<EligibilityGateResult['reasons']>()
      .notNull(),
    matchScore: integer('match_score'),
    rankingScore: integer('ranking_score'),
    rankingFactors: text('ranking_factors_json', {
      mode: 'json',
    }).$type<RankingFactors>(),
    breakdown: text('breakdown_json', { mode: 'json' }).$type<ScoreBreakdown>(),
    matchedEvidence: text('matched_evidence_json', { mode: 'json' })
      .$type<MatchedEvidence[]>()
      .notNull(),
    gaps: text('gaps_json', { mode: 'json' }).$type<ExtractedGap[]>().notNull(),
    unknowns: text('unknowns_json', { mode: 'json' })
      .$type<ExtractedUnknown[]>()
      .notNull(),
    confidence: integer('confidence_micros').notNull(),
    provider: text('provider', { enum: ['codex_cli'] }).notNull(),
    model: text('model').notNull(),
    reviewState: text('review_state', {
      enum: ['not_required', 'pending', 'approved', 'rejected'],
    }).notNull(),
    explanation: text('explanation').notNull(),
    rankingAsOf: integer('ranking_as_of', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    invalidatedAt: integer('invalidated_at', { mode: 'timestamp_ms' }),
  },
  (table) => [
    index('job_scores_job_created_idx').on(table.jobId, table.createdAt),
    index('job_scores_current_idx').on(table.jobId, table.invalidatedAt, table.createdAt),
    index('job_scores_task_idx').on(table.taskId),
    check('job_scores_profile_version_positive', sql`${table.profileVersion} > 0`),
    check(
      'job_scores_match_score_range',
      sql`${table.matchScore} is null or (${table.matchScore} >= 0 and ${table.matchScore} <= 100)`,
    ),
    check(
      'job_scores_ranking_score_range',
      sql`${table.rankingScore} is null or (${table.rankingScore} >= 0 and ${table.rankingScore} <= 100)`,
    ),
    check(
      'job_scores_integer_presence',
      sql`(${table.eligible} = 1 and ${table.matchScore} is not null and ${table.rankingScore} is not null and ${table.breakdown} is not null and ${table.rankingFactors} is not null) or (${table.eligible} = 0 and ${table.matchScore} is null and ${table.rankingScore} is null and ${table.breakdown} is null and ${table.rankingFactors} is null)`,
    ),
    check(
      'job_scores_confidence_range',
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1000000`,
    ),
  ],
);

export const scoringAttempts = sqliteTable(
  'scoring_attempts',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => scoringTasks.id, { onDelete: 'restrict' }),
    attemptNumber: integer('attempt_number').notNull(),
    outcome: text('outcome', {
      enum: ['succeeded', 'failed', 'cancelled', 'timeout', 'invalid_output'],
    }).notNull(),
    provider: text('provider', { enum: ['codex_cli'] }).notNull(),
    model: text('model').notNull(),
    errorCode: text('error_code'),
    errorSummary: text('error_summary'),
    outputHash: text('output_hash'),
    outputBytes: integer('output_bytes').notNull().default(0),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('scoring_attempts_task_number_uq').on(table.taskId, table.attemptNumber),
    index('scoring_attempts_task_idx').on(table.taskId),
    check('scoring_attempts_number_positive', sql`${table.attemptNumber} > 0`),
    check('scoring_attempts_output_bytes_nonnegative', sql`${table.outputBytes} >= 0`),
  ],
);
