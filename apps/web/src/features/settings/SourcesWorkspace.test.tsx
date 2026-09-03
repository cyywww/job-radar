import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSourceRequestSchema,
  updateSourceRequestSchema,
  type SourceView,
} from '@job-radar/shared';

import { SourcesWorkspace } from './SourcesWorkspace.js';

const timestamp = '2026-09-01T08:00:00.000Z';
const jobTechId = '70000000-0000-4000-8000-000000000001';
const targetPageId = '71000000-0000-4000-8000-000000000001';
const requestPolicy = {
  detailConcurrency: 4,
  requestTimeoutMs: 10_000,
  maxRetries: 3,
  retryBaseDelayMs: 300,
  minRequestIntervalMs: 150,
  missingThreshold: 3,
  userAgent: 'Job-Radar-Test/1.0',
};
const metrics = {
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
};

function jobTechSource(): SourceView {
  return {
    id: jobTechId,
    type: 'jobtech',
    name: 'JobTech / Platsbanken',
    baseUrl: 'https://jobsearch.api.jobtechdev.se',
    enabled: true,
    configurationState: 'enabled',
    deletedAt: null,
    supportLevel: 'supported',
    supportReason: 'Sweden primary source.',
    configVersion: 1,
    config: {
      kind: 'jobtech',
      queryMode: 'confirmed_profile_roles',
      occupationField: 'apaJ_2ja_LuF',
      pageSize: 100,
      maxPages: 20,
      ...requestPolicy,
    },
    lastSuccessAt: null,
    lastError: null,
    lastErrorCategory: null,
    healthStatus: 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
    metrics,
    latestRun: null,
  };
}

function targetPage(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: targetPageId,
    type: 'generic_web',
    name: 'Northstar careers',
    baseUrl: 'https://careers.example.test/jobs',
    enabled: false,
    configurationState: 'paused',
    deletedAt: null,
    supportLevel: 'limited',
    supportReason: 'Optional target-company page.',
    configVersion: 1,
    config: {
      kind: 'generic_web',
      startUrl: 'https://careers.example.test/jobs',
      companyName: 'Northstar Example AB',
      maxPostings: 200,
      ...requestPolicy,
    },
    lastSuccessAt: null,
    lastError: null,
    lastErrorCategory: null,
    healthStatus: 'unknown',
    createdAt: timestamp,
    updatedAt: timestamp,
    metrics,
    latestRun: null,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SourcesWorkspace', () => {
  it('keeps JobTech primary and manages one optional target-company page', async () => {
    let sources: SourceView[] = [jobTechSource()];
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    vi.stubGlobal('scrollTo', vi.fn());
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const path = input.toString();
        const method = init?.method ?? 'GET';
        if (path === '/api/sources?includeDeleted=true' && method === 'GET')
          return response({ sources });
        if (path === '/api/sources' && method === 'POST') {
          const body = createSourceRequestSchema.parse(JSON.parse(String(init?.body)));
          const config = targetPage().config;
          if (config.kind !== 'generic_web') throw new Error('Wrong source config');
          sources = [
            sources[0]!,
            targetPage({
              name: body.name,
              baseUrl: body.startUrl,
              config: {
                ...config,
                companyName: body.companyName,
                startUrl: body.startUrl,
              },
            }),
          ];
          return response(sources[1], 201);
        }
        if (path === `/api/sources/${targetPageId}/test` && method === 'POST') {
          sources[1] = targetPage({
            ...sources[1],
            healthStatus: 'healthy',
            lastSuccessAt: timestamp,
          });
          return response({
            source: sources[1],
            status: 'healthy',
            errorCategory: null,
            message: null,
            retryCount: 0,
            checkedAt: timestamp,
          });
        }
        if (path === `/api/sources/${targetPageId}` && method === 'PATCH') {
          const body = updateSourceRequestSchema.parse(JSON.parse(String(init?.body)));
          const current = sources[1] ?? targetPage();
          if (current.config.kind !== 'generic_web') throw new Error('Wrong source');
          sources[1] = targetPage({
            ...current,
            ...(body.name ? { name: body.name } : {}),
            ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            config: {
              ...current.config,
              ...(body.companyName ? { companyName: body.companyName } : {}),
              ...(body.startUrl ? { startUrl: body.startUrl } : {}),
            },
          });
          return response(sources[1]);
        }
        if (path === `/api/sources/${targetPageId}` && method === 'DELETE') {
          sources[1] = targetPage({
            ...sources[1],
            enabled: false,
            configurationState: 'deleted',
            deletedAt: timestamp,
          });
          return response(null, 204);
        }
        return response(
          {
            error: {
              code: 'TEST_ERROR',
              requestId: 'test-request',
              message: `Unexpected ${method} ${path}`,
            },
          },
          500,
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<SourcesWorkspace />);
    expect(await screen.findByText('JobTech / Platsbanken')).toBeTruthy();
    expect(await screen.findByText(/supported · Sweden primary source/)).toBeTruthy();
    await user.type(screen.getByLabelText('Source name'), 'Northstar careers');
    await user.type(screen.getByLabelText('Company name'), 'Northstar Example AB');
    await user.type(
      screen.getByLabelText('Public careers page URL'),
      'https://careers.example.test/jobs',
    );
    await user.click(screen.getByRole('button', { name: 'Add target page' }));
    await screen.findByText('Target page added and paused.');

    await user.click(screen.getByRole('button', { name: 'Test Northstar careers' }));
    await screen.findByText('Northstar careers is reachable.');
    await user.click(screen.getByRole('button', { name: 'Enable Northstar careers' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Pause Northstar careers' }),
      ).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Edit Northstar careers' }));
    const name = screen.getByLabelText('Source name');
    await user.clear(name);
    await user.type(name, 'Northstar engineering');
    await user.click(screen.getByRole('button', { name: 'Save target page' }));
    await screen.findByText('Northstar engineering');

    await user.click(
      screen.getByRole('button', { name: 'Delete Northstar engineering' }),
    );
    await waitFor(() => expect(screen.getByText('Northstar engineering')).toBeTruthy());
    expect(screen.getByText('deleted')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Edit Northstar engineering' }),
    ).toBeNull();
    expect(screen.getAllByText('JobTech / Platsbanken')).toHaveLength(1);
  });
});
