import { describe, expect, it } from 'vitest';

import { jobTechSourceConfigSchema, normalizedJobSchema, scanRunSchema } from './jobs.js';

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
        rawData: {},
      }),
    ).toThrow();
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
