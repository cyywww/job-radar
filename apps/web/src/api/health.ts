import { healthResponseSchema, type HealthResponse } from '@job-radar/shared';

export async function fetchHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const request: RequestInit = {
    headers: { accept: 'application/json' },
  };

  if (signal) {
    request.signal = signal;
  }

  const response = await fetch('/api/health', request);

  if (!response.ok) {
    throw new Error(`Health request failed with HTTP ${response.status}`);
  }

  return healthResponseSchema.parse(await response.json());
}
