import {
  bulkRescoreRequestSchema,
  bulkRescoreResponseSchema,
  bulkTriageRequestSchema,
  bulkTriageResponseSchema,
  createFeedbackRequestSchema,
  createSourceRequestSchema,
  jobReviewDetailSchema,
  refreshJobResponseSchema,
  retryFailedScoringResponseSchema,
  reviewJobsQuerySchema,
  reviewJobsResponseSchema,
  restoreTriageRequestSchema,
  restoreTriageResponseSchema,
  scanRunSchema,
  scansResponseSchema,
  scoreFeedbackSchema,
  scoreReviewEventSchema,
  scoringTaskSchema,
  scoringConfigurationSchema,
  scoringProcessResultSchema,
  sourceTestResultSchema,
  sourceViewSchema,
  sourcesResponseSchema,
  updateScoreReviewRequestSchema,
  updateSourceRequestSchema,
  updateTriageRequestSchema,
  updateTriageResponseSchema,
  type CreateFeedbackRequest,
  type CreateSourceRequest,
  type JobReviewDetail,
  type ReviewJobSummary,
  type ReviewJobsQuery,
  type ScanRun,
  type ScoreFeedback,
  type ScoreReviewEvent,
  type ScoringTask,
  type ScoringConfiguration,
  type ScoringProcessResult,
  type SourceTestResult,
  type SourceView,
  type TriageStatus,
  type TriageRecord,
  type UpdateSourceRequest,
} from '@job-radar/shared';

import { request, requestJson } from './request.js';

export async function fetchReviewJobs(query: ReviewJobsQuery): Promise<{
  jobs: ReviewJobSummary[];
  total: number;
}> {
  const parsed = reviewJobsQuerySchema.parse({
    ...query,
    includeClosed: query.includeClosed ? 'true' : 'false',
  });
  const parameters = new URLSearchParams({
    search: parsed.search,
    includeClosed: String(parsed.includeClosed),
    sort: parsed.sort,
    direction: parsed.direction,
    limit: String(parsed.limit),
    offset: String(parsed.offset),
  });
  for (const key of [
    'triage',
    'location',
    'remoteMode',
    'company',
    'sourceId',
    'lifecycle',
    'gate',
    'scoreStatus',
    'reviewState',
  ] as const) {
    const value = parsed[key];
    if (value) parameters.set(key, value);
  }
  const response = reviewJobsResponseSchema.parse(
    await requestJson(`/api/jobs?${parameters.toString()}`),
  );
  return { jobs: response.jobs, total: response.total };
}

export async function fetchReviewJob(jobId: string): Promise<JobReviewDetail> {
  return jobReviewDetailSchema.parse(await requestJson(`/api/jobs/${jobId}`));
}

export async function updateJobTriage(
  jobId: string,
  status: TriageStatus,
): Promise<ReturnType<typeof updateTriageResponseSchema.parse>> {
  return updateTriageResponseSchema.parse(
    await requestJson(`/api/jobs/${jobId}/triage`, {
      method: 'PATCH',
      body: JSON.stringify(updateTriageRequestSchema.parse({ status })),
    }),
  );
}

export async function bulkUpdateJobTriage(
  jobIds: string[],
  status: TriageStatus,
): Promise<ReturnType<typeof bulkTriageResponseSchema.parse>> {
  return bulkTriageResponseSchema.parse(
    await requestJson('/api/jobs/bulk-triage', {
      method: 'POST',
      body: JSON.stringify(bulkTriageRequestSchema.parse({ jobIds, status })),
    }),
  );
}

export async function restoreJobTriage(records: TriageRecord[]): Promise<TriageRecord[]> {
  return restoreTriageResponseSchema.parse(
    await requestJson('/api/jobs/bulk-triage/restore', {
      method: 'POST',
      body: JSON.stringify(
        restoreTriageRequestSchema.parse({
          records: records.map(({ jobId, status, note, updatedAt }) => ({
            jobId,
            status,
            note,
            updatedAt,
          })),
        }),
      ),
    }),
  ).current;
}

export async function createJobFeedback(
  jobId: string,
  input: CreateFeedbackRequest,
): Promise<ScoreFeedback> {
  return scoreFeedbackSchema.parse(
    await requestJson(`/api/jobs/${jobId}/feedback`, {
      method: 'POST',
      body: JSON.stringify(createFeedbackRequestSchema.parse(input)),
    }),
  );
}

export async function updateJobReview(
  jobId: string,
  state: 'pending' | 'approved' | 'rejected',
  reason: string,
): Promise<ScoreReviewEvent> {
  return scoreReviewEventSchema.parse(
    await requestJson(`/api/jobs/${jobId}/review`, {
      method: 'PATCH',
      body: JSON.stringify(updateScoreReviewRequestSchema.parse({ state, reason })),
    }),
  );
}

export async function rescoreJob(jobId: string): Promise<ScoringTask> {
  return scoringTaskSchema.parse(
    await requestJson(`/api/jobs/${jobId}/rescore`, { method: 'POST' }),
  );
}

export async function retryScoringTask(taskId: string): Promise<ScoringTask> {
  return scoringTaskSchema.parse(
    await requestJson(`/api/scoring/tasks/${taskId}/retry`, { method: 'POST' }),
  );
}

export async function bulkRescoreJobs(jobIds: string[]): Promise<ScoringTask[]> {
  return bulkRescoreResponseSchema.parse(
    await requestJson('/api/jobs/bulk-rescore', {
      method: 'POST',
      body: JSON.stringify(bulkRescoreRequestSchema.parse({ jobIds })),
    }),
  ).tasks;
}

export async function retryFailedScoring(): Promise<ScoringTask[]> {
  return retryFailedScoringResponseSchema.parse(
    await requestJson('/api/scoring/retry-failed', {
      method: 'POST',
      body: JSON.stringify({ limit: 25 }),
    }),
  ).tasks;
}

export async function fetchScoringConfiguration(): Promise<ScoringConfiguration> {
  return scoringConfigurationSchema.parse(await requestJson('/api/scoring/config'));
}

export async function processScoringQueue(limit = 1): Promise<ScoringProcessResult> {
  return scoringProcessResultSchema.parse(
    await requestJson('/api/scoring/process', {
      method: 'POST',
      body: JSON.stringify({ limit }),
    }),
  );
}

export async function refreshJob(jobId: string): Promise<ScanRun> {
  return refreshJobResponseSchema.parse(
    await requestJson(`/api/jobs/${jobId}/refresh`, { method: 'POST' }),
  ).scan;
}

export async function fetchSources(includeDeleted = false): Promise<SourceView[]> {
  return sourcesResponseSchema.parse(
    await requestJson(
      includeDeleted ? '/api/sources?includeDeleted=true' : '/api/sources',
    ),
  ).sources;
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
  await request(`/api/sources/${sourceId}`, { method: 'DELETE' });
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
