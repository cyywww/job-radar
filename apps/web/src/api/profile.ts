import {
  deleteProfileResponseSchema,
  profileImportResponseSchema,
  profileResourceSchema,
  profilesResponseSchema,
  profileVersionsResponseSchema,
  type ConfirmProfileRequest,
  type CreateProfileRequest,
  type ProfileImportResponse,
  type ProfileResource,
  type ProfileSummary,
  type ProfileVersionSummary,
  type UpdateProfileRequest,
} from '@job-radar/shared';

import { requestJson, request } from './request.js';

export async function fetchProfiles(): Promise<ProfileSummary[]> {
  return profilesResponseSchema.parse(await requestJson('/api/profiles')).profiles;
}

export async function fetchProfile(profileId: string): Promise<ProfileResource> {
  return profileResourceSchema.parse(await requestJson(`/api/profiles/${profileId}`));
}

export async function createProfile(
  name: string,
  profile: CreateProfileRequest,
): Promise<ProfileResource> {
  return profileResourceSchema.parse(
    await requestJson('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name, profile }),
    }),
  );
}

export async function updateProfile(
  profileId: string,
  name: string,
  profile: UpdateProfileRequest,
): Promise<ProfileResource> {
  return profileResourceSchema.parse(
    await requestJson(`/api/profiles/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify({ name, profile }),
    }),
  );
}

export async function selectProfile(profileId: string): Promise<ProfileResource> {
  return profileResourceSchema.parse(
    await requestJson(`/api/profiles/${profileId}/select`, { method: 'POST' }),
  );
}

export async function deleteProfile(profileId: string): Promise<{
  deletedId: string;
  activeProfileId: string | null;
}> {
  return deleteProfileResponseSchema.parse(
    await requestJson(`/api/profiles/${profileId}`, { method: 'DELETE' }),
  );
}

export async function confirmProfile(
  profileId: string,
  input: ConfirmProfileRequest,
): Promise<ProfileResource> {
  return profileResourceSchema.parse(
    await requestJson(`/api/profiles/${profileId}/confirm`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function fetchProfileVersions(
  profileId: string,
): Promise<ProfileVersionSummary[]> {
  return profileVersionsResponseSchema.parse(
    await requestJson(`/api/profiles/${profileId}/versions`),
  ).versions;
}

export async function importPastedProfile(text: string): Promise<ProfileImportResponse> {
  return profileImportResponseSchema.parse(
    await requestJson('/api/profiles/import', {
      method: 'POST',
      body: JSON.stringify({
        sourceType: 'pasted_text',
        label: 'Pasted profile text',
        text,
      }),
    }),
  );
}

export async function importProfileFile(file: File): Promise<ProfileImportResponse> {
  const response = await request('/api/profiles/import/file', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': file.type || 'text/plain',
      'x-file-name': file.name,
    },
    body: file,
  });
  return profileImportResponseSchema.parse(await response.json());
}
