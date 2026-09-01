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
import {
  DEFAULT_JOBTECH_SOURCE_ID,
  openDatabase,
  runMigrations,
  type DatabaseClient,
} from '@job-radar/db';
import {
  normalizedJobSchema,
  scanRunSchema,
  sourceTestResultSchema,
  sourceViewSchema,
  sourcesResponseSchema,
  type NormalizedJob,
  type ScanRun,
  type SourceType,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import { buildApp } from './app.js';

const rawJob = {
  id: 'sweden-source-fixture-1',
  title: 'Fictional Reliability Engineer',
};

let targetPageFails = false;

class FixtureConnector implements JobConnector {
  public constructor(public readonly type: SourceType) {}

  public async healthCheck(): Promise<ConnectorHealthResult> {
    if (this.type === 'generic_web' && targetPageFails) {
      throw new ConnectorRequestError(
        'Target company page fixture request failed with HTTP 503',
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
      company: 'Northstar Sweden Fixture AB',
      location: 'Stockholm, Sweden',
      publishedAt: '2026-08-30T08:00:00.000Z',
      deadline: null,
      descriptionText: 'A complete fictional description for source testing.',
      descriptionHtml: null,
      sourceUrl: 'https://careers.example.test/jobs/sweden-source-fixture-1',
      canonicalUrl: 'https://careers.example.test/jobs/sweden-source-fixture-1',
      remoteMode: 'hybrid',
      employmentType: 'Full-time',
      sourceActive: true,
      sourceMetadata: { market: 'Sweden' },
      rawData: rawJob,
    });
  }
}

let app: FastifyInstance;
let database: DatabaseClient;

async function createTargetPage(
  name: string,
): Promise<ReturnType<typeof sourceViewSchema.parse>> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sources',
    payload: {
      type: 'generic_web',
      name,
      companyName: 'Northstar Sweden Fixture AB',
      startUrl: 'https://careers.example.test/jobs?utm_source=fixture',
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
  targetPageFails = false;
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
    connectors: [new FixtureConnector('jobtech'), new FixtureConnector('generic_web')],
  });
});

afterEach(async () => app.close());

describe('Sweden-first source API', () => {
  it('starts with JobTech and accepts only an optional target-company page', async () => {
    const initial = sourcesResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/sources' })).json(),
    );
    expect(initial.sources).toEqual([
      expect.objectContaining({ type: 'jobtech', supportLevel: 'supported' }),
    ]);
    const renamePrimary = await app.inject({
      method: 'PATCH',
      url: `/api/sources/${DEFAULT_JOBTECH_SOURCE_ID}`,
      payload: { name: 'Renamed primary source' },
    });
    expect(renamePrimary.statusCode).toBe(400);
    const deletePrimary = await app.inject({
      method: 'DELETE',
      url: `/api/sources/${DEFAULT_JOBTECH_SOURCE_ID}`,
    });
    expect(deletePrimary.statusCode).toBe(400);

    const source = await createTargetPage('Northstar target page');
    expect(source).toMatchObject({
      enabled: false,
      supportLevel: 'limited',
      config: {
        kind: 'generic_web',
        startUrl: 'https://careers.example.test/jobs',
      },
    });

    const insecure = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: {
        type: 'generic_web',
        name: 'Unsafe target page',
        companyName: 'Northstar Sweden Fixture AB',
        startUrl: 'http://127.0.0.1/jobs',
      },
    });
    expect(insecure.statusCode).toBe(400);
  });

  it('tests, edits, enables, reruns, and softly deletes a target page', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: createFictionalProfileInput(),
    });
    const source = await createTargetPage('Northstar target page');
    const tested = sourceTestResultSchema.parse(
      (
        await app.inject({ method: 'POST', url: `/api/sources/${source.id}/test` })
      ).json(),
    );
    expect(tested).toMatchObject({ status: 'healthy', retryCount: 0 });

    const updated = sourceViewSchema.parse(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/sources/${source.id}`,
          payload: {
            enabled: true,
            name: 'Northstar careers',
            startUrl: 'https://careers.example.test/openings',
          },
        })
      ).json(),
    );
    expect(updated).toMatchObject({
      name: 'Northstar careers',
      enabled: true,
      configVersion: 2,
      config: { startUrl: 'https://careers.example.test/openings' },
    });

    const rerunResponse = await app.inject({
      method: 'POST',
      url: `/api/sources/${source.id}/rerun`,
    });
    expect(rerunResponse.statusCode).toBe(202);
    const completed = await waitForTerminal(scanRunSchema.parse(rerunResponse.json()).id);
    expect(completed.sourceRuns[0]).toMatchObject({
      sourceId: source.id,
      status: 'succeeded',
      configVersion: 2,
    });

    expect(
      (await app.inject({ method: 'DELETE', url: `/api/sources/${source.id}` }))
        .statusCode,
    ).toBe(204);
    const listed = sourcesResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/sources' })).json(),
    );
    expect(listed.sources.some((entry) => entry.id === source.id)).toBe(false);
    const withDeleted = sourcesResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/sources?includeDeleted=true',
        })
      ).json(),
    );
    expect(withDeleted.sources.find((entry) => entry.id === source.id)).toMatchObject({
      configurationState: 'deleted',
      enabled: false,
    });
  });

  it('isolates an optional target-page failure from the primary JobTech scan', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: createFictionalProfileInput(),
    });
    const targetPage = await createTargetPage('Failing target page');
    await app.inject({
      method: 'PATCH',
      url: `/api/sources/${targetPage.id}`,
      payload: { enabled: true },
    });
    targetPageFails = true;

    const started = await app.inject({ method: 'POST', url: '/api/scans', payload: {} });
    const completed = await waitForTerminal(scanRunSchema.parse(started.json()).id);
    expect(completed).toMatchObject({ status: 'partial' });
    expect(completed.sourceRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: DEFAULT_JOBTECH_SOURCE_ID,
          status: 'succeeded',
        }),
        expect.objectContaining({
          sourceId: targetPage.id,
          status: 'failed',
          errorCategory: 'http_server',
        }),
      ]),
    );
  });
});
