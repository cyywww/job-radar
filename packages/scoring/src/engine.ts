import {
  rankingFactorsSchema,
  scoreBreakdownSchema,
  type ConfirmedProfileView,
  type EligibilityGateResult,
  type JobExtraction,
  type RankingFactors,
  type ScoreBreakdown,
  type ScoringJobInput,
} from '@job-radar/shared';

import { SCORING_VERSION, SCORING_WEIGHTS } from './version.js';

const fitRatio = { full: 1, partial: 0.6, none: 0, unknown: 0.5 } as const;
const depthRatio = { mentioned: 0.33, demonstrated: 0.67, outcome: 1 } as const;

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function component(weight: number, ratio: number, explanation: string) {
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  return {
    weight,
    ratio: Number(boundedRatio.toFixed(4)),
    points: Math.round(weight * boundedRatio),
    explanation,
  };
}

function matchedRatio(ids: readonly string[], extraction: JobExtraction): number {
  if (ids.length === 0) return 0.5;
  const matched = new Set(
    extraction.matchedEvidence.map(({ requirementId }) => requirementId),
  );
  return ids.filter((id) => matched.has(id)).length / ids.length;
}

function skillDepthRatio(extraction: JobExtraction): number {
  const skills =
    extraction.requiredSkills.length > 0
      ? extraction.requiredSkills
      : extraction.preferredSkills;
  if (skills.length === 0) return 0.5;
  return (
    skills.reduce((total, skill) => {
      const depths = extraction.matchedEvidence
        .filter(({ requirementId }) => requirementId === skill.id)
        .map(({ evidenceDepth }) => depthRatio[evidenceDepth]);
      return total + (depths.length === 0 ? 0 : Math.max(...depths));
    }, 0) / skills.length
  );
}

function locationRatio(gate: EligibilityGateResult): number {
  const relevant = gate.reasons.filter(({ code }) =>
    ['location', 'remote_compatibility'].includes(code),
  );
  if (relevant.some(({ outcome }) => outcome === 'fail')) return 0;
  if (relevant.some(({ outcome }) => outcome === 'unknown')) return 0.5;
  return 1;
}

function softPreferenceRatio(
  profile: ConfirmedProfileView,
  extraction: JobExtraction,
): number {
  const preferences = profile.preferences?.data;
  if (!preferences) return 0.5;
  const checks: number[] = [];
  if (preferences.preferredIndustries.length > 0) {
    checks.push(
      extraction.domain.some(({ name }) =>
        preferences.preferredIndustries.some(
          (industry) => normalize(industry) === normalize(name),
        ),
      )
        ? 1
        : 0,
    );
  }
  if (
    preferences.minimumSalary !== null &&
    preferences.salaryCurrency !== null &&
    preferences.salaryPeriod !== null
  ) {
    const salary = extraction.salary;
    checks.push(
      salary.minimum === null || salary.currency === null || salary.period === null
        ? 0.5
        : salary.currency === preferences.salaryCurrency &&
            salary.period === preferences.salaryPeriod &&
            salary.minimum >= preferences.minimumSalary
          ? 1
          : 0,
    );
  }
  if (preferences.mustHaves.length > 0) {
    const requirementText = [
      ...extraction.requiredSkills.map(({ name }) => name),
      ...extraction.preferredSkills.map(({ name }) => name),
      ...extraction.responsibilities.map(({ text }) => text),
      ...extraction.domain.map(({ name }) => name),
    ]
      .map(normalize)
      .join(' ');
    checks.push(
      preferences.mustHaves.filter((value) => requirementText.includes(normalize(value)))
        .length / preferences.mustHaves.length,
    );
  }
  return checks.length === 0
    ? 0.5
    : checks.reduce((total, value) => total + value, 0) / checks.length;
}

export interface DeterministicScoreInput {
  readonly profile: ConfirmedProfileView;
  readonly job: ScoringJobInput;
  readonly extraction: JobExtraction;
  readonly gate: EligibilityGateResult;
  readonly scoringVersion: string;
  readonly rankingAsOf: Date;
}

