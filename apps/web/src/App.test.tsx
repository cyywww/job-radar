import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computeProfileCompleteness,
  createProfileRequestSchema,
  type CreateProfileRequest,
  type ProfileResource,
  type ProfileSnapshot,
  type ProfileSummary,
} from '@job-radar/shared';

import App from './App.js';

const timestamp = '2026-08-25T12:00:00.000Z';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function snapshotFrom(
  input: CreateProfileRequest,
  version: number,
  profileId: string,
): ProfileSnapshot {
  let factIndex = 1;
  const outputFact = <T extends { id?: string | undefined }>(fact: T) => ({
    ...fact,
    id: fact.id ?? `20000000-0000-4000-8000-${String(factIndex).padStart(12, '0')}`,
    evidenceId: `30000000-0000-4000-8000-${String(factIndex++).padStart(12, '0')}`,
    updatedAt: timestamp,
  });
  const basics = outputFact(input.basics);
  const workExperiences = input.workExperiences.map(outputFact);
  const educationExperiences = input.educationExperiences.map(outputFact);
  const skills = input.skills.map(outputFact);
  const languages = input.languages.map(outputFact);
  const certifications = input.certifications.map(outputFact);
  const projects = input.projects.map(outputFact);
  const preferences = outputFact(input.preferences);
  const allFacts = [
    basics,
    ...workExperiences,
    ...educationExperiences,
    ...skills,
    ...languages,
    ...certifications,
    ...projects,
    preferences,
  ];

  return {
    id: profileId,
    versionId: `50000000-0000-4000-8000-${String(version).padStart(12, '0')}`,
    version,
    status: allFacts.some((fact) => fact.confirmationStatus === 'pending')
      ? 'draft'
      : 'confirmed',
    changeSummary: version === 1 ? input.changeSummary : 'Updated profile in browser',
    sources: input.sources.map((source) => ({ ...source, createdAt: timestamp })),
    basics,
    workExperiences,
    educationExperiences,
    skills,
    languages,
    certifications,
    projects,
    preferences,
    completeness: computeProfileCompleteness({
      basics,
      workExperiences,
      projects,
      skills,
      languages,
      preferences,
    }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function summaryFrom(
  name: string,
  profile: ProfileSnapshot,
  isActive: boolean,
): ProfileSummary {
  return {
    id: profile.id,
    name,
    isActive,
    version: profile.version,
    status: profile.status,
    headline: profile.basics.data.headline ?? null,
    targetRoles: profile.preferences.data.targetRoles,
    completeness: profile.completeness,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile onboarding browser flow', () => {
  it('creates, edits, selects, and deletes named profiles', async () => {
    const stored = new Map<
      string,
      { name: string; profile: ProfileSnapshot; history: ProfileSnapshot[] }
    >();
    let activeId: string | null = null;
    let nextProfile = 1;
    let nextVersion = 1;
    const savedRequests: Array<Record<string, unknown>> = [];

    const resource = (id: string): ProfileResource => {
      const item = stored.get(id)!;
      return {
        summary: summaryFrom(item.name, item.profile, id === activeId),
        profile: item.profile,
      };
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';

        if (path === '/api/profiles' && method === 'GET') {
          return response({
            profiles: [...stored.entries()].map(([id, item]) =>
              summaryFrom(item.name, item.profile, id === activeId),
            ),
          });
        }
        if (path === '/api/profiles' && method === 'POST') {
          const request = JSON.parse(String(init?.body)) as {
            name: string;
            profile: unknown;
          };
          const body = createProfileRequestSchema.parse(request.profile);
          savedRequests.push(request as unknown as Record<string, unknown>);
          const id = `40000000-0000-4000-8000-${String(nextProfile++).padStart(12, '0')}`;
          const profile = snapshotFrom(body, nextVersion++, id);
          stored.set(id, { name: request.name, profile, history: [profile] });
          activeId = id;
          return response(resource(id), 201);
        }
        const profilePath = path.match(/^\/api\/profiles\/([^/]+)$/);
        if (profilePath && method === 'GET') {
          return response(resource(profilePath[1]!));
        }
        if (profilePath && method === 'PUT') {
          const request = JSON.parse(String(init?.body)) as {
            name: string;
            profile: CreateProfileRequest & { baseVersion: number };
          };
          savedRequests.push(request as unknown as Record<string, unknown>);
          const id = profilePath[1]!;
          const profileInput = { ...request.profile } as Partial<typeof request.profile>;
          delete profileInput.baseVersion;
          const profile = snapshotFrom(
            createProfileRequestSchema.parse(profileInput),
            nextVersion++,
            id,
          );
          const item = stored.get(id)!;
          item.name = request.name;
          item.profile = profile;
          item.history.push(profile);
          return response(resource(id));
        }
        const versionsPath = path.match(/^\/api\/profiles\/([^/]+)\/versions$/);
        if (versionsPath && method === 'GET') {
          const history = stored.get(versionsPath[1]!)?.history ?? [];
          return response({
            versions: [...history].reverse().map((profile) => {
              return {
                versionId: profile.versionId,
                version: profile.version,
                status: profile.status,
                changeSummary: profile.changeSummary,
                confirmedFactCount: 2,
                pendingFactCount: 0,
                createdAt: timestamp,
              };
            }),
          });
        }
        const selectPath = path.match(/^\/api\/profiles\/([^/]+)\/select$/);
        if (selectPath && method === 'POST') {
          activeId = selectPath[1]!;
          return response(resource(activeId));
        }
        if (profilePath && method === 'DELETE') {
          const deletedId = profilePath[1]!;
          stored.delete(deletedId);
          activeId = stored.keys().next().value ?? null;
          return response({ deletedId, activeProfileId: activeId });
        }
        if (path.startsWith('/api/jobs?')) {
          return response({ jobs: [], total: 0, limit: 50, offset: 0 });
        }
        if (path === '/api/sources?includeDeleted=true') {
          return response({ sources: [] });
        }
        if (path === '/api/scans?limit=10') {
          return response({ scans: [] });
        }
        if (path === '/api/scoring/config') {
          return response({ ready: false, provider: 'codex_cli', model: null });
        }
        if (path === '/api/health') {
          return response({
            status: 'ok',
            service: 'job-radar-api',
            version: '0.1.0',
            timestamp,
            api: { status: 'ok', uptimeSeconds: 5 },
            database: { status: 'ok', latencyMs: 0.4 },
          });
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
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Jobs' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Profiles' }));
    await screen.findByRole('heading', { name: 'Profiles' });
    expect(
      screen.getByRole('heading', { name: 'What are you looking for?' }),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Evidence source')).toBeNull();
    const advancedDetails = screen.getByText('Optional details').closest('details');
    expect(advancedDetails?.hasAttribute('open')).toBe(false);
    expect(
      advancedDetails?.contains(screen.getByRole('heading', { name: 'Work evidence' })),
    ).toBe(true);
    await user.clear(screen.getByRole('textbox', { name: /Profile name/ }));
    await user.type(
      screen.getByRole('textbox', { name: /Profile name/ }),
      'Product roles',
    );
    await user.type(screen.getByLabelText('Target roles'), 'Product Engineer');
    await user.type(screen.getByLabelText('Target locations'), 'Stockholm');
    await user.type(screen.getByLabelText('Core skills'), 'TypeScript\nSQL');
    await user.tab();
    await user.click(screen.getByRole('button', { name: 'Create profile' }));

    await screen.findByText('“Product roles” saved and selected.');
    expect(savedRequests[0]).toMatchObject({
      name: 'Product roles',
      profile: {
        basics: { data: { displayName: '' }, confirmationStatus: 'confirmed' },
        preferences: {
          data: { targetRoles: ['Product Engineer'], targetLocations: ['Stockholm'] },
          confirmationStatus: 'confirmed',
        },
        skills: [
          { data: { name: 'TypeScript', level: 'working' } },
          { data: { name: 'SQL', level: 'working' } },
        ],
      },
    });

    await user.click(screen.getByText('Optional details'));
    await user.click(screen.getByText('Language and eligibility'));
    await user.type(
      screen.getByLabelText('Professional headline'),
      'Fictional product engineer',
    );
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(savedRequests).toHaveLength(2));
    expect(screen.getByText('“Product roles” saved and selected.')).toBeTruthy();
    expect(savedRequests[1]).toMatchObject({ profile: { baseVersion: 1 } });
    await waitFor(() => expect(screen.getByText(/2 saved versions/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'New profile' }));
    await user.clear(screen.getByRole('textbox', { name: /Profile name/ }));
    await user.type(
      screen.getByRole('textbox', { name: /Profile name/ }),
      'Backend roles',
    );
    await user.type(screen.getByLabelText('Target roles'), 'Backend Engineer');
    await user.click(screen.getByRole('button', { name: 'Create profile' }));
    await screen.findByText('“Backend roles” saved and selected.');
    expect((screen.getByLabelText('Profile') as HTMLSelectElement).value).toBe(
      '40000000-0000-4000-8000-000000000002',
    );

    await user.selectOptions(screen.getByLabelText('Profile'), 'Product roles');
    await screen.findByText('“Product roles” now drives job search and scoring.');
    await user.click(screen.getByRole('button', { name: 'Delete profile' }));
    expect(screen.getByText('Delete “Product roles”?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await screen.findByText('“Product roles” deleted. Another profile is now selected.');
    expect(screen.queryByRole('option', { name: /Product roles/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      await screen.findByRole('heading', { name: 'Sources and local status' }),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'System status' }));
    expect(await screen.findByRole('heading', { name: 'App health' })).toBeTruthy();
  });
});
