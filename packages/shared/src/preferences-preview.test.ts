import { describe, expect, it } from 'vitest';

import { previewPreferences } from './preferences-preview.js';
import type { JobPreferencesData } from './profile.js';

const basePreferences: JobPreferencesData = {
  targetRoles: ['Product Engineer'],
  targetLocations: ['Stockholm'],
  workModes: ['hybrid'],
  maxCommuteMinutes: 45,
  minimumSalary: null,
  salaryCurrency: null,
  salaryPeriod: null,
  workAuthorization: {
    countries: ['Sweden'],
    status: 'work_permit' as const,
    needsSponsorship: false,
  },
  preferredIndustries: ['Climate technology'],
  preferredCompanySizes: ['mid_size'],
  mustHaves: ['Permanent employment'],
  exclusions: ['Unpaid roles'],
};

describe('preferences preview', () => {
  it('builds deterministic search terms and hard gates from confirmed preferences', () => {
    expect(
      previewPreferences({
        preferences: basePreferences,
        confirmationStatus: 'confirmed',
      }),
    ).toMatchObject({
      ready: true,
      searchTerms: ['Product Engineer', 'Stockholm', 'Climate technology'],
      hardConstraints: [
        'Must have: Permanent employment',
        'Maximum commute: 45 minutes',
        'Work authorization: work_permit',
      ],
      exclusions: ['Unpaid roles'],
      warnings: [],
    });
  });

  it('keeps pending or unknown preferences from becoming active gates', () => {
    const preview = previewPreferences({
      preferences: {
        ...basePreferences,
        workAuthorization: {
          countries: [],
          status: 'unknown',
          needsSponsorship: false,
        },
      },
      confirmationStatus: 'pending',
    });

    expect(preview.ready).toBe(false);
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/must be confirmed/i),
        expect.stringMatching(/work authorization/i),
      ]),
    );
    expect(preview.hardConstraints).not.toContain('Work authorization: unknown');
  });
});
