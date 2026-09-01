import { createHash } from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { AppConfig } from '@job-radar/config';
import {
  ProfileRepository,
  ScoringRepository,
  ScoringRepositoryError,
  type DatabaseClient,
} from '@job-radar/db';
import {
  auditExtraction,
  calculateDeterministicScore,
  CodexCliProvider,
  evaluateEligibility,
  EXTRACTOR_VERSION,
  ProviderError,
  SCORING_VERSION,
  ScoringAuditError,
  type AIProvider,
} from '@job-radar/scoring';
import {
  scoringJobInputSchema,
  scoringConfigurationSchema,
  type ExtractedUnknown,
  type ScoringConfiguration,
  type ScoringBackfillResult,
  type ScoringProcessResult,
  type ScoringTask,
  type ScoringTaskStatus,
  type ScoringTokenUsage,
} from '@job-radar/shared';

export class ScoringCoordinatorError extends Error {
  public constructor(
    public readonly code:
      | 'SCORING_RUN_ACTIVE'
      | 'SCORING_MODEL_NOT_CONFIGURED'
      | 'SCORING_PROFILE_NOT_READY'
      | 'SCORING_TASK_NOT_FOUND'
      | 'SCORING_JOB_NOT_FOUND'
      | 'SCORING_TASK_NOT_RETRYABLE',
    message: string,
  ) {
    super(message);
    this.name = 'ScoringCoordinatorError';
  }
}

export interface ScoringCoordinatorOptions {
  readonly provider?: AIProvider;
  readonly now?: () => Date;
}

const versions = {
  extractorVersion: EXTRACTOR_VERSION,
  scoringVersion: SCORING_VERSION,
} as const;

function safeHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function gateUnknowns(
  reasons: ReadonlyArray<{
    code: string;
    outcome: 'pass' | 'fail' | 'unknown';
    explanation: string;
  }>,
): ExtractedUnknown[] {
  return reasons
    .filter(({ outcome }) => outcome === 'unknown')
    .map(({ code, explanation }) => ({
      code: `gate_${code}`,
      dimension: 'eligibility' as const,
      question: `Can the confirmed Profile resolve the ${code.replaceAll('_', ' ')} condition?`,
      explanation,
    }));
}

function mapRepositoryError(error: unknown): never {
  if (!(error instanceof ScoringRepositoryError)) throw error;
  const code =
    error.code === 'SCORING_JOB_NOT_FOUND'
      ? 'SCORING_JOB_NOT_FOUND'
      : error.code === 'SCORING_TASK_NOT_RETRYABLE'
        ? 'SCORING_TASK_NOT_RETRYABLE'
        : 'SCORING_TASK_NOT_FOUND';
  throw new ScoringCoordinatorError(code, error.message);
}

export class ScoringCoordinator {
  private readonly repository: ScoringRepository;
  private readonly profiles: ProfileRepository;
  private readonly provider: AIProvider | null;
  private readonly now: () => Date;
  private active = false;

  public constructor(
    database: DatabaseClient,
    private readonly logger: FastifyBaseLogger,
    private readonly config: AppConfig,
    options: ScoringCoordinatorOptions = {},
  ) {
    this.repository = new ScoringRepository(database, {
      maxAttempts: config.scoringMaxAttempts,
      retryBaseMs: config.scoringRetryBaseMs,
      retryMaxMs: config.scoringRetryMaxMs,
    });
    this.profiles = new ProfileRepository(database);
    this.provider = options.provider
      ? options.provider
      : config.codexModel
        ? new CodexCliProvider({
            binary: config.codexBinary,
            model: config.codexModel,
            timeoutMs: config.scoringTimeoutMs,
            maxOutputBytes: config.scoringMaxOutputBytes,
          })
        : null;
    this.now = options.now ?? (() => new Date());
    const recovered = this.repository.recoverRunning(this.now());
    if (recovered > 0) {
      this.logger.warn(
        { recoveredScoringTasks: recovered },
        'Recovered interrupted scoring tasks',
      );
    }
  }

  public list(status: ScoringTaskStatus | undefined, limit: number): ScoringTask[] {
    return this.repository.listTasks(status, limit);
  }

  public configuration(): ScoringConfiguration {
    return scoringConfigurationSchema.parse({
      ready: this.provider !== null,
      provider: 'codex_cli',
      model: this.provider?.model ?? null,
    });
  }

