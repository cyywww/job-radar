import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAppConfig } from '@job-radar/config';
import { openDatabase, runMigrations } from '@job-radar/db';
import { errorResponseSchema, healthResponseSchema } from '@job-radar/shared';

import { buildApp } from './app.js';

let app: FastifyInstance;

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'job-radar-api-'));
  const config = getAppConfig(
    {
      NODE_ENV: 'test',
      JOB_RADAR_DATABASE_PATH: join(directory, 'test.sqlite'),
      JOB_RADAR_WEB_DIST_DIR: join(directory, 'missing-web-dist'),
      JOB_RADAR_DATA_DIR: directory,
      JOB_RADAR_CONFIG_DIR: join(directory, 'config'),
      JOB_RADAR_LOG_DIR: join(directory, 'logs'),
    },
    '/workspace/job-radar',
  );
  const database = openDatabase(config.databasePath);
  runMigrations(database);
  app = await buildApp({ config, database, logger: false });
});

afterEach(async () => {
  await app.close();
});

describe('operational routes', () => {
  it('reports API and database health', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    const payload = healthResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(payload.status).toBe('ok');
    expect(payload.database.status).toBe('ok');
  });

  it('reports readiness for a migrated database', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/readiness' });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe('ok');
  });

  it('normalizes unknown-route errors', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/missing' });
    const payload = errorResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(404);
    expect(payload.error.code).toBe('NOT_FOUND');
  });

  it.each([
    ['GET', '/api/dashboard'],
    ['GET', '/api/profile'],
    ['POST', '/api/profile'],
    ['PUT', '/api/profile'],
    ['POST', '/api/profile/confirm'],
    ['GET', '/api/profile/versions'],
    ['GET', '/api/profile/versions/1'],
    ['GET', '/api/preferences'],
    ['PUT', '/api/preferences'],
    ['POST', '/api/preferences/preview'],
    ['POST', '/api/profile/import'],
    ['POST', '/api/profile/import/file'],
    ['GET', '/api/review/jobs'],
    ['GET', '/api/review/jobs/10000000-0000-4000-8000-000000000001'],
    ['POST', '/api/jobs/reprocess'],
  ] as const)('does not retain retired %s %s', async (method, url) => {
    const response = await app.inject({ method, url });
    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('NOT_FOUND');
  });
});
