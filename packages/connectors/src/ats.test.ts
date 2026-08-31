import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  ashbySourceConfigSchema,
  greenhouseSourceConfigSchema,
  leverSourceConfigSchema,
  sourceSchema,
  teamtailorSourceConfigSchema,
  type Source,
} from '@job-radar/shared';

import { AshbyConnector } from './ashby.js';
import { type ConnectorContext, ConnectorRequestError } from './contracts.js';
import { exerciseConnectorContract } from './contract-test-kit.js';
import { GreenhouseConnector } from './greenhouse.js';
import { LeverConnector } from './lever.js';
import { TeamtailorConnector } from './teamtailor.js';

const fixtureRoots = {
  greenhouse: new URL('../fixtures/greenhouse/', import.meta.url),
  lever: new URL('../fixtures/lever/', import.meta.url),
  ashby: new URL('../fixtures/ashby/', import.meta.url),
  teamtailor: new URL('../fixtures/teamtailor/', import.meta.url),
};
const timestamp = '2026-08-31T08:00:00.000Z';
const commonPolicy = {
  detailConcurrency: 2,
  requestTimeoutMs: 500,
  maxRetries: 1,
  retryBaseDelayMs: 10,
  minRequestIntervalMs: 0,
  missingThreshold: 3,
  userAgent: 'Job-Radar-Fixture/1.0',
};

function fixture(type: keyof typeof fixtureRoots, name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixtureRoots[type]), 'utf8'));
}

function response(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function source(
  type: 'greenhouse' | 'lever' | 'ashby' | 'teamtailor',
  maxRetries = 1,
): Source {
  const details =
    type === 'greenhouse'
      ? {
          id: '71000000-0000-4000-8000-000000000001',
          name: 'Greenhouse fixture',
          baseUrl: 'https://boards-api.greenhouse.io',
          config: greenhouseSourceConfigSchema.parse({
            kind: 'greenhouse',
            boardToken: 'northstar-example',
            companyName: 'Northstar Greenhouse Example AB',
            ...commonPolicy,
            maxRetries,
          }),
        }
      : type === 'lever'
        ? {
            id: '72000000-0000-4000-8000-000000000001',
            name: 'Lever fixture',
            baseUrl: 'https://api.lever.co',
            config: leverSourceConfigSchema.parse({
              kind: 'lever',
              site: 'aurora-example',
              companyName: 'Aurora Lever Example AB',
              region: 'global',
              pageSize: 2,
              maxPages: 3,
              ...commonPolicy,
              maxRetries,
            }),
          }
        : type === 'ashby'
          ? {
              id: '73000000-0000-4000-8000-000000000001',
              name: 'Ashby fixture',
              baseUrl: 'https://api.ashbyhq.com',
              config: ashbySourceConfigSchema.parse({
                kind: 'ashby',
                boardName: 'polaris-example',
                companyName: 'Polaris Ashby Example AB',
                includeCompensation: true,
                ...commonPolicy,
                maxRetries,
              }),
            }
          : {
              id: '74000000-0000-4000-8000-000000000001',
              name: 'Teamtailor fixture',
              baseUrl: 'https://api.teamtailor.com',
              config: teamtailorSourceConfigSchema.parse({
                kind: 'teamtailor',
                companyName: 'Northstar Teamtailor Example AB',
                region: 'eu',
                apiTokenEnv: 'JOB_RADAR_TEAMTAILOR_TEST_TOKEN',
                pageSize: 1,
                maxPages: 3,
                ...commonPolicy,
                maxRetries,
              }),
            };

  return sourceSchema.parse({
    type,
    enabled: true,
    supportLevel: type === 'teamtailor' ? 'limited' : 'supported',
    supportReason: 'Fixture support classification.',
    configVersion: 1,
    lastSuccessAt: null,
    lastError: null,
    lastErrorCategory: null,
    healthStatus: 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...details,
  });
}

function context(
  value: Source,
  onRetry: ConnectorContext['onRetry'] = vi.fn(),
): ConnectorContext {
  return {
    source: value,
    queries: ['Platform Engineer'],
    signal: new AbortController().signal,
    onRetry,
  };
}

describe('GreenhouseConnector', () => {
  it('passes the reusable contract with a complete multi-job board and details', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      const id = url.pathname.split('/').at(-1);
      return response(
        id === 'jobs'
          ? fixture('greenhouse', 'list.json')
          : fixture('greenhouse', `detail-${id}.json`),
      );
    });
    const result = await exerciseConnectorContract(
      new GreenhouseConnector({ fetch: fetchMock }),
      context(source('greenhouse')),
    );

    expect(result.discovery).toMatchObject({ pagesFetched: 1, complete: true });
    expect(result.normalized).toHaveLength(2);
    expect(result.normalized[0]).toMatchObject({
      externalId: '4101',
      company: 'Northstar Greenhouse Example AB',
      location: 'Stockholm, Sweden',
      deadline: '2026-10-31T22:59:59.000Z',
    });
    expect(result.normalized[0]?.descriptionText).toContain('developer platforms');
  });

  it('accepts an empty board and retries a rate limit without exposing its body', async () => {
    const retryEvents: unknown[] = [];
    let requestCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      return requestCount === 1
        ? response({ private: 'do-not-expose@example.test' }, 429)
        : response(fixture('greenhouse', 'empty.json'));
    });
    const connector = new GreenhouseConnector({
      fetch: fetchMock,
      delay: async () => {},
    });
    const scanContext = context(source('greenhouse'), (event) => retryEvents.push(event));

    await expect(connector.healthCheck(scanContext)).resolves.toMatchObject({
      status: 'healthy',
    });
    await expect(connector.discover(scanContext)).resolves.toMatchObject({
      jobs: [],
      complete: true,
    });
    expect(retryEvents).toEqual([{ operation: 'health', attempt: 1, statusCode: 429 }]);
  });
});

