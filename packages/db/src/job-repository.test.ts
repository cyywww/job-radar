import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizedJobSchema, type NormalizedJob } from '@job-radar/shared';

import type { DatabaseClient } from './database.js';
import { openDatabase, runMigrations } from './database.js';
import { JobRepository } from './job-repository.js';

let database: DatabaseClient | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function normalized(
  source: string,
  overrides: Partial<NormalizedJob> = {},
): NormalizedJob {
  return normalizedJobSchema.parse({
    externalId: `${source}-external-1`,
    title: 'Fictional Product Engineer',
    company: 'Northstar Exact Match AB',
    location: 'Stockholm, Sweden',
    publishedAt: '2026-08-30T08:00:00.000Z',
    deadline: null,
    descriptionText:
      'The same complete fictional description is published on two ATS boards.',
    descriptionHtml: null,
    sourceUrl: `https://example.test/${source}/jobs/1`,
    canonicalUrl: `https://example.test/${source}/jobs/1`,
    remoteMode: 'hybrid',
    employmentType: 'Full-time',
    sourceActive: true,
    sourceMetadata: { ats: source },
    rawData: { source, id: `${source}-external-1`, descriptionVersion: 1 },
    ...overrides,
  });
}

describe('JobRepository multi-source identity', () => {
  it('conservatively merges exact cross-source jobs and keeps repeat scans idempotent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-job-repository-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const greenhouse = repository.createSource({
      type: 'greenhouse',
      name: 'Northstar Greenhouse',
      companyName: 'Northstar Exact Match AB',
      identifier: 'northstar-greenhouse',
    });
    const lever = repository.createSource({
      type: 'lever',
      name: 'Northstar Lever',
      companyName: 'Northstar Exact Match AB',
      identifier: 'northstar-lever',
      region: 'global',
    });
    const run = repository.createScan(1, [greenhouse, lever], [], new Date());

    expect(
      repository.ingestJob(greenhouse, run.id, normalized('greenhouse'), new Date()),
    ).toMatchObject({ outcome: 'created' });
    expect(
      repository.ingestJob(lever, run.id, normalized('lever'), new Date()),
    ).toMatchObject({ outcome: 'updated' });
    expect(
      repository.ingestJob(lever, run.id, normalized('lever'), new Date()),
    ).toMatchObject({ outcome: 'unchanged' });

    const list = repository.listJobs({ active: true, search: '', limit: 50, offset: 0 });
    expect(list.total).toBe(1);
    expect(list.jobs[0]?.sourceCount).toBe(2);
    const detail = repository.getJob(list.jobs[0]!.id);
    expect(detail?.sources).toHaveLength(2);
    expect(detail?.sources.every((source) => source.sourceMetadataStored)).toBe(true);
    expect(detail?.history).toHaveLength(2);
  });

  it('keeps a merged job active while any source link remains active', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-source-lifecycle-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const greenhouse = repository.createSource({
      type: 'greenhouse',
      name: 'Lifecycle Greenhouse',
      companyName: 'Northstar Exact Match AB',
      identifier: 'lifecycle-greenhouse',
    });
    const lever = repository.createSource({
      type: 'lever',
      name: 'Lifecycle Lever',
      companyName: 'Northstar Exact Match AB',
      identifier: 'lifecycle-lever',
      region: 'global',
    });
    const now = new Date('2026-08-31T12:00:00.000Z');
    const run = repository.createScan(1, [greenhouse, lever], [], now);

    repository.ingestJob(greenhouse, run.id, normalized('greenhouse'), now);
    repository.ingestJob(lever, run.id, normalized('lever'), now);
    repository.ingestJob(
      lever,
      run.id,
      normalized('lever', {
        sourceActive: false,
        rawData: {
          source: 'lever',
          id: 'lever-external-1',
          descriptionVersion: 1,
          removed: true,
        },
      }),
      now,
    );

    expect(
      repository.listJobs({ active: true, search: '', limit: 50, offset: 0 }).total,
    ).toBe(1);

    repository.applyLifecycle(greenhouse, new Set(), true, now);
    repository.applyLifecycle(greenhouse, new Set(), true, now);
    expect(repository.applyLifecycle(greenhouse, new Set(), true, now)).toBe(1);
    expect(
      repository.listJobs({ active: false, search: '', limit: 50, offset: 0 }).total,
    ).toBe(1);
  });
});
