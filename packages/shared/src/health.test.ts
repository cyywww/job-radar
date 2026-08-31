import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './health.js';

const validHealth = {
  status: 'ok',
  service: 'job-radar-api',
  version: '0.1.0',
  timestamp: '2026-08-25T12:00:00.000Z',
  api: {
    status: 'ok',
    uptimeSeconds: 12.5,
  },
  database: {
    status: 'ok',
    latencyMs: 0.8,
  },
} as const;

describe('healthResponseSchema', () => {
  it('accepts a complete health payload', () => {
    expect(healthResponseSchema.parse(validHealth)).toEqual(validHealth);
  });

  it('rejects an unsupported database state', () => {
    expect(() =>
      healthResponseSchema.parse({
        ...validHealth,
        database: { status: 'unknown', latencyMs: 1 },
      }),
    ).toThrow();
  });
});
