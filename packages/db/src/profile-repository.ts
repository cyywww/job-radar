import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';

import {
  basicFactSchema,
  certificationFactSchema,
  computeProfileCompleteness,
  educationExperienceFactSchema,
  evidenceSourceSchema,
  jobPreferencesFactSchema,
  languageFactSchema,
  profileSnapshotSchema,
  profileSummarySchema,
  projectExperienceFactSchema,
  skillFactSchema,
  workExperienceFactSchema,
  type ConfirmedProfileView,
  type ConfirmProfileRequest,
  type CreateProfileRequest,
  type EvidenceSourceInput,
  type JobPreferencesFactInput,
  type ProfileSnapshot,
  type ProfileSummary,
  type ProfileVersionSummary,
  type UpdateProfileRequest,
} from '@job-radar/shared';

import type { DatabaseClient } from './database.js';
import {
  jobRequirements,
  jobScores,
  profileEvidenceSources,
  profileFacts,
  profilePreferences,
  profiles,
  profileVersions,
  scanRuns,
  scoreFeedback,
  scoreReviewEvents,
  scoringAttempts,
  scoringTasks,
  sourceRuns,
} from './schema.js';

const PROFILE_LIMIT = 20;

type FactKind =
  | 'basics'
  | 'work_experience'
  | 'education_experience'
  | 'skill'
  | 'language'
  | 'certification'
  | 'project';

type SnapshotFact =
  | ProfileSnapshot['basics']
  | ProfileSnapshot['workExperiences'][number]
  | ProfileSnapshot['educationExperiences'][number]
  | ProfileSnapshot['skills'][number]
  | ProfileSnapshot['languages'][number]
  | ProfileSnapshot['certifications'][number]
  | ProfileSnapshot['projects'][number];

type ProfileUpdateContent = Omit<UpdateProfileRequest, 'baseVersion' | 'changeSummary'>;

export type ProfileStoreErrorCode =
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_NAME_EXISTS'
  | 'PROFILE_LIMIT_REACHED'
  | 'PROFILE_VERSION_NOT_FOUND'
  | 'PROFILE_VERSION_CONFLICT'
  | 'PROFILE_REFERENCE_INVALID';

export class ProfileStoreError extends Error {
  constructor(
    readonly code: ProfileStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProfileStoreError';
  }
}

