import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizedJobSchema, type NormalizedJob } from '@job-radar/shared';

import type { DatabaseClient } from './database.js';
import { openDatabase, runMigrations } from './database.js';
import { JobRepository, ScanAlreadyActiveError } from './job-repository.js';

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
    expect(detail?.sources.map((source) => source.matchStrategy)).toEqual(
      expect.arrayContaining(['new_job', 'content_fingerprint']),
    );
    expect(
      detail?.sources.find((source) => source.matchStrategy === 'content_fingerprint')
        ?.matchExplanation,
    ).toContain('fingerprint');
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
    repository.applyLifecycle(greenhouse, new Set(), false, now);
    expect(
      repository
        .getJob(
          repository.listJobs({ active: null, search: '', limit: 50, offset: 0 }).jobs[0]!
            .id,
        )
        ?.sources.find((entry) => entry.sourceId === greenhouse.id)?.consecutiveMisses,
    ).toBe(2);
    expect(repository.applyLifecycle(greenhouse, new Set(), true, now)).toBe(1);
    expect(
      repository.listJobs({ active: false, search: '', limit: 50, offset: 0 }).total,
    ).toBe(1);
  });

  it('uses deterministic URL and composite rules without merging ambiguous candidates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-dedup-strategies-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const greenhouse = repository.createSource({
      type: 'greenhouse',
      name: 'Strategy Greenhouse',
      companyName: 'Strategy Example AB',
      identifier: 'strategy-greenhouse',
    });
    const lever = repository.createSource({
      type: 'lever',
      name: 'Strategy Lever',
      companyName: 'Strategy Example AB',
      identifier: 'strategy-lever',
      region: 'global',
    });
    const ashby = repository.createSource({
      type: 'ashby',
      name: 'Strategy Ashby',
      companyName: 'Strategy Example AB',
      identifier: 'strategy-ashby',
      includeCompensation: false,
    });
    const now = new Date('2026-08-31T12:00:00.000Z');
    const run = repository.createScan(1, [greenhouse, lever, ashby], [], now);

    repository.ingestJob(
      greenhouse,
      run.id,
      normalized('url-a', {
        externalId: 'url-a',
        sourceUrl: 'https://careers.example.test/jobs/url-match?utm_source=one#apply',
        canonicalUrl: 'https://careers.example.test/jobs/url-match?utm_source=one#apply',
        descriptionText: 'First distinct description for URL matching.',
        rawData: { fixture: 'url-a' },
      }),
      now,
    );
    repository.ingestJob(
      lever,
      run.id,
      normalized('url-b', {
        externalId: 'url-b',
        sourceUrl: 'https://CAREERS.example.test:443/jobs/url-match/',
        canonicalUrl: 'https://CAREERS.example.test:443/jobs/url-match/',
        descriptionText: 'Second distinct description for URL matching.',
        rawData: { fixture: 'url-b' },
      }),
      now,
    );
    let jobs = repository.listJobs({ active: null, search: '', limit: 50, offset: 0 });
    expect(jobs.total).toBe(1);
    expect(repository.getJob(jobs.jobs[0]!.id)?.sources[1]?.matchStrategy).toBe(
      'canonical_url',
    );

    repository.ingestJob(
      greenhouse,
      run.id,
      normalized('same-source-2', {
        externalId: 'same-source-2',
        title: 'Fictional Composite Role',
        company: 'Composite Example AB',
        location: 'Gothenburg, Sweden',
        publishedAt: '2026-08-28T08:00:00.000Z',
        sourceUrl: 'https://careers.example.test/jobs/composite-one',
        canonicalUrl: 'https://careers.example.test/jobs/composite-one',
        descriptionText: 'Composite candidate one.',
        rawData: { fixture: 'composite-one' },
      }),
      now,
    );
    repository.ingestJob(
      lever,
      run.id,
      normalized('composite-match', {
        externalId: 'composite-match',
        title: 'Fictional Composite Role',
        company: 'Composite Example AB',
        location: 'Gothenburg, Sweden',
        publishedAt: '2026-08-28T20:00:00.000Z',
        sourceUrl: 'https://careers.example.test/jobs/composite-other-source',
        canonicalUrl: 'https://careers.example.test/jobs/composite-other-source',
        descriptionText: 'A different description matched by the strict composite.',
        rawData: { fixture: 'composite-match' },
      }),
      now,
    );
    const compositeJob = repository.listJobs({
      active: null,
      search: 'Composite Role',
      limit: 50,
      offset: 0,
    }).jobs[0];
    expect(
      repository
        .getJob(compositeJob!.id)
        ?.sources.some(
          (entry) => entry.matchStrategy === 'company_title_location_published',
        ),
    ).toBe(true);
    repository.ingestJob(
      greenhouse,
      run.id,
      normalized('same-source-3', {
        externalId: 'same-source-3',
        title: 'Fictional Composite Role',
        company: 'Composite Example AB',
        location: 'Gothenburg, Sweden',
        publishedAt: '2026-08-28T18:00:00.000Z',
        sourceUrl: 'https://careers.example.test/jobs/composite-two',
        canonicalUrl: 'https://careers.example.test/jobs/composite-two',
        descriptionText: 'Composite candidate two.',
        rawData: { fixture: 'composite-two' },
      }),
      now,
    );
    repository.ingestJob(
      ashby,
      run.id,
      normalized('ambiguous', {
        externalId: 'ambiguous',
        title: 'Fictional Composite Role',
        company: 'Composite Example AB',
        location: 'Gothenburg, Sweden',
        publishedAt: '2026-08-28T12:00:00.000Z',
        sourceUrl: 'https://careers.example.test/jobs/composite-three',
        canonicalUrl: 'https://careers.example.test/jobs/composite-three',
        descriptionText: 'An intentionally ambiguous third description.',
        rawData: { fixture: 'composite-three' },
      }),
      now,
    );
    jobs = repository.listJobs({ active: null, search: '', limit: 50, offset: 0 });
    expect(jobs.total).toBe(4);

    repository.requestCancellation(run.id, now);
    for (const source of [greenhouse, lever, ashby]) {
      repository.completeSourceRun(run.id, source.id, {
        status: 'cancelled',
        resultSetComplete: null,
        pagesFetched: 0,
        counts: {
          discovered: 0,
          fetched: 0,
          created: 0,
          updated: 0,
          unchanged: 0,
          closed: 0,
          failed: 0,
        },
        errorCategory: 'cancelled',
        errorSummary: 'Test scan completed before reprocessing',
        finishedAt: now,
      });
    }
    repository.completeScan(run.id, now);
    expect(repository.reprocessJobs(now).merged).toBe(0);
    expect(
      repository.listJobs({ active: null, search: '', limit: 50, offset: 0 }).total,
    ).toBe(4);
  });

  it('records classified snapshot changes, reopens jobs, and preserves history on reprocess', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-reprocess-lifecycle-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const source = repository.createSource({
      type: 'greenhouse',
      name: 'History Greenhouse',
      companyName: 'Northstar Exact Match AB',
      identifier: 'history-greenhouse',
    });
    const now = new Date('2026-08-31T12:00:00.000Z');
    const run = repository.createScan(1, [source], [], now);
    repository.ingestJob(source, run.id, normalized('history'), now);
    repository.ingestJob(
      source,
      run.id,
      normalized('history', {
        location: 'Gothenburg, Sweden',
        deadline: '2026-11-30T23:59:59.000Z',
        descriptionText: 'The fictional description now includes a material change.',
        rawData: { fixture: 'history', version: 2 },
      }),
      new Date('2026-09-01T12:00:00.000Z'),
    );
    const jobId = repository.listJobs({
      active: null,
      search: '',
      limit: 50,
      offset: 0,
    }).jobs[0]!.id;
    const changed = repository.getJob(jobId)!;
    expect(changed.history[0]?.changedFields).toEqual(
      expect.arrayContaining(['description', 'location', 'deadline']),
    );

    repository.applyLifecycle(source, new Set(), true, now);
    repository.applyLifecycle(source, new Set(), true, now);
    repository.applyLifecycle(source, new Set(), true, now);
    expect(repository.getJob(jobId)?.lifecycleStatus).toBe('closed');
    repository.ingestJob(
      source,
      run.id,
      normalized('history', {
        location: 'Gothenburg, Sweden',
        deadline: '2026-11-30T23:59:59.000Z',
        descriptionText: 'The fictional description now includes a material change.',
        rawData: { fixture: 'history', version: 2 },
      }),
      new Date('2026-09-02T12:00:00.000Z'),
    );
    expect(repository.getJob(jobId)?.lifecycleStatus).toBe('open');

    repository.completeSourceRun(run.id, source.id, {
      status: 'succeeded',
      resultSetComplete: true,
      pagesFetched: 1,
      counts: {
        discovered: 1,
        fetched: 1,
        created: 1,
        updated: 1,
        unchanged: 1,
        closed: 1,
        failed: 0,
      },
      errorCategory: null,
      errorSummary: null,
      finishedAt: new Date('2026-09-02T12:00:00.000Z'),
    });
    repository.completeScan(run.id, new Date('2026-09-02T12:00:00.000Z'));
    const snapshotCount = changed.history.length;
    const first = repository.reprocessJobs(new Date('2026-09-03T12:00:00.000Z'));
    const second = repository.reprocessJobs(new Date('2026-09-04T12:00:00.000Z'));
    expect(first.snapshotsPreserved).toBe(snapshotCount);
    expect(second).toMatchObject({ merged: 0, snapshotsPreserved: snapshotCount });
    expect(repository.getJob(jobId)?.history).toHaveLength(snapshotCount);
  });

  it('merges an unambiguous legacy URL duplicate without losing either snapshot', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-legacy-reprocess-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const greenhouse = repository.createSource({
      type: 'greenhouse',
      name: 'Legacy Greenhouse',
      companyName: 'Legacy One AB',
      identifier: 'legacy-greenhouse',
    });
    const lever = repository.createSource({
      type: 'lever',
      name: 'Legacy Lever',
      companyName: 'Legacy Two AB',
      identifier: 'legacy-lever',
      region: 'global',
    });
    const now = new Date('2026-08-31T12:00:00.000Z');
    const run = repository.createScan(1, [greenhouse, lever], [], now);
    repository.ingestJob(
      greenhouse,
      run.id,
      normalized('legacy-greenhouse', {
        company: 'Legacy One AB',
        title: 'Fictional Legacy Role One',
        canonicalUrl: 'https://old-one.example.test/jobs/1',
        sourceUrl: 'https://old-one.example.test/jobs/1',
        descriptionText: 'First historical fictional description.',
      }),
      now,
    );
    repository.ingestJob(
      lever,
      run.id,
      normalized('legacy-lever', {
        company: 'Legacy Two AB',
        title: 'Fictional Legacy Role Two',
        canonicalUrl: 'https://old-two.example.test/jobs/2',
        sourceUrl: 'https://old-two.example.test/jobs/2',
        descriptionText: 'Second historical fictional description.',
      }),
      now,
    );
    for (const source of [greenhouse, lever]) {
      repository.completeSourceRun(run.id, source.id, {
        status: 'succeeded',
        resultSetComplete: true,
        pagesFetched: 1,
        counts: {
          discovered: 1,
          fetched: 1,
          created: 1,
          updated: 0,
          unchanged: 0,
          closed: 0,
          failed: 0,
        },
        errorCategory: null,
        errorSummary: null,
        finishedAt: now,
      });
    }
    repository.completeScan(run.id, now);

    const before = repository.listJobs({
      active: null,
      search: '',
      limit: 50,
      offset: 0,
    });
    expect(before.total).toBe(2);
    database.sqlite
      .prepare('update jobs set canonical_url = ? where id = ?')
      .run(
        'HTTPS://Careers.Example.test:443//jobs/legacy/?utm_source=old#apply',
        before.jobs[0]!.id,
      );
    database.sqlite
      .prepare('update jobs set canonical_url = ? where id = ?')
      .run('https://careers.example.test/jobs/legacy', before.jobs[1]!.id);
    database.sqlite
      .prepare('update job_sources set source_url = ? where source_id = ?')
      .run(
        'HTTPS://Careers.Example.test:443//jobs/legacy/?utm_source=old#apply',
        greenhouse.id,
      );

    const result = repository.reprocessJobs(new Date('2026-09-01T12:00:00.000Z'));
    expect(result).toMatchObject({ processed: 2, merged: 1, snapshotsPreserved: 2 });
    expect(result.canonicalUrlsUpdated).toBeGreaterThan(0);
    const after = repository.listJobs({
      active: null,
      search: '',
      limit: 50,
      offset: 0,
    });
    expect(after.total).toBe(1);
    const detail = repository.getJob(after.jobs[0]!.id)!;
    expect(detail.sources).toHaveLength(2);
    expect(detail.history).toHaveLength(2);
    expect(detail.sources.map((source) => source.matchStrategy)).toContain('reprocessed');
    expect(detail.sources.every((source) => source.sourceUrl.includes('utm_'))).toBe(
      false,
    );
    expect(repository.reprocessJobs(new Date('2026-09-02T12:00:00.000Z')).merged).toBe(0);
  });

  it('persists config versions and rejects duplicate durable scans', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-scan-lock-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const source = repository.createSource({
      type: 'greenhouse',
      name: 'Versioned Greenhouse',
      companyName: 'Versioned Example AB',
      identifier: 'versioned-greenhouse',
    });
    const first = repository.createScan(1, [source], [], new Date());
    expect(() => repository.createScan(1, [source], [], new Date())).toThrow(
      ScanAlreadyActiveError,
    );
    expect(() => repository.reprocessJobs(new Date())).toThrow(ScanAlreadyActiveError);
    repository.completeSourceRun(first.id, source.id, {
      status: 'succeeded',
      resultSetComplete: true,
      pagesFetched: 1,
      counts: {
        discovered: 0,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        closed: 0,
        failed: 0,
      },
      errorCategory: null,
      errorSummary: null,
      finishedAt: new Date(),
    });
    repository.completeScan(first.id, new Date());
    const updated = repository.updateSource(source.id, {
      identifier: 'versioned-greenhouse-v2',
    });
    const second = repository.createScan(1, [updated], [], new Date());
    expect(repository.getScan(first.id)?.sourceRuns[0]?.configVersion).toBe(1);
    expect(repository.getScan(second.id)?.sourceRuns[0]?.configVersion).toBe(2);
  });
});
