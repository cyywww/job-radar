import {
  createProfileRequestSchema,
  type CreateProfileRequest,
  type EvidenceSourceInput,
  type ProfileSnapshot,
} from '@job-radar/shared';

function id(): string {
  return crypto.randomUUID();
}

export function createBlankProfileDraft(): CreateProfileRequest {
  const sourceId = id();
  return createProfileRequestSchema.parse({
    changeSummary: 'Created profile through onboarding',
    sources: [{ id: sourceId, type: 'user_input', label: 'Manual entry' }],
    basics: {
      sourceId,
      confirmationStatus: 'confirmed',
      data: { displayName: '' },
    },
    preferences: {
      sourceId,
      confirmationStatus: 'confirmed',
      data: {
        targetRoles: [],
        targetLocations: [],
        workModes: [],
        workAuthorization: {
          countries: [],
          status: 'unknown',
          needsSponsorship: false,
        },
      },
    },
  });
}

function sourceInput(source: ProfileSnapshot['sources'][number]): EvidenceSourceInput {
  return {
    id: source.id,
    type: source.type,
    label: source.label,
    ...(source.originalFilename ? { originalFilename: source.originalFilename } : {}),
    ...(source.contentHash ? { contentHash: source.contentHash } : {}),
  };
}

function factInput<T extends { evidenceId: string; updatedAt: string }>(
  fact: T,
): Omit<T, 'evidenceId' | 'updatedAt'> {
  const input = { ...fact } as Partial<T>;
  delete input.evidenceId;
  delete input.updatedAt;
  return input as Omit<T, 'evidenceId' | 'updatedAt'>;
}

export function snapshotToDraft(snapshot: ProfileSnapshot): CreateProfileRequest {
  return createProfileRequestSchema.parse({
    changeSummary: 'Updated profile in browser',
    sources: snapshot.sources.map(sourceInput),
    basics: factInput(snapshot.basics),
    workExperiences: snapshot.workExperiences.map(factInput),
    educationExperiences: snapshot.educationExperiences.map(factInput),
    skills: snapshot.skills.map(factInput),
    languages: snapshot.languages.map(factInput),
    certifications: snapshot.certifications.map(factInput),
    projects: snapshot.projects.map(factInput),
    preferences: factInput(snapshot.preferences),
  });
}

export function ensureManualSource(draft: CreateProfileRequest): {
  draft: CreateProfileRequest;
  sourceId: string;
} {
  const existing = draft.sources.find((source) => source.type === 'user_input');
  if (existing) return { draft, sourceId: existing.id };

  const source = { id: id(), type: 'user_input' as const, label: 'Manual entry' };
  return {
    draft: { ...draft, sources: [...draft.sources, source] },
    sourceId: source.id,
  };
}

export function newFactId(): string {
  return id();
}
