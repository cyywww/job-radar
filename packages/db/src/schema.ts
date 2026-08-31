import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
