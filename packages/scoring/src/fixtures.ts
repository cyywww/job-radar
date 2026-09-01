import {
  confirmedProfileViewSchema,
  jobExtractionSchema,
  scoringJobInputSchema,
  type ConfirmedProfileView,
  type JobExtraction,
  type ScoringJobInput,
} from '@job-radar/shared';

export const FIXTURE_SKILL_EVIDENCE_ID = '30000000-0000-4000-8000-000000000001';
export const FIXTURE_WORK_EVIDENCE_ID = '30000000-0000-4000-8000-000000000002';
export const FIXTURE_LANGUAGE_EVIDENCE_ID = '30000000-0000-4000-8000-000000000003';

export const FICTIONAL_JD = [
  'Build TypeScript services.',
  'Lead delivery for a fictional catalogue.',
  'English is required.',
  'Applicants must be authorized to work in Sweden.',
  'Hybrid work in Stockholm.',
  'Developer tools experience is required.',
  'React experience is preferred.',
  'Salary is SEK 800000 per year.',
].join(' ');

export function fictionalProfile(
  overrides: {
    languages?: Array<{
      name: string;
      proficiency: 'basic' | 'conversational' | 'professional' | 'fluent' | 'native';
    }>;
    workModes?: Array<'onsite' | 'hybrid' | 'remote'>;
    targetLocations?: string[];
    authorization?: {
      countries: string[];
      status:
        | 'citizen'
        | 'permanent_resident'
        | 'work_permit'
        | 'needs_sponsorship'
        | 'unknown';
      needsSponsorship: boolean;
      securityClearances?: string[];
    };
    targetCompanies?: string[];
    excludedCompanies?: string[];
    excludedRoleTypes?: string[];
    preferredIndustries?: string[];
    minimumSalary?: number | null;
    mustHaves?: string[];
  } = {},
): ConfirmedProfileView {
  const updatedAt = '2026-08-01T10:00:00.000Z';
  const sourceId = '10000000-0000-4000-8000-000000000001';
  const languages = overrides.languages ?? [
    { name: 'English', proficiency: 'fluent' as const },
  ];
  return confirmedProfileViewSchema.parse({
    profileId: '20000000-0000-4000-8000-000000000001',
    version: 1,
    basics: null,
    workExperiences: [
      {
        id: '21000000-0000-4000-8000-000000000001',
        evidenceId: FIXTURE_WORK_EVIDENCE_ID,
        sourceId,
        confirmationStatus: 'confirmed',
        data: {
          organization: 'Fictional Northstar AB',
          title: 'Product Engineer',
          startDate: '2021-01',
          current: true,
          summary: 'Led delivery for fictional developer tooling.',
        },
        updatedAt,
      },
    ],
    educationExperiences: [],
    skills: [
      {
        id: '21000000-0000-4000-8000-000000000002',
        evidenceId: FIXTURE_SKILL_EVIDENCE_ID,
        sourceId,
        confirmationStatus: 'confirmed',
        data: { name: 'TypeScript', level: 'advanced', yearsExperience: 6 },
        updatedAt,
      },
    ],
    languages: languages.map((data, index) => ({
      id: `21000000-0000-4000-8000-${String(index + 3).padStart(12, '0')}`,
      evidenceId:
        index === 0
          ? FIXTURE_LANGUAGE_EVIDENCE_ID
          : `30000000-0000-4000-8000-${String(index + 4).padStart(12, '0')}`,
      sourceId,
      confirmationStatus: 'confirmed',
      data,
      updatedAt,
    })),
    certifications: [],
    projects: [],
    preferences: {
      id: '21000000-0000-4000-8000-000000000010',
      evidenceId: '30000000-0000-4000-8000-000000000010',
      sourceId,
      confirmationStatus: 'confirmed',
      data: {
        targetRoles: ['Product Engineer'],
        targetLocations: overrides.targetLocations ?? ['Stockholm'],
        workModes: overrides.workModes ?? ['hybrid', 'remote'],
        maxCommuteMinutes: 45,
        minimumSalary:
          overrides.minimumSalary === undefined ? 720000 : overrides.minimumSalary,
        salaryCurrency: overrides.minimumSalary === null ? null : 'SEK',
        salaryPeriod: overrides.minimumSalary === null ? null : 'year',
        workAuthorization: overrides.authorization ?? {
          countries: ['Sweden'],
          status: 'work_permit',
          needsSponsorship: false,
        },
        preferredIndustries: overrides.preferredIndustries ?? ['Developer tools'],
        preferredCompanySizes: [],
        mustHaves: overrides.mustHaves ?? [],
        exclusions: [],
        targetCompanies: overrides.targetCompanies,
        excludedCompanies: overrides.excludedCompanies,
        excludedRoleTypes: overrides.excludedRoleTypes,
      },
      updatedAt,
    },
  });
}

