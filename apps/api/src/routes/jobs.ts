import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { JobRepository, type DatabaseClient } from '@job-radar/db';
import {
  AppError,
  createScanRequestSchema,
  jobDetailSchema,
  jobsQuerySchema,
  jobsResponseSchema,
  scanRunSchema,
  scansQuerySchema,
  scansResponseSchema,
  sourcesResponseSchema,
} from '@job-radar/shared';

import { ScanCoordinator, ScanCoordinatorError } from '../services/scan-coordinator.js';

const idParamsSchema = z.object({ id: z.string().uuid() }).strict();

function mapCoordinatorError(error: unknown): never {
  if (!(error instanceof ScanCoordinatorError)) throw error;
  const statusCode =
    error.code === 'SCAN_NOT_FOUND'
      ? 404
      : error.code === 'SCAN_ALREADY_RUNNING' || error.code === 'SCAN_NOT_CANCELLABLE'
        ? 409
        : 400;
  throw new AppError(error.code, error.message, statusCode);
}

export async function registerJobRoutes(
  app: FastifyInstance,
  database: DatabaseClient,
  coordinator: ScanCoordinator,
): Promise<void> {
  const repository = new JobRepository(database);

  app.get('/api/sources', async () =>
    sourcesResponseSchema.parse({ sources: coordinator.listSources() }),
  );

  app.post('/api/scans', async (request, reply) => {
    try {
      const run = coordinator.start(createScanRequestSchema.parse(request.body ?? {}));
      return reply.status(202).send(scanRunSchema.parse(run));
    } catch (error) {
      return mapCoordinatorError(error);
    }
  });

  app.get('/api/scans', async (request) => {
    const query = scansQuerySchema.parse(request.query);
    return scansResponseSchema.parse({ scans: coordinator.list(query.limit) });
  });

  app.get('/api/scans/:id', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      return scanRunSchema.parse(coordinator.get(id));
    } catch (error) {
      return mapCoordinatorError(error);
    }
  });

  app.post('/api/scans/:id/cancel', async (request) => {
    try {
      const { id } = idParamsSchema.parse(request.params);
      return scanRunSchema.parse(coordinator.cancel(id));
    } catch (error) {
      return mapCoordinatorError(error);
    }
  });

  app.get('/api/jobs', async (request) => {
    const query = jobsQuerySchema.parse(request.query);
    return jobsResponseSchema.parse(repository.listJobs(query));
  });

  app.get('/api/jobs/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const job = repository.getJob(id);
    if (!job) throw new AppError('JOB_NOT_FOUND', 'Job does not exist', 404);
    return jobDetailSchema.parse(job);
  });
}
