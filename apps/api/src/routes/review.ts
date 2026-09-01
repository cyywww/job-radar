import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  JobRepository,
  ProfileRepository,
  ReviewRepository,
  ReviewRepositoryError,
  type DatabaseClient,
} from '@job-radar/db';
import {
  STRONG_MATCH_THRESHOLD,
  bulkRescoreRequestSchema,
  bulkRescoreResponseSchema,
  bulkTriageRequestSchema,
  bulkTriageResponseSchema,
  createFeedbackRequestSchema,
  dashboardResponseSchema,
  jobReviewDetailSchema,
  refreshJobResponseSchema,
  retryFailedScoringRequestSchema,
  retryFailedScoringResponseSchema,
  reviewJobsQuerySchema,
  reviewJobsResponseSchema,
  restoreTriageRequestSchema,
  restoreTriageResponseSchema,
  scanEventSchema,
  scoreFeedbackSchema,
  scoreReviewEventSchema,
  updateScoreReviewRequestSchema,
  updateTriageRequestSchema,
  updateTriageResponseSchema,
  AppError,
  type ScanRun,
} from '@job-radar/shared';

import { ScanCoordinator, ScanCoordinatorError } from '../services/scan-coordinator.js';
import {
  ScoringCoordinator,
  ScoringCoordinatorError,
} from '../services/scoring-coordinator.js';

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();
const terminalScanStatuses = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
let activeSseConnections = 0;

export function getActiveScanEventConnections(): number {
  return activeSseConnections;
}

function mapReviewError(error: unknown): never {
  if (error instanceof ReviewRepositoryError) {
    throw new AppError(error.code, error.message, 404);
  }
  if (error instanceof ScanCoordinatorError) {
    const statusCode =
      error.code === 'SCAN_JOB_NOT_FOUND' || error.code === 'SCAN_NOT_FOUND'
        ? 404
        : error.code === 'SCAN_ALREADY_RUNNING'
          ? 409
          : 400;
    throw new AppError(error.code, error.message, statusCode);
  }
  if (error instanceof ScoringCoordinatorError) {
    const statusCode =
      error.code === 'SCORING_JOB_NOT_FOUND' || error.code === 'SCORING_TASK_NOT_FOUND'
        ? 404
        : error.code === 'SCORING_RUN_ACTIVE' ||
            error.code === 'SCORING_MODEL_NOT_CONFIGURED'
          ? 409
          : 400;
    throw new AppError(error.code, error.message, statusCode);
  }
  throw error;
}

function scanPhase(run: ScanRun) {
  if (run.stage) return run.stage;
  return terminalScanStatuses.has(run.status)
    ? ('complete' as const)
    : ('queued' as const);
}

