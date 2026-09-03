import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createProfileRequestSchema,
  normalizedJobSchema,
  reviewJobsQuerySchema,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import type { DatabaseClient } from './database.js';
import { openDatabase, runMigrations } from './database.js';
import { JobRepository } from './job-repository.js';
import { ProfileRepository } from './profile-repository.js';
import { ReviewRepository, ReviewRepositoryError } from './review-repository.js';

let database: DatabaseClient | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'job-radar-review-repository-'));
  database = openDatabase(join(directory, 'test.sqlite'));
  runMigrations(database);
  const profiles = new ProfileRepository(database);
  profiles.create(
    'Fictional profile',
    createProfileRequestSchema.parse(createFictionalProfileInput()),
  );
  const jobs = new JobRepository(database);
  const source = jobs.ensureDefaultSources(new Date('2026-09-01T07:00:00.000Z'));
  const scan = jobs.createScan(1, [source], ['Fictional Engineer']);
  const create = (externalId: string, title: string) =>
    jobs.ingestJob(
      source,
      scan.id,
      normalizedJobSchema.parse({
        externalId,
        title,
        company: 'Fictional Review Works AB',
        location: 'Stockholm, Sweden',
        publishedAt: '2026-09-01T06:00:00.000Z',
        deadline: null,
        descriptionText: 'Build TypeScript systems for a completely fictional team.',
        descriptionHtml: null,
        sourceUrl: `https://jobs.example.test/${externalId}`,
        canonicalUrl: `https://jobs.example.test/${externalId}`,
        remoteMode: 'hybrid',
        employmentType: 'Full-time',
        sourceActive: true,
        sourceMetadata: {},
        rawData: { fixture: externalId },
      }),
      new Date('2026-09-01T08:00:00.000Z'),
    );
  const first = create('review-one', 'Fictional Product Engineer');
  const second = create('review-two', 'Fictional Platform Engineer');
  return { jobs, profiles, review: new ReviewRepository(database), first, second };
}

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

function insertFormalScore(
  jobId: string,
  snapshotId: string,
  matchScore = 84,
  rankingScore = 87,
): string {
  const taskId = randomUUID();
  const requirementId = randomUUID();
  const scoreId = randomUUID();
  const now = Date.parse('2026-09-01T09:00:00.000Z');
  database!.sqlite
    .prepare(
      `insert into scoring_tasks (
        id, job_id, snapshot_id, profile_version, extractor_version, scoring_version,
        status, attempt_count, max_attempts, created_at, updated_at
      ) values (?, ?, ?, 1, 'strict-v1', 'deterministic-weighted-v1',
        'review', 1, 3, ?, ?)`,
    )
    .run(taskId, jobId, snapshotId, now, now);
  database!.sqlite
    .prepare(
      `insert into job_requirements (
        id, task_id, job_id, snapshot_id, profile_version, extractor_version,
        extraction_json, confidence_micros, provider, model, created_at
      ) values (?, ?, ?, ?, 1, 'strict-v1', ?, 600000, 'codex_cli',
        'fictional-model', ?)`,
    )
    .run(
      requirementId,
      taskId,
      jobId,
      snapshotId,
      JSON.stringify({
        requiredSkills: [{ name: 'TypeScript' }],
        preferredSkills: [{ name: 'SQLite' }],
      }),
      now,
    );
  database!.sqlite
    .prepare(
      `insert into job_scores (
        id, task_id, requirement_id, job_id, snapshot_id, profile_version,
        scoring_version, eligible, job_active, gate_reasons_json, match_score,
        ranking_score, ranking_factors_json, breakdown_json, matched_evidence_json,
        gaps_json, unknowns_json, confidence_micros, provider, model, review_state,
        explanation, ranking_as_of, created_at, updated_at
      ) values (?, ?, ?, ?, ?, 1, 'deterministic-weighted-v1', 1, 1, '[]', ?,
        ?, '{}', '{}', '[]', '[]', '[]', 600000, 'codex_cli', 'fictional-model',
        'pending', 'Fictional formal score.', ?, ?, ?)`,
    )
    .run(
      scoreId,
      taskId,
      requirementId,
      jobId,
      snapshotId,
      matchScore,
      rankingScore,
      now,
      now,
      now,
    );
  return scoreId;
}