function iso(date: Date): string {
  return date.toISOString();
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function sourceComparable(source: EvidenceSourceInput): string {
  return JSON.stringify(
    withoutUndefined({
      type: source.type,
      label: source.label,
      originalFilename: source.originalFilename,
      contentHash: source.contentHash,
    }),
  );
}

function factStatus(
  facts: Array<{ confirmationStatus: 'pending' | 'confirmed' | 'rejected' }>,
): 'draft' | 'confirmed' {
  return facts.some((fact) => fact.confirmationStatus === 'pending')
    ? 'draft'
    : 'confirmed';
}

function asFactInput(fact: SnapshotFact): {
  id: string;
  sourceId: string;
  confirmationStatus: 'pending' | 'confirmed' | 'rejected';
  evidenceExcerpt?: string | undefined;
  data: unknown;
} {
  return withoutUndefined({
    id: fact.id,
    sourceId: fact.sourceId,
    confirmationStatus: fact.confirmationStatus,
    evidenceExcerpt: fact.evidenceExcerpt,
    data: fact.data,
  });
}

function asPreferenceInput(
  fact: ProfileSnapshot['preferences'],
): JobPreferencesFactInput {
  return withoutUndefined({
    id: fact.id,
    sourceId: fact.sourceId,
    confirmationStatus: fact.confirmationStatus,
    evidenceExcerpt: fact.evidenceExcerpt,
    data: fact.data,
  });
}

function asSourceInput(source: ProfileSnapshot['sources'][number]): EvidenceSourceInput {
  return withoutUndefined({
    id: source.id,
    type: source.type,
    label: source.label,
    originalFilename: source.originalFilename,
    contentHash: source.contentHash,
  });
}

function snapshotToUpdateContent(snapshot: ProfileSnapshot): ProfileUpdateContent {
  return {
    sources: snapshot.sources.map(asSourceInput),
    basics: asFactInput(snapshot.basics) as ProfileUpdateContent['basics'],
    workExperiences: snapshot.workExperiences.map(
      (fact) => asFactInput(fact) as ProfileUpdateContent['workExperiences'][number],
    ),
    educationExperiences: snapshot.educationExperiences.map(
      (fact) => asFactInput(fact) as ProfileUpdateContent['educationExperiences'][number],
    ),
    skills: snapshot.skills.map(
      (fact) => asFactInput(fact) as ProfileUpdateContent['skills'][number],
    ),
    languages: snapshot.languages.map(
      (fact) => asFactInput(fact) as ProfileUpdateContent['languages'][number],
    ),
    certifications: snapshot.certifications.map(
      (fact) => asFactInput(fact) as ProfileUpdateContent['certifications'][number],
    ),
    projects: snapshot.projects.map(
      (fact) => asFactInput(fact) as ProfileUpdateContent['projects'][number],
    ),
    preferences: asPreferenceInput(snapshot.preferences),
  };
}

function allInputFacts(input: CreateProfileRequest | UpdateProfileRequest) {
  return [
    { kind: 'basics' as const, fact: input.basics },
    ...input.workExperiences.map((fact) => ({
      kind: 'work_experience' as const,
      fact,
    })),
    ...input.educationExperiences.map((fact) => ({
      kind: 'education_experience' as const,
      fact,
    })),
    ...input.skills.map((fact) => ({ kind: 'skill' as const, fact })),
    ...input.languages.map((fact) => ({ kind: 'language' as const, fact })),
    ...input.certifications.map((fact) => ({
      kind: 'certification' as const,
      fact,
    })),
    ...input.projects.map((fact) => ({ kind: 'project' as const, fact })),
  ];
}

export class ProfileRepository {
  constructor(private readonly client: DatabaseClient) {}

  listProfiles(): ProfileSummary[] {
    return this.client.db
      .select()
      .from(profiles)
      .orderBy(desc(profiles.isActive), desc(profiles.updatedAt), asc(profiles.name))
      .all()
      .map((profile) => this.summaryFromRecord(profile));
  }

  getCurrent(): ProfileSnapshot | null {
    const profile = this.activeRecord();
    return profile ? this.loadVersion(profile.id, profile.currentVersion) : null;
  }

  get(profileId: string): ProfileSnapshot | null {
    const profile = this.client.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get();
    return profile ? this.loadVersion(profile.id, profile.currentVersion) : null;
  }

  getVersion(profileId: string, version: number): ProfileSnapshot | null {
    return this.loadVersion(profileId, version);
  }

  create(name: string, input: CreateProfileRequest): ProfileSnapshot {
    this.assertNameAvailable(name);
    if (
      this.client.db.select({ id: profiles.id }).from(profiles).all().length >=
      PROFILE_LIMIT
    ) {
      throw new ProfileStoreError(
        'PROFILE_LIMIT_REACHED',
        `A maximum of ${PROFILE_LIMIT} profiles is supported`,
      );
    }

    const now = new Date();
    const profileId = randomUUID();
    const versionId = randomUUID();
    const version = this.nextGlobalVersion();

    this.client.sqlite.transaction(() => {
      this.client.db.update(profiles).set({ isActive: false }).run();
      this.client.db
        .insert(profiles)
        .values({
          id: profileId,
          name,
          isActive: true,
          currentVersion: version,
          currentVersionId: versionId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      this.persistVersion(profileId, versionId, version, input, now);
    })();

    return this.requireVersion(profileId, version);
  }

  update(profileId: string, name: string, input: UpdateProfileRequest): ProfileSnapshot {
    const profile = this.requireRecord(profileId);
    if (profile.currentVersion !== input.baseVersion) {
      throw new ProfileStoreError(
        'PROFILE_VERSION_CONFLICT',
        `Profile is at version ${profile.currentVersion}; reload before saving`,
      );
    }
    this.assertNameAvailable(name, profileId);

    const now = new Date();
    const nextVersion = this.nextGlobalVersion();
    const versionId = randomUUID();

    this.client.sqlite.transaction(() => {
      this.persistVersion(profile.id, versionId, nextVersion, input, now);
      this.client.db
        .update(profiles)
        .set({
          name,
          currentVersion: nextVersion,
          currentVersionId: versionId,
          updatedAt: now,
        })
        .where(eq(profiles.id, profile.id))
        .run();
    })();

    return this.requireVersion(profile.id, nextVersion);
  }

  confirm(profileId: string, input: ConfirmProfileRequest): ProfileSnapshot {
    const current = this.requireProfile(profileId);
    if (current.version !== input.baseVersion) {
      throw new ProfileStoreError(
        'PROFILE_VERSION_CONFLICT',
        `Profile is at version ${current.version}; reload before confirming`,
      );
    }

    const selected = new Set(input.factIds);
    const currentFacts: SnapshotFact[] = [
      current.basics,
      ...current.workExperiences,
      ...current.educationExperiences,
      ...current.skills,
      ...current.languages,
      ...current.certifications,
      ...current.projects,
    ];
    const allIds = new Set([
      ...currentFacts.map((fact) => fact.id),
      current.preferences.id,
    ]);
    const unknownId = input.factIds.find((id) => !allIds.has(id));
    if (unknownId) {
      throw new ProfileStoreError(
        'PROFILE_REFERENCE_INVALID',
        `Cannot confirm unknown fact ${unknownId}`,
      );
    }

    const content = snapshotToUpdateContent(current);
    const confirmFact = <
      T extends {
        id?: string | undefined;
        confirmationStatus: 'pending' | 'confirmed' | 'rejected';
      },
    >(
      fact: T,
    ): T =>
      (fact.confirmationStatus === 'pending' &&
      (input.confirmAllPending || (fact.id !== undefined && selected.has(fact.id)))
        ? { ...fact, confirmationStatus: 'confirmed' }
        : fact) as T;

    return this.update(profileId, this.requireRecord(profileId).name, {
      ...content,
      baseVersion: input.baseVersion,
      changeSummary: input.changeSummary,
      basics: confirmFact(content.basics),
      workExperiences: content.workExperiences.map(confirmFact),
      educationExperiences: content.educationExperiences.map(confirmFact),
      skills: content.skills.map(confirmFact),
      languages: content.languages.map(confirmFact),
      certifications: content.certifications.map(confirmFact),
      projects: content.projects.map(confirmFact),
      preferences: confirmFact(content.preferences),
    });
  }

  listVersions(profileId: string): ProfileVersionSummary[] {
    const profile = this.requireRecord(profileId);
    const versions = this.client.db
      .select()
      .from(profileVersions)
      .where(eq(profileVersions.profileId, profile.id))
      .orderBy(desc(profileVersions.version))
      .all();

    return versions.map((version) => {
      const facts = this.client.db
        .select({ status: profileFacts.confirmationStatus })
        .from(profileFacts)
        .where(eq(profileFacts.versionId, version.id))
        .all();
      const preference = this.client.db
        .select({ status: profilePreferences.confirmationStatus })
        .from(profilePreferences)
        .where(eq(profilePreferences.versionId, version.id))
        .get();
      const statuses = [...facts.map((fact) => fact.status), preference?.status].filter(
        (status): status is NonNullable<typeof status> => status !== undefined,
      );

      return {
        versionId: version.id,
        version: version.version,
        status: version.status,
        changeSummary: version.changeSummary,
        confirmedFactCount: statuses.filter((status) => status === 'confirmed').length,
        pendingFactCount: statuses.filter((status) => status === 'pending').length,
        createdAt: iso(version.createdAt),
      };
    });
  }

  getConfirmedView(version?: number): ConfirmedProfileView | null {
    const current =
      version === undefined ? this.getCurrent() : this.loadGlobalVersion(version);
    if (!current) return null;

    return {
      profileId: current.id,
      version: current.version,
      basics: current.basics.confirmationStatus === 'confirmed' ? current.basics : null,
      workExperiences: current.workExperiences.filter(
        (fact) => fact.confirmationStatus === 'confirmed',
      ),
      educationExperiences: current.educationExperiences.filter(
        (fact) => fact.confirmationStatus === 'confirmed',
      ),
      skills: current.skills.filter((fact) => fact.confirmationStatus === 'confirmed'),
      languages: current.languages.filter(
        (fact) => fact.confirmationStatus === 'confirmed',
      ),
      certifications: current.certifications.filter(
        (fact) => fact.confirmationStatus === 'confirmed',
      ),
      projects: current.projects.filter(
        (fact) => fact.confirmationStatus === 'confirmed',
      ),
      preferences:
        current.preferences.confirmationStatus === 'confirmed'
          ? current.preferences
          : null,
    };
  }

  select(profileId: string): ProfileSnapshot {
    const profile = this.requireRecord(profileId);
    if (!profile.isActive) {
      const now = new Date();
      this.client.sqlite.transaction(() => {
        this.client.db.update(profiles).set({ isActive: false }).run();
        this.client.db
          .update(profiles)
          .set({ isActive: true, updatedAt: now })
          .where(eq(profiles.id, profileId))
          .run();
      })();
    }
    return this.requireProfile(profileId);
  }

  delete(profileId: string): { deletedId: string; activeProfileId: string | null } {
    const profile = this.requireRecord(profileId);
    const versions = this.client.db
      .select({ version: profileVersions.version })
      .from(profileVersions)
      .where(eq(profileVersions.profileId, profileId))
      .all()
      .map(({ version }) => version);
    const fallback = profile.isActive
      ? this.client.db
          .select()
          .from(profiles)
          .where(ne(profiles.id, profileId))
          .orderBy(desc(profiles.updatedAt), asc(profiles.name))
          .get()
      : this.activeRecord();

    this.client.sqlite.transaction(() => {
      if (profile.isActive) {
        this.client.db
          .update(profiles)
          .set({ isActive: false })
          .where(eq(profiles.id, profileId))
          .run();
        if (fallback) {
          this.client.db
            .update(profiles)
            .set({ isActive: true, updatedAt: new Date() })
            .where(eq(profiles.id, fallback.id))
            .run();
        }
      }

      if (versions.length > 0) {
        const taskIds = this.client.db
          .select({ id: scoringTasks.id })
          .from(scoringTasks)
          .where(inArray(scoringTasks.profileVersion, versions))
          .all()
          .map(({ id }) => id);
        const scoreIds = this.client.db
          .select({ id: jobScores.id })
          .from(jobScores)
          .where(inArray(jobScores.profileVersion, versions))
          .all()
          .map(({ id }) => id);
        const scanIds = this.client.db
          .select({ id: scanRuns.id })
          .from(scanRuns)
          .where(inArray(scanRuns.profileVersion, versions))
          .all()
          .map(({ id }) => id);

        if (scoreIds.length > 0) {
          this.client.db
            .delete(scoreReviewEvents)
            .where(inArray(scoreReviewEvents.scoreId, scoreIds))
            .run();
          this.client.db
            .delete(scoreFeedback)
            .where(inArray(scoreFeedback.scoreId, scoreIds))
            .run();
        }
        if (taskIds.length > 0) {
          this.client.db
            .delete(scoringAttempts)
            .where(inArray(scoringAttempts.taskId, taskIds))
            .run();
        }
        this.client.db
          .delete(jobScores)
          .where(inArray(jobScores.profileVersion, versions))
          .run();
        this.client.db
          .delete(jobRequirements)
          .where(inArray(jobRequirements.profileVersion, versions))
          .run();
        this.client.db
          .delete(scoringTasks)
          .where(inArray(scoringTasks.profileVersion, versions))
          .run();
        if (scanIds.length > 0) {
          this.client.db
            .update(sourceRuns)
            .set({ queries: [] })
            .where(inArray(sourceRuns.scanRunId, scanIds))
            .run();
        }
      }

      this.client.db
        .delete(profileVersions)
        .where(eq(profileVersions.profileId, profileId))
        .run();
      this.client.db
        .delete(profileEvidenceSources)
        .where(eq(profileEvidenceSources.profileId, profileId))
        .run();
      this.client.db.delete(profiles).where(eq(profiles.id, profileId)).run();
    })();

    return { deletedId: profileId, activeProfileId: fallback?.id ?? null };
  }

  getSummary(profileId: string): ProfileSummary {
    return this.summaryFromRecord(this.requireRecord(profileId));
  }

  private requireProfile(profileId: string): ProfileSnapshot {
    const current = this.get(profileId);
    if (!current) {
      throw new ProfileStoreError('PROFILE_NOT_FOUND', 'Profile does not exist');
    }
    return current;
  }

  private requireRecord(profileId: string): typeof profiles.$inferSelect {
    const profile = this.client.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get();
    if (!profile) {
      throw new ProfileStoreError('PROFILE_NOT_FOUND', 'Profile does not exist');
    }
    return profile;
  }

  private activeRecord(): typeof profiles.$inferSelect | undefined {
    return this.client.db
      .select()
      .from(profiles)
      .where(eq(profiles.isActive, true))
      .get();
  }

  private assertNameAvailable(name: string, profileId?: string): void {
    const existing = this.client.db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.name, name))
      .get();
    if (existing && existing.id !== profileId) {
      throw new ProfileStoreError(
        'PROFILE_NAME_EXISTS',
        `A profile named “${name}” already exists`,
      );
    }
  }

  private nextGlobalVersion(): number {
    const latest = this.client.sqlite
      .prepare(
        `select max(version) as version from (
          select version from profile_versions
          union all
          select profile_version as version from scan_runs
        )`,
      )
      .get() as { version: number | null };
    return (latest?.version ?? 0) + 1;
  }

  private loadGlobalVersion(version: number): ProfileSnapshot | null {
    const record = this.client.db
      .select({ profileId: profileVersions.profileId })
      .from(profileVersions)
      .where(eq(profileVersions.version, version))
      .get();
    return record ? this.loadVersion(record.profileId, version) : null;
  }

  private summaryFromRecord(profile: typeof profiles.$inferSelect): ProfileSummary {
    const snapshot = this.requireVersion(profile.id, profile.currentVersion);
    return profileSummarySchema.parse({
      id: profile.id,
      name: profile.name,
      isActive: profile.isActive,
      version: snapshot.version,
      status: snapshot.status,
      headline: snapshot.basics.data.headline ?? null,
      targetRoles: snapshot.preferences.data.targetRoles,
      completeness: snapshot.completeness,
      createdAt: iso(profile.createdAt),
      updatedAt: iso(profile.updatedAt),
    });
  }

  private requireVersion(profileId: string, version: number): ProfileSnapshot {
    const snapshot = this.loadVersion(profileId, version);
    if (!snapshot) {
      throw new ProfileStoreError(
        'PROFILE_VERSION_NOT_FOUND',
        `Profile version ${version} does not exist`,
      );
    }
    return snapshot;
  }

  private persistVersion(
    profileId: string,
    versionId: string,
    version: number,
    input: CreateProfileRequest | UpdateProfileRequest,
    now: Date,
  ): void {
    this.persistSources(profileId, input.sources, now);
    const facts = allInputFacts(input);
    const status = factStatus([...facts.map(({ fact }) => fact), input.preferences]);

    this.client.db
      .insert(profileVersions)
      .values({
        id: versionId,
        profileId,
        version,
        status,
        changeSummary: input.changeSummary,
        createdAt: now,
      })
      .run();

    for (const { kind, fact } of facts) {
      this.client.db
        .insert(profileFacts)
        .values(
          withoutUndefined({
            evidenceId: randomUUID(),
            id: fact.id ?? randomUUID(),
            versionId,
            kind,
            data: fact.data,
            sourceId: fact.sourceId,
            confirmationStatus: fact.confirmationStatus,
            evidenceExcerpt: fact.evidenceExcerpt,
            updatedAt: now,
          }),
        )
        .run();
    }

    this.client.db
      .insert(profilePreferences)
      .values(
        withoutUndefined({
          evidenceId: randomUUID(),
          id: input.preferences.id ?? randomUUID(),
          versionId,
          data: input.preferences.data,
          sourceId: input.preferences.sourceId,
          confirmationStatus: input.preferences.confirmationStatus,
          evidenceExcerpt: input.preferences.evidenceExcerpt,
          updatedAt: now,
        }),
      )
      .run();
  }

  private persistSources(
    profileId: string,
    sources: EvidenceSourceInput[],
    now: Date,
  ): void {
    for (const source of sources) {
      const existing = this.client.db
        .select()
        .from(profileEvidenceSources)
        .where(eq(profileEvidenceSources.id, source.id))
        .get();
      if (existing) {
        const existingComparable = sourceComparable({
          id: existing.id,
          type: existing.type,
          label: existing.label,
          ...(existing.originalFilename
            ? { originalFilename: existing.originalFilename }
            : {}),
          ...(existing.contentHash ? { contentHash: existing.contentHash } : {}),
        });
        if (
          existing.profileId !== profileId ||
          existingComparable !== sourceComparable(source)
        ) {
          throw new ProfileStoreError(
            'PROFILE_REFERENCE_INVALID',
            `Evidence source ${source.id} is immutable or belongs to another profile`,
          );
        }
        continue;
      }

      this.client.db
        .insert(profileEvidenceSources)
        .values(
          withoutUndefined({
            ...source,
            profileId,
            createdAt: now,
          }),
        )
        .run();
    }
  }

  private loadVersion(profileId: string, versionNumber: number): ProfileSnapshot | null {
    const profile = this.client.db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profileId))
      .get();
    const version = this.client.db
      .select()
      .from(profileVersions)
      .where(
        and(
          eq(profileVersions.profileId, profileId),
          eq(profileVersions.version, versionNumber),
        ),
      )
      .get();
    if (!profile || !version) return null;

    const rows = this.client.db
      .select()
      .from(profileFacts)
      .where(eq(profileFacts.versionId, version.id))
      .orderBy(asc(profileFacts.updatedAt), asc(profileFacts.evidenceId))
      .all();
    const preferenceRow = this.client.db
      .select()
      .from(profilePreferences)
      .where(eq(profilePreferences.versionId, version.id))
      .get();
    if (!preferenceRow) {
      throw new ProfileStoreError(
        'PROFILE_REFERENCE_INVALID',
        `Profile version ${versionNumber} has no preferences`,
      );
    }

    const parseFact = (row: (typeof rows)[number]) => {
      const value = withoutUndefined({
        id: row.id,
        evidenceId: row.evidenceId,
        sourceId: row.sourceId,
        confirmationStatus: row.confirmationStatus,
        evidenceExcerpt: row.evidenceExcerpt ?? undefined,
        data: row.data,
        updatedAt: iso(row.updatedAt),
      });
      switch (row.kind) {
        case 'basics':
          return basicFactSchema.parse(value);
        case 'work_experience':
          return workExperienceFactSchema.parse(value);
        case 'education_experience':
          return educationExperienceFactSchema.parse(value);
        case 'skill':
          return skillFactSchema.parse(value);
        case 'language':
          return languageFactSchema.parse(value);
        case 'certification':
          return certificationFactSchema.parse(value);
        case 'project':
          return projectExperienceFactSchema.parse(value);
      }
    };

    const parsed = rows.map((row) => ({ kind: row.kind, fact: parseFact(row) }));
    const basics = parsed.find((item) => item.kind === 'basics')?.fact;
    if (!basics) {
      throw new ProfileStoreError(
        'PROFILE_REFERENCE_INVALID',
        `Profile version ${versionNumber} has no basics fact`,
      );
    }
    const preferences = jobPreferencesFactSchema.parse(
      withoutUndefined({
        id: preferenceRow.id,
        evidenceId: preferenceRow.evidenceId,
        sourceId: preferenceRow.sourceId,
        confirmationStatus: preferenceRow.confirmationStatus,
        evidenceExcerpt: preferenceRow.evidenceExcerpt ?? undefined,
        data: preferenceRow.data,
        updatedAt: iso(preferenceRow.updatedAt),
      }),
    );
    const sourceIds = new Set([
      ...rows.map((row) => row.sourceId),
      preferenceRow.sourceId,
    ]);
    const sourceRows = this.client.db
      .select()
      .from(profileEvidenceSources)
      .where(eq(profileEvidenceSources.profileId, profileId))
      .orderBy(asc(profileEvidenceSources.createdAt))
      .all()
      .filter((source) => sourceIds.has(source.id));
    const sources = sourceRows.map((source) =>
      evidenceSourceSchema.parse(
        withoutUndefined({
          id: source.id,
          type: source.type,
          label: source.label,
          originalFilename: source.originalFilename ?? undefined,
          contentHash: source.contentHash ?? undefined,
          createdAt: iso(source.createdAt),
        }),
      ),
    );

    const byKind = <T extends FactKind>(kind: T) =>
      parsed.filter((item) => item.kind === kind).map((item) => item.fact);
    const workExperiences = byKind('work_experience').map((fact) =>
      workExperienceFactSchema.parse(fact),
    );
    const educationExperiences = byKind('education_experience').map((fact) =>
      educationExperienceFactSchema.parse(fact),
    );
    const skills = byKind('skill').map((fact) => skillFactSchema.parse(fact));
    const languages = byKind('language').map((fact) => languageFactSchema.parse(fact));
    const certifications = byKind('certification').map((fact) =>
      certificationFactSchema.parse(fact),
    );
    const projects = byKind('project').map((fact) =>
      projectExperienceFactSchema.parse(fact),
    );
    const typedBasics = basicFactSchema.parse(basics);

    return profileSnapshotSchema.parse({
      id: profile.id,
      versionId: version.id,
      version: version.version,
      status: version.status,
      changeSummary: version.changeSummary,
      sources,
      basics: typedBasics,
      workExperiences,
      educationExperiences,
      skills,
      languages,
      certifications,
      projects,
      preferences,
      completeness: computeProfileCompleteness({
        basics: typedBasics,
        workExperiences,
        projects,
        skills,
        languages,
        preferences,
      }),
      createdAt: iso(profile.createdAt),
      updatedAt: iso(version.createdAt),
    });
  }
}
