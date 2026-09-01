import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigurationError, getAppConfig } from './environment.js';

describe('getAppConfig', () => {
  it('provides loopback-safe defaults and root-relative paths', () => {
    const config = getAppConfig({}, '/workspace/job-radar');

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.databasePath).toBe(
      resolve('/workspace/job-radar', 'data/job-radar.sqlite'),
    );
    expect(config.codexBinary).toBe('codex');
    expect(config.codexModel).toBeUndefined();
    expect(config.scoringMaxAttempts).toBe(3);
    expect(config.scoringReviewConfidence).toBe(0.65);
  });

  it('honors directory and database overrides', () => {
    const config = getAppConfig(
      {
        JOB_RADAR_DATA_DIR: './runtime-data',
        JOB_RADAR_DATABASE_PATH: '/tmp/fictional-job-radar.sqlite',
      },
      '/workspace/job-radar',
    );

    expect(config.dataDir).toBe(resolve('/workspace/job-radar', 'runtime-data'));
    expect(config.databasePath).toBe('/tmp/fictional-job-radar.sqlite');
  });

  it('rejects an invalid port without exposing environment values', () => {
    expect(() => getAppConfig({ PORT: '70000' }, '/workspace/job-radar')).toThrow(
      ConfigurationError,
    );
  });

  it('validates bounded scoring process settings', () => {
    const config = getAppConfig(
      {
        JOB_RADAR_CODEX_BINARY: '/opt/fictional/bin/codex',
        JOB_RADAR_CODEX_MODEL: 'fictional-codex-model',
        JOB_RADAR_SCORING_MAX_ATTEMPTS: '4',
        JOB_RADAR_SCORING_RETRY_BASE_MS: '2000',
        JOB_RADAR_SCORING_RETRY_MAX_MS: '8000',
      },
      '/workspace/job-radar',
    );

    expect(config.codexModel).toBe('fictional-codex-model');
    expect(config.scoringMaxAttempts).toBe(4);
    expect(config.scoringRetryMaxMs).toBe(8000);
  });

  it('rejects a scoring retry maximum below the base delay', () => {
    expect(() =>
      getAppConfig(
        {
          JOB_RADAR_SCORING_RETRY_BASE_MS: '8000',
          JOB_RADAR_SCORING_RETRY_MAX_MS: '2000',
        },
        '/workspace/job-radar',
      ),
    ).toThrow(ConfigurationError);
  });
});