describe('ReviewRepository', () => {
  it('treats missing triage as new and keeps repeated updates idempotent', () => {
    const { review, first } = setup();
    expect(review.getTriage(first.jobId)).toMatchObject({
      status: 'new',
      updatedAt: null,
    });

    const changed = review.updateTriage(
      first.jobId,
      'shortlisted',
      null,
      new Date('2026-09-01T10:00:00.000Z'),
    );
    expect(changed.previous.status).toBe('new');
    expect(changed.current.status).toBe('shortlisted');
    review.updateTriage(
      first.jobId,
      'shortlisted',
      null,
      new Date('2026-09-01T10:01:00.000Z'),
    );
    expect(review.getTriage(first.jobId).updatedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(
      (
        database!.sqlite.prepare('select count(*) as count from job_triage').get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
  });

  it('updates bulk triage atomically and supports deterministic undo', () => {
    const { review, first, second } = setup();
    const result = review.bulkUpdateTriage(
      [first.jobId, second.jobId],
      'ignored',
      new Date('2026-09-01T10:00:00.000Z'),
    );
    expect(result.current.map(({ status }) => status)).toEqual(['ignored', 'ignored']);
    review.restoreTriage(result.previous);
    expect(review.getTriage(first.jobId)).toMatchObject({
      status: 'new',
      updatedAt: null,
    });
    expect(
      (
        database!.sqlite.prepare('select count(*) as count from job_triage').get() as {
          count: number;
        }
      ).count,
    ).toBe(0);

    expect(() =>
      review.bulkUpdateTriage(
        [first.jobId, '94000000-0000-4000-8000-000000000001'],
        'archived',
      ),
    ).toThrow(ReviewRepositoryError);
    expect(review.getTriage(first.jobId).status).toBe('new');
  });

  it('lists and searches score-aware jobs without turning Gate/task states into zero', () => {
    const { review, first } = setup();
    insertFormalScore(first.jobId, first.snapshotId);
    const result = review.listJobs(
      reviewJobsQuerySchema.parse({ search: 'TypeScript', includeClosed: 'false' }),
    );
    expect(result.total).toBe(1);
    expect(result.jobs[0]).toMatchObject({
      id: first.jobId,
      extractedSkills: ['SQLite', 'TypeScript'],
      score: {
        state: 'review',
        matchScore: 84,
        rankingScore: 87,
        reviewState: 'pending',
      },
    });
  });

  it('shows only the selected profile score in opportunity views', () => {
    const { profiles, review, first } = setup();
    insertFormalScore(first.jobId, first.snapshotId);
    const primary = profiles.getCurrent()!;
    profiles.create(
      'Backend roles',
      profileInputWithSource('10000000-0000-4000-8000-000000000041'),
    );

    expect(
      review
        .listJobs(reviewJobsQuerySchema.parse({}))
        .jobs.find(({ id }) => id === first.jobId)?.score.state,
    ).toBe('unscored');
    profiles.select(primary.id);
    expect(
      review
        .listJobs(reviewJobsQuerySchema.parse({}))
        .jobs.find(({ id }) => id === first.jobId)?.score.state,
    ).toBe('review');
  });

  it('sorts formal match and ranking scores independently through fixed columns', () => {
    const { review, first, second } = setup();
    insertFormalScore(first.jobId, first.snapshotId, 84, 95);
    insertFormalScore(second.jobId, second.snapshotId, 90, 80);

    const byMatch = review.listJobs(
      reviewJobsQuerySchema.parse({ sort: 'matchScore', direction: 'desc' }),
    );
    const byRanking = review.listJobs(
      reviewJobsQuerySchema.parse({ sort: 'rankingScore', direction: 'desc' }),
    );
    expect(byMatch.jobs.map(({ id }) => id)).toEqual([second.jobId, first.jobId]);
    expect(byRanking.jobs.map(({ id }) => id)).toEqual([first.jobId, second.jobId]);
  });

  it('keeps correction feedback append-only and isolated from the formal score', () => {
    const { review, first } = setup();
    const scoreId = insertFormalScore(first.jobId, first.snapshotId);
    const one = review.createFeedback(first.jobId, {
      type: 'job_specific',
      suggestedScore: 70,
      reason: 'The fictional role direction is less aligned than the evidence suggests.',
    });
    const two = review.createFeedback(first.jobId, {
      type: 'profile_correction',
      reason: 'Review a fictional evidence date separately.',
    });
    expect(review.listFeedback(first.jobId)).toHaveLength(2);
    expect(one).toMatchObject({ scoreId, originalScore: 84, suggestedScore: 70 });
    expect(two.suggestedScore).toBeNull();
    expect(
      database!.sqlite
        .prepare('select match_score from job_scores where id = ?')
        .get(scoreId),
    ).toEqual({ match_score: 84 });
  });

  it('records review history while leaving every formal score field unchanged', () => {
    const { review, first } = setup();
    const scoreId = insertFormalScore(first.jobId, first.snapshotId);
    const before = database!.sqlite
      .prepare('select * from job_scores where id = ?')
      .get(scoreId) as Record<string, unknown>;
    const event = review.updateReviewState(
      first.jobId,
      'rejected',
      'The fictional extraction needs a human correction.',
    );
    const after = database!.sqlite
      .prepare('select * from job_scores where id = ?')
      .get(scoreId) as Record<string, unknown>;
    expect(event).toMatchObject({ previousState: 'pending', state: 'rejected' });
    expect(review.listReviewEvents(first.jobId)).toHaveLength(1);
    for (const key of [
      'match_score',
      'ranking_score',
      'breakdown_json',
      'gate_reasons_json',
      'scoring_version',
      'snapshot_id',
    ]) {
      expect(after[key]).toEqual(before[key]);
    }
    review.updateReviewState(
      first.jobId,
      'rejected',
      'The fictional extraction needs a human correction.',
    );
    expect(review.listReviewEvents(first.jobId)).toHaveLength(1);
  });
});
