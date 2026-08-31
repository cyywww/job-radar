import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobDetail, JobSummary, ScanRun, SourceView } from '@job-radar/shared';

import { JobsWorkspace } from './JobsWorkspace.js';

const timestamp = '2026-08-31T08:00:00.000Z';
const jobId = '81000000-0000-4000-8000-000000000001';
const snapshotId = '82000000-0000-4000-8000-000000000001';

const job: JobSummary = {
  id: jobId,
  title: 'Product Engineer',
  company: 'Northstar Example Works AB',
  location: 'Stockholm, Sweden',
  remoteMode: 'remote',
  employmentType: 'Permanent',
  publishedAt: '2026-08-25T08:15:00.000Z',
  deadline: '2026-12-15T23:59:59.999Z',
  firstSeenAt: timestamp,
  lastSeenAt: timestamp,
  lastChangedAt: timestamp,
  active: true,
  lifecycleStatus: 'open',
  closedAt: null,
  canonicalUrl: 'https://arbetsformedlingen.se/platsbanken/annonser/fictional-job-101',
  currentSnapshotId: snapshotId,
  sourceCount: 1,
};

const detail: JobDetail = {
  ...job,
  sources: [
    {
      sourceId: '70000000-0000-4000-8000-000000000001',
      sourceName: 'JobTech / Platsbanken',
      sourceType: 'jobtech',
      sourceJobId: 'fictional-job-101',
      sourceUrl: job.canonicalUrl,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      consecutiveMisses: 0,
      active: true,
      lastChangedAt: timestamp,
      matchStrategy: 'new_job',
      matchExplanation: 'Created from the first source.',
      sourceMetadataStored: true,
    },
  ],
  snapshot: {
    id: snapshotId,
    sourceId: '70000000-0000-4000-8000-000000000001',
    sourceName: 'JobTech / Platsbanken',
    contentHash: 'a'.repeat(64),
    company: job.company,
    title: job.title,
    location: job.location,
    deadline: job.deadline,
    changedFields: ['initial'],
    descriptionText:
      'Complete fictional description with React, TypeScript, accessible products, and a local-first workflow.',
    descriptionHtml: null,
    fetchedAt: timestamp,
    rawResponseStored: true,
  },
  history: [
    {
      id: snapshotId,
      sourceId: '70000000-0000-4000-8000-000000000001',
      sourceName: 'JobTech / Platsbanken',
      contentHash: 'a'.repeat(64),
      company: job.company,
      title: job.title,
      location: job.location,
      deadline: job.deadline,
      changedFields: ['initial'],
      fetchedAt: timestamp,
      rawResponseStored: true,
    },
  ],
};

const source: SourceView = {
  id: '70000000-0000-4000-8000-000000000001',
  type: 'jobtech',
  name: 'JobTech / Platsbanken',
  baseUrl: 'https://jobsearch.api.jobtechdev.se',
  enabled: true,
  supportLevel: 'supported',
  supportReason: 'Official public fixture.',
  configVersion: 1,
  config: {
    kind: 'jobtech',
    queryMode: 'confirmed_profile_roles',
    occupationField: 'apaJ_2ja_LuF',
    pageSize: 25,
    maxPages: 4,
    detailConcurrency: 4,
    requestTimeoutMs: 10_000,
    maxRetries: 3,
    retryBaseDelayMs: 300,
    minRequestIntervalMs: 150,
    missingThreshold: 3,
    userAgent: 'Job-Radar-Test/1.0',
  },
  lastSuccessAt: null,
  lastError: null,
  lastErrorCategory: null,
  healthStatus: 'unknown',
  createdAt: timestamp,
  updatedAt: timestamp,
  metrics: {
    totalRuns: 0,
    successfulRuns: 0,
    partialRuns: 0,
    failedRuns: 0,
    cancelledRuns: 0,
    totalRetries: 0,
    jobsDiscovered: 0,
    jobsFetched: 0,
    jobsCreated: 0,
    jobsUpdated: 0,
    jobsFailed: 0,
  },
  latestRun: null,
};

const queuedRun: ScanRun = {
  id: '83000000-0000-4000-8000-000000000001',
  status: 'queued',
  profileVersion: 1,
  counts: {
    discovered: 0,
    fetched: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    closed: 0,
    failed: 0,
  },
  errorSummary: null,
  cancelRequestedAt: null,
  startedAt: null,
  finishedAt: null,
  createdAt: timestamp,
  sourceRuns: [
    {
      id: '84000000-0000-4000-8000-000000000001',
      scanRunId: '83000000-0000-4000-8000-000000000001',
      sourceId: source.id,
      sourceName: source.name,
      configVersion: 1,
      status: 'queued',
      queries: ['Product Engineer'],
      resultSetComplete: null,
      pagesFetched: 0,
      retryCount: 0,
      counts: {
        discovered: 0,
        fetched: 0,
        created: 0,
        updated: 0,
        unchanged: 0,
        closed: 0,
        failed: 0,
      },
      errorCategory: null,
      errorSummary: null,
      startedAt: null,
      finishedAt: null,
      createdAt: timestamp,
    },
  ],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('JobsWorkspace', () => {
  it('shows a stored job detail and starts a browser scan', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const path = input.toString();
        if (path === '/api/jobs?active=all')
          return response({ jobs: [job], total: 1, limit: 50, offset: 0 });
        if (path === `/api/jobs/${jobId}`) return response(detail);
        if (path === '/api/sources') return response({ sources: [source] });
        if (path === '/api/scans?limit=10') return response({ scans: [] });
        if (path === '/api/scans' && init?.method === 'POST')
          return response(queuedRun, 202);
        return response({ error: { message: `Unexpected request ${path}` } }, 500);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<JobsWorkspace />);

    await screen.findByRole('button', { name: /Product Engineer/ });
    await screen.findByText(/Complete fictional description/);
    expect(
      screen.getByRole('link', { name: /Open original listing/ }).getAttribute('href'),
    ).toBe(job.canonicalUrl);

    await user.click(screen.getByRole('button', { name: 'Scan sources' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/scans',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect((await screen.findAllByText('queued')).length).toBeGreaterThan(0);
  });
});
