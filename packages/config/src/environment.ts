import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'dotenv';
import { z } from 'zod';

const environmentSchema = z
  .object({
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
    JOB_RADAR_CODEX_BINARY: z.string().trim().min(1).max(500).default('codex'),
    JOB_RADAR_CODEX_MODEL: z.string().trim().min(1).max(120).optional(),
    JOB_RADAR_SCORING_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(900_000)
      .default(120_000),
    JOB_RADAR_SCORING_MAX_OUTPUT_BYTES: z.coerce
      .number()
      .int()
      .min(4_096)
      .max(2_097_152)
      .default(262_144),
    JOB_RADAR_SCORING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    JOB_RADAR_SCORING_RETRY_BASE_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(60_000),
    JOB_RADAR_SCORING_RETRY_MAX_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(86_400_000)
      .default(3_600_000),
    JOB_RADAR_SCORING_REVIEW_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.65),
  })
  .superRefine((value, context) => {
    if (value.JOB_RADAR_SCORING_RETRY_MAX_MS < value.JOB_RADAR_SCORING_RETRY_BASE_MS) {
      context.addIssue({
        code: 'custom',
        path: ['JOB_RADAR_SCORING_RETRY_MAX_MS'],
        message: 'Scoring retry maximum must be at least the retry base',
      });
    }
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
  readonly codexBinary: string;
  readonly codexModel?: string;
  readonly scoringTimeoutMs: number;
  readonly scoringMaxOutputBytes: number;
  readonly scoringMaxAttempts: number;
  readonly scoringRetryBaseMs: number;
  readonly scoringRetryMaxMs: number;
  readonly scoringReviewConfidence: number;
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
    codexBinary: result.data.JOB_RADAR_CODEX_BINARY,
    ...(result.data.JOB_RADAR_CODEX_MODEL
      ? { codexModel: result.data.JOB_RADAR_CODEX_MODEL }
      : {}),
    scoringTimeoutMs: result.data.JOB_RADAR_SCORING_TIMEOUT_MS,
    scoringMaxOutputBytes: result.data.JOB_RADAR_SCORING_MAX_OUTPUT_BYTES,
    scoringMaxAttempts: result.data.JOB_RADAR_SCORING_MAX_ATTEMPTS,
    scoringRetryBaseMs: result.data.JOB_RADAR_SCORING_RETRY_BASE_MS,
    scoringRetryMaxMs: result.data.JOB_RADAR_SCORING_RETRY_MAX_MS,
    scoringReviewConfidence: result.data.JOB_RADAR_SCORING_REVIEW_CONFIDENCE,
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
