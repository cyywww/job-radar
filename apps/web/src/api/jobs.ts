import {
  createSourceRequestSchema,
  jobDetailSchema,
  jobsResponseSchema,
  scanRunSchema,
  scansResponseSchema,
  sourceTestResultSchema,
  sourceCapabilitiesResponseSchema,
  sourceViewSchema,
  sourcesResponseSchema,
  updateSourceRequestSchema,
  type CreateSourceRequest,
  type JobDetail,
  type JobSummary,
  type ScanRun,
  type SourceTestResult,
  type SourceCapability,
  type SourceView,
  type UpdateSourceRequest,
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
  return jobsResponseSchema.parse(await requestJson('/api/jobs?active=all')).jobs;
}

export async function fetchJob(jobId: string): Promise<JobDetail> {
  return jobDetailSchema.parse(await requestJson(`/api/jobs/${jobId}`));
}

export async function fetchSources(): Promise<SourceView[]> {
  return sourcesResponseSchema.parse(await requestJson('/api/sources')).sources;
}

export async function fetchSourceCapabilities(): Promise<SourceCapability[]> {
  return sourceCapabilitiesResponseSchema.parse(
    await requestJson('/api/source-capabilities'),
  ).capabilities;
}

export async function createSource(input: CreateSourceRequest): Promise<SourceView> {
  return sourceViewSchema.parse(
    await requestJson('/api/sources', {
      method: 'POST',
      body: JSON.stringify(createSourceRequestSchema.parse(input)),
    }),
  );
}

export async function updateSource(
  sourceId: string,
  input: UpdateSourceRequest,
): Promise<SourceView> {
  return sourceViewSchema.parse(
    await requestJson(`/api/sources/${sourceId}`, {
      method: 'PATCH',
      body: JSON.stringify(updateSourceRequestSchema.parse(input)),
    }),
  );
}

export async function testSource(sourceId: string): Promise<SourceTestResult> {
  return sourceTestResultSchema.parse(
    await requestJson(`/api/sources/${sourceId}/test`, { method: 'POST' }),
  );
}

export async function deleteSource(sourceId: string): Promise<void> {
  const response = await fetch(`/api/sources/${sourceId}`, {
    method: 'DELETE',
    headers: { accept: 'application/json' },
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

export async function rerunSource(sourceId: string): Promise<ScanRun> {
  return scanRunSchema.parse(
    await requestJson(`/api/sources/${sourceId}/rerun`, { method: 'POST' }),
  );
}
