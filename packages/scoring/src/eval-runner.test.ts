import { describe, expect, it } from 'vitest';

import { scoringEvalCases } from './eval-cases.js';
import { runScoringEvals } from './eval-runner.js';

describe('offline scoring evals', () => {
  it('covers at least 30 fictional cases with deterministic Gate and score ranges', () => {
    expect(scoringEvalCases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(scoringEvalCases.map(({ id }) => id)).size).toBe(
      scoringEvalCases.length,
    );
    expect(runScoringEvals().filter(({ passed }) => !passed)).toEqual([]);
  });
});
