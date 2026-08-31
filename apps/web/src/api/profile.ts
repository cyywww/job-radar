import {
  confirmedProfileViewSchema,
  profileImportResponseSchema,
  profileSnapshotSchema,
  profileVersionsResponseSchema,
  type ConfirmedProfileView,
  type ConfirmProfileRequest,
  type CreateProfileRequest,
  type ProfileImportResponse,
  type ProfileSnapshot,
  type ProfileVersionSummary,
  type UpdateProfileRequest,
} from '@job-radar/shared';

export class ProfileApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProfileApiError';
  }
}

async function parseError(response: Response): Promise<ProfileApiError> {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return new ProfileApiError(
    response.status,
    body?.error?.message ?? `Request failed with HTTP ${response.status}`,
  );
}

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw await parseError(response);
  return response.json();
}

export async function fetchProfile(): Promise<ProfileSnapshot | null> {
  try {
    return profileSnapshotSchema.parse(await requestJson('/api/profile'));
  } catch (error) {
    if (error instanceof ProfileApiError && error.status === 404) return null;
    throw error;
  }
}

export async function createProfile(
  input: CreateProfileRequest,
): Promise<ProfileSnapshot> {
  return profileSnapshotSchema.parse(
    await requestJson('/api/profile', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function updateProfile(
  input: UpdateProfileRequest,
): Promise<ProfileSnapshot> {
  return profileSnapshotSchema.parse(
    await requestJson('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  );
}

export async function confirmProfile(
  input: ConfirmProfileRequest,
): Promise<ProfileSnapshot> {
  return profileSnapshotSchema.parse(
    await requestJson('/api/profile/confirm', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
}

export async function fetchProfileVersions(): Promise<ProfileVersionSummary[]> {
  return profileVersionsResponseSchema.parse(await requestJson('/api/profile/versions'))
    .versions;
}

export async function fetchConfirmedProfile(): Promise<ConfirmedProfileView> {
  return confirmedProfileViewSchema.parse(await requestJson('/api/profile/confirmed'));
}

export async function importPastedProfile(text: string): Promise<ProfileImportResponse> {
  return profileImportResponseSchema.parse(
    await requestJson('/api/profile/import', {
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
  const response = await fetch('/api/profile/import/file', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': file.type || 'text/plain',
      'x-file-name': file.name,
    },
    body: file,
  });
  if (!response.ok) throw await parseError(response);
  return profileImportResponseSchema.parse(await response.json());
}
