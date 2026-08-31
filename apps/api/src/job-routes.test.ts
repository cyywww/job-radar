import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobTechConnector } from '@job-radar/connectors';
import { getAppConfig } from '@job-radar/config';
import {
  DEFAULT_JOBTECH_SOURCE_CONFIG,
  DEFAULT_JOBTECH_SOURCE_ID,
  openDatabase,
  runMigrations,
  type DatabaseClient,
} from '@job-radar/db';
import {
  jobDetailSchema,
  jobsResponseSchema,
  scanRunSchema,
  type ScanRun,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import { buildApp } from './app.js';

const fixtureRoot = new URL(
  '../../../packages/connectors/fixtures/jobtech/',
  import.meta.url,
);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type GatewayMode = 'success' | 'changed' | 'partial' | 'empty' | 'failure' | 'hanging';

let app: FastifyInstance;
let database: DatabaseClient;
let mode: GatewayMode;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

async function waitForTerminal(runId: string): Promise<ScanRun> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await app.inject({ method: 'GET', url: `/api/scans/${runId}` });
    const run = scanRunSchema.parse(response.json());
    if (['succeeded', 'partial', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Scan did not reach a terminal state');
}

async function startScan(): Promise<ScanRun> {
  const response = await app.inject({ method: 'POST', url: '/api/scans', payload: {} });
  expect(response.statusCode).toBe(202);
  return waitForTerminal(scanRunSchema.parse(response.json()).id);
}

beforeEach(async () => {
  mode = 'success';
  fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input.toString());
    if (mode === 'failure') return response({ error: 'fixture outage' }, 503);
    if (mode === 'hanging') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    }
    if (url.pathname === '/search') {
      if (mode === 'empty' || url.searchParams.get('q') === 'Frontend Engineer') {
        return response({ total: { value: 0 }, hits: [] });
      }
      if (url.searchParams.get('limit') === '1') {
        return response({ total: { value: 1 }, hits: [{ id: 'fictional-job-101' }] });
      }
      return response(
        fixture(
          url.searchParams.get('offset') === '2'
            ? 'search-page-2.json'
            : 'search-page-1.json',
        ),
      );
    }
    const id = url.pathname.split('/').at(-1)?.replace('fictional-job-', '');
    if (mode === 'partial' && id === '102') {
      return response({ error: 'fixture detail outage' }, 503);
    }
    const detail = fixture(`detail-${id}.json`) as Record<string, unknown>;
    if (mode === 'changed' && id === '101') {
      const description = detail.description as Record<string, unknown>;
      return response({
        ...detail,
        description: {
          ...description,
          text: `${String(description.text)} Added fictional accessibility ownership.`,
        },
      });
    }
    return response(detail);
  });

  const directory = mkdtempSync(join(tmpdir(), 'job-radar-job-api-'));
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
    connectors: [new JobTechConnector({ fetch: fetchMock })],
  });
  database.sqlite.prepare('update sources set config_json = ? where id = ?').run(
    JSON.stringify({
      ...DEFAULT_JOBTECH_SOURCE_CONFIG,
      pageSize: 2,
      maxPages: 3,
      minRequestIntervalMs: 0,
      maxRetries: 1,
      retryBaseDelayMs: 10,
    }),
    DEFAULT_JOBTECH_SOURCE_ID,
  );
  await app.inject({
    method: 'POST',
    url: '/api/profile',
    payload: createFictionalProfileInput(),
  });
});

afterEach(async () => app.close());

describe('job scan API', () => {
  it('runs the fixture pipeline, stores full details, and remains idempotent', async () => {
    const first = await startScan();
    const jobsResponse = await app.inject({ method: 'GET', url: '/api/jobs' });
    const jobList = jobsResponseSchema.parse(jobsResponse.json());
    const detailResponse = await app.inject({
      method: 'GET',
      url: `/api/jobs/${jobList.jobs[0]?.id}`,
    });
    const detail = jobDetailSchema.parse(detailResponse.json());

    expect(first.status).toBe('succeeded');
    expect(first.counts).toMatchObject({
      discovered: 3,
      fetched: 3,
      created: 3,
      failed: 0,
    });
    expect(first.sourceRuns[0]).toMatchObject({
      status: 'succeeded',
      pagesFetched: 3,
      resultSetComplete: true,
    });
    expect(jobList.total).toBe(3);
    expect(detail.snapshot.descriptionText.length).toBeGreaterThan(100);
    expect(detail.snapshot.rawResponseStored).toBe(true);
    expect(detail.sources[0]?.sourceJobId).toMatch(/^fictional-job-/);

    const second = await startScan();
    const rowCounts = database.sqlite
      .prepare(
        'select (select count(*) from jobs) as jobs, (select count(*) from job_snapshots) as snapshots',
      )
      .get() as { jobs: number; snapshots: number };

    expect(second.counts).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(rowCounts).toEqual({ jobs: 3, snapshots: 3 });

    mode = 'changed';
    const changed = await startScan();
    const changedCounts = database.sqlite
      .prepare(
        'select (select count(*) from jobs) as jobs, (select count(*) from job_snapshots) as snapshots',
      )
      .get() as { jobs: number; snapshots: number };
    expect(changed.counts).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
    expect(changedCounts).toEqual({ jobs: 3, snapshots: 4 });
  });

  it('closes jobs only after three complete scans no longer see them', async () => {
    await startScan();
    mode = 'empty';
    await startScan();
    await startScan();
    const beforeThreshold = jobsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/jobs' })).json(),
    );
    const threshold = await startScan();
    const active = jobsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/jobs' })).json(),
    );
    const all = jobsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/jobs?active=all' })).json(),
    );

    expect(beforeThreshold.total).toBe(3);
    expect(threshold.counts.closed).toBe(3);
    expect(active.total).toBe(0);
    expect(all.jobs.every((job) => !job.active && job.closedAt !== null)).toBe(true);
  });

  it('isolates connector failure, records retries, and keeps the API healthy', async () => {
    mode = 'failure';
    const run = await startScan();
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    const sources = await app.inject({ method: 'GET', url: '/api/sources' });

    expect(run.status).toBe('failed');
    expect(run.counts.failed).toBe(1);
    expect(run.sourceRuns[0]).toMatchObject({
      status: 'failed',
      retryCount: 1,
      errorSummary: 'JobTech request failed with HTTP 503',
    });
    expect(health.statusCode).toBe(200);
    expect(sources.json()).toMatchObject({
      sources: [{ healthStatus: 'unavailable' }],
    });
  });

  it('keeps sibling jobs when one detail request fails', async () => {
    mode = 'partial';
    const run = await startScan();
    const jobList = jobsResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/jobs' })).json(),
    );

    expect(run.status).toBe('partial');
    expect(run.counts).toMatchObject({ fetched: 2, created: 2, failed: 1 });
    expect(run.sourceRuns[0]).toMatchObject({
      status: 'partial',
      retryCount: 1,
      errorSummary: '1 discovered job detail failed',
    });
    expect(jobList.total).toBe(2);
  });

  it('cancels an in-flight connector request', async () => {
    mode = 'hanging';
    const startedResponse = await app.inject({
      method: 'POST',
      url: '/api/scans',
      payload: {},
    });
    const started = scanRunSchema.parse(startedResponse.json());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const cancelResponse = await app.inject({
      method: 'POST',
      url: `/api/scans/${started.id}/cancel`,
    });
    const completed = await waitForTerminal(started.id);

    expect(cancelResponse.statusCode).toBe(200);
    expect(completed.status).toBe('cancelled');
    expect(completed.sourceRuns[0]?.status).toBe('cancelled');
  });
});
