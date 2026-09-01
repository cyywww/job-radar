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
      'The same complete fictional description is published on two Sweden sources.',
    descriptionHtml: null,
    sourceUrl: `https://example.test/${source}/jobs/1`,
    canonicalUrl: `https://example.test/${source}/jobs/1`,
    remoteMode: 'hybrid',
    employmentType: 'Full-time',
    sourceActive: true,
    sourceMetadata: { fixtureSource: source },
    rawData: { source, id: `${source}-external-1`, descriptionVersion: 1 },
    ...overrides,
  });
}

function targetPage(
  repository: JobRepository,
  name: string,
  slug: string,
  companyName = 'Northstar Exact Match AB',
) {
  return repository.createSource({
    type: 'generic_web',
    name,
    companyName,
    startUrl: `https://careers.example.test/${slug}`,
  });
}

describe('JobRepository multi-source identity', () => {
  it('conservatively merges exact cross-source jobs and keeps repeat scans idempotent', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-job-repository-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const jobtech = repository.ensureDefaultSources();
    const companyPage = targetPage(repository, 'Northstar careers', 'northstar');
    const run = repository.createScan(1, [jobtech, companyPage], [], new Date());

    expect(
      repository.ingestJob(jobtech, run.id, normalized('jobtech'), new Date()),
    ).toMatchObject({ outcome: 'created' });
    expect(
      repository.ingestJob(companyPage, run.id, normalized('company-page'), new Date()),
    ).toMatchObject({ outcome: 'updated' });
    expect(
      repository.ingestJob(companyPage, run.id, normalized('company-page'), new Date()),
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
    const jobtech = repository.ensureDefaultSources();
    const companyPage = targetPage(repository, 'Lifecycle company page', 'lifecycle');
    const now = new Date('2026-08-31T12:00:00.000Z');
    const run = repository.createScan(1, [jobtech, companyPage], [], now);

    repository.ingestJob(jobtech, run.id, normalized('jobtech'), now);
    repository.ingestJob(companyPage, run.id, normalized('company-page'), now);
    repository.ingestJob(
      companyPage,
      run.id,
      normalized('company-page', {
        sourceActive: false,
        rawData: {
          source: 'company-page',
          id: 'company-page-external-1',
          descriptionVersion: 1,
          removed: true,
        },
      }),
      now,
    );

    expect(
      repository.listJobs({ active: true, search: '', limit: 50, offset: 0 }).total,
    ).toBe(1);

    repository.applyLifecycle(jobtech, new Set(), true, now);
    repository.applyLifecycle(jobtech, new Set(), true, now);
    repository.applyLifecycle(jobtech, new Set(), false, now);
    expect(
      repository
        .getJob(
          repository.listJobs({ active: null, search: '', limit: 50, offset: 0 }).jobs[0]!
            .id,
        )
        ?.sources.find((entry) => entry.sourceId === jobtech.id)?.consecutiveMisses,
    ).toBe(2);
    expect(repository.applyLifecycle(jobtech, new Set(), true, now)).toBe(1);
    expect(
      repository.listJobs({ active: false, search: '', limit: 50, offset: 0 }).total,
    ).toBe(1);
  });

  it('uses deterministic URL and composite rules without merging ambiguous candidates', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-dedup-strategies-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const jobtech = repository.ensureDefaultSources();
    const firstPage = targetPage(
      repository,
      'Strategy company page one',
      'strategy-one',
      'Strategy Example AB',
    );
    const secondPage = targetPage(
      repository,
      'Strategy company page two',
      'strategy-two',
      'Strategy Example AB',
    );
    const now = new Date('2026-08-31T12:00:00.000Z');
    const run = repository.createScan(1, [jobtech, firstPage, secondPage], [], now);

    repository.ingestJob(
      jobtech,
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
      firstPage,
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
      jobtech,
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
      firstPage,
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
      jobtech,
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
      secondPage,
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
    for (const source of [jobtech, firstPage, secondPage]) {
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
    const source = repository.ensureDefaultSources();
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
    const jobtech = repository.ensureDefaultSources();
    const companyPage = targetPage(
      repository,
      'Legacy company page',
      'legacy',
      'Legacy Two AB',
    );
    const now = new Date('2026-08-31T12:00:00.000Z');
    const run = repository.createScan(1, [jobtech, companyPage], [], now);
    repository.ingestJob(
      jobtech,
      run.id,
      normalized('legacy-jobtech', {
        company: 'Legacy One AB',
        title: 'Fictional Legacy Role One',
        canonicalUrl: 'https://old-one.example.test/jobs/1',
        sourceUrl: 'https://old-one.example.test/jobs/1',
        descriptionText: 'First historical fictional description.',
      }),
      now,
    );
    repository.ingestJob(
      companyPage,
      run.id,
      normalized('legacy-company-page', {
        company: 'Legacy Two AB',
        title: 'Fictional Legacy Role Two',
        canonicalUrl: 'https://old-two.example.test/jobs/2',
        sourceUrl: 'https://old-two.example.test/jobs/2',
        descriptionText: 'Second historical fictional description.',
      }),
      now,
    );
    for (const source of [jobtech, companyPage]) {
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
        jobtech.id,
      );

    for (const [index, job] of before.jobs.entries()) {
      const snapshotId = repository.getJob(job.id)!.snapshot.id;
      const taskId = `93000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const requirementId = `94000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const scoreId = `95000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const attemptId = `96000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      database.sqlite
        .prepare(
          `insert into scoring_tasks
            (id, job_id, snapshot_id, profile_version, extractor_version, scoring_version,
             status, attempt_count, max_attempts, created_at, updated_at)
           values (?, ?, ?, 1, 'fictional-extractor-v1', 'fictional-scoring-v1',
             'succeeded', 1, 3, ?, ?)`,
        )
        .run(taskId, job.id, snapshotId, now.getTime(), now.getTime());
      database.sqlite
        .prepare(
          `insert into job_requirements
            (id, task_id, job_id, snapshot_id, profile_version, extractor_version,
             extraction_json, confidence_micros, provider, model, created_at)
           values (?, ?, ?, ?, 1, 'fictional-extractor-v1', '{}', 900000,
             'codex_cli', 'fictional-model', ?)`,
        )
        .run(requirementId, taskId, job.id, snapshotId, now.getTime());
      database.sqlite
        .prepare(
          `insert into job_scores
            (id, task_id, requirement_id, job_id, snapshot_id, profile_version,
             scoring_version, eligible, job_active, gate_reasons_json, match_score,
             ranking_score, ranking_factors_json, breakdown_json, matched_evidence_json,
             gaps_json, unknowns_json, confidence_micros, provider, model, review_state,
             explanation, ranking_as_of, created_at, updated_at)
           values (?, ?, ?, ?, ?, 1, 'fictional-scoring-v1', 0, 1,
             '[{"code":"company_excluded","outcome":"fail","explanation":"Fictional exclusion."}]',
             null, null, null, null, '[]', '[]', '[]', 900000, 'codex_cli',
             'fictional-model', 'not_required', 'Fictional historical Gate failure.',
             null, ?, ?)`,
        )
        .run(
          scoreId,
          taskId,
          requirementId,
          job.id,
          snapshotId,
          now.getTime(),
          now.getTime(),
        );
      database.sqlite
        .prepare(
          `insert into scoring_attempts
            (id, task_id, attempt_number, outcome, provider, model, output_bytes,
             started_at, finished_at)
           values (?, ?, 1, 'succeeded', 'codex_cli', 'fictional-model', 0, ?, ?)`,
        )
        .run(attemptId, taskId, now.getTime(), now.getTime());
      database.sqlite
        .prepare(
          `insert into job_triage (job_id, status, note, updated_at)
           values (?, ?, ?, ?)`,
        )
        .run(
          job.id,
          index === 0 ? 'shortlisted' : 'ignored',
          `Fictional triage ${index + 1}.`,
          now.getTime() + index,
        );
      database.sqlite
        .prepare(
          `insert into score_feedback
            (id, job_id, score_id, type, original_score, suggested_score, reason, created_at)
           values (?, ?, ?, 'job_specific', null, null, ?, ?)`,
        )
        .run(
          `97000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          job.id,
          scoreId,
          `Fictional feedback ${index + 1}.`,
          now.getTime(),
        );
      database.sqlite
        .prepare(
          `insert into score_review_events
            (id, job_id, score_id, previous_state, state, reason, created_at)
           values (?, ?, ?, 'not_required', 'rejected', ?, ?)`,
        )
        .run(
          `98000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
          job.id,
          scoreId,
          `Fictional review event ${index + 1}.`,
          now.getTime(),
        );
    }

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
    expect(
      database.sqlite
        .prepare(
          `select
             (select count(*) from scoring_tasks where job_id = ?) as tasks,
             (select count(*) from job_requirements where job_id = ?) as requirements,
             (select count(*) from job_scores where job_id = ?) as scores,
             (select count(*) from job_triage where job_id = ?) as triage,
             (select count(*) from score_feedback where job_id = ?) as feedback,
             (select count(*) from score_review_events where job_id = ?) as review_events,
             (select count(*) from scoring_attempts) as attempts`,
        )
        .get(detail.id, detail.id, detail.id, detail.id, detail.id, detail.id),
    ).toEqual({
      tasks: 2,
      requirements: 2,
      scores: 2,
      triage: 1,
      feedback: 2,
      review_events: 2,
      attempts: 2,
    });
    expect(
      database.sqlite
        .prepare('select status, note from job_triage where job_id = ?')
        .get(detail.id),
    ).toEqual({ status: 'ignored', note: 'Fictional triage 2.' });
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(repository.reprocessJobs(new Date('2026-09-02T12:00:00.000Z')).merged).toBe(0);
  });

  it('persists config versions and rejects duplicate durable scans', () => {
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-scan-lock-'));
    database = openDatabase(join(directory, 'test.sqlite'));
    runMigrations(database);
    const repository = new JobRepository(database);
    const source = targetPage(
      repository,
      'Versioned company page',
      'versioned-one',
      'Versioned Example AB',
    );
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
      startUrl: 'https://careers.example.test/versioned-two',
    });
    const second = repository.createScan(1, [updated], [], new Date());
    expect(repository.getScan(first.id)?.sourceRuns[0]?.configVersion).toBe(1);
    expect(repository.getScan(second.id)?.sourceRuns[0]?.configVersion).toBe(2);
  });
});
