import {
  eligibilityGateResultSchema,
  type ConfirmedProfileView,
  type EligibilityGateResult,
  type GateReason,
  type JobExtraction,
  type ScoringJobInput,
} from '@job-radar/shared';

const proficiencyRank = {
  basic: 1,
  conversational: 2,
  professional: 3,
  fluent: 4,
  native: 5,
  unknown: 0,
} as const;

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  const normalized = new Set(left.map(normalize).filter(Boolean));
  return right.some((value) => normalized.has(normalize(value)));
}

function locationMatches(candidate: readonly string[], jobLocation: string): boolean {
  const job = normalize(jobLocation);
  return candidate.some((value) => {
    const target = normalize(value);
    return (
      target !== '' && (job === target || job.includes(target) || target.includes(job))
    );
  });
}

function workAuthorizationReasons(
  profile: ConfirmedProfileView,
  extraction: JobExtraction,
): GateReason[] {
  const preference = profile.preferences?.data.workAuthorization;
  const requirement = extraction.workAuthorization;
  if (
    requirement.policy === 'not_stated' ||
    requirement.policy === 'sponsorship_available'
  ) {
    return [
      {
        code: 'work_authorization',
        outcome: 'pass',
        explanation:
          requirement.policy === 'sponsorship_available'
            ? 'The posting explicitly allows sponsorship.'
            : 'The posting states no work-authorization restriction.',
      },
    ];
  }
  if (
    requirement.policy === 'no_sponsorship' &&
    (preference?.needsSponsorship || preference?.status === 'needs_sponsorship')
  ) {
    return [
      {
        code: 'work_authorization',
        outcome: 'fail',
        explanation:
          'The posting explicitly offers no sponsorship, while the confirmed Profile requires sponsorship.',
      },
    ];
  }
  if (!preference || preference.status === 'unknown') {
    return [
      {
        code:
          requirement.policy === 'citizenship_required'
            ? 'citizenship'
            : 'work_authorization',
        outcome: 'unknown',
        explanation:
          'The posting has an authorization condition, but the confirmed Profile is insufficient to decide it.',
      },
    ];
  }
  if (requirement.policy === 'unknown') {
    return [
      {
        code: 'work_authorization',
        outcome: 'unknown',
        explanation:
          'The posting mentions authorization but does not state a decidable policy.',
      },
    ];
  }
  const countryRequired = requirement.countries.length > 0;
  const countryMatch = overlaps(preference.countries, requirement.countries);
  if (requirement.policy === 'citizenship_required') {
    const passes = preference.status === 'citizen' && (!countryRequired || countryMatch);
    return [
      {
        code: 'citizenship',
        outcome: passes ? 'pass' : 'fail',
        explanation: passes
          ? 'Confirmed citizenship satisfies the explicit posting condition.'
          : 'Confirmed citizenship does not satisfy the posting’s explicit citizenship condition.',
      },
    ];
  }
  if (countryRequired && !countryMatch) {
    return [
      {
        code: 'work_authorization',
        outcome: 'fail',
        explanation:
          'Confirmed work authorization does not cover a country required by the posting.',
      },
    ];
  }
  return [
    {
      code: 'work_authorization',
      outcome: 'pass',
      explanation:
        'Confirmed work authorization satisfies the posting’s explicit condition.',
    },
  ];
}

function locationReasons(
  profile: ConfirmedProfileView,
  job: ScoringJobInput,
  extraction: JobExtraction,
): GateReason[] {
  const preferences = profile.preferences?.data;
  if (!preferences || preferences.workModes.length === 0) {
    return [
      {
        code: 'remote_compatibility',
        outcome: 'unknown',
        explanation: 'The confirmed Profile has no work-mode constraint to compare.',
      },
    ];
  }
  const extractedMode = extraction.locationPolicy.workMode;
  if (
    job.remoteMode !== 'unknown' &&
    extractedMode !== 'unknown' &&
    extractedMode !== 'mixed' &&
    job.remoteMode !== extractedMode
  ) {
    return [
      {
        code: 'remote_compatibility',
        outcome: 'unknown',
        explanation:
          'The structured posting mode conflicts with the explicit work mode extracted from the current job snapshot.',
      },
    ];
  }
  const jobMode: 'onsite' | 'hybrid' | 'remote' | 'mixed' | 'unknown' =
    job.remoteMode === 'unknown' ? extractedMode : job.remoteMode;
  if (jobMode === 'unknown' || jobMode === 'mixed') {
    return [
      {
        code: 'remote_compatibility',
        outcome: 'unknown',
        explanation: 'The posting does not state a single decidable work mode.',
      },
    ];
  }
  if (!preferences.workModes.includes(jobMode)) {
    return [
      {
        code: 'remote_compatibility',
        outcome: 'fail',
        explanation: `The posting requires ${jobMode} work, which is outside the confirmed work-mode preferences.`,
      },
    ];
  }
  if (jobMode === 'remote') {
    const restrictedCountries = extraction.locationPolicy.remoteCountries;
    if (restrictedCountries.length === 0) {
      return [
        {
          code: 'remote_compatibility',
          outcome: 'pass',
          explanation:
            'The posting’s remote mode is compatible with the confirmed work-mode preferences.',
        },
      ];
    }
    const authorization = preferences.workAuthorization;
    if (authorization.status === 'unknown' || authorization.countries.length === 0) {
      return [
        {
          code: 'location',
          outcome: 'unknown',
          explanation:
            'The remote posting is country-restricted, but the confirmed Profile cannot establish location eligibility.',
        },
      ];
    }
    const pass = overlaps(authorization.countries, restrictedCountries);
    return [
      {
        code: 'location',
        outcome: pass ? 'pass' : 'fail',
        explanation: pass
          ? 'Confirmed country eligibility matches the posting’s remote-country scope.'
          : 'Confirmed country eligibility is outside the posting’s explicit remote-country scope.',
      },
    ];
  }
  if (preferences.targetLocations.length === 0 || normalize(job.location) === '') {
    return [
      {
        code: 'location',
        outcome: 'unknown',
        explanation:
          'An onsite or hybrid location cannot be decided from the confirmed Profile and posting.',
      },
    ];
  }
  const pass = locationMatches(preferences.targetLocations, job.location);
  return [
    {
      code: 'location',
      outcome: pass ? 'pass' : 'fail',
      explanation: pass
        ? 'The posting location is within the confirmed target locations.'
        : 'The posting location is outside the confirmed target locations and is not fully remote.',
    },
  ];
}