describe('LeverConnector', () => {
  it('passes the reusable contract with documented skip/limit pagination', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      const last = url.pathname.split('/').at(-1);
      if (last?.startsWith('lever-fictional-')) {
        return response(fixture('lever', `detail-${last.slice(-4)}.json`));
      }
      if (url.searchParams.get('limit') === '1') {
        return response(fixture('lever', 'list-page-1.json'));
      }
      return response(
        fixture(
          'lever',
          url.searchParams.get('skip') === '2' ? 'list-page-2.json' : 'list-page-1.json',
        ),
      );
    });
    const result = await exerciseConnectorContract(
      new LeverConnector({ fetch: fetchMock }),
      context(source('lever')),
    );

    expect(result.discovery).toMatchObject({ pagesFetched: 2, complete: true });
    expect(result.normalized).toHaveLength(3);
    expect(result.normalized[0]).toMatchObject({
      externalId: 'lever-fictional-5101',
      remoteMode: 'hybrid',
      employmentType: 'Full-time',
    });
    expect(result.normalized[0]?.descriptionText).toContain('Design APIs');
  });

  it('accepts an empty page and classifies a bounded server failure', async () => {
    const emptyConnector = new LeverConnector({
      fetch: vi.fn(async () => response(fixture('lever', 'empty.json'))),
    });
    await expect(
      emptyConnector.discover(context(source('lever'))),
    ).resolves.toMatchObject({
      jobs: [],
      pagesFetched: 1,
      complete: true,
    });

    const failing = new LeverConnector({
      fetch: vi.fn(async () => response({ response: 'not retained' }, 503)),
    });
    const failure = failing.healthCheck(context(source('lever', 0)));
    await expect(failure).rejects.toMatchObject({
      category: 'http_server',
      statusCode: 503,
    });
    await expect(failure).rejects.not.toThrow('not retained');
  });
});

describe('AshbyConnector', () => {
  it('passes the reusable contract for a complete board and excludes unlisted jobs', async () => {
    const connector = new AshbyConnector({
      fetch: vi.fn(async () => response(fixture('ashby', 'board.json'))),
    });
    const result = await exerciseConnectorContract(connector, context(source('ashby')));

    expect(result.discovery).toMatchObject({ pagesFetched: 1, complete: true });
    expect(result.normalized).toHaveLength(2);
    expect(result.normalized[0]).toMatchObject({
      externalId: 'ashby-fictional-6101',
      remoteMode: 'hybrid',
      employmentType: 'FullTime',
    });
  });

  it('accepts an empty board and classifies a terminal rate limit', async () => {
    const emptyConnector = new AshbyConnector({
      fetch: vi.fn(async () => response(fixture('ashby', 'empty.json'))),
    });
    await expect(
      emptyConnector.discover(context(source('ashby'))),
    ).resolves.toMatchObject({
      jobs: [],
      complete: true,
    });

    const failing = new AshbyConnector({
      fetch: vi.fn(async () => response({ secret: 'never surface this' }, 429)),
    });
    await expect(failing.healthCheck(context(source('ashby', 0)))).rejects.toEqual(
      expect.objectContaining<Partial<ConnectorRequestError>>({
        category: 'rate_limited',
        statusCode: 429,
      }),
    );
  });
});

describe('TeamtailorConnector', () => {
  it('passes the reusable contract with authenticated official pagination', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input.toString());
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Token token=fixture-public-read-token',
      );
      const last = url.pathname.split('/').at(-1);
      if (last?.startsWith('tt-fictional-')) {
        return response(fixture('teamtailor', `detail-${last.slice(-4)}.json`));
      }
      return response(
        fixture(
          'teamtailor',
          url.searchParams.get('page[number]') === '2'
            ? 'list-page-2.json'
            : 'list-page-1.json',
        ),
      );
    });
    const connector = new TeamtailorConnector({
      fetch: fetchMock,
      readEnvironment: () => 'fixture-public-read-token',
    });
    const result = await exerciseConnectorContract(
      connector,
      context(source('teamtailor')),
    );

    expect(result.discovery).toMatchObject({ pagesFetched: 2, complete: true });
    expect(result.normalized).toHaveLength(2);
    expect(result.normalized[0]).toMatchObject({
      externalId: 'tt-fictional-8101',
      location: 'Stockholm, Sweden',
      remoteMode: 'hybrid',
    });
  });

  it('fails safely when the environment variable is absent', async () => {
    const connector = new TeamtailorConnector({
      fetch: vi.fn(),
      readEnvironment: () => undefined,
    });
    await expect(
      connector.healthCheck(context(source('teamtailor'))),
    ).rejects.toMatchObject({
      category: 'configuration',
    });
  });
});
