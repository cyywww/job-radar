import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { getRepositoryRoot } from '@job-radar/config';

import * as schema from './schema.js';

export interface DatabaseClient {
  readonly sqlite: Database.Database;
  readonly db: ReturnType<typeof drizzle<typeof schema>>;
  close(): void;
}

export interface DatabaseHealth {
  readonly status: 'ok' | 'error';
  readonly latencyMs: number;
}

export function getMigrationsFolder(): string {
  return join(getRepositoryRoot(), 'packages', 'db', 'migrations');
}

export function openDatabase(databasePath: string): DatabaseClient {
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}

export function runMigrations(
  client: DatabaseClient,
  migrationsFolder = getMigrationsFolder(),
): void {
  migrate(client.db, { migrationsFolder });
  client.sqlite.pragma('optimize');
}

export function checkDatabase(client: DatabaseClient): DatabaseHealth {
  const startedAt = performance.now();

  try {
    client.sqlite.prepare('select 1 as ok').get();
    return {
      status: 'ok',
      latencyMs: Number((performance.now() - startedAt).toFixed(3)),
    };
  } catch {
    return {
      status: 'error',
      latencyMs: Number((performance.now() - startedAt).toFixed(3)),
    };
  }
}
