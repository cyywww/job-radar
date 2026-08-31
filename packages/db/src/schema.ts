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

import type { SourceConfig, SourceErrorCategory } from '@job-radar/shared';

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
    descriptionText: text('description_text').notNull(),
    descriptionHtml: text('description_html'),
    rawJson: text('raw_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    fetchedAt: integer('fetched_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('job_snapshots_job_hash_uq').on(table.jobId, table.contentHash),
    index('job_snapshots_job_fetched_idx').on(table.jobId, table.fetchedAt),
  ],
);
