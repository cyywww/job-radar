import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createProfileRequestSchema,
  updateProfileRequestSchema,
} from '@job-radar/shared';
import { createFictionalProfileInput } from '@job-radar/testing';

import type { DatabaseClient } from './database.js';
import { getMigrationsFolder, openDatabase, runMigrations } from './database.js';
import { JobRepository } from './job-repository.js';
import { ProfileRepository, ProfileStoreError } from './profile-repository.js';

let database: DatabaseClient;
let repository: ProfileRepository;

function profileInputWithSource(sourceId: string) {
  const fixture = createFictionalProfileInput();
  const withSource = <T extends { sourceId: string }>(fact: T): T => ({
    ...fact,
    sourceId,
  });
  return createProfileRequestSchema.parse({
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
  });
}

beforeEach(() => {
  const directory = mkdtempSync(join(tmpdir(), 'job-radar-profile-db-'));
  database = openDatabase(join(directory, 'test.sqlite'));
  runMigrations(database, getMigrationsFolder());
  repository = new ProfileRepository(database);
});

afterEach(() => database.close());

describe('ProfileRepository', () => {
  it('creates an immutable profile version and loads a complete snapshot', () => {
    const created = repository.create(
      'Fictional profile',
      createProfileRequestSchema.parse(createFictionalProfileInput()),
    );

    expect(created.version).toBe(1);
    expect(created.status).toBe('confirmed');
    expect(created.completeness.score).toBe(100);
    expect(repository.listVersions(created.id)).toHaveLength(1);
  });

  it('adds a version without changing the historical snapshot', () => {
    const created = repository.create(
      'Fictional profile',
      createProfileRequestSchema.parse(createFictionalProfileInput()),
    );
    const updated = repository.update(
      created.id,
      'Fictional profile',
      updateProfileRequestSchema.parse({
        ...createFictionalProfileInput(),
        baseVersion: created.version,
        changeSummary: 'Changed fictional headline',
        basics: {
          ...createFictionalProfileInput().basics,
          data: {
            ...createFictionalProfileInput().basics.data,
            headline: 'Updated fictional headline',
          },
        },
      }),
    );

    expect(updated.version).toBe(2);
    expect(updated.basics.data.headline).toBe('Updated fictional headline');
    expect(repository.getVersion(created.id, 1)?.basics.data.headline).toBe(
      'Product engineer for imaginary services',
    );
    expect(repository.listVersions(created.id).map(({ version }) => version)).toEqual([
      2, 1,
    ]);
  });

  it('confirms pending facts into a new version and isolates them beforehand', () => {
    const fixture = createFictionalProfileInput();
    const created = repository.create(
      'Fictional profile',
      createProfileRequestSchema.parse({
        ...fixture,
        basics: { ...fixture.basics, confirmationStatus: 'pending' },
        skills: fixture.skills.map((fact) => ({
          ...fact,
          confirmationStatus: 'pending',
        })),
      }),
    );

    expect(created.status).toBe('draft');
    expect(repository.getConfirmedView()?.basics).toBeNull();
    expect(repository.getConfirmedView()?.skills).toHaveLength(0);

    const confirmed = repository.confirm(created.id, {
      baseVersion: 1,
      factIds: [],
      confirmAllPending: true,
      changeSummary: 'Confirmed reviewed fictional facts',
    });

    expect(confirmed.version).toBe(2);
    expect(confirmed.status).toBe('confirmed');
    expect(repository.getConfirmedView()?.basics?.data.displayName).toBe('Robin North');
    expect(repository.getConfirmedView()?.skills).toHaveLength(1);
    expect(repository.getVersion(created.id, 1)?.basics.confirmationStatus).toBe(
      'pending',
    );
  });

  it('rejects stale writes', () => {
    const created = repository.create(
      'Fictional profile',
      createProfileRequestSchema.parse(createFictionalProfileInput()),
    );
    const stale = updateProfileRequestSchema.parse({
      ...createFictionalProfileInput(),
      baseVersion: 2,
    });

    expect(() => repository.update(created.id, 'Fictional profile', stale)).toThrowError(
      ProfileStoreError,
    );
  });

  it('keeps named profiles, selection, and version histories independent', () => {
    const product = repository.create(
      'Product roles',
      profileInputWithSource('10000000-0000-4000-8000-000000000011'),
    );
    const backend = repository.create(
      'Backend roles',
      profileInputWithSource('10000000-0000-4000-8000-000000000012'),
    );

    expect(product.version).toBe(1);
    expect(backend.version).toBe(2);
    expect(repository.getCurrent()?.id).toBe(backend.id);
    expect(
      repository.listProfiles().map(({ name, isActive }) => [name, isActive]),
    ).toEqual([
      ['Backend roles', true],
      ['Product roles', false],
    ]);

    repository.select(product.id);
    const updated = repository.update(
      product.id,
      'Product and design roles',
      updateProfileRequestSchema.parse({
        ...profileInputWithSource('10000000-0000-4000-8000-000000000011'),
        baseVersion: product.version,
        changeSummary: 'Focused the fictional product strategy',
      }),
    );

    expect(updated.version).toBe(3);
    expect(repository.listVersions(product.id).map(({ version }) => version)).toEqual([
      3, 1,
    ]);
    expect(repository.listVersions(backend.id).map(({ version }) => version)).toEqual([
      2,
    ]);
    expect(repository.getConfirmedView(backend.version)?.profileId).toBe(backend.id);

    const jobs = new JobRepository(database);
    const scan = jobs.createScan(
      updated.version,
      [jobs.ensureDefaultSources()],
      ['Fictional private target'],
    );
    const deleted = repository.delete(product.id);
    expect(deleted).toEqual({ deletedId: product.id, activeProfileId: backend.id });
    expect(repository.get(product.id)).toBeNull();
    expect(repository.getCurrent()?.id).toBe(backend.id);
    expect(
      database.sqlite
        .prepare('select count(*) as count from scan_runs where id = ?')
        .get(scan.id),
    ).toEqual({ count: 1 });
    expect(
      database.sqlite
        .prepare('select queries_json as queries from source_runs where scan_run_id = ?')
        .get(scan.id),
    ).toEqual({ queries: '[]' });

    const third = repository.create(
      'Platform roles',
      profileInputWithSource('10000000-0000-4000-8000-000000000013'),
    );
    expect(third.version).toBe(4);
  });

  it('rejects duplicate profile names', () => {
    repository.create(
      'Product roles',
      profileInputWithSource('10000000-0000-4000-8000-000000000021'),
    );

    expect(() =>
      repository.create(
        'Product roles',
        profileInputWithSource('10000000-0000-4000-8000-000000000022'),
      ),
    ).toThrowError(ProfileStoreError);
  });
});
