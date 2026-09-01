export const EXTRACTOR_VERSION = 'codex-job-extractor-v1' as const;
export const SCORING_VERSION = 'deterministic-weighted-v1' as const;

export const SCORING_WEIGHTS = Object.freeze({
  requiredSkills: 30,
  skillDepth: 20,
  responsibilities: 15,
  seniority: 15,
  domain: 8,
  location: 7,
  softPreferences: 5,
});

export const DEFAULT_REVIEW_CONFIDENCE = 0.65;
