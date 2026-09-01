import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProfileRequestSchema, normalizedJobSchema } from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import type { DatabaseClient } from './database.js';
import {
  checkDatabase,
  getMigrationsFolder,
  openDatabase,
  runMigrations,
} from './database.js';
import { JobRepository } from './job-repository.js';
import { ProfileRepository } from './profile-repository.js';

let database: DatabaseClient | undefined;

const migrationFiles = [
  '0000_slimy_the_watchers.sql',
  '0001_dusty_praxagora.sql',
  '0002_lush_proemial_gods.sql',
  '0003_superb_sprite.sql',
  '0004_windy_mongu.sql',
  '0005_sweden_source_cleanup.sql',
  '0006_neat_clea.sql',
  '0007_bizarre_richard_fisk.sql',
] as const;

function copyMigrationsThrough(target: string, lastIndex: number): void {
  const targetMeta = join(target, 'meta');
  const currentMigrations = getMigrationsFolder();
  mkdirSync(targetMeta, { recursive: true });

  for (let index = 0; index <= lastIndex; index += 1) {
    const prefix = String(index).padStart(4, '0');
    const migration = migrationFiles[index]!;
    cpSync(join(currentMigrations, migration), join(target, migration));
    cpSync(
      join(currentMigrations, 'meta', `${prefix}_snapshot.json`),
      join(targetMeta, `${prefix}_snapshot.json`),
    );
  }

  const journal = JSON.parse(
    readFileSync(join(currentMigrations, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  writeFileSync(
    join(targetMeta, '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, lastIndex + 1) }),
  );
}

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('database infrastructure', () => {
  it('migrates an empty SQLite database and reports healthy', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-db-'));
    database = openDatabase(join(directory, 'test.sqlite'));

    runMigrations(database, getMigrationsFolder());

    const table = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name = 'system_metadata'",
      )
      .get() as { name: string } | undefined;

    expect(table?.name).toBe('system_metadata');
    const expectedTables = [
      'profile_versions',
      'sources',
      'scan_runs',
      'source_runs',
      'jobs',
      'job_sources',
      'job_snapshots',
      'scoring_tasks',
      'job_requirements',
      'job_scores',
      'scoring_attempts',
      'job_triage',
      'score_feedback',
      'score_review_events',
    ];
    const tables = database.sqlite
      .prepare(
        `select name from sqlite_master where type = 'table' and name in (${expectedTables.map(() => '?').join(', ')})`,
      )
      .all(...expectedTables) as Array<{ name: string }>;

    expect(tables.map(({ name }) => name).sort()).toEqual(expectedTables.sort());
    const sourceColumns = database.sqlite.pragma('table_info(sources)') as Array<{
      name: string;
    }>;
    const sourceRunColumns = database.sqlite.pragma('table_info(source_runs)') as Array<{
      name: string;
    }>;
    const jobSourceColumns = database.sqlite.pragma('table_info(job_sources)') as Array<{
      name: string;
    }>;
    expect(sourceColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['last_error_category', 'deleted_at']),
    );
    expect(sourceRunColumns.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['error_category', 'stage', 'failure_stage']),
    );
    expect(jobSourceColumns.map(({ name }) => name)).toContain('source_metadata_json');
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(checkDatabase(database).status).toBe('ok');
  });

  it('upgrades a populated JobTech database without losing source or snapshot history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-db-upgrade-'));
    const oldMigrations = join(directory, 'old-migrations');
    const currentMigrations = getMigrationsFolder();
    copyMigrationsThrough(oldMigrations, 3);

    database = openDatabase(join(directory, 'upgrade.sqlite'));
    runMigrations(database, oldMigrations);
    const sourceId = '70000000-0000-4000-8000-000000000099';
    const scanId = '80000000-0000-4000-8000-000000000099';
    const jobId = '90000000-0000-4000-8000-000000000099';
    const snapshotId = '91000000-0000-4000-8000-000000000099';
    const timestamp = Date.parse('2026-08-30T08:00:00.000Z');
    database.sqlite
      .prepare(
        `insert into sources
          (id, type, name, base_url, enabled, config_json, health_status, created_at, updated_at)
         values (?, 'jobtech', 'Historical JobTech fixture', 'https://jobsearch.api.jobtechdev.se', 1, '{}', 'unknown', ?, ?)`,
      )
      .run(sourceId, timestamp, timestamp);
    database.sqlite
      .prepare(
        `insert into scan_runs (id, status, profile_version, created_at)
         values (?, 'succeeded', 1, ?)`,
      )
      .run(scanId, timestamp);
    database.sqlite
      .prepare(
        `insert into jobs
          (id, canonical_key, company, title, location, remote_mode, first_seen_at,
           last_seen_at, active, canonical_url, current_snapshot_id)
         values (?, 'historical:key', 'Historical Example AB', 'Historical Engineer',
           'Stockholm, Sweden', 'hybrid', ?, ?, 1,
           'https://careers.example.test/jobs/historical', ?)`,
      )
      .run(jobId, timestamp, timestamp, snapshotId);
    database.sqlite
      .prepare(
        `insert into job_sources
          (job_id, source_id, source_job_id, source_url, first_seen_at, last_seen_at,
           last_seen_scan_run_id, consecutive_misses, active, source_metadata_json)
         values (?, ?, 'historical-external', 'https://careers.example.test/jobs/historical',
           ?, ?, ?, 0, 1, '{}')`,
      )
      .run(jobId, sourceId, timestamp, timestamp, scanId);
    database.sqlite
      .prepare(
        `insert into job_snapshots
          (id, job_id, content_hash, description_text, description_html, raw_json, fetched_at)
         values (?, ?, ?, 'Historical fictional description.', null, '{}', ?)`,
      )
      .run(snapshotId, jobId, 'a'.repeat(64), timestamp);

    runMigrations(database, currentMigrations);
    const upgraded = database.sqlite
      .prepare(
        `select j.last_changed_at as changed, j.canonical_source_id as canonical_source,
                js.match_strategy as strategy, js.last_changed_at as source_changed,
                snap.company as company, snap.source_id as snapshot_source,
                snap.changed_fields_json as changed_fields
         from jobs j
         join job_sources js on js.job_id = j.id
         join job_snapshots snap on snap.job_id = j.id
         where j.id = ?`,
      )
      .get(jobId) as Record<string, unknown>;
    expect(upgraded).toMatchObject({
      changed: timestamp,
      canonical_source: sourceId,
      strategy: 'new_job',
      source_changed: timestamp,
      company: 'Historical Example AB',
      snapshot_source: sourceId,
      changed_fields: '["initial"]',
    });
    const source = database.sqlite
      .prepare(
        'select config_json as config, config_version as version from sources where id = ?',
      )
      .get(sourceId) as { config: string; version: number };
    expect(JSON.parse(source.config)).toMatchObject({
      occupationField: 'apaJ_2ja_LuF',
      pageSize: 100,
      maxPages: 20,
    });
    expect(source.version).toBe(2);
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('adds M3 scoring tables to a populated M2 database without changing job history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-m2-upgrade-'));
    const m2Migrations = join(directory, 'm2-migrations');
    copyMigrationsThrough(m2Migrations, 5);
    database = openDatabase(join(directory, 'm2-upgrade.sqlite'));
    runMigrations(database, m2Migrations);

    const profiles = new ProfileRepository(database);
    const profile = profiles.create(
      createProfileRequestSchema.parse(createFictionalProfileInput()),
    );
    const jobs = new JobRepository(database);
    const source = jobs.ensureDefaultSources();
    const scanId = '80000000-0000-4000-8000-000000000066';
    const timestamp = Date.parse('2026-09-01T08:00:00.000Z');
    database.sqlite
      .prepare(
        `insert into scan_runs (id, status, profile_version, created_at)
         values (?, 'succeeded', ?, ?)`,
      )
      .run(scanId, profile.version, timestamp);
    const ingested = jobs.ingestJob(
      source,
      scanId,
      normalizedJobSchema.parse({
        externalId: 'fictional-m2-migration-job',
        title: 'Fictional Migration Engineer',
        company: 'Fictional Upgrade Works AB',
        location: 'Stockholm, Sweden',
        publishedAt: '2026-08-30T08:00:00.000Z',
        deadline: null,
        descriptionText: 'A fully fictional M2 snapshot retained during migration.',
        descriptionHtml: null,
        sourceUrl: 'https://jobs.example.test/fictional-m2-migration-job',
        canonicalUrl: 'https://jobs.example.test/fictional-m2-migration-job',
        remoteMode: 'hybrid',
        employmentType: 'Full-time',
        sourceActive: true,
        sourceMetadata: { fixture: true },
        rawData: { fixture: 'm2-migration' },
      }),
      new Date(timestamp),
    );

    runMigrations(database, getMigrationsFolder());

    expect(
      database.sqlite
        .prepare(
          'select j.current_snapshot_id as snapshot_id, s.description_text as description from jobs j join job_snapshots s on s.id = j.current_snapshot_id where j.id = ?',
        )
        .get(ingested.jobId),
    ).toEqual({
      snapshot_id: ingested.snapshotId,
      description: 'A fully fictional M2 snapshot retained during migration.',
    });
    expect(
      database.sqlite
        .prepare(
          'select (select count(*) from scoring_tasks) as tasks, (select count(*) from job_requirements) as requirements, (select count(*) from job_scores) as scores, (select count(*) from scoring_attempts) as attempts',
        )
        .get(),
    ).toEqual({ tasks: 0, requirements: 0, scores: 0, attempts: 0 });
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('adds M4 review state to populated M3 data without rewriting formal scores', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-m3-upgrade-'));
    const m3Migrations = join(directory, 'm3-migrations');
    copyMigrationsThrough(m3Migrations, 6);
    database = openDatabase(join(directory, 'm3-upgrade.sqlite'));
    runMigrations(database, m3Migrations);

    const profile = new ProfileRepository(database).create(
      createProfileRequestSchema.parse(createFictionalProfileInput()),
    );
    const timestamp = Date.parse('2026-08-31T08:00:00.000Z');
    const sourceId = '70000000-0000-4000-8000-000000000077';
    const scanId = '80000000-0000-4000-8000-000000000077';
    const sourceRunId = '81000000-0000-4000-8000-000000000077';
    const jobId = '90000000-0000-4000-8000-000000000077';
    const snapshotId = '91000000-0000-4000-8000-000000000077';
    const taskId = '92000000-0000-4000-8000-000000000077';
    const requirementId = '93000000-0000-4000-8000-000000000077';
    const scoreId = '94000000-0000-4000-8000-000000000077';
    const attemptId = '95000000-0000-4000-8000-000000000077';

    database.sqlite
      .prepare(
        `insert into sources
          (id, type, name, base_url, enabled, config_json, config_version,
           health_status, created_at, updated_at)
         values (?, 'jobtech', 'Fictional M3 JobTech',
           'https://jobsearch.api.jobtechdev.se', 1,
           '{"occupationField":"apaJ_2ja_LuF","pageSize":100,"maxPages":20}',
           2, 'healthy', ?, ?)`,
      )
      .run(sourceId, timestamp, timestamp);
    database.sqlite
      .prepare(
        `insert into scan_runs
          (id, status, profile_version, discovered_count, fetched_count, created_count,
           updated_count, unchanged_count, closed_count, failed_count, started_at,
           finished_at, created_at)
         values (?, 'succeeded', ?, 1, 1, 0, 0, 0, 0, 0, ?, ?, ?)`,
      )
      .run(scanId, profile.version, timestamp, timestamp, timestamp);
    database.sqlite
      .prepare(
        `insert into source_runs
          (id, scan_run_id, source_id, status, queries_json, discovered_count,
           fetched_count, created_count, updated_count, unchanged_count, closed_count,
           failed_count, result_set_complete, started_at, finished_at, created_at)
         values (?, ?, ?, 'succeeded', '["Fictional engineer"]', 1, 1, 1, 0, 0,
           0, 0, 1, ?, ?, ?)`,
      )
      .run(sourceRunId, scanId, sourceId, timestamp, timestamp, timestamp);
    database.sqlite
      .prepare(
        `insert into jobs
          (id, canonical_key, company, title, location, remote_mode, published_at,
           first_seen_at, last_seen_at, last_changed_at, content_fingerprint,
           canonical_source_id, active, canonical_url, current_snapshot_id)
         values (?, 'm3:preserved-score', 'Fictional Preserve Labs AB',
           'Fictional M3 Engineer', 'Stockholm, Sweden', 'hybrid', ?, ?, ?, ?, ?, ?, 1,
           'https://jobs.example.test/m3-preserved-score', ?)`,
      )
      .run(
        jobId,
        timestamp,
        timestamp,
        timestamp,
        timestamp,
        'd'.repeat(64),
        sourceId,
        snapshotId,
      );
    database.sqlite
      .prepare(
        `insert into job_sources
          (job_id, source_id, source_job_id, source_url, first_seen_at, last_seen_at,
           last_seen_scan_run_id, consecutive_misses, active, last_changed_at,
           match_strategy, match_evidence_json, source_metadata_json)
         values (?, ?, 'm3-preserved-score',
           'https://jobs.example.test/m3-preserved-score', ?, ?, ?, 0, 1, ?,
           'new_job', '{"explanation":"Fictional exact source id"}', '{}')`,
      )
      .run(jobId, sourceId, timestamp, timestamp, scanId, timestamp);
    database.sqlite
      .prepare(
        `insert into job_snapshots
          (id, job_id, content_hash, company, title, location, description_text,
           raw_json, source_id, scan_run_id, changed_fields_json, fetched_at)
         values (?, ?, ?, 'Fictional Preserve Labs AB', 'Fictional M3 Engineer',
           'Stockholm, Sweden', 'A fictional description retained during M4 migration.',
           '{}', ?, ?, '["initial"]', ?)`,
      )
      .run(snapshotId, jobId, 'e'.repeat(64), sourceId, scanId, timestamp);
    database.sqlite
      .prepare(
        `insert into scoring_tasks
          (id, job_id, snapshot_id, profile_version, extractor_version,
           scoring_version, status, attempt_count, max_attempts, created_at, updated_at)
         values (?, ?, ?, ?, 'extractor-v1', 'score-v1', 'succeeded', 1, 3, ?, ?)`,
      )
      .run(taskId, jobId, snapshotId, profile.version, timestamp, timestamp);
    database.sqlite
      .prepare(
        `insert into job_requirements
          (id, task_id, job_id, snapshot_id, profile_version, extractor_version,
           extraction_json, confidence_micros, provider, model, created_at)
         values (?, ?, ?, ?, ?, 'extractor-v1',
           '{"requiredSkills":[],"preferredSkills":[]}', 820000,
           'fixture', 'fixture-model', ?)`,
      )
      .run(requirementId, taskId, jobId, snapshotId, profile.version, timestamp);
    database.sqlite
      .prepare(
        `insert into job_scores
          (id, task_id, requirement_id, job_id, snapshot_id, profile_version,
           scoring_version, eligible, job_active, gate_reasons_json, match_score,
           ranking_score, ranking_factors_json, breakdown_json, matched_evidence_json,
           gaps_json, unknowns_json, confidence_micros, provider, model, review_state,
           explanation, ranking_as_of, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, 'score-v1', 1, 1, '[]', 84, 81, '{}', '{}',
           '[]', '[]', '["Fictional uncertainty"]', 820000, 'fixture',
           'fixture-model', 'pending', 'Fictional deterministic explanation.', ?, ?, ?)`,
      )
      .run(
        scoreId,
        taskId,
        requirementId,
        jobId,
        snapshotId,
        profile.version,
        timestamp,
        timestamp,
        timestamp,
      );
    database.sqlite
      .prepare(
        `insert into scoring_attempts
          (id, task_id, attempt_number, outcome, provider, model, output_hash,
           output_bytes, started_at, finished_at)
         values (?, ?, 1, 'succeeded', 'fixture', 'fixture-model', ?, 128, ?, ?)`,
      )
      .run(attemptId, taskId, 'f'.repeat(64), timestamp, timestamp);

    runMigrations(database, getMigrationsFolder());

    expect(
      database.sqlite
        .prepare(
          `select match_score as matchScore, ranking_score as rankingScore,
                  scoring_version as scoringVersion, review_state as reviewState,
                  invalidated_at as invalidatedAt
           from job_scores where id = ?`,
        )
        .get(scoreId),
    ).toEqual({
      matchScore: 84,
      rankingScore: 81,
      scoringVersion: 'score-v1',
      reviewState: 'pending',
      invalidatedAt: null,
    });
    expect(
      database.sqlite
        .prepare(
          `select
             (select count(*) from profile_versions) as profiles,
             (select count(*) from job_snapshots) as snapshots,
             (select count(*) from job_requirements) as requirements,
             (select count(*) from scoring_attempts) as attempts,
             (select count(*) from job_triage) as triage,
             (select count(*) from score_feedback) as feedback,
             (select count(*) from score_review_events) as reviewEvents`,
        )
        .get(),
    ).toEqual({
      profiles: 1,
      snapshots: 1,
      requirements: 1,
      attempts: 1,
      triage: 0,
      feedback: 0,
      reviewEvents: 0,
    });
    expect(
      database.sqlite
        .prepare('select status, stage from scan_runs where id = ?')
        .get(scanId),
    ).toEqual({ status: 'succeeded', stage: 'complete' });
    expect(
      database.sqlite
        .prepare(
          'select status, stage, failure_stage as failureStage from source_runs where id = ?',
        )
        .get(sourceRunId),
    ).toEqual({ status: 'succeeded', stage: 'complete', failureStage: null });
    expect(
      database.sqlite
        .prepare(
          `select output_bytes as outputBytes, input_tokens as inputTokens,
                  cached_input_tokens as cachedInputTokens,
                  output_tokens as outputTokens,
                  reasoning_output_tokens as reasoningOutputTokens
           from scoring_attempts where id = ?`,
        )
        .get(attemptId),
    ).toEqual({
      outputBytes: 128,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
    });
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('removes unsupported source state instead of retaining compatibility data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-db-cleanup-'));
    const oldMigrations = join(directory, 'old-migrations');
    const currentMigrations = getMigrationsFolder();
    copyMigrationsThrough(oldMigrations, 4);

    database = openDatabase(join(directory, 'cleanup.sqlite'));
    runMigrations(database, oldMigrations);

    const sourceId = '70000000-0000-4000-8000-000000000088';
    const scanId = '80000000-0000-4000-8000-000000000088';
    const sourceRunId = '81000000-0000-4000-8000-000000000088';
    const jobId = '90000000-0000-4000-8000-000000000088';
    const snapshotId = '91000000-0000-4000-8000-000000000088';
    const mergeEventId = '92000000-0000-4000-8000-000000000088';
    const timestamp = Date.parse('2026-08-30T09:00:00.000Z');

    database.sqlite
      .prepare(
        `insert into sources
          (id, type, name, base_url, enabled, config_json, health_status, created_at, updated_at)
         values (?, 'removed_source', 'Removed source fixture', 'https://boards.example.test',
           1, '{}', 'healthy', ?, ?)`,
      )
      .run(sourceId, timestamp, timestamp);
    database.sqlite
      .prepare(
        `insert into scan_runs (id, status, profile_version, created_at)
         values (?, 'succeeded', 1, ?)`,
      )
      .run(scanId, timestamp);
    database.sqlite
      .prepare(
        `insert into source_runs
          (id, scan_run_id, source_id, status, queries_json, result_set_complete, created_at)
         values (?, ?, ?, 'succeeded', '["fictional"]', 1, ?)`,
      )
      .run(sourceRunId, scanId, sourceId, timestamp);
    database.sqlite
      .prepare(
        `insert into jobs
          (id, canonical_key, company, title, location, remote_mode, first_seen_at,
           last_seen_at, last_changed_at, content_fingerprint, canonical_source_id,
           active, canonical_url, current_snapshot_id)
         values (?, 'removed:key', 'Removed Example AB', 'Removed Engineer',
           'Stockholm, Sweden', 'hybrid', ?, ?, ?, ?, ?, 1,
           'https://boards.example.test/jobs/removed', ?)`,
      )
      .run(jobId, timestamp, timestamp, timestamp, 'b'.repeat(64), sourceId, snapshotId);
    database.sqlite
      .prepare(
        `insert into job_sources
          (job_id, source_id, source_job_id, source_url, first_seen_at, last_seen_at,
           last_seen_scan_run_id, consecutive_misses, active, last_changed_at,
           match_strategy, match_evidence_json, source_metadata_json)
         values (?, ?, 'removed-external', 'https://boards.example.test/jobs/removed',
           ?, ?, ?, 0, 1, ?, 'new_job', '{"explanation":"Fixture"}', '{}')`,
      )
      .run(jobId, sourceId, timestamp, timestamp, scanId, timestamp);
    database.sqlite
      .prepare(
        `insert into job_snapshots
          (id, job_id, content_hash, company, title, location, description_text,
           raw_json, source_id, scan_run_id, changed_fields_json, fetched_at)
         values (?, ?, ?, 'Removed Example AB', 'Removed Engineer', 'Stockholm, Sweden',
           'Fictional removed description.', '{}', ?, ?, '["initial"]', ?)`,
      )
      .run(snapshotId, jobId, 'c'.repeat(64), sourceId, scanId, timestamp);
    database.sqlite
      .prepare(
        `insert into job_merge_events
          (id, job_id, source_id, source_job_id, scan_run_id, match_strategy,
           evidence_json, created_at)
         values (?, ?, ?, 'removed-external', ?, 'new_job',
           '{"explanation":"Fixture"}', ?)`,
      )
      .run(mergeEventId, jobId, sourceId, scanId, timestamp);

    runMigrations(database, currentMigrations);

    for (const table of [
      'job_merge_events',
      'job_snapshots',
      'job_sources',
      'jobs',
      'source_runs',
      'scan_runs',
      'sources',
    ]) {
      const row = database.sqlite
        .prepare(`select count(*) as count from ${table}`)
        .get() as {
        count: number;
      };
      expect(row.count).toBe(0);
    }
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
