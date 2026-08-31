import { describe, expect, it } from 'vitest';

import {
  ashbySourceConfigSchema,
  createSourceRequestSchema,
  greenhouseSourceConfigSchema,
  jobTechSourceConfigSchema,
  leverSourceConfigSchema,
  normalizedJobSchema,
  scanRunSchema,
  sourceCapabilities,
  teamtailorSourceConfigSchema,
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

  it('keeps each ATS identifier and request policy strictly bounded', () => {
    expect(
      greenhouseSourceConfigSchema.parse({
        kind: 'greenhouse',
        boardToken: 'northstar-example',
        companyName: 'Northstar Example AB',
        ...requestPolicy,
      }).boardToken,
    ).toBe('northstar-example');
    expect(
      leverSourceConfigSchema.parse({
        kind: 'lever',
        site: 'northstar-example',
        companyName: 'Northstar Example AB',
        region: 'eu',
        pageSize: 50,
        maxPages: 10,
        ...requestPolicy,
      }).region,
    ).toBe('eu');
    expect(
      ashbySourceConfigSchema.parse({
        kind: 'ashby',
        boardName: 'northstar-example',
        companyName: 'Northstar Example AB',
        includeCompensation: true,
        ...requestPolicy,
      }).includeCompensation,
    ).toBe(true);
    expect(() =>
      createSourceRequestSchema.parse({
        type: 'ashby',
        name: 'Unsafe path fixture',
        companyName: 'Northstar Example AB',
        identifier: '../private-board',
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

  it('records reviewed support levels for every planned source', () => {
    const levels = Object.fromEntries(
      sourceCapabilities.capabilities.map((capability) => [
        capability.type,
        capability.supportLevel,
      ]),
    );
    expect(levels).toMatchObject({
      teamtailor: 'limited',
      workday: 'not_supported',
      jobylon: 'not_supported',
      successfactors: 'not_supported',
      generic_web: 'limited',
    });
    expect(
      teamtailorSourceConfigSchema.parse({
        kind: 'teamtailor',
        companyName: 'Northstar Example AB',
        region: 'eu',
        apiTokenEnv: 'JOB_RADAR_TEAMTAILOR_TOKEN',
        pageSize: 30,
        maxPages: 10,
        ...requestPolicy,
      }).apiTokenEnv,
    ).toBe('JOB_RADAR_TEAMTAILOR_TOKEN');
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
