import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAppConfig } from '@job-radar/config';
import {
  JobRepository,
  openDatabase,
  runMigrations,
  type DatabaseClient,
} from '@job-radar/db';
import {
  EXTRACTOR_VERSION,
  type AIProvider,
  type ExtractionRequest,
} from '@job-radar/scoring';
import {
  dashboardResponseSchema,
  jobExtractionSchema,
  jobReviewDetailSchema,
  jobScoringHistorySchema,
  normalizedJobSchema,
  profileSnapshotSchema,
  scoringBackfillResultSchema,
  scoringConfigurationSchema,
  scoringProcessResultSchema,
  scoringQueueResponseSchema,
  reviewJobsResponseSchema,
  scoreFeedbackSchema,
  scoreReviewEventSchema,
  updateTriageResponseSchema,
  type JobExtraction,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import { buildApp } from './app.js';
import { getActiveScanEventConnections } from './routes/review.js';

type ProviderMode = 'success' | 'invalid_evidence' | 'gate_override';

let app: FastifyInstance;
let database: DatabaseClient;
let providerMode: ProviderMode;
let jobId: string;

const providerUsage = {
  inputTokens: 1_000,
  cachedInputTokens: 100,
  outputTokens: 250,
  reasoningOutputTokens: 50,
  totalTokens: 1_250,
} as const;

function extraction(request: ExtractionRequest): JobExtraction {
  const skillEvidenceId = request.profile.skills[0]!.evidenceId;
  const workEvidenceId = request.profile.workExperiences[0]!.evidenceId;
  return jobExtractionSchema.parse({
    requiredSkills: [
      {
        id: 'skill-typescript',
        name: 'TypeScript',
        minimumYears: null,
        jdSnippet: 'Build TypeScript services.',
      },
    ],
    preferredSkills: [
      {
        id: 'skill-react',
        name: 'React',
        minimumYears: null,
        jdSnippet: 'React experience is preferred.',
      },
    ],
    responsibilities: [
      {
        id: 'responsibility-delivery',
        text: 'Lead fictional delivery',
        jdSnippet: 'Lead fictional delivery.',
      },
    ],
    seniority: 'senior',
    yearsRequired: null,
    languages: [
      {
        id: 'language-english',
        language: 'English',
        requirement: 'required',
        minimumProficiency: 'professional',
        jdSnippet: 'English is required.',
      },
    ],
    workAuthorization: {
      policy: 'authorized_in_country',
      countries: ['Sweden'],
      jdSnippet: 'Applicants must be authorized to work in Sweden.',
    },
    education: { required: false, level: 'unspecified', fields: [], jdSnippet: null },
    domain: [
      {
        id: 'domain-tools',
        name: 'Developer tools',
        requirement: 'required',
        jdSnippet: 'Developer tools experience is required.',
      },
    ],
    locationPolicy: {
      workMode: 'hybrid',
      locations: ['Stockholm'],
      remoteCountries: [],
      onsiteDaysPerWeek: null,
      jdSnippet: 'Hybrid work in Stockholm.',
    },
    salary: {
      minimum: null,
      maximum: null,
      currency: null,
      period: null,
      jdSnippet: null,
    },
    securityClearance: {
      required: false,
      name: null,
      citizenshipCountries: [],
      jdSnippet: null,
    },
    matchedEvidence: [
      {
        requirementId: 'skill-typescript',
        dimension: 'required_skills',
        jdSnippet: 'Build TypeScript services.',
        profileEvidenceId:
          providerMode === 'invalid_evidence'
            ? '90000000-0000-4000-8000-000000000099'
            : skillEvidenceId,
        explanation: 'Confirmed TypeScript evidence directly matches the requirement.',
        evidenceDepth: 'demonstrated',
      },
      {
        requirementId: 'domain-tools',
        dimension: 'domain',
        jdSnippet: 'Developer tools experience is required.',
        profileEvidenceId: workEvidenceId,
        explanation: 'Confirmed fictional work provides domain evidence.',
        evidenceDepth: 'outcome',
      },
    ],
    gaps: [
      {
        requirementId: 'skill-react',
        dimension: 'skill_depth',
        severity: 'preferred',
        requirement: 'React experience',
        explanation: 'No confirmed React evidence is available.',
      },
    ],
    unknowns: [],
    seniorityFit: 'full',
    roleFit: 'full',
    confidence: 0.9,
    extractorVersion: EXTRACTOR_VERSION,
  });
}

const fakeProvider: AIProvider = {
  id: 'codex_cli',
  model: 'fictional-offline-model',
  async extract(request) {
    const valid = extraction(request);
    if (providerMode === 'gate_override') {
      return {
        extraction: { ...valid, eligible: true } as unknown as JobExtraction,
        usage: providerUsage,
        outputBytes: 2_048,
      };
    }
    return {
      extraction: valid,
      usage: providerUsage,
      outputBytes: 2_048,
    };
  },
};

function seedJob(): string {
  const jobs = new JobRepository(database);
  const source = jobs.ensureDefaultSources();
  const scan = jobs.createScan(1, [source], ['Product Engineer']);
  const ingested = jobs.ingestJob(
    source,
    scan.id,
    normalizedJobSchema.parse({
      externalId: 'fictional-api-score-1',
      title: 'Product Engineer',
      company: 'Fictional Score Works AB',
      location: 'Stockholm, Sweden',
      publishedAt: '2026-08-30T08:00:00.000Z',
      deadline: null,
      descriptionText:
        'Build TypeScript services. Lead fictional delivery. English is required. Applicants must be authorized to work in Sweden. Hybrid work in Stockholm. Developer tools experience is required. React experience is preferred.',
      descriptionHtml: null,
      sourceUrl: 'https://jobs.example.test/fictional-api-score-1',
      canonicalUrl: 'https://jobs.example.test/fictional-api-score-1',
      remoteMode: 'hybrid',
      employmentType: 'Full-time',
      sourceActive: true,
      sourceMetadata: {},
      rawData: { fixture: 'scoring-api' },
    }),
    new Date('2026-09-01T08:00:00.000Z'),
  );
  jobs.completeSourceRun(scan.id, source.id, {
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
    finishedAt: new Date('2026-09-01T08:00:01.000Z'),
  });
  jobs.completeScan(scan.id, new Date('2026-09-01T08:00:01.000Z'));
  return ingested.jobId;
}

beforeEach(async () => {
  providerMode = 'success';
  const directory = mkdtempSync(join(tmpdir(), 'job-radar-scoring-api-'));
  const config = getAppConfig(
    {
      NODE_ENV: 'test',
      JOB_RADAR_DATABASE_PATH: join(directory, 'test.sqlite'),
      JOB_RADAR_WEB_DIST_DIR: join(directory, 'missing-web-dist'),
      JOB_RADAR_DATA_DIR: directory,
      JOB_RADAR_CONFIG_DIR: join(directory, 'config'),
      JOB_RADAR_LOG_DIR: join(directory, 'logs'),
      JOB_RADAR_SCORING_MAX_ATTEMPTS: '1',
      JOB_RADAR_SCORING_RETRY_BASE_MS: '1000',
      JOB_RADAR_SCORING_RETRY_MAX_MS: '1000',
    },
    '/workspace/job-radar',
  );
  database = openDatabase(config.databasePath);
  runMigrations(database);
  app = await buildApp({
    config,
    database,
    logger: false,
    scoringProvider: fakeProvider,
  });
  const profile = await app.inject({
    method: 'POST',
    url: '/api/profile',
    payload: createFictionalProfileInput(),
  });
  expect(profile.statusCode).toBe(201);
  jobId = seedJob();
});

afterEach(async () => app.close());

describe('scoring API', () => {
  it('reports the explicitly selected model', async () => {
    const configuration = scoringConfigurationSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/scoring/config' })).json(),
    );
    expect(configuration).toEqual({
      ready: true,
      provider: 'codex_cli',
      model: 'fictional-offline-model',
    });
  });

  it('starts normally but refuses AI processing when no model was specified', async () => {
    await app.close();
    const directory = mkdtempSync(join(tmpdir(), 'job-radar-no-model-api-'));
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
    app = await buildApp({ config, database, logger: false });

    expect(
      scoringConfigurationSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/scoring/config' })).json(),
      ),
    ).toEqual({
      ready: false,
      provider: 'codex_cli',
      model: null,
    });
    const process = await app.inject({
      method: 'POST',
      url: '/api/scoring/process',
      payload: { limit: 1 },
    });
    expect(process.statusCode).toBe(409);
    expect(process.json()).toMatchObject({
      error: { code: 'SCORING_MODEL_NOT_CONFIGURED' },
    });
    expect(
      database.sqlite.prepare('select count(*) as count from scoring_tasks').get(),
    ).toEqual({ count: 0 });
  });

  it('serves the M4 dashboard, review list/detail, triage, feedback, and review history', async () => {
    await app.inject({ method: 'POST', url: '/api/scoring/backfill', payload: {} });
    await app.inject({
      method: 'POST',
      url: '/api/scoring/process',
      payload: { limit: 1 },
    });

    const dashboard = dashboardResponseSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/dashboard' })).json(),
    );
    expect(dashboard.strongMatchThreshold).toBe(80);
    expect(dashboard.topJobs[0]).toMatchObject({ id: jobId });

    const list = reviewJobsResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/review/jobs?search=TypeScript&sort=matchScore&direction=desc',
        })
      ).json(),
    );
    expect(list.total).toBe(1);
    expect(list.jobs[0]).toMatchObject({
      id: jobId,
      triage: { status: 'new', updatedAt: null },
      score: { state: 'scored', eligible: true },
    });
    expect(list.jobs[0]?.score.matchScore).not.toBe(list.jobs[0]?.score.rankingScore);

    const triage = updateTriageResponseSchema.parse(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/jobs/${jobId}/triage`,
          payload: { status: 'shortlisted' },
        })
      ).json(),
    );
    expect(triage).toMatchObject({
      previous: { status: 'new' },
      current: { status: 'shortlisted' },
    });
    const sourceId = new JobRepository(database).getJob(jobId)!.sources[0]!.sourceId;
    const filtered = reviewJobsResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url:
            `/api/review/jobs?search=TypeScript&triage=shortlisted` +
            `&location=Stockholm&remoteMode=hybrid&company=Fictional%20Score` +
            `&sourceId=${sourceId}&lifecycle=open&gate=passed` +
            '&scoreStatus=scored&reviewState=not_required&includeClosed=false' +
            '&sort=rankingScore&direction=desc',
        })
      ).json(),
    );
    expect(filtered.jobs.map(({ id }) => id)).toEqual([jobId]);
    const restored = await app.inject({
      method: 'POST',
      url: '/api/jobs/bulk-triage/restore',
      payload: {
        records: [
          {
            jobId: triage.previous.jobId,
            status: triage.previous.status,
            note: triage.previous.note,
            updatedAt: triage.previous.updatedAt,
          },
        ],
      },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ current: [{ status: 'new' }] });

    const feedback = scoreFeedbackSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/jobs/${jobId}/feedback`,
          payload: {
            type: 'job_specific',
            suggestedScore: 61,
            reason:
              'The fictional responsibilities need a separate human interpretation.',
          },
        })
      ).json(),
    );
    const formalBefore = database.sqlite
      .prepare('select match_score, ranking_score from job_scores where id = ?')
      .get(feedback.scoreId) as { match_score: number; ranking_score: number };
    expect(feedback.originalScore).toBe(formalBefore.match_score);
    expect(feedback.suggestedScore).toBe(61);

    const reviewEvent = scoreReviewEventSchema.parse(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/jobs/${jobId}/review`,
          payload: {
            state: 'rejected',
            reason: 'The fictional extraction should be reviewed without rewriting it.',
          },
        })
      ).json(),
    );
    expect(reviewEvent.state).toBe('rejected');
    expect(
      database.sqlite
        .prepare('select match_score, ranking_score from job_scores where id = ?')
        .get(feedback.scoreId),
    ).toEqual(formalBefore);

    const detail = jobReviewDetailSchema.parse(
      (await app.inject({ method: 'GET', url: `/api/review/jobs/${jobId}` })).json(),
    );
    expect(detail.currentScore?.reviewState).toBe('rejected');
    expect(detail.currentRequirement?.extraction.requiredSkills[0]?.name).toBe(
      'TypeScript',
    );
    expect(detail.feedback).toHaveLength(1);
    expect(detail.reviewHistory).toHaveLength(1);
    expect(detail.job.snapshot.descriptionText).toContain('Build TypeScript services.');
  });

  it('validates bulk review operations and emits a persisted terminal SSE state', async () => {
    const invalidSort = await app.inject({
      method: 'GET',
      url: '/api/review/jobs?sort=not-a-column',
    });
    expect(invalidSort.statusCode).toBe(400);

    const bulk = await app.inject({
      method: 'POST',
      url: '/api/jobs/bulk-triage',
      payload: { jobIds: [jobId], status: 'ignored' },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toMatchObject({
      previous: [{ status: 'new' }],
      current: [{ status: 'ignored' }],
    });
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/jobs/bulk-triage',
      payload: { jobIds: [jobId, jobId], status: 'archived' },
    });
    expect(duplicate.statusCode).toBe(400);

    const rescore = await app.inject({
      method: 'POST',
      url: '/api/jobs/bulk-rescore',
      payload: { jobIds: [jobId] },
    });
    expect(rescore.statusCode).toBe(200);
    expect(rescore.json()).toMatchObject({ tasks: [{ status: 'pending' }] });
    const rescoredTaskId = (rescore.json() as { tasks: Array<{ id: string }> }).tasks[0]!
      .id;
    database.sqlite
      .prepare(
        `update scoring_tasks
         set status = 'failed', attempt_count = max_attempts,
             last_error_code = 'fixture_failure',
             last_error_summary = 'Fictional retryable failure.'
         where id = ?`,
      )
      .run(rescoredTaskId);
    const retried = await app.inject({
      method: 'POST',
      url: '/api/scoring/retry-failed',
      payload: { limit: 25 },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toMatchObject({
      tasks: [{ id: rescoredTaskId, status: 'pending' }],
    });

    const runId = (
      database.sqlite
        .prepare('select id from scan_runs order by created_at desc limit 1')
        .get() as { id: string }
    ).id;
    const events = await app.inject({
      method: 'GET',
      url: `/api/scans/${runId}/events`,
    });
    expect(events.statusCode).toBe(200);
    expect(events.headers['content-type']).toContain('text/event-stream');
    expect(events.payload).toContain('event: scan');
    expect(events.payload).toContain('"terminal":true');
    expect(events.payload).not.toContain('Build TypeScript services');
    expect(getActiveScanEventConnections()).toBe(0);

    const reconnected = await app.inject({
      method: 'GET',
      url: `/api/scans/${runId}/events`,
    });
    expect(reconnected.payload).toContain('"terminal":true');
    expect(getActiveScanEventConnections()).toBe(0);
  });

  it('streams persisted SSE progress, cleans up disconnects, and reconnects to terminal state', async () => {
    const repository = new JobRepository(database);
    const source = repository.listSources()[0]!;
    const startedAt = new Date('2026-09-01T09:00:00.000Z');
    const run = repository.createScan(1, [source], [], startedAt);
    repository.markScanRunning(run.id, startedAt);
    repository.markSourceRunRunning(run.id, source.id, startedAt);

    const controller = new AbortController();
    const response = await app.inject({
      method: 'GET',
      url: `/api/scans/${run.id}/events`,
      signal: controller.signal,
      payloadAsStream: true,
    });
    expect(response.statusCode).toBe(200);
    const iterator = response.stream()[Symbol.asyncIterator]();
    let stream = String((await iterator.next()).value);
    expect(stream).toContain('"phase":"health"');
    expect(stream).toContain('"discovered":0');
    expect(getActiveScanEventConnections()).toBe(1);

    repository.markSourceRunStage(run.id, source.id, 'discovery');
    const progress = {
      discovered: 3,
      fetched: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      closed: 0,
      failed: 0,
    };
    repository.updateSourceRunProgress(run.id, source.id, {
      counts: progress,
      pagesFetched: 1,
      resultSetComplete: true,
    });
    while (!stream.includes('"phase":"discovery"')) {
      stream += String((await iterator.next()).value);
    }
    expect(stream).toContain('"discovered":3');

    controller.abort();
    await expect(iterator.next()).rejects.toBeDefined();
    await expect.poll(() => getActiveScanEventConnections()).toBe(0);

    repository.completeSourceRun(run.id, source.id, {
      status: 'succeeded',
      resultSetComplete: true,
      pagesFetched: 1,
      counts: progress,
      errorCategory: null,
      errorSummary: null,
      failureStage: null,
      finishedAt: new Date('2026-09-01T09:01:00.000Z'),
    });
    repository.completeScan(run.id, new Date('2026-09-01T09:01:00.000Z'));
    const terminal = await app.inject({
      method: 'GET',
      url: `/api/scans/${run.id}/events`,
    });
    const terminalBody = terminal.payload;
    expect(terminalBody).toContain('"terminal":true');
    expect(terminalBody).toContain('"discovered":3');
    expect(getActiveScanEventConnections()).toBe(0);
  });

  it('backfills idempotently, scores once per claim, and preserves rescore history', async () => {
    const firstBackfill = scoringBackfillResultSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scoring/backfill',
          payload: {},
        })
      ).json(),
    );
    const secondBackfill = scoringBackfillResultSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scoring/backfill',
          payload: {},
        })
      ).json(),
    );
    expect(firstBackfill).toEqual({ queued: 1, invalidated: 0 });
    expect(secondBackfill).toEqual({ queued: 0, invalidated: 0 });

    const processed = scoringProcessResultSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scoring/process',
          payload: { limit: 1 },
        })
      ).json(),
    );
    expect(processed).toEqual({
      claimed: 1,
      succeeded: 1,
      review: 0,
      pendingRetry: 0,
      failed: 0,
      usage: providerUsage,
    });

    let history = jobScoringHistorySchema.parse(
      (await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/scoring` })).json(),
    );
    expect(history.current).toMatchObject({
      eligible: true,
      profileVersion: 1,
      provider: 'codex_cli',
      model: 'fictional-offline-model',
      reviewState: 'not_required',
    });
    expect(Number.isInteger(history.current?.matchScore)).toBe(true);
    expect(history.requirements).toHaveLength(1);
    expect(history.requirements[0]?.extraction.requiredSkills[0]?.name).toBe(
      'TypeScript',
    );
    expect(history.scores).toHaveLength(1);
    expect(history.attempts[0]).toMatchObject({
      model: 'fictional-offline-model',
      outputBytes: 2_048,
      usage: providerUsage,
    });

    const rescore = await app.inject({
      method: 'POST',
      url: `/api/jobs/${jobId}/rescore`,
    });
    expect(rescore.statusCode).toBe(200);
    expect(rescore.json()).toMatchObject({ status: 'pending', attemptCount: 1 });
    await app.inject({
      method: 'POST',
      url: '/api/scoring/process',
      payload: { limit: 1 },
    });
    history = jobScoringHistorySchema.parse(
      (await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/scoring` })).json(),
    );
    expect(history.scores).toHaveLength(2);
    expect(
      history.scores.filter(({ invalidatedAt }) => invalidatedAt === null),
    ).toHaveLength(1);
    expect(
      database.sqlite.prepare('select count(*) as count from scoring_attempts').get(),
    ).toMatchObject({ count: 2 });

    const fixture = createFictionalProfileInput();
    const profileUpdate = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      payload: {
        ...fixture,
        baseVersion: 1,
        changeSummary: 'Fictional confirmed Profile update for invalidation',
        basics: {
          ...fixture.basics,
          data: { ...fixture.basics.data, headline: 'Fictional scoring revision' },
        },
      },
    });
    expect(profileSnapshotSchema.parse(profileUpdate.json()).version).toBe(2);
    history = jobScoringHistorySchema.parse(
      (await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/scoring` })).json(),
    );
    expect(history.current).toBeNull();
    expect(
      history.tasks.some(
        ({ profileVersion, status }) => profileVersion === 2 && status === 'pending',
      ),
    ).toBe(true);

    const missing = await app.inject({
      method: 'GET',
      url: '/api/jobs/99000000-0000-4000-8000-000000000099/scoring',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects invalid evidence and Gate overrides without writing a formal score', async () => {
    providerMode = 'invalid_evidence';
    await app.inject({ method: 'POST', url: '/api/scoring/backfill', payload: {} });
    const invalidEvidence = scoringProcessResultSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scoring/process',
          payload: { limit: 1 },
        })
      ).json(),
    );
    expect(invalidEvidence.failed).toBe(1);
    expect(
      database.sqlite
        .prepare(
          'select (select count(*) from job_requirements) as requirements, (select count(*) from job_scores) as scores, (select count(*) from scoring_attempts) as attempts',
        )
        .get(),
    ).toEqual({ requirements: 0, scores: 0, attempts: 1 });

    const queue = scoringQueueResponseSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/scoring/queue?status=failed',
        })
      ).json(),
    );
    providerMode = 'success';
    const retry = await app.inject({
      method: 'POST',
      url: `/api/scoring/tasks/${queue.tasks[0]!.id}/retry`,
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ status: 'pending', attemptCount: 1 });
    expect(
      scoringProcessResultSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/scoring/process',
            payload: { limit: 1 },
          })
        ).json(),
      ).succeeded,
    ).toBe(1);

    providerMode = 'gate_override';
    await app.inject({ method: 'POST', url: `/api/jobs/${jobId}/rescore` });
    expect(
      scoringProcessResultSchema.parse(
        (
          await app.inject({
            method: 'POST',
            url: '/api/scoring/process',
            payload: { limit: 1 },
          })
        ).json(),
      ).failed,
    ).toBe(1);
    expect(
      database.sqlite
        .prepare(
          'select (select count(*) from job_requirements) as requirements, (select count(*) from job_scores) as scores, (select count(*) from scoring_attempts where outcome = ?) as invalid_attempts',
        )
        .get('invalid_output'),
    ).toEqual({ requirements: 1, scores: 1, invalid_attempts: 2 });
  });

  it('records a failed closed-job Gate without disguising it as a low score', async () => {
    database.sqlite
      .prepare('update jobs set active = 0, closed_at = ? where id = ?')
      .run(new Date('2026-09-01T09:00:00.000Z').getTime(), jobId);
    const backfill = await app.inject({
      method: 'POST',
      url: '/api/scoring/backfill',
      payload: { includeClosed: true },
    });
    expect(scoringBackfillResultSchema.parse(backfill.json()).queued).toBe(1);
    await app.inject({
      method: 'POST',
      url: '/api/scoring/process',
      payload: { limit: 1 },
    });
    const history = jobScoringHistorySchema.parse(
      (await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/scoring` })).json(),
    );
    expect(history.current).toMatchObject({
      eligible: false,
      matchScore: null,
      rankingScore: null,
    });
    expect(
      history.current?.gateReasons.some(
        ({ code, outcome }) => code === 'job_closed' && outcome === 'fail',
      ),
    ).toBe(true);

    database.sqlite
      .prepare('update jobs set active = 1, closed_at = null where id = ?')
      .run(jobId);
    const reopenedBackfill = scoringBackfillResultSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/scoring/backfill',
          payload: {},
        })
      ).json(),
    );
    expect(reopenedBackfill).toEqual({ queued: 1, invalidated: 1 });
    await app.inject({
      method: 'POST',
      url: '/api/scoring/process',
      payload: { limit: 1 },
    });
    const reopened = jobScoringHistorySchema.parse(
      (await app.inject({ method: 'GET', url: `/api/jobs/${jobId}/scoring` })).json(),
    );
    expect(reopened.current?.eligible).toBe(true);
    expect(reopened.scores).toHaveLength(2);
    expect(
      reopened.scores.filter(({ invalidatedAt }) => invalidatedAt !== null),
    ).toHaveLength(1);
  });
});
