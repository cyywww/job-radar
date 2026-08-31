import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getAppConfig } from '@job-radar/config';
import { openDatabase, runMigrations } from '@job-radar/db';
import {
  confirmedProfileViewSchema,
  profileImportResponseSchema,
  profileSnapshotSchema,
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

describe('profile routes', () => {
  it('creates, edits, and reads immutable profile versions', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: createFictionalProfileInput(),
    });
    const created = profileSnapshotSchema.parse(createResponse.json());
    expect(createResponse.statusCode).toBe(201);

    const fixture = createFictionalProfileInput();
    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/api/profile',
      payload: {
        ...fixture,
        baseVersion: created.version,
        changeSummary: 'Edited through profile API',
        basics: {
          ...fixture.basics,
          data: { ...fixture.basics.data, headline: 'Fictional API editor' },
        },
      },
    });
    const updated = profileSnapshotSchema.parse(updateResponse.json());
    const versionOneResponse = await app.inject({
      method: 'GET',
      url: '/api/profile/versions/1',
    });
    const versionsResponse = await app.inject({
      method: 'GET',
      url: '/api/profile/versions',
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updated.version).toBe(2);
    expect(
      profileSnapshotSchema.parse(versionOneResponse.json()).basics.data.headline,
    ).toBe('Product engineer for imaginary services');
    expect(
      profileVersionsResponseSchema.parse(versionsResponse.json()).versions,
    ).toHaveLength(2);
  });

  it('keeps imported facts pending until explicit confirmation', async () => {
    const importResponse = await app.inject({
      method: 'POST',
      url: '/api/profile/import',
      payload: {
        sourceType: 'pasted_text',
        label: 'Fictional paste',
        text: 'Name: Robin North\nLocation: Stockholm',
      },
    });
    const imported = profileImportResponseSchema.parse(importResponse.json());
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: imported.draft,
    });
    const created = profileSnapshotSchema.parse(createResponse.json());
    const beforeConfirmation = confirmedProfileViewSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/profile/confirmed' })).json(),
    );

    expect(created.status).toBe('draft');
    expect(beforeConfirmation.basics).toBeNull();
    expect(beforeConfirmation.preferences).toBeNull();

    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/api/profile/confirm',
      payload: {
        baseVersion: created.version,
        factIds: [],
        confirmAllPending: true,
        changeSummary: 'Reviewed fictional import',
      },
    });
    const confirmed = profileSnapshotSchema.parse(confirmResponse.json());
    expect(confirmed.version).toBe(2);
    expect(confirmed.status).toBe('confirmed');
  });

  it('previews confirmed hard constraints without scoring jobs', async () => {
    const preferences = createFictionalProfileInput().preferences.data;
    const response = await app.inject({
      method: 'POST',
      url: '/api/preferences/preview',
      payload: { preferences, confirmationStatus: 'confirmed' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ready: true,
      exclusions: ['Unpaid roles', 'Full-time office attendance'],
    });
  });

  it('updates preferences through a new Profile version', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: createFictionalProfileInput(),
    });
    const created = profileSnapshotSchema.parse(createResponse.json());
    const sourceId = '10000000-0000-4000-8000-000000000099';
    const updateResponse = await app.inject({
      method: 'PUT',
      url: '/api/preferences',
      payload: {
        baseVersion: created.version,
        source: {
          id: sourceId,
          type: 'user_input',
          label: 'Fictional preference edit',
        },
        preferences: {
          id: created.preferences.id,
          sourceId,
          confirmationStatus: 'confirmed',
          data: {
            ...createFictionalProfileInput().preferences.data,
            exclusions: ['Night shifts'],
          },
        },
        changeSummary: 'Updated fictional hard exclusions',
      },
    });
    const currentPreferences = await app.inject({
      method: 'GET',
      url: '/api/preferences',
    });
    const versionOne = profileSnapshotSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/profile/versions/1' })).json(),
    );

    expect(profileSnapshotSchema.parse(updateResponse.json()).version).toBe(2);
    expect(currentPreferences.json()).toMatchObject({
      data: { exclusions: ['Night shifts'] },
    });
    expect(versionOne.preferences.data.exclusions).toEqual([
      'Unpaid roles',
      'Full-time office attendance',
    ]);
  });

  it('rejects invalid profile payloads and unsafe file paths', async () => {
    const invalidProfile = await app.inject({
      method: 'POST',
      url: '/api/profile',
      payload: { sources: [] },
    });
    const traversal = await app.inject({
      method: 'POST',
      url: '/api/profile/import/file',
      headers: {
        'content-type': 'text/plain',
        'x-file-name': '../resume.txt',
      },
      payload: 'Name: Robin North',
    });

    expect(invalidProfile.statusCode).toBe(400);
    expect(traversal.statusCode).toBe(400);
    expect(traversal.json()).toMatchObject({
      error: { code: 'PROFILE_FILE_NAME_INVALID' },
    });
  });

  it('enforces the local file import size limit', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/profile/import/file',
      headers: {
        'content-type': 'text/plain',
        'x-file-name': 'fictional-profile.txt',
      },
      payload: 'x'.repeat(512 * 1024 + 1),
    });

    expect(response.statusCode).toBe(413);
  });
});
