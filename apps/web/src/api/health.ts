import { healthResponseSchema, type HealthResponse } from '@job-radar/shared';

import { requestJson } from './request.js';

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return healthResponseSchema.parse(
    await requestJson('/api/health', signal ? { signal } : undefined),
  );
}
