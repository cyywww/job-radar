import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  jobTechSourceConfigSchema,
  sourceSchema,
  type JobTechSourceConfig,
  type Source,
} from '@job-radar/shared';

import { ConnectorCancelledError, type ConnectorContext } from './contracts.js';
import { JobTechConnector } from './jobtech.js';
import { canonicalizeUrl, mapWithConcurrency } from './util.js';

const fixtureRoot = new URL('../fixtures/jobtech/', import.meta.url);

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixtureRoot), 'utf8'));
}

function source(config: Partial<JobTechSourceConfig> = {}): Source {
  return sourceSchema.parse({
    id: '70000000-0000-4000-8000-000000000001',
    type: 'jobtech',
    name: 'JobTech fixture',
    baseUrl: 'https://jobsearch.api.jobtechdev.se',
    enabled: true,
    supportLevel: 'supported',
    supportReason: 'Official public fixture.',
    configVersion: 1,
    config: jobTechSourceConfigSchema.parse({
      kind: 'jobtech',
      queryMode: 'confirmed_profile_roles',
      pageSize: 2,
      maxPages: 3,
      detailConcurrency: 2,
      requestTimeoutMs: 500,
      maxRetries: 1,
      retryBaseDelayMs: 10,
      minRequestIntervalMs: 0,
      missingThreshold: 3,
      userAgent: 'Job-Radar-Fixture/1.0',
      ...config,
    }),
    lastSuccessAt: null,
    lastError: null,
    lastErrorCategory: null,
    healthStatus: 'unknown',
    createdAt: '2026-08-31T08:00:00.000Z',
    updatedAt: '2026-08-31T08:00:00.000Z',
  });
}

function context(value = source()): ConnectorContext {
  return {
    source: value,
    queries: ['Product Engineer'],
    signal: new AbortController().signal,
    onRetry: vi.fn(),
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('JobTechConnector', () => {
  it('paginates, fetches full details, and normalizes fixed fixtures', async () => {
    const requests: URL[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      requests.push(url);
      if (url.pathname === '/search' && url.searchParams.get('limit') === '1') {
        return response(fixture('search-page-1.json'));
      }
      if (url.pathname === '/search' && url.searchParams.get('offset') === '0') {
        return response(fixture('search-page-1.json'));
      }
      if (url.pathname === '/search' && url.searchParams.get('offset') === '2') {
        return response(fixture('search-page-2.json'));
      }
      const id = url.pathname.split('/').at(-1);
      return response(fixture(`detail-${id?.replace('fictional-job-', '')}.json`));
    });
    const connector = new JobTechConnector({ fetch: fetchMock });
    const scanContext = context();

    expect(await connector.healthCheck(scanContext)).toEqual({
      status: 'healthy',
      message: null,
    });
    const discovery = await connector.discover(scanContext);
    const details = await Promise.all(
      discovery.jobs.map((job) => connector.fetchDetail(job, scanContext)),
    );
    const normalized = details.map((detail) => connector.normalize(detail));

    expect(discovery).toMatchObject({ pagesFetched: 2, complete: true });
    expect(discovery.jobs).toHaveLength(3);
    expect(normalized[0]).toMatchObject({
      externalId: 'fictional-job-101',
      company: 'Northstar Example Works AB',
      location: 'Stockholm, Stockholms län, Sweden',
      remoteMode: 'remote',
      deadline: '2026-12-15T23:59:59.999Z',
    });
    expect(normalized[0]?.descriptionText).toContain('accessible React interfaces');
    expect(normalized[1]?.remoteMode).toBe('hybrid');
    expect(requests.filter((url) => url.pathname.startsWith('/ad/'))).toHaveLength(3);
  });

  it('retries retryable responses with exponential-delay hooks', async () => {
    const retryEvents: unknown[] = [];
    const delays: number[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(response(fixture('search-page-1.json')));
    const connector = new JobTechConnector({
      fetch: fetchMock,
      delay: async (ms) => {
        delays.push(ms);
      },
    });
    const scanContext: ConnectorContext = {
      ...context(),
      onRetry: (event) => retryEvents.push(event),
    };

    await expect(connector.healthCheck(scanContext)).resolves.toMatchObject({
      status: 'healthy',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryEvents).toEqual([{ operation: 'health', attempt: 1, statusCode: 429 }]);
    expect(delays).toContain(10);
  });

  it('propagates cancellation without waiting for the request timeout', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const connector = new JobTechConnector({ fetch: fetchMock });
    const scanContext: ConnectorContext = {
      ...context(),
      signal: controller.signal,
    };

    const health = connector.healthCheck(scanContext);
    controller.abort();
    await expect(health).rejects.toBeInstanceOf(ConnectorCancelledError);
  });

  it('turns a bounded request timeout into a connector error', async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const connector = new JobTechConnector({ fetch: fetchMock });
    const scanContext = context(source({ requestTimeoutMs: 100, maxRetries: 0 }));

    await expect(connector.healthCheck(scanContext)).rejects.toThrow(
      'JobTech request timed out',
    );
  });

  it('paces requests through the configured source rate limit', async () => {
    let clock = 0;
    const delays: number[] = [];
    const connector = new JobTechConnector({
      fetch: vi.fn(async () => response(fixture('search-page-1.json'))),
      now: () => clock,
      delay: async (ms) => {
        delays.push(ms);
        clock += ms;
      },
    });
    const scanContext = context(source({ minRequestIntervalMs: 25, maxPages: 1 }));

    await connector.healthCheck(scanContext);
    await connector.discover(scanContext);

    expect(delays).toContain(25);
  });
});

describe('canonicalizeUrl', () => {
  it('removes tracking and stable-sorts meaningful parameters', () => {
    expect(
      canonicalizeUrl(
        'https://Example.com/jobs/42/?utm_source=test&team=platform&gclid=fixture#apply',
      ),
    ).toBe('https://example.com/jobs/42?team=platform');
  });
});

describe('mapWithConcurrency', () => {
  it('never exceeds its worker limit', async () => {
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      new AbortController().signal,
      async (value) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return value * 2;
      },
    );

    expect(peak).toBe(2);
    expect(results).toEqual([
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 4 },
      { status: 'fulfilled', value: 6 },
      { status: 'fulfilled', value: 8 },
      { status: 'fulfilled', value: 10 },
    ]);
  });
});
