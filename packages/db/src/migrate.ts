import {
  createLogger,
  ensureRuntimeDirectories,
  getAppConfig,
  loadEnvironmentFiles,
} from '@job-radar/config';

import { openDatabase, runMigrations } from './database.js';

loadEnvironmentFiles();
const config = getAppConfig();
ensureRuntimeDirectories(config);

const logger = createLogger(config, 'job-radar-migrate');
const database = openDatabase(config.databasePath);

try {
  runMigrations(database);
  logger.info('Database migrations are current');
} catch (error) {
  logger.error({ err: error }, 'Database migration failed');
  process.exitCode = 1;
} finally {
  database.close();
  logger.flush();
}
