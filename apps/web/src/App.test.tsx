import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  computeProfileCompleteness,
  createProfileRequestSchema,
  type CreateProfileRequest,
  type ProfileSnapshot,
} from '@job-radar/shared';

import App from './App.js';

const timestamp = '2026-08-25T12:00:00.000Z';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function snapshotFrom(input: CreateProfileRequest, version: number): ProfileSnapshot {
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
    id: '40000000-0000-4000-8000-000000000001',
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('profile onboarding browser flow', () => {
  it('creates and edits a profile with preferences as immutable versions', async () => {
    let current: ProfileSnapshot | null = null;
    const savedRequests: Array<Record<string, unknown>> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const path = typeof input === 'string' ? input : input.toString();
        const method = init?.method ?? 'GET';

        if (path === '/api/profile' && method === 'GET') {
          return response({ error: { message: 'Profile does not exist' } }, 404);
        }
        if (path === '/api/profile' && method === 'POST') {
          const body = createProfileRequestSchema.parse(JSON.parse(String(init?.body)));
          savedRequests.push(body);
          current = snapshotFrom(body, 1);
          return response(current, 201);
        }
        if (path === '/api/profile' && method === 'PUT') {
          const body = JSON.parse(String(init?.body)) as CreateProfileRequest & {
            baseVersion: number;
          };
          savedRequests.push(body as unknown as Record<string, unknown>);
          const profileInput = { ...body } as Partial<typeof body>;
          delete profileInput.baseVersion;
          current = snapshotFrom(createProfileRequestSchema.parse(profileInput), 2);
          return response(current);
        }
        if (path === '/api/profile/versions') {
          const count = current?.version ?? 0;
          return response({
            versions: Array.from({ length: count }, (_item, index) => {
              const version = count - index;
              return {
                versionId: `50000000-0000-4000-8000-${String(version).padStart(12, '0')}`,
                version,
                status: 'confirmed',
                changeSummary:
                  version === 1
                    ? 'Created profile through onboarding'
                    : 'Updated profile in browser',
                confirmedFactCount: 2,
                pendingFactCount: 0,
                createdAt: timestamp,
              };
            }),
          });
        }

        return response({ error: { message: `Unexpected ${method} ${path}` } }, 500);
      }),
    );

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Profile' }));
    await screen.findByRole('heading', { name: 'Your profile' });
    expect(screen.getByRole('heading', { name: 'Your search' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your fit' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Evidence' })).toBeTruthy();
    expect(screen.queryByLabelText('Evidence source')).toBeNull();
    expect(
      screen
        .getByText('Optional search filters')
        .closest('details')
        ?.hasAttribute('open'),
    ).toBe(false);
    await user.type(screen.getByLabelText('Display name'), 'Robin North');
    await user.type(screen.getByLabelText('Current location'), 'Stockholm');
    await user.type(screen.getByLabelText('Professional summary'), 'Fictional engineer.');
    await user.type(screen.getByLabelText('Target roles'), 'Product Engineer');
    await user.type(screen.getByLabelText('Target locations'), 'Stockholm');
    await user.click(screen.getByRole('checkbox', { name: 'hybrid' }));
    await user.selectOptions(
      screen.getByLabelText('Work authorization status'),
      'work_permit',
    );
    await user.type(screen.getByLabelText('Authorized countries'), 'Sweden');
    await user.type(screen.getByLabelText('Core skills'), 'TypeScript\nSQL');
    await user.tab();
    await user.click(screen.getByText('Optional search filters'));
    await user.type(screen.getByLabelText('Hard exclusions'), 'Unpaid roles');
    await user.tab();
    expect(screen.getByText('1 active role lane')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /^Create profile$/ }));

    await screen.findByText(/Saved as version 1/);
    expect(savedRequests[0]).toMatchObject({
      basics: { data: { displayName: 'Robin North' }, confirmationStatus: 'confirmed' },
      preferences: {
        data: { targetRoles: ['Product Engineer'], exclusions: ['Unpaid roles'] },
        confirmationStatus: 'confirmed',
      },
      skills: [
        { data: { name: 'TypeScript', level: 'working' } },
        { data: { name: 'SQL', level: 'working' } },
      ],
    });

    await user.type(
      screen.getByLabelText('Professional headline'),
      'Fictional product engineer',
    );
    await user.click(screen.getByRole('button', { name: 'Save new version' }));

    await screen.findByText(/Saved as version 2/);
    expect(savedRequests[1]).toMatchObject({ baseVersion: 1 });
    await waitFor(() => expect(screen.getByText(/2 saved versions/)).toBeTruthy());
  });
});