export function fictionalJob(overrides: Partial<ScoringJobInput> = {}): ScoringJobInput {
  return scoringJobInputSchema.parse({
    jobId: '40000000-0000-4000-8000-000000000001',
    snapshotId: '50000000-0000-4000-8000-000000000001',
    company: 'Fictional Northstar AB',
    title: 'Product Engineer',
    location: 'Stockholm, Sweden',
    remoteMode: 'hybrid',
    employmentType: 'Full-time',
    publishedAt: '2026-08-30T08:00:00.000Z',
    active: true,
    descriptionText: FICTIONAL_JD,
    fetchedAt: '2026-09-01T08:00:00.000Z',
    ...overrides,
  });
}

export function fictionalExtraction(
  overrides: Partial<JobExtraction> = {},
): JobExtraction {
  return jobExtractionSchema.parse({
    requiredSkills: [
      {
        id: 'skill-typescript',
        name: 'TypeScript',
        minimumYears: null,
        jdSnippet: 'Build TypeScript services.',
      },
    ],
    preferredSkills: [
      {
        id: 'skill-react',
        name: 'React',
        minimumYears: null,
        jdSnippet: 'React experience is preferred.',
      },
    ],
    responsibilities: [
      {
        id: 'responsibility-delivery',
        text: 'Lead delivery',
        jdSnippet: 'Lead delivery for a fictional catalogue.',
      },
    ],
    seniority: 'senior',
    yearsRequired: null,
    languages: [
      {
        id: 'language-english',
        language: 'English',
        requirement: 'required',
        minimumProficiency: 'professional',
        jdSnippet: 'English is required.',
      },
    ],
    workAuthorization: {
      policy: 'authorized_in_country',
      countries: ['Sweden'],
      jdSnippet: 'Applicants must be authorized to work in Sweden.',
    },
    education: { required: false, level: 'unspecified', fields: [], jdSnippet: null },
    domain: [
      {
        id: 'domain-developer-tools',
        name: 'Developer tools',
        requirement: 'required',
        jdSnippet: 'Developer tools experience is required.',
      },
    ],
    locationPolicy: {
      workMode: 'hybrid',
      locations: ['Stockholm'],
      remoteCountries: [],
      onsiteDaysPerWeek: null,
      jdSnippet: 'Hybrid work in Stockholm.',
    },
    salary: {
      minimum: 800000,
      maximum: null,
      currency: 'SEK',
      period: 'year',
      jdSnippet: 'Salary is SEK 800000 per year.',
    },
    securityClearance: {
      required: false,
      name: null,
      citizenshipCountries: [],
      jdSnippet: null,
    },
    matchedEvidence: [
      {
        requirementId: 'skill-typescript',
        dimension: 'required_skills',
        jdSnippet: 'Build TypeScript services.',
        profileEvidenceId: FIXTURE_SKILL_EVIDENCE_ID,
        explanation: 'The confirmed skill directly matches the required technology.',
        evidenceDepth: 'demonstrated',
      },
      {
        requirementId: 'domain-developer-tools',
        dimension: 'domain',
        jdSnippet: 'Developer tools experience is required.',
        profileEvidenceId: FIXTURE_WORK_EVIDENCE_ID,
        explanation: 'Confirmed work experience is in fictional developer tooling.',
        evidenceDepth: 'outcome',
      },
    ],
    gaps: [
      {
        requirementId: 'skill-react',
        dimension: 'skill_depth',
        severity: 'preferred',
        requirement: 'React experience',
        explanation: 'The confirmed Profile does not contain React evidence.',
      },
    ],
    unknowns: [],
    seniorityFit: 'full',
    roleFit: 'full',
    confidence: 0.9,
    extractorVersion: 'codex-job-extractor-v1',
    ...overrides,
  });
}
