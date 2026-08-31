import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ProfileRepository, ProfileStoreError, type DatabaseClient } from '@job-radar/db';
import {
  AppError,
  confirmProfileRequestSchema,
  confirmedProfileViewSchema,
  createProfileRequestSchema,
  jobPreferencesFactSchema,
  preferencesPreviewRequestSchema,
  preferencesPreviewResponseSchema,
  profileImportRequestSchema,
  profileImportResponseSchema,
  profileSnapshotSchema,
  profileVersionsResponseSchema,
  previewPreferences,
  updatePreferencesRequestSchema,
  updateProfileRequestSchema,
} from '@job-radar/shared';

import {
  MAX_PROFILE_FILE_BYTES,
  validateProfileContentType,
  validateProfileFilename,
} from '../security/profile-import.js';
import { extractProfileDraft } from '../services/profile-import.js';

const versionParamsSchema = z.object({ version: z.coerce.number().int().positive() });

function mapStoreError(error: unknown): never {
  if (!(error instanceof ProfileStoreError)) throw error;

  const statusCode =
    error.code === 'PROFILE_VERSION_CONFLICT'
      ? 409
      : error.code === 'PROFILE_EXISTS'
        ? 409
        : error.code === 'PROFILE_REFERENCE_INVALID'
          ? 400
          : 404;
  throw new AppError(error.code, error.message, statusCode);
}

export async function registerProfileRoutes(
  app: FastifyInstance,
  database: DatabaseClient,
): Promise<void> {
  const repository = new ProfileRepository(database);

  app.post('/api/profile', async (request, reply) => {
    try {
      const profile = repository.create(createProfileRequestSchema.parse(request.body));
      return reply.status(201).send(profileSnapshotSchema.parse(profile));
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.get('/api/profile', async () => {
    const profile = repository.getCurrent();
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 'Profile does not exist', 404);
    return profileSnapshotSchema.parse(profile);
  });

  app.put('/api/profile', async (request) => {
    try {
      return profileSnapshotSchema.parse(
        repository.update(updateProfileRequestSchema.parse(request.body)),
      );
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.post('/api/profile/confirm', async (request) => {
    try {
      return profileSnapshotSchema.parse(
        repository.confirm(confirmProfileRequestSchema.parse(request.body)),
      );
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.get('/api/profile/versions', async () => {
    try {
      return profileVersionsResponseSchema.parse({
        versions: repository.listVersions(),
      });
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.get('/api/profile/versions/:version', async (request) => {
    const { version } = versionParamsSchema.parse(request.params);
    const profile = repository.getVersion(version);
    if (!profile) {
      throw new AppError(
        'PROFILE_VERSION_NOT_FOUND',
        `Profile version ${version} does not exist`,
        404,
      );
    }
    return profileSnapshotSchema.parse(profile);
  });

  app.get('/api/profile/confirmed', async () => {
    const profile = repository.getConfirmedView();
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 'Profile does not exist', 404);
    return confirmedProfileViewSchema.parse(profile);
  });

  app.get('/api/preferences', async () => {
    const profile = repository.getCurrent();
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 'Profile does not exist', 404);
    return jobPreferencesFactSchema.parse(profile.preferences);
  });

  app.put('/api/preferences', async (request) => {
    try {
      return profileSnapshotSchema.parse(
        repository.updatePreferences(updatePreferencesRequestSchema.parse(request.body)),
      );
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.post('/api/preferences/preview', async (request) =>
    preferencesPreviewResponseSchema.parse(
      previewPreferences(preferencesPreviewRequestSchema.parse(request.body)),
    ),
  );

  app.post('/api/profile/import', async (request) => {
    const input = profileImportRequestSchema.parse(request.body);
    return profileImportResponseSchema.parse(
      extractProfileDraft({
        text: input.text,
        label: input.label,
        sourceType: input.sourceType,
      }),
    );
  });

  app.post(
    '/api/profile/import/file',
    { bodyLimit: MAX_PROFILE_FILE_BYTES },
    async (request) => {
      validateProfileContentType(request.headers['content-type']);
      const filename = validateProfileFilename(request.headers['x-file-name']);
      if (typeof request.body !== 'string' || request.body.trim().length === 0) {
        throw new AppError(
          'PROFILE_FILE_EMPTY',
          'The imported profile file is empty',
          400,
        );
      }

      return profileImportResponseSchema.parse(
        extractProfileDraft({
          text: request.body,
          label: `Local file: ${filename}`,
          sourceType: 'file_upload',
          originalFilename: filename,
        }),
      );
    },
  );
}
