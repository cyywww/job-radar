import { auditExtraction } from './audit.js';
import { calculateDeterministicScore } from './engine.js';
import { scoringEvalCases, type ScoringEvalCase } from './eval-cases.js';
import { fictionalExtraction, fictionalJob, fictionalProfile } from './fixtures.js';
import { evaluateEligibility } from './gate.js';
import { EXTRACTOR_VERSION, SCORING_VERSION } from './version.js';

export interface ScoringEvalResult {
  readonly id: string;
  readonly passed: boolean;
  readonly eligible: boolean;
  readonly matchScore: number | null;
  readonly expectedEligible: boolean;
  readonly expectedRange: readonly [number, number] | null;
}

function materialize(entry: ScoringEvalCase) {
  const profile = fictionalProfile({
    ...(entry.profile?.languages ? { languages: [...entry.profile.languages] } : {}),
    ...(entry.profile?.workModes ? { workModes: [...entry.profile.workModes] } : {}),
    ...(entry.profile?.targetLocations
      ? { targetLocations: entry.profile.targetLocations }
      : {}),
    authorization: {
      countries: entry.profile?.authCountries ?? ['Sweden'],
      status: entry.profile?.authStatus ?? 'work_permit',
      needsSponsorship: entry.profile?.needsSponsorship ?? false,
      ...(entry.profile?.clearances
        ? { securityClearances: entry.profile.clearances }
        : {}),
    },
    ...(entry.profile?.excludedCompanies
      ? { excludedCompanies: entry.profile.excludedCompanies }
      : {}),
    ...(entry.profile?.excludedRoleTypes
      ? { excludedRoleTypes: entry.profile.excludedRoleTypes }
      : {}),
    ...(entry.profile?.targetCompanies
      ? { targetCompanies: entry.profile.targetCompanies }
      : {}),
    ...(entry.profile?.preferredIndustries
      ? { preferredIndustries: entry.profile.preferredIndustries }
      : {}),
    ...(entry.profile?.minimumSalary !== undefined
      ? { minimumSalary: entry.profile.minimumSalary }
      : {}),
  });
  const language = entry.extraction?.language;
  const securityRequired = entry.extraction?.securityRequired ?? false;
  const extraDescription = [
    language === 'Swedish' ? 'Swedish is required.' : '',
    securityRequired ? 'Alpha security clearance is required.' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const baseJob = fictionalJob();
  const job = fictionalJob({
    ...entry.job,
    descriptionText: `${baseJob.descriptionText}${extraDescription ? ` ${extraDescription}` : ''}`,
  });
  const extraction = fictionalExtraction({
    ...(language === null
      ? { languages: [] }
      : language
        ? {
            languages: [
              {
                id: `language-${language.toLocaleLowerCase('en')}`,
                language,
                requirement: entry.extraction?.languageRequirement ?? 'required',
                minimumProficiency: entry.extraction?.languageMinimum ?? 'professional',
                jdSnippet:
                  language === 'Swedish'
                    ? 'Swedish is required.'
                    : 'English is required.',
              },
            ],
          }
        : {}),
    workAuthorization: {
      policy: entry.extraction?.authPolicy ?? 'authorized_in_country',
      countries: entry.extraction?.authCountries ?? ['Sweden'],
      jdSnippet: 'Applicants must be authorized to work in Sweden.',
    },
    securityClearance: {
      required: securityRequired,
      name: entry.extraction?.securityName ?? null,
      citizenshipCountries: entry.extraction?.securityCitizenship ?? [],
      jdSnippet: securityRequired ? 'Alpha security clearance is required.' : null,
    },
    locationPolicy: {
      workMode: entry.extraction?.workMode ?? 'hybrid',
      locations: ['Stockholm'],
      remoteCountries: entry.extraction?.remoteCountries ?? [],
      onsiteDaysPerWeek: null,
      jdSnippet: 'Hybrid work in Stockholm.',
    },
    roleFit: entry.extraction?.roleFit ?? 'full',
    seniorityFit: entry.extraction?.seniorityFit ?? 'full',
    confidence: entry.extraction?.confidence ?? 0.9,
    unknowns: Array.from({ length: entry.extraction?.unknownCount ?? 0 }, (_, index) => ({
      code: `fictional_unknown_${index + 1}`,
      dimension: 'responsibilities' as const,
      question: `Can fictional unknown ${index + 1} be confirmed?`,
      explanation: 'The fictional posting does not provide enough information.',
    })),
    ...(entry.extraction?.evidenceDepth
      ? {
          matchedEvidence: fictionalExtraction().matchedEvidence.map((match, index) =>
            index === 0
              ? { ...match, evidenceDepth: entry.extraction!.evidenceDepth! }
              : match,
          ),
        }
      : {}),
    ...(entry.extraction?.noRequiredSkills
      ? {
          requiredSkills: [],
          matchedEvidence: fictionalExtraction().matchedEvidence.filter(
            ({ requirementId }) => requirementId !== 'skill-typescript',
          ),
        }
      : {}),
  });
  return { profile, job, extraction };
}

export function runScoringEvals(): ScoringEvalResult[] {
  return scoringEvalCases.map((entry) => {
    const materialized = materialize(entry);
    const extraction = auditExtraction({
      raw: materialized.extraction,
      profile: materialized.profile,
      job: materialized.job,
      extractorVersion: EXTRACTOR_VERSION,
    });
    const gate = evaluateEligibility({ ...materialized, extraction });
    const result = calculateDeterministicScore({
      ...materialized,
      extraction,
      gate,
      scoringVersion: SCORING_VERSION,
      rankingAsOf: new Date(materialized.job.fetchedAt),
    });
    const inRange =
      entry.expected.matchScore === null
        ? result.matchScore === null
        : result.matchScore !== null &&
          result.matchScore >= entry.expected.matchScore[0] &&
          result.matchScore <= entry.expected.matchScore[1];
    return {
      id: entry.id,
      passed: gate.eligible === entry.expected.eligible && inRange,
      eligible: gate.eligible,
      matchScore: result.matchScore,
      expectedEligible: entry.expected.eligible,
      expectedRange: entry.expected.matchScore,
    };
  });
}

if (process.argv[1]?.endsWith('eval-runner.ts')) {
  const results = runScoringEvals();
  const failed = results.filter(({ passed }) => !passed);
  console.log(
    JSON.stringify(
      { total: results.length, passed: results.length - failed.length, failed },
      null,
      2,
    ),
  );
  if (failed.length > 0) process.exitCode = 1;
}
