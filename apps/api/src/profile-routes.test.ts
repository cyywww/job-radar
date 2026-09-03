import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAppConfig } from '@job-radar/config';
import { openDatabase, runMigrations } from '@job-radar/db';
import {
  confirmedProfileViewSchema,
  deleteProfileResponseSchema,
  profileImportResponseSchema,
  profileResourceSchema,
  profileSnapshotSchema,
  profilesResponseSchema,
  profileVersionsResponseSchema,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import { buildApp } from './app.js';

let app: FastifyInstance;

beforeEach(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'job-radar-profile-api-'));
  const config = getAppConfig(
    {
      NODE_ENV: 'test',
      JOB_RADAR_DATABASE_PATH: join(directory, 'test.sqlite'),
      JOB_RADAR_WEB_DIST_DIR: join(directory, 'missing-web-dist'),
      JOB_RADAR_DATA_DIR: directory,
      JOB_RADAR_CONFIG_DIR: join(directory, 'config'),
      JOB_RADAR_LOG_DIR: join(directory, 'logs'),
    },
    '/workspace/job-radar',
  );
  const database = openDatabase(config.databasePath);
  runMigrations(database);
  app = await buildApp({ config, database, logger: false });
});

afterEach(async () => app.close());

function profileInputWithSource(sourceId: string) {
  const fixture = createFictionalProfileInput();
  const withSource = <T extends { sourceId: string }>(fact: T): T => ({
    ...fact,
    sourceId,
  });
  return {
    ...fixture,
    sources: fixture.sources.map((source) => ({ ...source, id: sourceId })),
    basics: withSource(fixture.basics),
    workExperiences: fixture.workExperiences.map(withSource),
    educationExperiences: fixture.educationExperiences.map(withSource),
    skills: fixture.skills.map(withSource),
    languages: fixture.languages.map(withSource),
    certifications: fixture.certifications.map(withSource),
    projects: fixture.projects.map(withSource),
    preferences: withSource(fixture.preferences),
  };
}

