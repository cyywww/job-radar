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
});
