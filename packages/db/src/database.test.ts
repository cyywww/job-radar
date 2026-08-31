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
    const profileTable = database.sqlite
      .prepare(
        "select name from sqlite_master where type = 'table' and name = 'profile_versions'",
      )
      .get() as { name: string } | undefined;

    expect(profileTable?.name).toBe('profile_versions');
    expect(checkDatabase(database).status).toBe('ok');
  });
});
