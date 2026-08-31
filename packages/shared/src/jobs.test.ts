import { describe, expect, it } from 'vitest';

import {
  createSourceRequestSchema,
  genericWebSourceConfigSchema,
  jobTechSourceConfigSchema,
  normalizedJobSchema,
  scanRunSchema,
  sourceSupportForType,
} from './jobs.js';
import {
  canonicalizeJobUrl,
  compositeJobIdentity,
  normalizeDescription,
} from './job-identity.js';

const requestPolicy = {
  detailConcurrency: 2,
  requestTimeoutMs: 1_000,
  maxRetries: 2,
  retryBaseDelayMs: 100,
  minRequestIntervalMs: 0,
  missingThreshold: 3,
  userAgent: 'Job-Radar-Test/1.0',
};

describe('job collection contracts', () => {
  it('bounds JobTech pagination, retries, and concurrency', () => {
    expect(() =>
      jobTechSourceConfigSchema.parse({
        kind: 'jobtech',
        queryMode: 'confirmed_profile_roles',
        occupationField: 'apaJ_2ja_LuF',
        pageSize: 101,
        maxPages: 1,
        detailConcurrency: 1,
        requestTimeoutMs: 1_000,
        maxRetries: 2,
        retryBaseDelayMs: 100,
        minRequestIntervalMs: 0,
        missingThreshold: 3,
        userAgent: 'Job-Radar-Test/1.0',
      }),
    ).toThrow();
  });

  it('keeps the optional target-company page explicit and HTTPS-only', () => {
    expect(
      genericWebSourceConfigSchema.parse({
        kind: 'generic_web',
        startUrl: 'https://careers.example.test/jobs',
        companyName: 'Northstar Example AB',
        maxPostings: 100,
        ...requestPolicy,
      }).startUrl,
    ).toBe('https://careers.example.test/jobs');
    expect(() =>
      createSourceRequestSchema.parse({
        type: 'generic_web',
        name: 'Unsafe target page',
        companyName: 'Northstar Example AB',
        startUrl: 'http://127.0.0.1/jobs',
      }),
    ).toThrow();
  });

  it('requires a complete normalized description and auditable raw data', () => {
    expect(() =>
      normalizedJobSchema.parse({
        externalId: 'fixture-1',
        title: 'Engineer',
        company: 'Example Company',
        location: 'Stockholm',
        publishedAt: null,
        deadline: null,
        descriptionText: '',
        descriptionHtml: null,
        sourceUrl: 'https://example.test/jobs/1',
        canonicalUrl: 'https://example.test/jobs/1',
        remoteMode: 'unknown',
        employmentType: null,
        sourceActive: true,
        sourceMetadata: {},
        rawData: {},
      }),
    ).toThrow();
  });

  it('exposes only the Sweden-first source model', () => {
    expect(sourceSupportForType('jobtech').supportLevel).toBe('supported');
    expect(sourceSupportForType('generic_web').supportLevel).toBe('limited');
    expect(() => sourceSupportForType('removed_source')).toThrow();
  });

  it('does not accept an untracked scan state', () => {
    expect(() =>
      scanRunSchema.parse({
        id: '90000000-0000-4000-8000-000000000001',
        status: 'mystery',
      }),
    ).toThrow();
  });
});

describe('deterministic job identity', () => {
  it('canonicalizes tracking, fragments, case, default ports, and query order', () => {
    expect(
      canonicalizeJobUrl(
        'HTTPS://Careers.Example.test:443//jobs/role/?utm_source=x&b=2&a=1#apply',
      ),
    ).toBe('https://careers.example.test/jobs/role?a=1&b=2');
  });

  it('normalizes content and builds a publication-day composite', () => {
    expect(normalizeDescription('  Build   APIs ; safely. ')).toBe('build apis;safely.');
    expect(
      compositeJobIdentity({
        company: ' Northstar AB ',
        title: 'Platform  Engineer',
        location: 'Stockholm',
        publishedAt: '2026-08-31T22:00:00+02:00',
      }),
    ).toBe('northstar ab|platform engineer|stockholm|2026-08-31');
  });
});
