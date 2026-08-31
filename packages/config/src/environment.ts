import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'dotenv';
import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  JOB_RADAR_DATA_DIR: z.string().min(1).optional(),
  JOB_RADAR_CONFIG_DIR: z.string().min(1).optional(),
  JOB_RADAR_LOG_DIR: z.string().min(1).optional(),
  JOB_RADAR_DATABASE_PATH: z.string().min(1).optional(),
  JOB_RADAR_WEB_DIST_DIR: z.string().min(1).optional(),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly rootDir: string;
  readonly dataDir: string;
  readonly configDir: string;
  readonly logDir: string;
  readonly databasePath: string;
  readonly webDistDir: string;
}

export class ConfigurationError extends Error {
  public readonly issues: readonly string[];

  public constructor(issues: readonly string[]) {
    super(`Invalid environment configuration: ${issues.join('; ')}`);
    this.name = 'ConfigurationError';
    this.issues = issues;
  }
}

export function getRepositoryRoot(): string {
  return fileURLToPath(new URL('../../..', import.meta.url));
}

function resolveRuntimePath(rootDir: string, value: string): string {
  return isAbsolute(value) ? value : resolve(rootDir, value);
}

export function loadEnvironmentFiles(
  rootDir = getRepositoryRoot(),
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const originalKeys = new Set(Object.keys(environment));
  const fileValues: Record<string, string> = {};

  for (const filename of ['.env', '.env.local']) {
    const path = join(rootDir, filename);
    if (existsSync(path)) {
      Object.assign(fileValues, parse(readFileSync(path)));
    }
  }

  for (const [key, value] of Object.entries(fileValues)) {
    if (!originalKeys.has(key)) {
      environment[key] = value;
    }
  }
}

export function getAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
  rootDir = getRepositoryRoot(),
): AppConfig {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const dataDir = resolveRuntimePath(rootDir, result.data.JOB_RADAR_DATA_DIR ?? './data');

  return {
    nodeEnv: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
    rootDir,
    dataDir,
    configDir: resolveRuntimePath(
      rootDir,
      result.data.JOB_RADAR_CONFIG_DIR ?? './config',
    ),
    logDir: resolveRuntimePath(rootDir, result.data.JOB_RADAR_LOG_DIR ?? './logs'),
    databasePath: resolveRuntimePath(
      rootDir,
      result.data.JOB_RADAR_DATABASE_PATH ?? join(dataDir, 'job-radar.sqlite'),
    ),
    webDistDir: resolveRuntimePath(
      rootDir,
      result.data.JOB_RADAR_WEB_DIST_DIR ?? './apps/web/dist',
    ),
  };
}

export function ensureRuntimeDirectories(config: AppConfig): void {
  const directories = new Set([
    config.dataDir,
    config.configDir,
    config.logDir,
    dirname(config.databasePath),
  ]);

  for (const directory of directories) {
    mkdirSync(directory, { recursive: true });
  }
}
