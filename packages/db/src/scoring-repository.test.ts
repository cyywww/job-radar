import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  calculateDeterministicScore,
  evaluateEligibility,
  EXTRACTOR_VERSION,
  SCORING_VERSION,
} from '@job-radar/scoring';
import {
  createProfileRequestSchema,
  jobExtractionSchema,
  normalizedJobSchema,
  type ConfirmedProfileView,
  type JobExtraction,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import type { DatabaseClient } from './database.js';
import { openDatabase, runMigrations } from './database.js';
import { JobRepository } from './job-repository.js';
import { ProfileRepository } from './profile-repository.js';
import { ScoringRepository } from './scoring-repository.js';

let database: DatabaseClient | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'job-radar-scoring-repository-'));
  database = openDatabase(join(directory, 'test.sqlite'));
  runMigrations(database);
  const profiles = new ProfileRepository(database);
  const profile = profiles.create(
    'Fictional profile',
    createProfileRequestSchema.parse(createFictionalProfileInput()),
  );
  const confirmed = profiles.getConfirmedView()!;
  const jobs = new JobRepository(database);
  const source = jobs.ensureDefaultSources();
  const scan = jobs.createScan(profile.version, [source], ['Product Engineer']);
  const ingested = jobs.ingestJob(
    source,
    scan.id,
    normalizedJobSchema.parse({
      externalId: 'fictional-score-1',
      title: 'Fictional Product Engineer',
      company: 'Fictional Score Works AB',
      location: 'Stockholm, Sweden',
      publishedAt: '2026-08-30T08:00:00.000Z',
      deadline: null,
      descriptionText:
        'Build TypeScript services. Lead fictional delivery. English is required. Applicants must be authorized to work in Sweden. Hybrid work in Stockholm. Developer tools experience is required. React experience is preferred.',
      descriptionHtml: null,
      sourceUrl: 'https://jobs.example.test/fictional-score-1',
      canonicalUrl: 'https://jobs.example.test/fictional-score-1',
      remoteMode: 'hybrid',
      employmentType: 'Full-time',
      sourceActive: true,
      sourceMetadata: {},
      rawData: { fixture: 'scoring-repository' },
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
  const scoring = new ScoringRepository(database, {
    maxAttempts: 3,
    retryBaseMs: 1_000,
    retryMaxMs: 4_000,
  });
  return { profiles, confirmed, jobs, source, ingested, scoring };
}

function extraction(skillEvidenceId: string, workEvidenceId: string): JobExtraction {
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
        text: 'Lead delivery',
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
        profileEvidenceId: skillEvidenceId,
        explanation: 'Confirmed TypeScript evidence matches.',
        evidenceDepth: 'demonstrated',
      },
      {
        requirementId: 'domain-tools',
        dimension: 'domain',
        jdSnippet: 'Developer tools experience is required.',
        profileEvidenceId: workEvidenceId,
        explanation: 'Confirmed fictional work is in developer tools.',
        evidenceDepth: 'outcome',
      },
    ],
    gaps: [
      {
        requirementId: 'skill-react',
        dimension: 'skill_depth',
        severity: 'preferred',
        requirement: 'React',
        explanation: 'No confirmed React evidence.',
      },
    ],
    unknowns: [],
    seniorityFit: 'full',
    roleFit: 'full',
    confidence: 0.9,
    extractorVersion: EXTRACTOR_VERSION,
  });
}

const versions = {
  extractorVersion: EXTRACTOR_VERSION,
  scoringVersion: SCORING_VERSION,
};

const tokenAudit = {
  inputTokens: 1_000,
  cachedInputTokens: 100,
  outputTokens: 250,
  reasoningOutputTokens: 50,
  totalTokens: 1_250,
} as const;

function profileInputWithSource(sourceId: string) {
  const fixture = createFictionalProfileInput();
  const withSource = <T extends { sourceId: string }>(fact: T): T => ({
    ...fact,
    sourceId,
  });
  return createProfileRequestSchema.parse({
    ...fixture,
    sources: fixture.sources.map((source) => ({ ...source, id: sourceId })),
    basics: withSource(fixture.basics),
    workExperiences: fixture.workExperiences.map(withSource),
    educationExperiences: fixture.educationExperiences.map(withSource),
    skills: fixture.skills.map(withSource),
    languages: fixture.languages.map(withSource),
    certifications: fixture.certifications.map(withSource),
    projects: fixture.projects.map(withSource),
    preferences: withSource(fixture.preferences),
  });
}

