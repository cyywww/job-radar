import { describe, expect, it } from 'vitest';

import { computeProfileCompleteness } from './profile-completeness.js';
import {
  createProfileRequestSchema,
  jobPreferencesDataSchema,
  workExperienceDataSchema,
} from './profile.js';

const sourceId = '10000000-0000-4000-8000-000000000001';

describe('profile contracts', () => {
  it('rejects impossible work date ranges', () => {
    expect(() =>
      workExperienceDataSchema.parse({
        organization: 'Fictional Systems AB',
        title: 'Engineer',
        startDate: '2026-04',
        endDate: '2025-03',
        current: false,
      }),
    ).toThrow();
  });

  it('requires complete salary configuration', () => {
    expect(() =>
      jobPreferencesDataSchema.parse({
        targetRoles: [],
        targetLocations: [],
        workModes: [],
        minimumSalary: 60_000,
        workAuthorization: {
          countries: [],
          status: 'unknown',
          needsSponsorship: false,
        },
      }),
    ).toThrow();
  });

  it('rejects facts that reference an unknown evidence source', () => {
    expect(() =>
      createProfileRequestSchema.parse({
        sources: [{ id: sourceId, type: 'user_input', label: 'Manual entry' }],
        basics: {
          sourceId: '20000000-0000-4000-8000-000000000001',
          confirmationStatus: 'confirmed',
          data: { displayName: 'Robin North' },
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
      }),
    ).toThrow(/unknown evidence source/);
  });
});

describe('profile completeness', () => {
  it('does not count pending extracted facts as confirmed information', () => {
    const completeness = computeProfileCompleteness({
      basics: {
        sourceId,
        confirmationStatus: 'pending',
        data: {
          displayName: 'Robin North',
          currentLocation: 'Stockholm',
          summary: 'Fictional product engineer.',
        },
      },
      workExperiences: [],
      projects: [],
      skills: [
        {
          sourceId,
          confirmationStatus: 'pending',
          data: { name: 'TypeScript', level: 'advanced' },
        },
      ],
      languages: [],
      preferences: {
        sourceId,
        confirmationStatus: 'pending',
        data: {
          targetRoles: ['Product Engineer'],
          targetLocations: ['Stockholm'],
          workModes: ['hybrid'],
          maxCommuteMinutes: null,
          minimumSalary: null,
          salaryCurrency: null,
          salaryPeriod: null,
          workAuthorization: {
            countries: ['Sweden'],
            status: 'work_permit',
            needsSponsorship: false,
          },
          preferredIndustries: [],
          preferredCompanySizes: [],
          mustHaves: [],
          exclusions: [],
        },
      },
    });

    expect(completeness.score).toBe(0);
    expect(completeness.missing).toHaveLength(10);
  });
});
