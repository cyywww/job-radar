import { describe, expect, it } from 'vitest';

import { calculateDeterministicScore } from './engine.js';
import { fictionalExtraction, fictionalJob, fictionalProfile } from './fixtures.js';
import { evaluateEligibility } from './gate.js';
import { SCORING_VERSION } from './version.js';

function score(overrides: Parameters<typeof fictionalExtraction>[0] = {}) {
  const profile = fictionalProfile({ targetCompanies: ['Fictional Northstar AB'] });
  const job = fictionalJob();
  const extraction = fictionalExtraction(overrides);
  const gate = evaluateEligibility({ profile, job, extraction });
  return calculateDeterministicScore({
    profile,
    job,
    extraction,
    gate,
    scoringVersion: SCORING_VERSION,
    rankingAsOf: new Date('2026-09-01T08:00:00.000Z'),
  });
}

describe('calculateDeterministicScore', () => {
  it('uses every fixed dimension and sums rounded integer points', () => {
    const result = score();
    expect(result.breakdown).not.toBeNull();
    expect(result.breakdown?.requiredSkills.weight).toBe(30);
    expect(result.breakdown?.skillDepth.points).toBe(13);
    expect(result.breakdown?.responsibilities.weight).toBe(15);
    expect(result.breakdown?.seniority.weight).toBe(15);
    expect(result.breakdown?.domain.weight).toBe(8);
    expect(result.breakdown?.location.weight).toBe(7);
    expect(result.breakdown?.softPreferences.weight).toBe(5);
    expect(result.matchScore).toBe(
      Object.values(result.breakdown!).reduce((total, item) => total + item.points, 0),
    );
    expect(Number.isInteger(result.matchScore)).toBe(true);
  });

  it('is reproducible for identical inputs and version', () => {
    expect(score()).toEqual(score());
  });

  it('keeps publication freshness out of matchScore', () => {
    const profile = fictionalProfile();
    const extraction = fictionalExtraction();
    const oldJob = fictionalJob({ publishedAt: '2025-01-01T00:00:00.000Z' });
    const newJob = fictionalJob({ publishedAt: '2026-09-01T07:30:00.000Z' });
    const calculate = (job: ReturnType<typeof fictionalJob>) =>
      calculateDeterministicScore({
        profile,
        job,
        extraction,
        gate: evaluateEligibility({ profile, job, extraction }),
        scoringVersion: SCORING_VERSION,
        rankingAsOf: new Date('2026-09-01T08:00:00.000Z'),
      });
    expect(calculate(oldJob).matchScore).toBe(calculate(newJob).matchScore);
    expect(calculate(oldJob).rankingFactors?.freshnessBoost).toBe(0);
    expect(calculate(newJob).rankingFactors?.freshnessBoost).toBe(5);
  });

  it('maps partial and unknown fits explicitly and rejects unknown versions', () => {
    const result = score({ roleFit: 'partial', seniorityFit: 'unknown' });
    expect(result.breakdown?.responsibilities.points).toBe(9);
    expect(result.breakdown?.seniority.points).toBe(8);
    const profile = fictionalProfile();
    const job = fictionalJob();
    const extraction = fictionalExtraction();
    expect(() =>
      calculateDeterministicScore({
        profile,
        job,
        extraction,
        gate: evaluateEligibility({ profile, job, extraction }),
        scoringVersion: 'future-unreviewed',
        rankingAsOf: new Date(),
      }),
    ).toThrow('Unsupported scoring version');
  });

  it('returns no numeric score when the deterministic Gate fails', () => {
    const profile = fictionalProfile();
    const job = fictionalJob({ active: false });
    const extraction = fictionalExtraction();
    const result = calculateDeterministicScore({
      profile,
      job,
      extraction,
      gate: evaluateEligibility({ profile, job, extraction }),
      scoringVersion: SCORING_VERSION,
      rankingAsOf: new Date(),
    });
    expect(result).toMatchObject({
      matchScore: null,
      rankingScore: null,
      breakdown: null,
      rankingFactors: null,
    });
  });

  it('applies neutral missing-value rules and clamps ranking to integer bounds', () => {
    const neutral = score({ requiredSkills: [], preferredSkills: [], domain: [] });
    expect(neutral.breakdown?.requiredSkills).toMatchObject({ ratio: 0.5, points: 15 });
    expect(neutral.breakdown?.skillDepth).toMatchObject({ ratio: 0.5, points: 10 });
    expect(neutral.breakdown?.domain).toMatchObject({ ratio: 0.5, points: 4 });

    const maximum = score({
      matchedEvidence: fictionalExtraction().matchedEvidence.map((match) => ({
        ...match,
        evidenceDepth: 'outcome' as const,
      })),
      confidence: 1,
    });
    expect(maximum.matchScore).toBe(100);
    expect(maximum.rankingScore).toBe(100);

    const profile = fictionalProfile({
      preferredIndustries: ['Imaginary health'],
      minimumSalary: 900_000,
    });
    const job = fictionalJob({ publishedAt: '2025-01-01T00:00:00.000Z' });
    const extraction = fictionalExtraction({
      matchedEvidence: [],
      roleFit: 'none',
      seniorityFit: 'none',
      confidence: 0,
      unknowns: Array.from({ length: 10 }, (_, index) => ({
        code: `unknown_${index}`,
        dimension: 'responsibilities' as const,
        question: 'Can this fictional condition be resolved?',
        explanation: 'The fictional input contains no supporting detail.',
      })),
    });
    const minimum = calculateDeterministicScore({
      profile,
      job,
      extraction,
      gate: evaluateEligibility({ profile, job, extraction }),
      scoringVersion: SCORING_VERSION,
      rankingAsOf: new Date('2026-09-01T08:00:00.000Z'),
    });
    expect(minimum.rankingFactors?.uncertaintyPenalty).toBe(10);
    expect(minimum.rankingScore).toBe(0);
    expect(Number.isInteger(minimum.rankingScore)).toBe(true);
  });

  it('includes deterministic Gate unknowns in the ranking uncertainty penalty', () => {
    const profile = fictionalProfile({ languages: [] });
    const job = fictionalJob();
    const extraction = fictionalExtraction({ confidence: 1, unknowns: [] });
    const gate = evaluateEligibility({ profile, job, extraction });
    const result = calculateDeterministicScore({
      profile,
      job,
      extraction,
      gate,
      scoringVersion: SCORING_VERSION,
      rankingAsOf: new Date(job.fetchedAt),
    });
    expect(gate.reasons).toContainEqual(
      expect.objectContaining({ code: 'required_language', outcome: 'unknown' }),
    );
    expect(result.rankingFactors?.uncertaintyPenalty).toBe(2);
  });
});
