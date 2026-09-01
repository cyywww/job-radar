import { describe, expect, it } from 'vitest';

import {
  scoringAttemptSchema,
  scoringConfigurationSchema,
  scoringProcessResultSchema,
  scoringTokenUsageSchema,
} from './scoring.js';

const usage = {
  inputTokens: 1_000,
  cachedInputTokens: 100,
  outputTokens: 250,
  reasoningOutputTokens: 50,
  totalTokens: 1_250,
} as const;

describe('scoring cost-control contracts', () => {
  it('validates actual usage without double-counting cached or reasoning tokens', () => {
    expect(scoringTokenUsageSchema.parse(usage).totalTokens).toBe(1_250);
    expect(() =>
      scoringTokenUsageSchema.parse({ ...usage, totalTokens: 1_400 }),
    ).toThrow();
    expect(() =>
      scoringTokenUsageSchema.parse({ ...usage, cachedInputTokens: 1_001 }),
    ).toThrow();
  });

  it('requires explicit configuration state and aggregates bounded-run usage', () => {
    expect(
      scoringConfigurationSchema.parse({
        ready: false,
        provider: 'codex_cli',
        model: null,
      }),
    ).toMatchObject({ ready: false, model: null });
    expect(
      scoringProcessResultSchema.parse({
        claimed: 1,
        succeeded: 1,
        review: 0,
        pendingRetry: 0,
        failed: 0,
        usage,
      }).usage.totalTokens,
    ).toBe(1_250);
  });

  it('keeps historical attempts valid when legacy rows have no usage audit', () => {
    const attempt = scoringAttemptSchema.parse({
      id: '89000000-0000-4000-8000-000000000001',
      taskId: '89000000-0000-4000-8000-000000000002',
      attemptNumber: 1,
      outcome: 'succeeded',
      provider: 'codex_cli',
      model: 'fictional-model',
      errorCode: null,
      errorSummary: null,
      outputBytes: 0,
      usage: null,
      startedAt: '2026-09-01T08:00:00.000Z',
      finishedAt: '2026-09-01T08:00:01.000Z',
    });
    expect(attempt.usage).toBeNull();
  });
});
