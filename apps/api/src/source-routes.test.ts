import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ConnectorRequestError,
  type ConnectorHealthResult,
  type DiscoveryResult,
  type JobConnector,
} from '@job-radar/connectors';
import { getAppConfig } from '@job-radar/config';
import { openDatabase, runMigrations, type DatabaseClient } from '@job-radar/db';
import {
  normalizedJobSchema,
  scanRunSchema,
  sourceTestResultSchema,
  sourceViewSchema,
  sourcesResponseSchema,
  type NormalizedJob,
  type ScanRun,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import { buildApp } from './app.js';

const rawJob = {
  id: 'greenhouse-isolated-1',
  title: 'Fictional Reliability Engineer',
};

class FixtureConnector implements JobConnector {
  public constructor(
    public readonly type: string,
    private readonly failure = false,
  ) {}

  public async healthCheck(): Promise<ConnectorHealthResult> {
    if (this.failure) {
      throw new ConnectorRequestError(
        `${this.type} fixture request failed with HTTP 503`,
        'http_server',
        503,
      );
    }
    return { status: 'healthy', message: null };
  }

  public async discover(): Promise<DiscoveryResult> {
    return {
      jobs: [{ externalId: rawJob.id, rawSummary: rawJob }],
      pagesFetched: 1,
      complete: true,
    };
  }

  public async fetchDetail(): Promise<Record<string, unknown>> {
    return rawJob;
  }

  public normalize(): NormalizedJob {
    return normalizedJobSchema.parse({
      externalId: rawJob.id,
      title: rawJob.title,
      company: 'Northstar Source Fixture AB',
      location: 'Stockholm, Sweden',
      publishedAt: '2026-08-30T08:00:00.000Z',
      deadline: null,
      descriptionText: 'A complete fictional description for source isolation testing.',
      descriptionHtml: null,
      sourceUrl: 'https://example.test/jobs/greenhouse-isolated-1',
      canonicalUrl: 'https://example.test/jobs/greenhouse-isolated-1',
      remoteMode: 'hybrid',
      employmentType: 'Full-time',
      sourceActive: true,
      sourceMetadata: { department: 'Fictional Engineering' },
      rawData: rawJob,
    });
  }
}

let app: FastifyInstance;
let database: DatabaseClient;

async function createSource(
  type: 'greenhouse' | 'lever',
  name: string,
): Promise<ReturnType<typeof sourceViewSchema.parse>> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sources',
    payload: {
      type,
      name,
      companyName: 'Northstar Source Fixture AB',
      identifier: `${type}-fixture`,
      ...(type === 'lever' ? { region: 'global' } : {}),
    },
  });
  expect(response.statusCode).toBe(201);
  return sourceViewSchema.parse(response.json());
}

async function waitForTerminal(runId: string): Promise<ScanRun> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/scans/${runId}` });
    const run = scanRunSchema.parse(response.json());
    if (['succeeded', 'partial', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Scan did not reach a terminal state');
}

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'job-radar-source-api-'));
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
  database = openDatabase(config.databasePath);
  runMigrations(database);
  app = await buildApp({
    config,
    database,
    logger: false,
    connectors: [new FixtureConnector('greenhouse'), new FixtureConnector('lever', true)],
  });
});

afterEach(async () => app.close());

describe('source configuration API', () => {
  it('adds, tests, edits, pauses, enables, and softly deletes a source', async () => {
    const source = await createSource('greenhouse', 'Northstar Greenhouse');
    expect(source).toMatchObject({
      enabled: true,
      healthStatus: 'unknown',
      metrics: { totalRuns: 0, totalRetries: 0 },
      latestRun: null,
    });

    const testResponse = await app.inject({
      method: 'POST',
      url: `/api/sources/${source.id}/test`,
    });
    const tested = sourceTestResultSchema.parse(testResponse.json());
    expect(tested).toMatchObject({ status: 'healthy', retryCount: 0, message: null });
    expect(tested.source.lastSuccessAt).not.toBeNull();

    const pausedResponse = await app.inject({
      method: 'PATCH',
      url: `/api/sources/${source.id}`,
      payload: { enabled: false, name: 'Northstar Careers' },
    });
    expect(sourceViewSchema.parse(pausedResponse.json())).toMatchObject({
      name: 'Northstar Careers',
      enabled: false,
    });
    const enabledResponse = await app.inject({
      method: 'PATCH',
      url: `/api/sources/${source.id}`,
      payload: { enabled: true, identifier: 'northstar-updated' },
    });
    expect(sourceViewSchema.parse(enabledResponse.json()).config).toMatchObject({
      boardToken: 'northstar-updated',
    });

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/sources/${source.id}`,
    });
    expect(deleted.statusCode).toBe(204);
    const list = sourcesResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/sources' })).json(),
    );
    expect(list.sources.some((entry) => entry.id === source.id)).toBe(false);
    const missing = await app.inject({
      method: 'POST',
      url: `/api/sources/${source.id}/test`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it('isolates one failed source and exposes source metrics and latest summaries', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: createFictionalProfileInput(),
    });
    const healthy = await createSource('greenhouse', 'Healthy Greenhouse');
    const failing = await createSource('lever', 'Failing Lever');
    const startedResponse = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: { sourceIds: [healthy.id, failing.id] },
    });
    expect(startedResponse.statusCode).toBe(202);
    const completed = await waitForTerminal(
      scanRunSchema.parse(startedResponse.json()).id,
    );

    expect(completed.status).toBe('partial');
    expect(completed.counts).toMatchObject({ created: 1, failed: 1 });
    expect(completed.sourceRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: healthy.id, status: 'succeeded' }),
        expect.objectContaining({
          sourceId: failing.id,
          status: 'failed',
          errorCategory: 'http_server',
        }),
      ]),
    );

    const sources = sourcesResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/sources' })).json(),
    ).sources;
    expect(sources.find((source) => source.id === healthy.id)).toMatchObject({
      metrics: { totalRuns: 1, successfulRuns: 1, jobsCreated: 1 },
      latestRun: { status: 'succeeded' },
    });
    expect(sources.find((source) => source.id === failing.id)).toMatchObject({
      healthStatus: 'unavailable',
      lastErrorCategory: 'http_server',
      metrics: { totalRuns: 1, failedRuns: 1, jobsFailed: 1 },
      latestRun: { status: 'failed', errorCategory: 'http_server' },
    });
  });
});
