import {
  createLogger,
  ensureRuntimeDirectories,
  getAppConfig,
  loadEnvironmentFiles,
} from '@job-radar/config';
import { openDatabase, runMigrations } from '@job-radar/db';

import { buildApp } from './app.js';

loadEnvironmentFiles();
const config = getAppConfig();
ensureRuntimeDirectories(config);

const logger = createLogger(config, 'job-radar-api');
const database = openDatabase(config.databasePath);

try {
  runMigrations(database);
} catch (error) {
  database.close();
  logger.fatal({ err: error }, 'Startup migration failed');
  logger.flush();
  throw error;
}

const app = await buildApp({ config, database, logger });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'Shutting down');
  await app.close();
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  const address = await app.listen({ host: config.host, port: config.port });
  app.log.info({ address }, 'Job Radar API is ready');
} catch (error) {
  app.log.fatal({ err: error }, 'Failed to start Job Radar API');
  await app.close();
  process.exitCode = 1;
}
