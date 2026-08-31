import { mkdtempSync } from 'node:fs';
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
    expect(database.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(checkDatabase(database).status).toBe('ok');
  });
});
