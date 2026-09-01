import { describe, expect, it } from 'vitest';

import { evaluateEligibility } from './gate.js';
import { fictionalExtraction, fictionalJob, fictionalProfile } from './fixtures.js';

describe('evaluateEligibility', () => {
  const cases = [
    {
      name: 'passes explicit authorization, location, language, and open-job conditions',
      profile: fictionalProfile(),
      job: fictionalJob(),
      extraction: fictionalExtraction(),
      eligible: true,
      reason: ['work_authorization', 'pass'],
    },
    {
      name: 'fails a closed job independently of matching quality',
      profile: fictionalProfile(),
      job: fictionalJob({ active: false }),
      extraction: fictionalExtraction(),
      eligible: false,
      reason: ['job_closed', 'fail'],
    },
    {
      name: 'fails an explicit no-sponsorship condition',
      profile: fictionalProfile({
        authorization: {
          countries: ['Sweden'],
          status: 'needs_sponsorship',
          needsSponsorship: true,
        },
      }),
      job: fictionalJob(),
      extraction: fictionalExtraction({
        workAuthorization: {
          policy: 'no_sponsorship',
          countries: ['Sweden'],
          jdSnippet: 'Applicants must be authorized to work in Sweden.',
        },
      }),
      eligible: false,
      reason: ['work_authorization', 'fail'],
    },
    {
      name: 'fails no-sponsorship when sponsorship need is confirmed but status is unknown',
      profile: fictionalProfile({
        authorization: {
          countries: [],
          status: 'unknown',
          needsSponsorship: true,
        },
      }),
      job: fictionalJob(),
      extraction: fictionalExtraction({
        workAuthorization: {
          policy: 'no_sponsorship',
          countries: [],
          jdSnippet: 'Applicants must be authorized to work in Sweden.',
        },
      }),
      eligible: false,
      reason: ['work_authorization', 'fail'],
    },
    {
      name: 'keeps missing required-language evidence unknown',
      profile: fictionalProfile({ languages: [] }),
      job: fictionalJob(),
      extraction: fictionalExtraction(),
      eligible: true,
      reason: ['required_language', 'unknown'],
    },
    {
      name: 'fails confirmed language proficiency below the explicit minimum',
      profile: fictionalProfile({
        languages: [{ name: 'English', proficiency: 'basic' }],
      }),
      job: fictionalJob(),
      extraction: fictionalExtraction(),
      eligible: false,
      reason: ['required_language', 'fail'],
    },
    {
      name: 'fails an explicitly excluded company',
      profile: fictionalProfile({ excludedCompanies: ['Fictional Northstar AB'] }),
      job: fictionalJob(),
      extraction: fictionalExtraction(),
      eligible: false,
      reason: ['company_excluded', 'fail'],
    },
    {
      name: 'keeps an unconfirmed security clearance unknown',
      profile: fictionalProfile(),
      job: fictionalJob(),
      extraction: fictionalExtraction({
        securityClearance: {
          required: true,
          name: 'Alpha',
          citizenshipCountries: ['Sweden'],
          jdSnippet: 'Applicants must be authorized to work in Sweden.',
        },
      }),
      eligible: true,
      reason: ['security_clearance', 'unknown'],
    },
    {
      name: 'keeps conflicting structured and extracted work modes unknown',
      profile: fictionalProfile({ workModes: ['remote'] }),
      job: fictionalJob({ remoteMode: 'remote' }),
      extraction: fictionalExtraction({
        locationPolicy: {
          workMode: 'onsite',
          locations: ['Stockholm'],
          remoteCountries: [],
          onsiteDaysPerWeek: 5,
          jdSnippet: 'Hybrid work in Stockholm.',
        },
      }),
      eligible: true,
      reason: ['remote_compatibility', 'unknown'],
    },
  ] as const;

  for (const entry of cases) {
    it(entry.name, () => {
      const result = evaluateEligibility(entry);
      expect(result.eligible).toBe(entry.eligible);
      expect(result.reasons).toContainEqual(
        expect.objectContaining({ code: entry.reason[0], outcome: entry.reason[1] }),
      );
    });
  }
});