  public backfill(includeClosed: boolean): ScoringBackfillResult {
    const profile = this.profiles.getConfirmedView();
    if (!profile) {
      throw new ScoringCoordinatorError(
        'SCORING_PROFILE_NOT_READY',
        'A confirmed Profile is required before scoring jobs.',
      );
    }
    return this.repository.syncAll(
      profile.version,
      versions,
      includeClosed,
      this.now(),
      true,
    );
  }

  public onProfileVersionChanged(profileVersion: number): ScoringBackfillResult {
    return this.repository.syncAll(profileVersion, versions, true, this.now());
  }

  public syncJob(jobId: string, profileVersion: number): ScoringBackfillResult {
    try {
      return this.repository.syncJob(jobId, profileVersion, versions, this.now());
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public syncAllJobs(profileVersion: number): ScoringBackfillResult {
    return this.repository.syncAll(profileVersion, versions, true, this.now());
  }

  public rescoreJob(jobId: string): ScoringTask {
    const profile = this.profiles.getConfirmedView();
    if (!profile) {
      throw new ScoringCoordinatorError(
        'SCORING_PROFILE_NOT_READY',
        'A confirmed Profile is required before scoring jobs.',
      );
    }
    try {
      return this.repository.forceRescoreJob(
        jobId,
        profile.version,
        versions,
        this.now(),
      );
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public rescoreJobs(jobIds: readonly string[]): ScoringTask[] {
    const profile = this.profiles.getConfirmedView();
    if (!profile) {
      throw new ScoringCoordinatorError(
        'SCORING_PROFILE_NOT_READY',
        'A confirmed Profile is required before scoring jobs.',
      );
    }
    try {
      return this.repository.forceRescoreJobs(
        jobIds,
        profile.version,
        versions,
        this.now(),
      );
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public retry(taskId: string): ScoringTask {
    try {
      return this.repository.retry(taskId, this.now());
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public retryFailed(limit: number): ScoringTask[] {
    return this.repository.retryFailed(limit, this.now());
  }

  public getJobHistory(jobId: string) {
    try {
      return this.repository.getJobHistory(jobId);
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  public async process(
    limit: number,
    signal?: AbortSignal,
  ): Promise<ScoringProcessResult> {
    if (!this.provider) {
      throw new ScoringCoordinatorError(
        'SCORING_MODEL_NOT_CONFIGURED',
        'Set JOB_RADAR_CODEX_MODEL before processing the scoring queue.',
      );
    }
    if (this.active) {
      throw new ScoringCoordinatorError(
        'SCORING_RUN_ACTIVE',
        'A bounded scoring run is already active in this process.',
      );
    }
    this.active = true;
    const result: ScoringProcessResult = {
      claimed: 0,
      succeeded: 0,
      review: 0,
      pendingRetry: 0,
      failed: 0,
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      },
    };
    try {
      for (let index = 0; index < limit; index += 1) {
        if (signal?.aborted) break;
        const claimed = this.repository.claimNext(this.now());
        if (!claimed) break;
        result.claimed += 1;
        const processed = await this.processClaimed(claimed, signal);
        result[processed.outcome] += 1;
        if (processed.usage) {
          result.usage.inputTokens += processed.usage.inputTokens;
          result.usage.cachedInputTokens += processed.usage.cachedInputTokens;
          result.usage.outputTokens += processed.usage.outputTokens;
          result.usage.reasoningOutputTokens += processed.usage.reasoningOutputTokens;
          result.usage.totalTokens += processed.usage.totalTokens;
        }
      }
      return result;
    } finally {
      this.active = false;
    }
  }

  private async processClaimed(
    claimed: NonNullable<ReturnType<ScoringRepository['claimNext']>>,
    signal?: AbortSignal,
  ): Promise<{
    outcome: 'succeeded' | 'review' | 'pendingRetry' | 'failed';
    usage: ScoringTokenUsage | null;
  }> {
    const provider = this.provider;
    if (!provider) {
      throw new ScoringCoordinatorError(
        'SCORING_MODEL_NOT_CONFIGURED',
        'Set JOB_RADAR_CODEX_MODEL before processing the scoring queue.',
      );
    }
    const profile = this.profiles.getConfirmedView(claimed.task.profileVersion);
    const currentProfile = this.profiles.getConfirmedView();
    if (
      !profile ||
      !currentProfile ||
      currentProfile.version !== claimed.task.profileVersion
    ) {
      this.repository.fail(claimed.task.id, {
        code: 'stale_profile',
        summary: 'The confirmed Profile changed before this scoring attempt completed.',
        outcome: 'failed',
        provider: provider.id,
        model: provider.model,
        outputHash: null,
        outputBytes: 0,
        usage: null,
        retryable: false,
        now: this.now(),
      });
      if (currentProfile)
        this.repository.syncAll(currentProfile.version, versions, true, this.now());
      return { outcome: 'failed', usage: null };
    }
    let providerAudit: {
      usage: ScoringTokenUsage;
      outputBytes: number;
    } | null = null;
    try {
      const job = scoringJobInputSchema.parse(claimed.job);
      const providerOutput = await provider.extract({
        profile,
        job,
        extractorVersion: claimed.task.extractorVersion,
        ...(signal ? { signal } : {}),
      });
      providerAudit = {
        usage: providerOutput.usage,
        outputBytes: providerOutput.outputBytes,
      };
      const extraction = auditExtraction({
        raw: providerOutput.extraction,
        profile,
        job,
        extractorVersion: claimed.task.extractorVersion,
      });
      const gate = evaluateEligibility({ profile, job, extraction });
      const rankingAsOf = new Date(job.fetchedAt);
      const score = calculateDeterministicScore({
        profile,
        job,
        extraction,
        gate,
        scoringVersion: claimed.task.scoringVersion,
        rankingAsOf,
      });
      const eligibilityUnknowns = gateUnknowns(gate.reasons);
      const unknowns = [...extraction.unknowns, ...eligibilityUnknowns];
      const reviewRequired =
        extraction.confidence < this.config.scoringReviewConfidence ||
        unknowns.length > 0;
      const failedGateReasons = gate.reasons.filter(({ outcome }) => outcome === 'fail');
      const explanation = gate.eligible
        ? `Eligibility Gate passed. ${extraction.matchedEvidence.length} evidence-backed match(es) and ${extraction.gaps.length} explicit gap(s) were scored deterministically.`
        : `Eligibility Gate failed for ${failedGateReasons.map(({ code }) => code).join(', ')}. No match or ranking score was created; ${extraction.matchedEvidence.length} match(es) and ${extraction.gaps.length} gap(s) remain auditable.`;
      this.repository.complete(claimed.task.id, {
        extraction,
        gate,
        score,
        jobActive: job.active,
        provider: provider.id,
        model: provider.model,
        reviewRequired,
        unknowns,
        explanation,
        rankingAsOf,
        usage: providerOutput.usage,
        outputBytes: providerOutput.outputBytes,
        now: this.now(),
      });
      return {
        outcome: reviewRequired ? 'review' : 'succeeded',
        usage: providerOutput.usage,
      };
    } catch (error) {
      const now = this.now();
      const failure =
        error instanceof ProviderError
          ? {
              code: error.code,
              summary: error.message,
              outcome:
                error.code === 'cancelled'
                  ? ('cancelled' as const)
                  : error.code === 'timeout'
                    ? ('timeout' as const)
                    : error.code === 'invalid_json' || error.code === 'schema_invalid'
                      ? ('invalid_output' as const)
                      : ('failed' as const),
              outputHash: error.outputHash,
              outputBytes: error.outputBytes,
              usage: error.usage,
              retryable: error.code !== 'usage_missing',
            }
          : error instanceof ScoringAuditError
            ? {
                code: error.code,
                summary: error.message,
                outcome: 'invalid_output' as const,
                outputHash: safeHash(error.message),
                outputBytes: providerAudit?.outputBytes ?? 0,
                usage: providerAudit?.usage ?? null,
                retryable: true,
              }
            : {
                code: 'unexpected',
                summary: 'Scoring failed unexpectedly and produced no formal score.',
                outcome: 'failed' as const,
                outputHash: null,
                outputBytes: providerAudit?.outputBytes ?? 0,
                usage: providerAudit?.usage ?? null,
                retryable: true,
              };
      const task = this.repository.fail(claimed.task.id, {
        ...failure,
        provider: provider.id,
        model: provider.model,
        now,
      });
      this.logger.warn(
        { scoringTaskId: claimed.task.id, errorCode: failure.code, status: task.status },
        'Scoring attempt failed safely',
      );
      return {
        outcome: task.status === 'failed' ? 'failed' : 'pendingRetry',
        usage: failure.usage,
      };
    }
  }
}