function completeFixtureScore(
  scoring: ScoringRepository,
  confirmed: ConfirmedProfileView,
): void {
  scoring.syncAll(confirmed.version, versions, false);
  const claimed = scoring.claimNext(new Date('2026-09-01T09:00:00.000Z'))!;
  const extracted = extraction(
    confirmed.skills[0]!.evidenceId,
    confirmed.workExperiences[0]!.evidenceId,
  );
  const gate = evaluateEligibility({
    profile: confirmed,
    job: claimed.job,
    extraction: extracted,
  });
  const score = calculateDeterministicScore({
    profile: confirmed,
    job: claimed.job,
    extraction: extracted,
    gate,
    scoringVersion: SCORING_VERSION,
    rankingAsOf: new Date(claimed.job.fetchedAt),
  });
  scoring.complete(claimed.task.id, {
    extraction: extracted,
    gate,
    score,
    jobActive: claimed.job.active,
    provider: 'codex_cli',
    model: 'fictional-model',
    reviewRequired: false,
    unknowns: [],
    explanation: 'Gate passed with two matches and one explicit gap.',
    rankingAsOf: new Date(claimed.job.fetchedAt),
    usage: tokenAudit,
    outputBytes: 2_048,
    now: new Date('2026-09-01T09:01:00.000Z'),
  });
}

