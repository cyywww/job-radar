import type { JobExtraction } from '@job-radar/shared';

type Fit = JobExtraction['roleFit'];

export interface ScoringEvalCase {
  readonly id: string;
  readonly label: string;
  readonly profile?: {
    readonly languages?: Array<{
      readonly name: string;
      readonly proficiency:
        'basic' | 'conversational' | 'professional' | 'fluent' | 'native';
    }>;
    readonly workModes?: Array<'onsite' | 'hybrid' | 'remote'>;
    readonly targetLocations?: string[];
    readonly authStatus?:
      'citizen' | 'permanent_resident' | 'work_permit' | 'needs_sponsorship' | 'unknown';
    readonly authCountries?: string[];
    readonly needsSponsorship?: boolean;
    readonly clearances?: string[];
    readonly excludedCompanies?: string[];
    readonly excludedRoleTypes?: string[];
    readonly targetCompanies?: string[];
    readonly preferredIndustries?: string[];
    readonly minimumSalary?: number | null;
  };
  readonly job?: {
    readonly active?: boolean;
    readonly company?: string;
    readonly title?: string;
    readonly location?: string;
    readonly remoteMode?: 'onsite' | 'hybrid' | 'remote' | 'unknown';
  };
  readonly extraction?: {
    readonly language?: string | null;
    readonly languageRequirement?: 'required' | 'preferred';
    readonly languageMinimum?:
      'basic' | 'conversational' | 'professional' | 'fluent' | 'native' | 'unknown';
    readonly authPolicy?: JobExtraction['workAuthorization']['policy'];
    readonly authCountries?: string[];
    readonly securityRequired?: boolean;
    readonly securityName?: string | null;
    readonly securityCitizenship?: string[];
    readonly workMode?: JobExtraction['locationPolicy']['workMode'];
    readonly remoteCountries?: string[];
    readonly roleFit?: Fit;
    readonly seniorityFit?: Fit;
    readonly confidence?: number;
    readonly unknownCount?: number;
    readonly evidenceDepth?: 'mentioned' | 'demonstrated' | 'outcome';
    readonly noRequiredSkills?: boolean;
  };
  readonly expected: {
    readonly eligible: boolean;
    readonly matchScore: readonly [number, number] | null;
  };
}