export interface DeterministicScoreResult {
  readonly scoringVersion: string;
  readonly matchScore: number | null;
  readonly rankingScore: number | null;
  readonly breakdown: ScoreBreakdown | null;
  readonly rankingFactors: RankingFactors | null;
}

function freshnessBoost(publishedAt: string | null, rankingAsOf: Date): number {
  if (publishedAt === null) return 0;
  const ageMs = Math.max(0, rankingAsOf.getTime() - Date.parse(publishedAt));
  const days = ageMs / 86_400_000;
  if (days <= 1) return 5;
  if (days <= 3) return 4;
  if (days <= 7) return 3;
  if (days <= 14) return 2;
  if (days <= 30) return 1;
  return 0;
}

export function calculateDeterministicScore(
  input: DeterministicScoreInput,
): DeterministicScoreResult {
  if (input.scoringVersion !== SCORING_VERSION) {
    throw new Error(`Unsupported scoring version: ${input.scoringVersion}`);
  }
  if (!input.gate.eligible) {
    return {
      scoringVersion: input.scoringVersion,
      matchScore: null,
      rankingScore: null,
      breakdown: null,
      rankingFactors: null,
    };
  }
  const breakdown = scoreBreakdownSchema.parse({
    requiredSkills: component(
      SCORING_WEIGHTS.requiredSkills,
      matchedRatio(
        input.extraction.requiredSkills.map(({ id }) => id),
        input.extraction,
      ),
      'Required-skill points use the fraction of extracted required skills with audited evidence.',
    ),
    skillDepth: component(
      SCORING_WEIGHTS.skillDepth,
      skillDepthRatio(input.extraction),
      'Depth uses the strongest audited evidence per required skill: mentioned 0.33, demonstrated 0.67, outcome 1.00.',
    ),
    responsibilities: component(
      SCORING_WEIGHTS.responsibilities,
      fitRatio[input.extraction.roleFit],
      'Responsibility alignment maps full/partial/none/unknown to 1.00/0.60/0.00/0.50.',
    ),
    seniority: component(
      SCORING_WEIGHTS.seniority,
      fitRatio[input.extraction.seniorityFit],
      'Seniority alignment maps full/partial/none/unknown to 1.00/0.60/0.00/0.50.',
    ),
    domain: component(
      SCORING_WEIGHTS.domain,
      matchedRatio(
        input.extraction.domain
          .filter(({ requirement }) => requirement !== 'context')
          .map(({ id }) => id),
        input.extraction,
      ),
      'Domain points use audited evidence coverage; no stated domain is neutral at 0.50.',
    ),
    location: component(
      SCORING_WEIGHTS.location,
      locationRatio(input.gate),
      'Location uses only deterministic Gate outcomes: pass 1.00, unknown 0.50, fail 0.00.',
    ),
    softPreferences: component(
      SCORING_WEIGHTS.softPreferences,
      softPreferenceRatio(input.profile, input.extraction),
      'Soft preferences average configured industry, salary, and must-have matches; no configured check is neutral at 0.50.',
    ),
  });
  const matchScore = Object.values(breakdown).reduce(
    (total, value) => total + value.points,
    0,
  );
  const freshness = freshnessBoost(input.job.publishedAt, input.rankingAsOf);
  const targetCompany =
    input.profile.preferences?.data.targetCompanies?.some(
      (company) => normalize(company) === normalize(input.job.company),
    ) === true
      ? 3
      : 0;
  const uncertainty = Math.min(
    10,
    (input.extraction.unknowns.length +
      input.gate.reasons.filter(({ outcome }) => outcome === 'unknown').length) *
      2 +
      Math.round((1 - input.extraction.confidence) * 4),
  );
  const rankingFactors = rankingFactorsSchema.parse({
    freshnessBoost: freshness,
    targetCompanyBoost: targetCompany,
    uncertaintyPenalty: uncertainty,
  });
  return {
    scoringVersion: input.scoringVersion,
    matchScore,
    rankingScore: Math.max(
      0,
      Math.min(100, matchScore + freshness + targetCompany - uncertainty),
    ),
    breakdown,
    rankingFactors,
  };
}
