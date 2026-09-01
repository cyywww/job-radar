import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  AppError,
  jobScoringHistorySchema,
  scoringBackfillRequestSchema,
  scoringBackfillResultSchema,
  scoringConfigurationSchema,
  scoringProcessRequestSchema,
  scoringProcessResultSchema,
  scoringQueueQuerySchema,
  scoringQueueResponseSchema,
  scoringTaskSchema,
} from '@job-radar/shared';

import {
  ScoringCoordinator,
  ScoringCoordinatorError,
} from '../services/scoring-coordinator.js';

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

function mapScoringError(error: unknown): never {
  if (!(error instanceof ScoringCoordinatorError)) throw error;
  const statusCode =
    error.code === 'SCORING_JOB_NOT_FOUND' || error.code === 'SCORING_TASK_NOT_FOUND'
      ? 404
      : error.code === 'SCORING_RUN_ACTIVE' ||
          error.code === 'SCORING_TASK_NOT_RETRYABLE' ||
          error.code === 'SCORING_MODEL_NOT_CONFIGURED'
        ? 409
        : 400;
  throw new AppError(error.code, error.message, statusCode);
}

export async function registerScoringRoutes(
  app: FastifyInstance,
  coordinator: ScoringCoordinator,
): Promise<void> {
  app.get('/api/scoring/config', async () =>
    scoringConfigurationSchema.parse(coordinator.configuration()),
  );

  app.get('/api/scoring/queue', async (request) => {
    const query = scoringQueueQuerySchema.parse(request.query);
    return scoringQueueResponseSchema.parse({
      tasks: coordinator.list(query.status, query.limit),
    });
  });

  app.post('/api/scoring/backfill', async (request) => {
    try {
      const input = scoringBackfillRequestSchema.parse(request.body ?? {});
      return scoringBackfillResultSchema.parse(coordinator.backfill(input.includeClosed));
    } catch (error) {
      return mapScoringError(error);
    }
  });

  app.post('/api/scoring/process', async (request) => {
    try {
      const input = scoringProcessRequestSchema.parse(request.body ?? {});
      return scoringProcessResultSchema.parse(await coordinator.process(input.limit));
    } catch (error) {
      return mapScoringError(error);
    }
  });

  app.post('/api/scoring/tasks/:id/retry', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      return scoringTaskSchema.parse(coordinator.retry(id));
    } catch (error) {
      return mapScoringError(error);
    }
  });

  app.post('/api/jobs/:id/rescore', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      return scoringTaskSchema.parse(coordinator.rescoreJob(id));
    } catch (error) {
      return mapScoringError(error);
    }
  });

  app.get('/api/jobs/:id/scoring', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      return jobScoringHistorySchema.parse(coordinator.getJobHistory(id));
    } catch (error) {
      return mapScoringError(error);
    }
  });
}
