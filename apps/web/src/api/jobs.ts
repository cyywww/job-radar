import {
  jobDetailSchema,
  jobsResponseSchema,
  scanRunSchema,
  scansResponseSchema,
  sourcesResponseSchema,
  type JobDetail,
  type JobSummary,
  type ScanRun,
  type Source,
} from '@job-radar/shared';

export class JobsApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'JobsApiError';
  }
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new JobsApiError(
      response.status,
      body?.error?.message ?? `Request failed with HTTP ${response.status}`,
    );
  }
  return response.json();
}

export async function fetchJobs(): Promise<JobSummary[]> {
  return jobsResponseSchema.parse(await requestJson('/api/jobs')).jobs;
}

export async function fetchJob(jobId: string): Promise<JobDetail> {
  return jobDetailSchema.parse(await requestJson(`/api/jobs/${jobId}`));
}

export async function fetchSources(): Promise<Source[]> {
  return sourcesResponseSchema.parse(await requestJson('/api/sources')).sources;
}

export async function fetchScans(): Promise<ScanRun[]> {
  return scansResponseSchema.parse(await requestJson('/api/scans?limit=10')).scans;
}

export async function startScan(): Promise<ScanRun> {
  return scanRunSchema.parse(
    await requestJson('/api/scans', { method: 'POST', body: JSON.stringify({}) }),
  );
}

export async function cancelScan(scanRunId: string): Promise<ScanRun> {
  return scanRunSchema.parse(
    await requestJson(`/api/scans/${scanRunId}/cancel`, { method: 'POST' }),
  );
}