describe('ScoringRepository', () => {
  it('enqueues idempotently, claims once, and preserves successful score history', () => {
    const { confirmed, scoring, ingested } = setup();
    expect(scoring.syncAll(confirmed.version, versions, false)).toEqual({
      queued: 1,
      invalidated: 0,
    });
    expect(scoring.syncAll(confirmed.version, versions, false).queued).toBe(0);
    const claimed = scoring.claimNext(new Date('2026-09-01T09:00:00.000Z'))!;
    expect(scoring.claimNext(new Date('2026-09-01T09:00:00.000Z'))).toBeNull();
    const extracted = extraction(
      confirmed.skills[0]!.evidenceId,
      confirmed.workExperiences[0]!.evidenceId,
    );
    const gate = evaluateEligibility({
      profile: confirmed,
      job: claimed.job,
      extraction: extracted,
    });
    const score = calculateDeterministicScore({
      profile: confirmed,
      job: claimed.job,
      extraction: extracted,
      gate,
      scoringVersion: SCORING_VERSION,
      rankingAsOf: new Date(claimed.job.fetchedAt),
    });
    scoring.complete(claimed.task.id, {
      extraction: extracted,
      gate,
      score,
      jobActive: claimed.job.active,
      provider: 'codex_cli',
      model: 'fictional-model',
      reviewRequired: false,
      unknowns: [],
      explanation: 'Gate passed with two matches and one explicit gap.',
      rankingAsOf: new Date(claimed.job.fetchedAt),
      usage: tokenAudit,
      outputBytes: 2_048,
      now: new Date('2026-09-01T09:01:00.000Z'),
    });
    const history = scoring.getJobHistory(ingested.jobId);
    expect(history.current?.matchScore).toBe(score.matchScore);
    expect(history.scores).toHaveLength(1);
    expect(history.tasks[0]?.status).toBe('succeeded');
    expect(history.attempts[0]).toMatchObject({
      usage: tokenAudit,
      outputBytes: 2_048,
    });
  });

  it('preserves another profile score while queueing and deleting the selected profile', () => {
    const { profiles, confirmed, scoring, ingested } = setup();
    completeFixtureScore(scoring, confirmed);
    const second = profiles.create(
      'Backend roles',
      profileInputWithSource('10000000-0000-4000-8000-000000000031'),
    );

    expect(
      scoring.syncAll(
        second.version,
        versions,
        false,
        new Date('2026-09-01T10:00:00.000Z'),
        false,
        second.id,
      ),
    ).toEqual({ queued: 1, invalidated: 0 });
    expect(
      scoring.getJobHistory(ingested.jobId, confirmed.profileId).current,
    ).not.toBeNull();
    expect(scoring.getJobHistory(ingested.jobId, second.id)).toMatchObject({
      current: null,
      tasks: [{ profileVersion: second.version, status: 'pending' }],
    });

    profiles.delete(second.id);
    expect(
      scoring.getJobHistory(ingested.jobId, confirmed.profileId).current,
    ).not.toBeNull();
    expect(scoring.getJobHistory(ingested.jobId, second.id)).toEqual({
      current: null,
      requirements: [],
      scores: [],
      tasks: [],
      attempts: [],
    });
  });

  it('keeps rescore double-clicks idempotent and never resets a running claim', () => {
    const { confirmed, scoring, ingested } = setup();
    completeFixtureScore(scoring, confirmed);

    const first = scoring.forceRescoreJob(ingested.jobId, confirmed.version, versions);
    const duplicate = scoring.forceRescoreJob(
      ingested.jobId,
      confirmed.version,
      versions,
    );
    expect(duplicate).toMatchObject({
      id: first.id,
      status: 'pending',
      attemptCount: 1,
      maxAttempts: 4,
    });

    const claimed = scoring.claimNext(new Date())!;
    expect(
      scoring.forceRescoreJob(ingested.jobId, confirmed.version, versions),
    ).toMatchObject({
      id: claimed.task.id,
      status: 'running',
      attemptCount: 2,
      maxAttempts: 4,
    });
    expect(scoring.claimNext(new Date())).toBeNull();
  });

  it('applies finite exponential retries and manual failed-task recovery', () => {
    const { confirmed, scoring } = setup();
    scoring.syncAll(confirmed.version, versions, false);
    let now = new Date('2026-09-01T10:00:00.000Z');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = scoring.claimNext(now)!;
      const failed = scoring.fail(claimed.task.id, {
        code: 'fixture_failure',
        summary: 'Fictional bounded provider failure.',
        outcome: 'failed',
        provider: 'codex_cli',
        model: 'fictional-model',
        outputHash: null,
        outputBytes: 0,
        usage: null,
        retryable: true,
        now,
      });
      expect(failed.status).toBe(attempt === 3 ? 'failed' : 'pending');
      if (attempt < 3) {
        expect(scoring.claimNext(now)).toBeNull();
        now = new Date(now.getTime() + 2 ** (attempt - 1) * 1_000);
      }
    }
    const failedTask = scoring.listTasks('failed', 10)[0]!;
    expect(scoring.retryFailed(25, new Date(now.getTime() + 1))).toEqual([
      expect.objectContaining({ id: failedTask.id, status: 'pending' }),
    ]);
    expect(scoring.retryFailed(25, new Date(now.getTime() + 2))).toEqual([]);
    expect(scoring.claimNext(new Date(now.getTime() + 1))?.task.attemptCount).toBe(4);
    const attempts = database!.sqlite
      .prepare('select count(*) as count from scoring_attempts')
      .get() as { count: number };
    expect(attempts.count).toBe(3);
  });

  it('queues a bounded batch transaction only when every job exists', () => {
    const { confirmed, scoring, jobs, source, ingested } = setup();
    const nextScan = jobs.createScan(confirmed.version, [source], ['Platform Engineer']);
    const second = jobs.ingestJob(
      source,
      nextScan.id,
      normalizedJobSchema.parse({
        externalId: 'fictional-score-2',
        title: 'Fictional Platform Engineer',
        company: 'Fictional Score Works AB',
        location: 'Stockholm, Sweden',
        publishedAt: '2026-08-31T08:00:00.000Z',
        deadline: null,
        descriptionText: 'Build fictional SQLite and TypeScript systems.',
        descriptionHtml: null,
        sourceUrl: 'https://jobs.example.test/fictional-score-2',
        canonicalUrl: 'https://jobs.example.test/fictional-score-2',
        remoteMode: 'hybrid',
        employmentType: 'Full-time',
        sourceActive: true,
        sourceMetadata: {},
        rawData: { fixture: 'scoring-repository-two' },
      }),
      new Date('2026-09-01T12:00:00.000Z'),
    );

    const tasks = scoring.forceRescoreJobs(
      [ingested.jobId, second.jobId],
      confirmed.version,
      versions,
    );
    expect(tasks.map(({ status }) => status)).toEqual(['pending', 'pending']);
    expect(() =>
      scoring.forceRescoreJobs(
        [ingested.jobId, '99000000-0000-4000-8000-000000000001'],
        confirmed.version,
        versions,
      ),
    ).toThrow();
    expect(scoring.listTasks('pending', 10)).toHaveLength(2);
  });

  it('recovers an interrupted running attempt without duplicating its audit record', () => {
    const { confirmed, scoring } = setup();
    scoring.syncAll(confirmed.version, versions, false);
    const claimed = scoring.claimNext(new Date('2026-09-01T10:30:00.000Z'))!;

    expect(scoring.recoverRunning(new Date('2026-09-01T10:31:00.000Z'))).toBe(1);
    expect(scoring.recoverRunning(new Date('2026-09-01T10:31:01.000Z'))).toBe(0);
    expect(scoring.listTasks('pending', 10)[0]).toMatchObject({
      id: claimed.task.id,
      attemptCount: 1,
      lastErrorCode: 'interrupted',
    });
    expect(
      database!.sqlite
        .prepare(
          'select count(*) as count from scoring_attempts where task_id = ? and outcome = ?',
        )
        .get(claimed.task.id, 'failed'),
    ).toEqual({ count: 1 });
  });

  it('invalidates old scores for snapshot, Profile, and lifecycle changes without deletion', () => {
    const { confirmed, scoring, jobs, source, ingested } = setup();
    scoring.syncAll(confirmed.version, versions, false);
    const firstTask = scoring.claimNext(new Date('2026-09-01T11:00:00.000Z'))!;
    scoring.fail(firstTask.task.id, {
      code: 'fixture_failure',
      summary: 'Fictional failure retained for audit.',
      outcome: 'invalid_output',
      provider: 'codex_cli',
      model: 'fictional-model',
      outputHash: 'a'.repeat(64),
      outputBytes: 24,
      usage: tokenAudit,
      retryable: true,
      now: new Date('2026-09-01T11:00:01.000Z'),
    });

    expect(scoring.syncAll(confirmed.version + 1, versions, true).queued).toBe(1);
    expect(
      scoring.listTasks(undefined, 20).some(({ profileVersion }) => profileVersion === 1),
    ).toBe(true);

    const nextScan = jobs.createScan(
      confirmed.version + 1,
      [source],
      ['Product Engineer'],
    );
    const changed = jobs.ingestJob(
      source,
      nextScan.id,
      normalizedJobSchema.parse({
        externalId: 'fictional-score-1',
        title: 'Fictional Product Engineer',
        company: 'Fictional Score Works AB',
        location: 'Stockholm, Sweden',
        publishedAt: '2026-08-30T08:00:00.000Z',
        deadline: null,
        descriptionText:
          'Build TypeScript services. Lead fictional delivery. English is required. Applicants must be authorized to work in Sweden. Hybrid work in Stockholm. Developer tools experience is required. React experience is preferred. Material fictional revision.',
        descriptionHtml: null,
        sourceUrl: 'https://jobs.example.test/fictional-score-1',
        canonicalUrl: 'https://jobs.example.test/fictional-score-1',
        remoteMode: 'hybrid',
        employmentType: 'Full-time',
        sourceActive: false,
        sourceMetadata: {},
        rawData: { fixture: 'changed-and-closed' },
      }),
      new Date('2026-09-02T08:00:00.000Z'),
    );
    expect(changed.snapshotId).not.toBe(ingested.snapshotId);
    const synced = scoring.syncJob(changed.jobId, confirmed.version + 1, versions);
    expect(synced.queued).toBe(1);
    expect(scoring.listTasks(undefined, 20).length).toBeGreaterThanOrEqual(3);
    expect(
      database!.sqlite.prepare('select count(*) as count from scoring_attempts').get(),
    ).toMatchObject({ count: 1 });
  });

  it.each([
    {
      label: 'extractor version',
      changedVersions: {
        extractorVersion: 'codex-job-extractor-v2-fixture',
        scoringVersion: SCORING_VERSION,
      },
    },
    {
      label: 'scoring version',
      changedVersions: {
        extractorVersion: EXTRACTOR_VERSION,
        scoringVersion: 'deterministic-weighted-v2-fixture',
      },
    },
  ])('invalidates a formal score when the $label changes', ({ changedVersions }) => {
    const { confirmed, scoring, ingested } = setup();
    completeFixtureScore(scoring, confirmed);

    expect(scoring.syncAll(confirmed.version, changedVersions, true)).toEqual({
      queued: 1,
      invalidated: 1,
    });
    const history = scoring.getJobHistory(ingested.jobId);
    expect(history.current).toBeNull();
    expect(history.scores).toHaveLength(1);
    expect(history.scores[0]?.invalidatedAt).not.toBeNull();
    expect(
      history.tasks.some(
        (task) =>
          task.extractorVersion === changedVersions.extractorVersion &&
          task.scoringVersion === changedVersions.scoringVersion &&
          task.status === 'pending',
      ),
    ).toBe(true);
  });
});
