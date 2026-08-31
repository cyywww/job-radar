import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchHealth } from './health.js';

const healthyPayload = {
  status: 'ok',
  service: 'job-radar-api',
  version: '0.1.0',
  timestamp: '2026-08-25T12:00:00.000Z',
  api: { status: 'ok', uptimeSeconds: 5 },
  database: { status: 'ok', latencyMs: 0.4 },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHealth', () => {
  it('returns a parsed shared health contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(healthyPayload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(fetchHealth()).resolves.toEqual(healthyPayload);
  });

  it('throws for a failed request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(fetchHealth()).rejects.toThrow('HTTP 503');
  });
});
