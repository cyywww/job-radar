import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DatabaseClient } from './database.js';
import {
  checkDatabase,
  getMigrationsFolder,
  openDatabase,
  runMigrations,
} from './database.js';

let database: DatabaseClient | undefined;

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
    expect(sourceRunColumns.map(({ name }) => name)).toContain('error_category');
    expect(jobSourceColumns.map(({ name }) => name)).toContain('source_metadata_json');
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(checkDatabase(database).status).toBe('ok');
  });

  it('upgrades a populated Phase 4 database without losing source or snapshot history', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-db-upgrade-'));
    const oldMigrations = join(directory, 'old-migrations');
    const oldMeta = join(oldMigrations, 'meta');
    mkdirSync(oldMeta, { recursive: true });
    const currentMigrations = getMigrationsFolder();
    for (let index = 0; index <= 3; index += 1) {
      const prefix = String(index).padStart(4, '0');
      const migration = [
        '0000_slimy_the_watchers.sql',
        '0001_dusty_praxagora.sql',
        '0002_lush_proemial_gods.sql',
        '0003_superb_sprite.sql',
      ][index]!;
      cpSync(join(currentMigrations, migration), join(oldMigrations, migration));
      cpSync(
        join(currentMigrations, 'meta', `${prefix}_snapshot.json`),
        join(oldMeta, `${prefix}_snapshot.json`),
      );
    }
    const journal = JSON.parse(
      readFileSync(join(currentMigrations, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    writeFileSync(
      join(oldMeta, '_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, 4) }),
    );

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
         values (?, 'greenhouse', 'Historical fixture', 'https://boards-api.greenhouse.io', 1, '{}', 'unknown', ?, ?)`,
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
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