export async function registerReviewRoutes(
  app: FastifyInstance,
  database: DatabaseClient,
  scans: ScanCoordinator,
  scoring: ScoringCoordinator,
): Promise<void> {
  const jobs = new JobRepository(database);
  const profiles = new ProfileRepository(database);
  const review = new ReviewRepository(database);

  app.get('/api/dashboard', async () => {
    const now = new Date();
    const counts = review.dashboardCounts(now);
    const profile = profiles.getConfirmedView();
    const topCandidates = review.listJobs(
      reviewJobsQuerySchema.parse({
        sort: 'rankingScore',
        direction: 'desc',
        includeClosed: 'false',
        limit: 50,
      }),
    ).jobs;
    return dashboardResponseSchema.parse({
      generatedAt: now.toISOString(),
      todayBoundary: counts.todayBoundary.toISOString(),
      profileReady: Boolean(
        profile?.preferences?.data.targetRoles.some((role) => role.trim().length > 0),
      ),
      strongMatchThreshold: STRONG_MATCH_THRESHOLD,
      counts: {
        newToday: counts.newToday,
        strongMatches: counts.strongMatches,
        pendingScoring: counts.pendingScoring,
        pendingReview: counts.pendingReview,
        closed: counts.closed,
      },
      sources: jobs.listSources().map((source) => ({
        id: source.id,
        name: source.name,
        enabled: source.enabled,
        healthStatus: source.healthStatus,
        lastSuccessAt: source.lastSuccessAt,
        lastError: source.lastError,
      })),
      latestScan: jobs.listScans(1)[0] ?? null,
      topJobs: topCandidates
        .filter(
          (job) =>
            job.score.eligible === true &&
            job.score.rankingScore !== null &&
            job.triage.status !== 'ignored' &&
            job.triage.status !== 'archived',
        )
        .slice(0, 10),
    });
  });

  app.get('/api/review/jobs', async (request) => {
    const query = reviewJobsQuerySchema.parse(request.query);
    return reviewJobsResponseSchema.parse(review.listJobs(query));
  });

  app.get('/api/review/jobs/:id', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const job = jobs.getJob(id);
      if (!job) throw new ReviewRepositoryError('JOB_NOT_FOUND', 'Job does not exist.');
      const history = scoring.getJobHistory(id);
      return jobReviewDetailSchema.parse({
        job,
        triage: review.getTriage(id),
        currentScore: history.current,
        currentRequirement: history.current
          ? (history.requirements.find(
              (requirement) => requirement.id === history.current?.requirementId,
            ) ?? null)
          : null,
        scoreHistory: history.scores,
        tasks: history.tasks,
        attempts: history.attempts,
        feedback: review.listFeedback(id),
        reviewHistory: review.listReviewEvents(id),
      });
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.patch('/api/jobs/:id/triage', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const input = updateTriageRequestSchema.parse(request.body);
      return updateTriageResponseSchema.parse(
        review.updateTriage(id, input.status, input.note),
      );
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.post('/api/jobs/bulk-triage', async (request) => {
    try {
      const input = bulkTriageRequestSchema.parse(request.body);
      return bulkTriageResponseSchema.parse(
        review.bulkUpdateTriage(input.jobIds, input.status),
      );
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.post('/api/jobs/bulk-triage/restore', async (request) => {
    try {
      const input = restoreTriageRequestSchema.parse(request.body);
      return restoreTriageResponseSchema.parse({
        current: review.restoreTriage(input.records),
      });
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.post('/api/jobs/:id/feedback', async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const input = createFeedbackRequestSchema.parse(request.body);
      return reply
        .status(201)
        .send(scoreFeedbackSchema.parse(review.createFeedback(id, input)));
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.patch('/api/jobs/:id/review', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      const input = updateScoreReviewRequestSchema.parse(request.body);
      return scoreReviewEventSchema.parse(
        review.updateReviewState(id, input.state, input.reason),
      );
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.post('/api/jobs/:id/refresh', async (request, reply) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      return reply
        .status(202)
        .send(refreshJobResponseSchema.parse(scans.startJobRefresh(id)));
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.post('/api/jobs/bulk-rescore', async (request) => {
    try {
      const input = bulkRescoreRequestSchema.parse(request.body);
      return bulkRescoreResponseSchema.parse({
        tasks: scoring.rescoreJobs(input.jobIds),
      });
    } catch (error) {
      return mapReviewError(error);
    }
  });

  app.post('/api/scoring/retry-failed', async (request) => {
    const input = retryFailedScoringRequestSchema.parse(request.body ?? {});
    return retryFailedScoringResponseSchema.parse({
      tasks: scoring.retryFailed(input.limit),
    });
  });

  app.get('/api/scans/:id/events', async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    let current: ScanRun;
    try {
      current = scans.get(id);
    } catch (error) {
      return mapReviewError(error);
    }

    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader('content-type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('cache-control', 'no-cache, no-transform');
    reply.raw.setHeader('connection', 'keep-alive');
    activeSseConnections += 1;
    let closed = false;
    const interval: { timer?: NodeJS.Timeout } = {};
    let prior = '';

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (interval.timer) clearInterval(interval.timer);
      activeSseConnections -= 1;
    };
    const send = (run: ScanRun) => {
      const event = scanEventSchema.parse({
        scan: run,
        phase: scanPhase(run),
        terminal: terminalScanStatuses.has(run.status),
        emittedAt: new Date().toISOString(),
      });
      const state = JSON.stringify({ scan: event.scan, phase: event.phase });
      if (state !== prior) {
        prior = state;
        reply.raw.write(`event: scan\ndata: ${JSON.stringify(event)}\n\n`);
      }
      if (event.terminal) {
        cleanup();
        reply.raw.end();
      }
    };

    request.raw.once('close', cleanup);
    reply.raw.once('close', cleanup);
    send(current);
    if (closed) return;
    interval.timer = setInterval(() => {
      if (closed) return;
      try {
        current = scans.get(id);
        send(current);
      } catch {
        cleanup();
        reply.raw.end();
      }
    }, 250);
    interval.timer.unref();
  });
}
