import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardResponse, ScanRun } from '@job-radar/shared';

import { DashboardWorkspace } from './DashboardWorkspace.js';

const timestamp = '2026-09-01T08:00:00.000Z';

const queued: ScanRun = {
  id: '83000000-0000-4000-8000-000000000001',
  status: 'queued',
  stage: 'queued',
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
  sourceRuns: [],
};

const dashboard: DashboardResponse = {
  generatedAt: timestamp,
  todayBoundary: '2026-09-01T00:00:00.000Z',
  profileReady: true,
  strongMatchThreshold: 80,
  counts: {
    newToday: 3,
    strongMatches: 2,
    pendingScoring: 4,
    pendingReview: 1,
    closed: 7,
  },
  sources: [
    {
      id: '70000000-0000-4000-8000-000000000001',
      name: 'JobTech / Platsbanken',
      enabled: true,
      healthStatus: 'healthy',
      lastSuccessAt: timestamp,
      lastError: null,
    },
  ],
  latestScan: null,
  topJobs: [],
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

describe('DashboardWorkspace', () => {
  it('shows daily metrics, explicit next steps, health, and starts a scan once', async () => {
    let current = dashboard;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = input.toString();
      if (path === '/api/dashboard') return response(current);
      if (path === '/api/scans' && init?.method === 'POST') {
        current = { ...dashboard, latestScan: queued };
        return response(queued, 202);
      }
      return response({ error: { message: `Unexpected ${path}` } }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
    const openJobs = vi.fn();
    const user = userEvent.setup();
    render(<DashboardWorkspace onOpenJobs={openJobs} onOpenProfile={vi.fn()} />);

    await screen.findByRole('heading', { name: 'Your evidence-backed job radar.' });
    expect(screen.getByText('Strong matches (≥ 80)')).toBeTruthy();
    expect(screen.getByText('JobTech / Platsbanken')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review 1 uncertain/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Scan sources' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/scans',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    expect(await screen.findByText(/queued. Open Jobs/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Scan running' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Review jobs' }));
    expect(openJobs).toHaveBeenCalled();
  });

  it('shows a keyboard-operable Profile action when no confirmed role exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ ...dashboard, profileReady: false })),
    );
    const openProfile = vi.fn();
    const user = userEvent.setup();
    render(<DashboardWorkspace onOpenJobs={vi.fn()} onOpenProfile={openProfile} />);

    expect(await screen.findByText(/Create and confirm your Profile/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Scan sources' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Open Profile' }));
    expect(openProfile).toHaveBeenCalledOnce();
  });
});
