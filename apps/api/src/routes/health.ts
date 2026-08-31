import type { FastifyInstance } from 'fastify';

import type { DatabaseClient } from '@job-radar/db';

import { getHealth } from '../services/health.js';

export async function registerHealthRoutes(
  app: FastifyInstance,
  database: DatabaseClient,
): Promise<void> {
  app.get('/api/health', async () => getHealth(database));

  app.get('/api/readiness', async (_request, reply) => {
    const health = getHealth(database);
    return reply.status(health.database.status === 'ok' ? 200 : 503).send(health);
  });

  app.get('/health', async () => getHealth(database));
}
