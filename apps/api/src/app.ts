import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError } from 'zod';

import type { AppConfig } from '@job-radar/config';
import type { JobConnector } from '@job-radar/connectors';
import type { DatabaseClient } from '@job-radar/db';
import type { AIProvider } from '@job-radar/scoring';
import { AppError, errorResponseSchema } from '@job-radar/shared';

import { registerHealthRoutes } from './routes/health.js';
import { registerJobRoutes } from './routes/jobs.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerReviewRoutes } from './routes/review.js';
import { registerScoringRoutes } from './routes/scoring.js';
import { ScanCoordinator } from './services/scan-coordinator.js';
import { ScoringCoordinator } from './services/scoring-coordinator.js';

export interface BuildAppOptions {
  readonly config: AppConfig;
  readonly database: DatabaseClient;
  readonly logger?: FastifyBaseLogger | false;
  readonly connectors?: readonly JobConnector[];
  readonly scoringProvider?: AIProvider;
}

function statusAndCode(error: unknown): { statusCode: number; code: string } {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, code: error.code };
  }

  if (error instanceof ZodError) {
    return { statusCode: 400, code: 'VALIDATION_ERROR' };
  }

  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;

  return {
    statusCode,
    code: statusCode < 500 ? 'REQUEST_ERROR' : 'INTERNAL_ERROR',
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const serverOptions: FastifyServerOptions =
    options.logger === false || options.logger === undefined
      ? { logger: false }
      : { loggerInstance: options.logger };
  const app = Fastify(serverOptions);

  app.addContentTypeParser(
    'text/markdown',
    { parseAs: 'string' },
    (_request, body, done) => done(null, body),
  );

  app.setErrorHandler((error, request, reply) => {
    const { statusCode, code } = statusAndCode(error);
    const message =
      statusCode >= 500
        ? 'Internal server error'
        : error instanceof Error
          ? error.message
          : 'Request rejected';

    if (statusCode >= 500) {
      request.log.error({ err: error }, 'Request failed');
    } else {
      request.log.warn({ err: error }, 'Request rejected');
    }

    return reply.status(statusCode).send(
      errorResponseSchema.parse({
        error: {
          code,
          message,
          requestId: request.id,
        },
      }),
    );
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(
      errorResponseSchema.parse({
        error: {
          code: 'NOT_FOUND',
          message: 'Route not found',
          requestId: request.id,
        },
      }),
    ),
  );

  await registerHealthRoutes(app, options.database);
  const scoring = new ScoringCoordinator(options.database, app.log, options.config, {
    ...(options.scoringProvider ? { provider: options.scoringProvider } : {}),
  });
  await registerProfileRoutes(app, options.database, scoring);
  const coordinator = new ScanCoordinator(options.database, app.log, {
    ...(options.connectors ? { connectors: options.connectors } : {}),
    scoring,
  });
  await registerJobRoutes(app, options.database, coordinator);
  await registerScoringRoutes(app, scoring);
  await registerReviewRoutes(app, options.database, coordinator, scoring);

  const indexPath = join(options.config.webDistDir, 'index.html');
  const assetsPath = join(options.config.webDistDir, 'assets');

  if (existsSync(indexPath) && existsSync(assetsPath)) {
    await app.register(fastifyStatic, {
      root: assetsPath,
      prefix: '/assets/',
      wildcard: true,
    });

    app.get('/', async (_request, reply) =>
      reply.type('text/html; charset=utf-8').send(readFileSync(indexPath, 'utf8')),
    );
  }

  app.addHook('onClose', async () => {
    await coordinator.close();
    options.database.close();
  });

  return app;
}