describe('profile routes', () => {
  it('creates, selects, renames, lists, and deletes multiple profiles', async () => {
    const productResponse = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Product roles', profile: createFictionalProfileInput() },
    });
    const product = profileResourceSchema.parse(productResponse.json());
    const backendResponse = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: {
        name: 'Backend roles',
        profile: profileInputWithSource('10000000-0000-4000-8000-000000000051'),
      },
    });
    const backend = profileResourceSchema.parse(backendResponse.json());

    expect(productResponse.statusCode).toBe(201);
    expect(backend.profile.version).toBe(2);
    expect(
      profilesResponseSchema
        .parse((await app.inject({ method: 'GET', url: '/api/profiles' })).json())
        .profiles.map(({ name, isActive }) => [name, isActive]),
    ).toEqual([
      ['Backend roles', true],
      ['Product roles', false],
    ]);

    const selectResponse = await app.inject({
      method: 'POST',
      url: `/api/profiles/${product.profile.id}/select`,
    });
    expect(profileResourceSchema.parse(selectResponse.json()).summary.isActive).toBe(
      true,
    );
    expect(
      confirmedProfileViewSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/profile/confirmed' })).json(),
      ).profileId,
    ).toBe(product.profile.id);

    const renameResponse = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${product.profile.id}`,
      payload: {
        name: 'Product and design roles',
        profile: {
          ...createFictionalProfileInput(),
          baseVersion: product.profile.version,
          changeSummary: 'Renamed a fictional strategy',
        },
      },
    });
    const renamed = profileResourceSchema.parse(renameResponse.json());
    expect(renamed.summary.name).toBe('Product and design roles');
    expect(renamed.profile.version).toBe(3);
    expect(
      profileVersionsResponseSchema
        .parse(
          (
            await app.inject({
              method: 'GET',
              url: `/api/profiles/${product.profile.id}/versions`,
            })
          ).json(),
        )
        .versions.map(({ version }) => version),
    ).toEqual([3, 1]);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: {
        name: 'Backend roles',
        profile: profileInputWithSource('10000000-0000-4000-8000-000000000052'),
      },
    });
    expect(duplicate.statusCode).toBe(409);

    const deleted = deleteProfileResponseSchema.parse(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/profiles/${product.profile.id}`,
        })
      ).json(),
    );
    expect(deleted).toEqual({
      deletedId: product.profile.id,
      activeProfileId: backend.profile.id,
    });
    expect(
      confirmedProfileViewSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/profile/confirmed' })).json(),
      ).profileId,
    ).toBe(backend.profile.id);
  });

  it('edits facts and preferences through one versioned Profile resource', async () => {
    const fixture = createFictionalProfileInput();
    const createdResponse = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Fictional profile', profile: fixture },
    });
    const created = profileResourceSchema.parse(createdResponse.json()).profile;
    expect(createdResponse.statusCode).toBe(201);
    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${created.id}`,
      payload: {
        name: 'Fictional profile',
        profile: {
          ...fixture,
          baseVersion: created.version,
          changeSummary: 'Edited facts and preferences together',
          basics: {
            ...fixture.basics,
            data: { ...fixture.basics.data, headline: 'Fictional API editor' },
          },
          preferences: {
            ...fixture.preferences,
            data: { ...fixture.preferences.data, exclusions: ['Night shifts'] },
          },
        },
      },
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = profileResourceSchema.parse(updateResponse.json()).profile;
    expect(updated.version).toBe(2);
    expect(updated.preferences.data.exclusions).toEqual(['Night shifts']);
    const original = profileSnapshotSchema.parse(
      (
        await app.inject({ method: 'GET', url: `/api/profiles/${created.id}/versions/1` })
      ).json(),
    );
    expect(original.basics.data.headline).toBe('Product engineer for imaginary services');
    expect(original.preferences.data.exclusions).toEqual(
      fixture.preferences.data.exclusions,
    );
    expect(
      profileVersionsResponseSchema.parse(
        (
          await app.inject({ method: 'GET', url: `/api/profiles/${created.id}/versions` })
        ).json(),
      ).versions,
    ).toHaveLength(2);
    const stale = await app.inject({
      method: 'PUT',
      url: `/api/profiles/${created.id}`,
      payload: { name: 'Fictional profile', profile: { ...fixture, baseVersion: 1 } },
    });
    expect(stale.statusCode).toBe(409);
  });

  it('keeps imported facts pending until explicit confirmation', async () => {
    const imported = profileImportResponseSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/profiles/import',
          payload: {
            sourceType: 'pasted_text',
            label: 'Fictional paste',
            text: 'Name: Robin North\nLocation: Stockholm',
          },
        })
      ).json(),
    );
    const created = profileResourceSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/profiles',
          payload: { name: 'Imported profile', profile: imported.draft },
        })
      ).json(),
    ).profile;
    const before = confirmedProfileViewSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/profile/confirmed' })).json(),
    );
    expect(created.status).toBe('draft');
    expect(before.basics).toBeNull();
    expect(before.preferences).toBeNull();
    const confirmed = profileResourceSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/profiles/${created.id}/confirm`,
          payload: {
            baseVersion: created.version,
            factIds: [],
            confirmAllPending: true,
            changeSummary: 'Reviewed fictional import',
          },
        })
      ).json(),
    ).profile;
    expect(confirmed.version).toBe(2);
    expect(confirmed.status).toBe('confirmed');
  });

  it('does not expose another Profile through its version URL', async () => {
    const first = profileResourceSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/profiles',
          payload: { name: 'First profile', profile: createFictionalProfileInput() },
        })
      ).json(),
    ).profile;
    const second = profileResourceSchema.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/profiles',
          payload: {
            name: 'Second profile',
            profile: profileInputWithSource('10000000-0000-4000-8000-000000000077'),
          },
        })
      ).json(),
    ).profile;
    const response = await app.inject({
      method: 'GET',
      url: `/api/profiles/${first.id}/versions/${second.version}`,
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects invalid profile payloads and unsafe file paths', async () => {
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      payload: { name: 'Invalid profile', profile: { sources: [] } },
    });
    const traversal = await app.inject({
      method: 'POST',
      url: '/api/profiles/import/file',
      headers: { 'content-type': 'text/plain', 'x-file-name': '../resume.txt' },
      payload: 'Name: Robin North',
    });
    expect(invalid.statusCode).toBe(400);
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json()).toMatchObject({
      error: { code: 'PROFILE_FILE_NAME_INVALID' },
    });
  });

  it('enforces the local file import size limit', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profiles/import/file',
      headers: { 'content-type': 'text/plain', 'x-file-name': 'fictional-profile.txt' },
      payload: 'x'.repeat(512 * 1024 + 1),
    });
    expect(response.statusCode).toBe(413);
  });
});