function languageReasons(
  profile: ConfirmedProfileView,
  extraction: JobExtraction,
): GateReason[] {
  const required = extraction.languages.filter(
    ({ requirement }) => requirement === 'required',
  );
  if (required.length === 0) {
    return [
      {
        code: 'required_language',
        outcome: 'pass',
        explanation: 'The posting states no mandatory language requirement.',
      },
    ];
  }
  return required.map((requirement): GateReason => {
    const language = profile.languages.find(
      ({ data }) => normalize(data.name) === normalize(requirement.language),
    );
    if (!language) {
      return {
        code: 'required_language',
        outcome: 'unknown',
        explanation: `The posting requires ${requirement.language}, but the confirmed Profile has no fact that decides proficiency.`,
      };
    }
    if (requirement.minimumProficiency === 'unknown') {
      return {
        code: 'required_language',
        outcome: 'pass',
        explanation: `The confirmed Profile includes the required language ${requirement.language}.`,
      };
    }
    const pass =
      proficiencyRank[language.data.proficiency] >=
      proficiencyRank[requirement.minimumProficiency];
    return {
      code: 'required_language',
      outcome: pass ? 'pass' : 'fail',
      explanation: pass
        ? `Confirmed ${requirement.language} proficiency meets the explicit minimum.`
        : `Confirmed ${requirement.language} proficiency is below the explicit minimum.`,
    };
  });
}

function securityReasons(
  profile: ConfirmedProfileView,
  extraction: JobExtraction,
): GateReason[] {
  const requirement = extraction.securityClearance;
  if (!requirement.required) {
    return [
      {
        code: 'security_clearance',
        outcome: 'pass',
        explanation: 'The posting states no mandatory security clearance.',
      },
    ];
  }
  const authorization = profile.preferences?.data.workAuthorization;
  const clearances = authorization?.securityClearances ?? [];
  if (clearances.length === 0) {
    return [
      {
        code: 'security_clearance',
        outcome: 'unknown',
        explanation:
          'The posting requires a security clearance, but the confirmed Profile has no clearance fact.',
      },
    ];
  }
  const namedMatch =
    requirement.name === null ||
    clearances.some((clearance) => normalize(clearance) === normalize(requirement.name!));
  const citizenshipMatch =
    requirement.citizenshipCountries.length === 0 ||
    (authorization?.status === 'citizen' &&
      overlaps(authorization.countries, requirement.citizenshipCountries));
  const pass = namedMatch && citizenshipMatch;
  return [
    {
      code: 'security_clearance',
      outcome: pass ? 'pass' : 'fail',
      explanation: pass
        ? 'A confirmed clearance and citizenship condition satisfy the posting.'
        : 'Confirmed clearance or citizenship facts do not satisfy the posting’s explicit condition.',
    },
  ];
}

export interface GateInput {
  readonly profile: ConfirmedProfileView;
  readonly job: ScoringJobInput;
  readonly extraction: JobExtraction;
}

export function evaluateEligibility(input: GateInput): EligibilityGateResult {
  const preferences = input.profile.preferences?.data;
  const companyExcluded = Boolean(
    preferences &&
    [...(preferences.excludedCompanies ?? []), ...preferences.exclusions].some(
      (value) => normalize(value) === normalize(input.job.company),
    ),
  );
  const roleExcluded = Boolean(
    preferences &&
    [...(preferences.excludedRoleTypes ?? []), ...preferences.exclusions].some(
      (value) => {
        const exclusion = normalize(value);
        return exclusion !== '' && normalize(input.job.title).includes(exclusion);
      },
    ),
  );
  const reasons: GateReason[] = [
    {
      code: 'job_closed',
      outcome: input.job.active ? 'pass' : 'fail',
      explanation: input.job.active
        ? 'The job is currently open.'
        : 'The job is closed and cannot be eligible.',
    },
    {
      code: 'company_excluded',
      outcome: companyExcluded ? 'fail' : 'pass',
      explanation: companyExcluded
        ? 'The company is explicitly excluded by confirmed preferences.'
        : 'The company is not explicitly excluded.',
    },
    {
      code: 'role_type_excluded',
      outcome: roleExcluded ? 'fail' : 'pass',
      explanation: roleExcluded
        ? 'The role type is explicitly excluded by confirmed preferences.'
        : 'The role type is not explicitly excluded.',
    },
    ...workAuthorizationReasons(input.profile, input.extraction),
    ...locationReasons(input.profile, input.job, input.extraction),
    ...languageReasons(input.profile, input.extraction),
    ...securityReasons(input.profile, input.extraction),
  ];
  return eligibilityGateResultSchema.parse({
    eligible: !reasons.some(({ outcome }) => outcome === 'fail'),
    reasons,
  });
}
