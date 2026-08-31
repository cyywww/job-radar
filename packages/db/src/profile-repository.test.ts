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
import { ProfileRepository, ProfileStoreError } from './profile-repository.js';

let database: DatabaseClient;
let repository: ProfileRepository;

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
      createProfileRequestSchema.parse(createFictionalProfileInput()),
    );

    expect(created.version).toBe(1);
    expect(created.status).toBe('confirmed');
    expect(created.completeness.score).toBe(100);
    expect(repository.listVersions()).toHaveLength(1);
  });

  it('adds a version without changing the historical snapshot', () => {
    const created = repository.create(
      createProfileRequestSchema.parse(createFictionalProfileInput()),
    );
    const updated = repository.update(
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
    expect(repository.getVersion(1)?.basics.data.headline).toBe(
      'Product engineer for imaginary services',
    );
    expect(repository.listVersions().map(({ version }) => version)).toEqual([2, 1]);
  });

  it('confirms pending facts into a new version and isolates them beforehand', () => {
    const fixture = createFictionalProfileInput();
    const created = repository.create(
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

    const confirmed = repository.confirm({
      baseVersion: 1,
      factIds: [],
      confirmAllPending: true,
      changeSummary: 'Confirmed reviewed fictional facts',
    });

    expect(confirmed.version).toBe(2);
    expect(confirmed.status).toBe('confirmed');
    expect(repository.getConfirmedView()?.basics?.data.displayName).toBe('Robin North');
    expect(repository.getConfirmedView()?.skills).toHaveLength(1);
    expect(repository.getVersion(1)?.basics.confirmationStatus).toBe('pending');
  });

  it('rejects stale writes', () => {
    repository.create(createProfileRequestSchema.parse(createFictionalProfileInput()));
    const stale = updateProfileRequestSchema.parse({
      ...createFictionalProfileInput(),
      baseVersion: 2,
    });

    expect(() => repository.update(stale)).toThrowError(ProfileStoreError);
  });
});
