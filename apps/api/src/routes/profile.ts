import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { ProfileRepository, ProfileStoreError, type DatabaseClient } from '@job-radar/db';
import {
  AppError,
  confirmProfileRequestSchema,
  confirmedProfileViewSchema,
  createProfileResourceRequestSchema,
  deleteProfileResponseSchema,
  profileImportRequestSchema,
  profileImportResponseSchema,
  profileResourceSchema,
  profileSnapshotSchema,
  profilesResponseSchema,
  profileVersionsResponseSchema,
  updateProfileResourceRequestSchema,
} from '@job-radar/shared';

import {
  MAX_PROFILE_FILE_BYTES,
  validateProfileContentType,
  validateProfileFilename,
} from '../security/profile-import.js';
import { extractProfileDraft } from '../services/profile-import.js';
import type { ScoringCoordinator } from '../services/scoring-coordinator.js';

const profileParamsSchema = z.object({ id: z.string().uuid() }).strict();
const profileVersionParamsSchema = profileParamsSchema
  .extend({ version: z.coerce.number().int().positive() })
  .strict();

function mapStoreError(error: unknown): never {
  if (!(error instanceof ProfileStoreError)) throw error;

  const statusCode =
    error.code === 'PROFILE_VERSION_CONFLICT' ||
    error.code === 'PROFILE_NAME_EXISTS' ||
    error.code === 'PROFILE_LIMIT_REACHED'
      ? 409
      : error.code === 'PROFILE_REFERENCE_INVALID'
        ? 400
        : 404;
  throw new AppError(error.code, error.message, statusCode);
}

export async function registerProfileRoutes(
  app: FastifyInstance,
  database: DatabaseClient,
  scoring: ScoringCoordinator,
): Promise<void> {
  const repository = new ProfileRepository(database);

  app.get('/api/profile/confirmed', async () => {
    const profile = repository.getConfirmedView();
    if (!profile) throw new AppError('PROFILE_NOT_FOUND', 'Profile does not exist', 404);
    return confirmedProfileViewSchema.parse(profile);
  });

  app.post('/api/profiles/import', async (request) => {
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
    '/api/profiles/import/file',
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

  app.get('/api/profiles', async () =>
    profilesResponseSchema.parse({ profiles: repository.listProfiles() }),
  );

  app.post('/api/profiles', async (request, reply) => {
    try {
      const input = createProfileResourceRequestSchema.parse(request.body);
      const profile = repository.create(input.name, input.profile);
      scoring.onProfileVersionChanged(profile.id, profile.version);
      return reply.status(201).send(
        profileResourceSchema.parse({
          summary: repository.getSummary(profile.id),
          profile,
        }),
      );
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.get('/api/profiles/:id', async (request) => {
    try {
      const { id } = profileParamsSchema.parse(request.params);
      const profile = repository.get(id);
      if (!profile) {
        throw new ProfileStoreError('PROFILE_NOT_FOUND', 'Profile does not exist');
      }
      return profileResourceSchema.parse({
        summary: repository.getSummary(id),
        profile,
      });
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.put('/api/profiles/:id', async (request) => {
    try {
      const { id } = profileParamsSchema.parse(request.params);
      const input = updateProfileResourceRequestSchema.parse(request.body);
      const profile = repository.update(id, input.name, input.profile);
      scoring.onProfileVersionChanged(profile.id, profile.version);
      return profileResourceSchema.parse({
        summary: repository.getSummary(id),
        profile,
      });
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.post('/api/profiles/:id/confirm', async (request) => {
    try {
      const { id } = profileParamsSchema.parse(request.params);
      const profile = repository.confirm(
        id,
        confirmProfileRequestSchema.parse(request.body),
      );
      scoring.onProfileVersionChanged(profile.id, profile.version);
      return profileResourceSchema.parse({
        summary: repository.getSummary(id),
        profile,
      });
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.post('/api/profiles/:id/select', async (request) => {
    try {
      const { id } = profileParamsSchema.parse(request.params);
      const profile = repository.select(id);
      scoring.onProfileSelected(profile.id, profile.version);
      return profileResourceSchema.parse({
        summary: repository.getSummary(id),
        profile,
      });
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.delete('/api/profiles/:id', async (request) => {
    try {
      const { id } = profileParamsSchema.parse(request.params);
      const result = repository.delete(id);
      if (result.activeProfileId) {
        const activeProfile = repository.get(result.activeProfileId);
        if (activeProfile) {
          scoring.onProfileSelected(activeProfile.id, activeProfile.version);
        }
      }
      return deleteProfileResponseSchema.parse(result);
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.get('/api/profiles/:id/versions', async (request) => {
    try {
      const { id } = profileParamsSchema.parse(request.params);
      return profileVersionsResponseSchema.parse({
        versions: repository.listVersions(id),
      });
    } catch (error) {
      return mapStoreError(error);
    }
  });

  app.get('/api/profiles/:id/versions/:version', async (request) => {
    try {
      const { id, version } = profileVersionParamsSchema.parse(request.params);
      const profile = repository.getVersion(id, version);
      if (!profile) {
        throw new ProfileStoreError(
          'PROFILE_VERSION_NOT_FOUND',
          `Profile version ${version} does not exist`,
        );
      }
      return profileSnapshotSchema.parse(profile);
    } catch (error) {
      return mapStoreError(error);
    }
  });
}
