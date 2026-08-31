import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  genericWebSourceConfigSchema,
  sourceSchema,
  type Source,
} from '@job-radar/shared';

import { exerciseConnectorContract } from './contract-test-kit.js';
import type { ConnectorContext } from './contracts.js';
import { GenericWebConnector } from './generic-web.js';
import { assertSafePublicHttpsUrl, isPublicAddress, SafeWebClient } from './safe-web.js';

const html = readFileSync(
  new URL('../fixtures/generic-web/jobs.html', import.meta.url),
  'utf8',
);
const timestamp = '2026-08-31T08:00:00.000Z';

function source(startUrl = 'https://careers.public-example.com/jobs'): Source {
  return sourceSchema.parse({
    id: '75000000-0000-4000-8000-000000000001',
    type: 'generic_web',
    name: 'Generic JSON-LD fixture',
    baseUrl: startUrl,
    enabled: true,
    config: genericWebSourceConfigSchema.parse({
      kind: 'generic_web',
      startUrl,
      companyName: 'Northstar Generic Example AB',
      maxPostings: 20,
      detailConcurrency: 2,
      requestTimeoutMs: 500,
      maxRetries: 0,
      retryBaseDelayMs: 10,
      minRequestIntervalMs: 0,
      missingThreshold: 3,
      userAgent: 'Job-Radar-Fixture/1.0',
    }),
    supportLevel: 'limited',
    supportReason: 'Explicit JSON-LD fixture.',
    configVersion: 1,
    lastSuccessAt: null,
    lastError: null,
    lastErrorCategory: null,
    healthStatus: 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function context(value: Source): ConnectorContext {
  return {
    source: value,
    queries: [],
    signal: new AbortController().signal,
    onRetry: vi.fn(),
  };
}

describe('GenericWebConnector', () => {
  it('accepts only bounded schema.org JobPosting JSON-LD from an opted-in page', async () => {
    const connector = new GenericWebConnector({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: vi.fn(
        async () =>
          new Response(html, {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          }),
      ),
    });
    const result = await exerciseConnectorContract(connector, context(source()));

    expect(result.health).toMatchObject({ status: 'healthy' });
    expect(result.discovery).toMatchObject({ pagesFetched: 1, complete: true });
    expect(result.normalized).toHaveLength(1);
    expect(result.normalized[0]).toMatchObject({
      externalId: 'generic-fictional-9101',
      company: 'Northstar Generic Example AB',
      location: 'Sweden',
      remoteMode: 'remote',
      canonicalUrl: 'https://careers.public-example.com/jobs/systems-engineer',
    });
  });
});

describe('target company page SSRF policy', () => {
  it.each([
    'http://careers.public-example.com/jobs',
    'https://localhost/jobs',
    'https://127.0.0.1/jobs',
    'https://169.254.169.254/latest/meta-data',
    'https://10.0.0.7/jobs',
    'https://[::1]/jobs',
    'https://user:secret@careers.public-example.com/jobs',
    'https://careers.public-example.com:8443/jobs',
  ])('rejects unsafe URL %s before a request', (value) => {
    expect(() => assertSafePublicHttpsUrl(value)).toThrow();
  });

  it.each([
    ['8.8.8.8', true],
    ['127.0.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['2606:4700:4700::1111', true],
    ['::1', false],
    ['fd00::1', false],
    ['::ffff:127.0.0.1', false],
  ])('classifies address %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it('rejects DNS answers and redirects that enter a private network', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://169.254.169.254/latest/meta-data' },
        }),
    );
    const client = new SafeWebClient({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: fetchMock,
    });
    const scanContext = context(source());
    await expect(
      client.requestHtml(
        'Target company page',
        scanContext.source.baseUrl,
        scanContext.source.config,
        scanContext,
        'discover',
      ),
    ).rejects.toMatchObject({ category: 'unsafe_url' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const dnsClient = new SafeWebClient({
      resolve: async () => [{ address: '10.1.2.3', family: 4 }],
      fetch: vi.fn(),
    });
    await expect(
      dnsClient.requestHtml(
        'Target company page',
        scanContext.source.baseUrl,
        scanContext.source.config,
        scanContext,
        'discover',
      ),
    ).rejects.toMatchObject({ category: 'unsafe_url' });
  });

  it('rejects a mixed public and private DNS answer before fetching', async () => {
    const fetchMock = vi.fn();
    const client = new SafeWebClient({
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.20', family: 4 },
      ],
      fetch: fetchMock,
    });
    const scanContext = context(source());
    await expect(
      client.requestHtml(
        'Target company page',
        scanContext.source.baseUrl,
        scanContext.source.config,
        scanContext,
        'discover',
      ),
    ).rejects.toMatchObject({ category: 'unsafe_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pins the validated DNS answer into the request dispatcher', async () => {
    const resolve = vi.fn(async () => [{ address: '93.184.216.34', family: 4 as const }]);
    const fetchMock = vi.fn(
      async (_input: string | URL, init: { dispatcher?: unknown }) => {
        expect(init.dispatcher?.constructor.name).toBe('Agent');
        return new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      },
    );
    const client = new SafeWebClient({ resolve, fetch: fetchMock });
    const scanContext = context(source());
    await client.requestHtml(
      'Target company page',
      scanContext.source.baseUrl,
      scanContext.source.config,
      scanContext,
      'discover',
    );
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