export const scoringEvalCases: readonly ScoringEvalCase[] = [
  {
    id: 'eval-01',
    label: 'baseline strong fictional match',
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-02',
    label: 'closed job hard Gate',
    job: { active: false },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-03',
    label: 'excluded company hard Gate',
    profile: { excludedCompanies: ['Fictional Northstar AB'] },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-04',
    label: 'excluded role type hard Gate',
    profile: { excludedRoleTypes: ['Product Engineer'] },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-05',
    label: 'no sponsorship with sponsorship need',
    profile: { authStatus: 'needs_sponsorship', needsSponsorship: true },
    extraction: { authPolicy: 'no_sponsorship' },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-06',
    label: 'authorization country mismatch',
    profile: { authCountries: ['Norway'] },
    extraction: { authPolicy: 'authorized_in_country', authCountries: ['Sweden'] },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-07',
    label: 'Swedish citizenship requirement satisfied',
    profile: { authStatus: 'citizen', authCountries: ['Sweden'] },
    extraction: { authPolicy: 'citizenship_required', authCountries: ['Sweden'] },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-08',
    label: 'citizenship requirement not satisfied',
    profile: { authStatus: 'permanent_resident', authCountries: ['Sweden'] },
    extraction: { authPolicy: 'citizenship_required', authCountries: ['Sweden'] },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-09',
    label: 'unknown authorization remains unknown',
    profile: { authStatus: 'unknown', authCountries: [] },
    extraction: { authPolicy: 'authorized_in_country', authCountries: ['Sweden'] },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-10',
    label: 'remote mode compatible',
    profile: { workModes: ['remote'] },
    job: { remoteMode: 'remote' },
    extraction: { workMode: 'remote' },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-11',
    label: 'remote country scope compatible',
    profile: { workModes: ['remote'], authCountries: ['Sweden'] },
    job: { remoteMode: 'remote' },
    extraction: { workMode: 'remote', remoteCountries: ['Sweden'] },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-12',
    label: 'remote country scope mismatch',
    profile: { workModes: ['remote'], authCountries: ['Norway'] },
    job: { remoteMode: 'remote' },
    extraction: { workMode: 'remote', remoteCountries: ['Sweden'] },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-13',
    label: 'onsite Stockholm compatible',
    profile: { workModes: ['onsite'], targetLocations: ['Stockholm'] },
    job: { remoteMode: 'onsite' },
    extraction: { workMode: 'onsite' },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-14',
    label: 'onsite location outside range',
    profile: { workModes: ['onsite'], targetLocations: ['Stockholm'] },
    job: { remoteMode: 'onsite', location: 'Gothenburg, Sweden' },
    extraction: { workMode: 'onsite' },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-15',
    label: 'remote-only preference rejects onsite',
    profile: { workModes: ['remote'] },
    job: { remoteMode: 'onsite' },
    extraction: { workMode: 'onsite' },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-16',
    label: 'unknown work mode stays eligible with uncertainty',
    job: { remoteMode: 'unknown' },
    extraction: { workMode: 'unknown' },
    expected: { eligible: true, matchScore: [90, 90] },
  },
  {
    id: 'eval-17',
    label: 'required English satisfied',
    extraction: { language: 'English', languageRequirement: 'required' },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-18',
    label: 'required English below level',
    profile: { languages: [{ name: 'English', proficiency: 'basic' }] },
    extraction: {
      language: 'English',
      languageRequirement: 'required',
      languageMinimum: 'professional',
    },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-19',
    label: 'missing required Swedish remains unknown',
    profile: { languages: [] },
    extraction: { language: 'Swedish', languageRequirement: 'required' },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-20',
    label: 'preferred Swedish does not Gate',
    profile: { languages: [] },
    extraction: { language: 'Swedish', languageRequirement: 'preferred' },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-21',
    label: 'security clearance satisfied',
    profile: { authStatus: 'citizen', authCountries: ['Sweden'], clearances: ['Alpha'] },
    extraction: {
      securityRequired: true,
      securityName: 'Alpha',
      securityCitizenship: ['Sweden'],
    },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-22',
    label: 'security clearance mismatch',
    profile: { authStatus: 'citizen', authCountries: ['Sweden'], clearances: ['Beta'] },
    extraction: { securityRequired: true, securityName: 'Alpha' },
    expected: { eligible: false, matchScore: null },
  },
  {
    id: 'eval-23',
    label: 'security clearance missing remains unknown',
    extraction: { securityRequired: true, securityName: 'Alpha' },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-24',
    label: 'outcome evidence earns full depth',
    extraction: { evidenceDepth: 'outcome' },
    expected: { eligible: true, matchScore: [100, 100] },
  },
  {
    id: 'eval-25',
    label: 'mentioned evidence earns bounded depth',
    extraction: { evidenceDepth: 'mentioned' },
    expected: { eligible: true, matchScore: [87, 87] },
  },
  {
    id: 'eval-26',
    label: 'partial role and seniority fit',
    extraction: { roleFit: 'partial', seniorityFit: 'partial' },
    expected: { eligible: true, matchScore: [81, 81] },
  },
  {
    id: 'eval-27',
    label: 'no role and seniority fit',
    extraction: { roleFit: 'none', seniorityFit: 'none' },
    expected: { eligible: true, matchScore: [63, 63] },
  },
  {
    id: 'eval-28',
    label: 'unknown seniority is neutral',
    extraction: { seniorityFit: 'unknown' },
    expected: { eligible: true, matchScore: [86, 86] },
  },
  {
    id: 'eval-29',
    label: 'low confidence keeps deterministic match score',
    extraction: { confidence: 0.4 },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-30',
    label: 'explicit unknowns affect ranking not match',
    extraction: { unknownCount: 2 },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-31',
    label: 'preferred industry miss is bounded',
    profile: { preferredIndustries: ['Imaginary health'] },
    expected: { eligible: true, matchScore: [91, 91] },
  },
  {
    id: 'eval-32',
    label: 'salary preference miss is bounded',
    profile: { minimumSalary: 900000 },
    expected: { eligible: true, matchScore: [91, 91] },
  },
  {
    id: 'eval-33',
    label: 'target company affects ranking only',
    profile: { targetCompanies: ['Fictional Northstar AB'] },
    expected: { eligible: true, matchScore: [93, 93] },
  },
  {
    id: 'eval-34',
    label: 'no extracted required skills uses neutral missing rule',
    extraction: { noRequiredSkills: true },
    expected: { eligible: true, matchScore: [65, 65] },
  },
] as const;
