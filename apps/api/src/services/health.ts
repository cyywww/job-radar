import type { DatabaseClient } from '@job-radar/db';
import { checkDatabase } from '@job-radar/db';
import {
  APP_VERSION,
  healthResponseSchema,
  type HealthResponse,
} from '@job-radar/shared';

export function getHealth(database: DatabaseClient): HealthResponse {
  const databaseHealth = checkDatabase(database);

  return healthResponseSchema.parse({
    status: databaseHealth.status === 'ok' ? 'ok' : 'degraded',
    service: 'job-radar-api',
    version: APP_VERSION,
    timestamp: new Date().toISOString(),
    api: {
      status: 'ok',
      uptimeSeconds: Number(process.uptime().toFixed(3)),
    },
    database: databaseHealth,
  });
}
