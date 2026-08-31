import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSourceRequestSchema,
  sourceCapabilities,
  updateSourceRequestSchema,
  type SourceView,
} from '@job-radar/shared';

import { SourcesWorkspace } from './SourcesWorkspace.js';

const timestamp = '2026-08-31T08:00:00.000Z';
const sourceId = '71000000-0000-4000-8000-000000000001';

function sourceView(overrides: Partial<SourceView> = {}): SourceView {
  return {
    id: sourceId,
    type: 'greenhouse',
    name: 'Northstar careers',
    baseUrl: 'https://boards-api.greenhouse.io',
    enabled: true,
    supportLevel: 'supported',
    supportReason: 'Official public fixture.',
    configVersion: 1,
    config: {
      kind: 'greenhouse',
      boardToken: 'northstar-example',
      companyName: 'Northstar Example AB',
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
  it('adds, tests, edits, pauses, and deletes a public ATS source', async () => {
    let sources: SourceView[] = [];
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    vi.stubGlobal('scrollTo', vi.fn());
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const path = input.toString();
        const method = init?.method ?? 'GET';
        if (path === '/api/source-capabilities' && method === 'GET') {
          return response(sourceCapabilities);
        }
        if (path === '/api/sources' && method === 'GET') return response({ sources });
        if (path === '/api/sources' && method === 'POST') {
          const body = createSourceRequestSchema.parse(JSON.parse(String(init?.body)));
          if (body.type !== 'greenhouse') throw new Error('Expected Greenhouse input');
          const base = sourceView();
          if (base.config.kind !== 'greenhouse')
            throw new Error('Expected fixture config');
          sources = [
            sourceView({
              name: body.name,
              config: {
                ...base.config,
                boardToken: body.identifier,
                companyName: body.companyName,
              },
            }),
          ];
          return response(sources[0], 201);
        }
        if (path === `/api/sources/${sourceId}/test` && method === 'POST') {
          sources = [
            sourceView({
              ...sources[0],
              healthStatus: 'healthy',
              lastSuccessAt: timestamp,
            }),
          ];
          return response({
            source: sources[0],
            status: 'healthy',
            errorCategory: null,
            message: null,
            retryCount: 0,
            checkedAt: timestamp,
          });
        }
        if (path === `/api/sources/${sourceId}` && method === 'PATCH') {
          const body = updateSourceRequestSchema.parse(JSON.parse(String(init?.body)));
          const current = sources[0] ?? sourceView();
          const config =
            current.config.kind === 'greenhouse'
              ? {
                  ...current.config,
                  ...(body.companyName ? { companyName: body.companyName } : {}),
                  ...(body.identifier ? { boardToken: body.identifier } : {}),
                }
              : current.config;
          sources = [
            sourceView({
              ...current,
              config,
              ...(body.name ? { name: body.name } : {}),
              ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
            }),
          ];
          return response(sources[0]);
        }
        if (path === `/api/sources/${sourceId}` && method === 'DELETE') {
          sources = [];
          return response(null, 204);
        }
        return response({ error: { message: `Unexpected ${method} ${path}` } }, 500);
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();

    render(<SourcesWorkspace />);
    await screen.findByText('No sources configured.');
    await user.type(screen.getByLabelText('Source name'), 'Northstar careers');
    await user.type(screen.getByLabelText('Company name'), 'Northstar Example AB');
    await user.type(screen.getByLabelText('Board token'), 'northstar-example');
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await screen.findByText('Source added.');
    expect(screen.getByText('Northstar careers')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Test Northstar careers' }));
    await screen.findByText('Northstar careers is reachable.');
    await user.click(screen.getByRole('button', { name: 'Pause Northstar careers' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Enable Northstar careers' }),
      ).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Edit Northstar careers' }));
    const name = screen.getByLabelText('Source name');
    await user.clear(name);
    await user.type(name, 'Northstar engineering');
    await user.click(screen.getByRole('button', { name: 'Save source' }));
    await screen.findByText('Northstar engineering');

    await user.click(
      screen.getByRole('button', { name: 'Delete Northstar engineering' }),
    );
    await screen.findByText('No sources configured.');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/sources/${sourceId}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
