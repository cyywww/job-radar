import { describe, expect, it } from 'vitest';

import {
  STRONG_MATCH_THRESHOLD,
  bulkTriageRequestSchema,
  createFeedbackRequestSchema,
  jobScoreSummarySchema,
  reviewJobsQuerySchema,
  restoreTriageRequestSchema,
  savedJobFiltersSchema,
  scanEventSchema,
  updateScoreReviewRequestSchema,
} from './review.js';

describe('M4 review contracts', () => {
  it('uses one explicit strong-match display threshold', () => {
    expect(STRONG_MATCH_THRESHOLD).toBe(80);
  });

  it('bounds and normalizes job review queries', () => {
    expect(
      reviewJobsQuerySchema.parse({
        search: '  TypeScript  ',
        sort: 'matchScore',
        direction: 'asc',
        includeClosed: 'true',
        limit: '25',
      }),
    ).toMatchObject({
      search: 'TypeScript',
      sort: 'matchScore',
      direction: 'asc',
      includeClosed: true,
      limit: 25,
    });
    expect(() => reviewJobsQuerySchema.parse({ sort: 'drop table jobs' })).toThrow();
    expect(() => reviewJobsQuerySchema.parse({ search: 'x'.repeat(201) })).toThrow();
  });

  it('rejects duplicate or oversized bulk triage requests', () => {
    const id = '81000000-0000-4000-8000-000000000001';
    expect(() =>
      bulkTriageRequestSchema.parse({ jobIds: [id, id], status: 'ignored' }),
    ).toThrow();
    expect(() =>
      bulkTriageRequestSchema.parse({
        jobIds: Array.from(
          { length: 101 },
          (_, index) => `81000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
        ),
        status: 'ignored',
      }),
    ).toThrow();
  });

  it('requires explanations for corrections and review decisions', () => {
    expect(() =>
      createFeedbackRequestSchema.parse({ type: 'job_specific', reason: '' }),
    ).toThrow();
    expect(() =>
      updateScoreReviewRequestSchema.parse({ state: 'rejected', reason: '' }),
    ).toThrow();
  });

  it('never permits a Gate failure to look like a zero score', () => {
    const base = {
      state: 'gate_failed' as const,
      taskId: null,
      taskStatus: null,
      matchScore: null,
      rankingScore: null,
      eligible: false,
      confidence: 0.9,
      unknownCount: 0,
      reviewState: 'not_required' as const,
      scoringVersion: 'deterministic-weighted-v1',
      lastErrorCode: null,
      lastErrorSummary: null,
    };
    expect(jobScoreSummarySchema.parse(base).matchScore).toBeNull();
    expect(() => jobScoreSummarySchema.parse({ ...base, matchScore: 0 })).toThrow();
  });

  it('versions browser-saved filters', () => {
    const saved = savedJobFiltersSchema.parse({
      version: 1,
      view: 'cards',
      filters: {
        search: '',
        includeClosed: false,
        sort: 'rankingScore',
        direction: 'desc',
      },
    });
    expect(saved.filters.includeClosed).toBe(false);
    expect(() => savedJobFiltersSchema.parse({ ...saved, version: 2 })).toThrow();
  });

  it('preserves sparse triage undo and requires durable SSE stage state', () => {
    const jobId = '81000000-0000-4000-8000-000000000001';
    expect(
      restoreTriageRequestSchema.parse({
        records: [{ jobId, status: 'new', note: null, updatedAt: null }],
      }).records[0]?.updatedAt,
    ).toBeNull();
    expect(() =>
      restoreTriageRequestSchema.parse({
        records: [{ jobId, status: 'archived', note: null, updatedAt: null }],
      }),
    ).toThrow();

    const scan = {
      id: '82000000-0000-4000-8000-000000000001',
      status: 'running' as const,
      stage: 'discovery' as const,
      profileVersion: 1,
      counts: {
        discovered: 3,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        closed: 0,
        failed: 0,
      },
      errorSummary: null,
      cancelRequestedAt: null,
      startedAt: '2026-09-01T08:00:00.000Z',
      finishedAt: null,
      createdAt: '2026-09-01T08:00:00.000Z',
      sourceRuns: [],
    };
    expect(
      scanEventSchema.parse({
        scan,
        phase: 'discovery',
        terminal: false,
        emittedAt: '2026-09-01T08:00:01.000Z',
      }).scan.counts.discovered,
    ).toBe(3);
    expect(() =>
      scanEventSchema.parse({
        scan: { ...scan, stage: undefined },
        phase: 'discovery',
        terminal: false,
        emittedAt: '2026-09-01T08:00:01.000Z',
      }),
    ).toThrow();
  });
});
