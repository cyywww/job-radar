import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import {
  jobRequirementSchema,
  jobScoreSchema,
  scoringTaskSchema,
  scoringTaskStatusSchema,
  type EligibilityGateResult,
  type ExtractedUnknown,
  type JobExtraction,
  type JobRequirement,
  type JobScore,
  type ScoringBackfillResult,
  type ScoringJobInput,
  type ScoringTask,
  type ScoringTaskStatus,
} from '@job-radar/shared';

import type { DeterministicScoreResult } from '@job-radar/scoring';

import type { DatabaseClient } from './database.js';
import {
  jobRequirements,
  jobScores,
  jobSnapshots,
  jobs,
  scoringAttempts,
  scoringTasks,
} from './schema.js';

export interface ScoringRepositoryOptions {
  readonly maxAttempts: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

export interface ScoringVersions {
  readonly extractorVersion: string;
  readonly scoringVersion: string;
}

export interface ClaimedScoringTask {
  readonly task: ScoringTask;
  readonly job: ScoringJobInput;
}

export interface CompleteScoringInput {
  readonly extraction: JobExtraction;
  readonly gate: EligibilityGateResult;
  readonly score: DeterministicScoreResult;
  readonly jobActive: boolean;
  readonly provider: 'codex_cli';
  readonly model: string;
  readonly reviewRequired: boolean;
  readonly unknowns: ExtractedUnknown[];
  readonly explanation: string;
  readonly rankingAsOf: Date;
  readonly now: Date;
}

export interface ScoringFailureInput {
  readonly code: string;
  readonly summary: string;
  readonly outcome: 'failed' | 'cancelled' | 'timeout' | 'invalid_output';
  readonly provider: 'codex_cli';
  readonly model: string;
  readonly outputHash: string | null;
  readonly outputBytes: number;
  readonly now: Date;
}

function date(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function confidenceFromMicros(value: number): number {
  return value / 1_000_000;
}

function confidenceToMicros(value: number): number {
  return Math.round(value * 1_000_000);
}

export class ScoringRepositoryError extends Error {
  public constructor(
    public readonly code:
      | 'SCORING_TASK_NOT_FOUND'
      | 'SCORING_JOB_NOT_FOUND'
      | 'SCORING_TASK_NOT_RETRYABLE'
      | 'SCORING_TASK_STALE'
      | 'SCORING_TASK_STATE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ScoringRepositoryError';
  }
}

export class ScoringRepository {
  public constructor(
    private readonly client: DatabaseClient,
    private readonly options: ScoringRepositoryOptions,
  ) {}

  public syncAll(
    profileVersion: number,
    versions: ScoringVersions,
    includeClosed: boolean,
    now = new Date(),
    retryFailed = false,
  ): ScoringBackfillResult {
    const rows = this.client.db
      .select()
      .from(jobs)
      .orderBy(asc(jobs.firstSeenAt), asc(jobs.id))
      .all()
      .filter((job) => includeClosed || job.active);
    let queued = 0;
    let invalidated = 0;
    this.client.db.transaction((transaction) => {
      for (const job of rows) {
        const result = this.syncJobInTransaction(
          transaction,
          job,
          profileVersion,
          versions,
          now,
          retryFailed,
        );
        queued += result.queued;
        invalidated += result.invalidated;
      }
    });
    return { queued, invalidated };
  }

  public syncJob(
    jobId: string,
    profileVersion: number,
    versions: ScoringVersions,
    now = new Date(),
  ): ScoringBackfillResult {
    const job = this.client.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job) {
      throw new ScoringRepositoryError('SCORING_JOB_NOT_FOUND', 'Job does not exist.');
    }
    return this.client.db.transaction((transaction) =>
      this.syncJobInTransaction(transaction, job, profileVersion, versions, now, false),
    );
  }

  public forceRescoreJob(
    jobId: string,
    profileVersion: number,
    versions: ScoringVersions,
    now = new Date(),
  ): ScoringTask {
    const job = this.client.db.select().from(jobs).where(eq(jobs.id, jobId)).get();
    if (!job?.currentSnapshotId) {
      throw new ScoringRepositoryError(
        'SCORING_JOB_NOT_FOUND',
        'Job or current snapshot does not exist.',
      );
    }
    this.client.db.transaction((transaction) => {
      transaction
        .update(jobScores)
        .set({ invalidatedAt: now, updatedAt: now })
        .where(and(eq(jobScores.jobId, jobId), isNull(jobScores.invalidatedAt)))
        .run();
      transaction
        .update(jobRequirements)
        .set({ invalidatedAt: now })
        .where(
          and(eq(jobRequirements.jobId, jobId), isNull(jobRequirements.invalidatedAt)),
        )
        .run();
      const existing = transaction
        .select()
        .from(scoringTasks)
        .where(
          and(
            eq(scoringTasks.jobId, jobId),
            eq(scoringTasks.snapshotId, job.currentSnapshotId!),
            eq(scoringTasks.profileVersion, profileVersion),
            eq(scoringTasks.extractorVersion, versions.extractorVersion),
            eq(scoringTasks.scoringVersion, versions.scoringVersion),
          ),
        )
        .get();
      if (existing) {
        if (
          existing.invalidatedAt !== null ||
          !['pending', 'running'].includes(existing.status)
        ) {
          transaction
            .update(scoringTasks)
            .set({
              status: 'pending',
              maxAttempts: existing.attemptCount + this.options.maxAttempts,
              retryAt: null,
              claimedAt: null,
              lastErrorCode: null,
              lastErrorSummary: null,
              updatedAt: now,
              invalidatedAt: null,
            })
            .where(eq(scoringTasks.id, existing.id))
            .run();
        }
      } else {
        this.insertTask(
          transaction,
          jobId,
          job.currentSnapshotId!,
          profileVersion,
          versions,
          now,
        );
      }
    });
    return this.findIdentityTask(jobId, job.currentSnapshotId, profileVersion, versions)!;
  }

  public forceRescoreJobs(
    jobIds: readonly string[],
    profileVersion: number,
    versions: ScoringVersions,
    now = new Date(),
  ): ScoringTask[] {
    const selected = this.client.db
      .select()
      .from(jobs)
      .where(inArray(jobs.id, [...jobIds]))
      .all();
    if (
      selected.length !== jobIds.length ||
      selected.some((job) => job.currentSnapshotId === null)
    ) {
      throw new ScoringRepositoryError(
        'SCORING_JOB_NOT_FOUND',
        'One or more jobs or current snapshots do not exist.',
      );
    }
    this.client.db.transaction((transaction) => {
      for (const job of selected) {
        transaction
          .update(jobScores)
          .set({ invalidatedAt: now, updatedAt: now })
          .where(and(eq(jobScores.jobId, job.id), isNull(jobScores.invalidatedAt)))
          .run();
        transaction
          .update(jobRequirements)
          .set({ invalidatedAt: now })
          .where(
            and(eq(jobRequirements.jobId, job.id), isNull(jobRequirements.invalidatedAt)),
          )
          .run();
        const existing = transaction
          .select()
          .from(scoringTasks)
          .where(
            and(
              eq(scoringTasks.jobId, job.id),
              eq(scoringTasks.snapshotId, job.currentSnapshotId!),
              eq(scoringTasks.profileVersion, profileVersion),
              eq(scoringTasks.extractorVersion, versions.extractorVersion),
              eq(scoringTasks.scoringVersion, versions.scoringVersion),
            ),
          )
          .get();
        if (existing) {
          if (
            existing.invalidatedAt !== null ||
            !['pending', 'running'].includes(existing.status)
          ) {
            transaction
              .update(scoringTasks)
              .set({
                status: 'pending',
                maxAttempts: existing.attemptCount + this.options.maxAttempts,
                retryAt: null,
                claimedAt: null,
                lastErrorCode: null,
                lastErrorSummary: null,
                updatedAt: now,
                invalidatedAt: null,
              })
              .where(eq(scoringTasks.id, existing.id))
              .run();
          }
        } else {
          this.insertTask(
            transaction,
            job.id,
            job.currentSnapshotId!,
            profileVersion,
            versions,
            now,
          );
        }
      }
    });
    return jobIds.map((jobId) => {
      const job = selected.find((entry) => entry.id === jobId)!;
      return this.findIdentityTask(
        jobId,
        job.currentSnapshotId!,
        profileVersion,
        versions,
      )!;
    });
  }

  public listTasks(status: ScoringTaskStatus | undefined, limit: number): ScoringTask[] {
    const parsedStatus = status ? scoringTaskStatusSchema.parse(status) : undefined;
    const rows = this.client.db
      .select()
      .from(scoringTasks)
      .where(parsedStatus ? eq(scoringTasks.status, parsedStatus) : undefined)
      .orderBy(desc(scoringTasks.createdAt), desc(scoringTasks.id))
      .limit(limit)
      .all();
    return rows.map((row) => this.taskFromRow(row));
  }

  public claimNext(now = new Date()): ClaimedScoringTask | null {
    return this.client.db.transaction((transaction) => {
      const row = transaction
        .select()
        .from(scoringTasks)
        .where(
          and(
            eq(scoringTasks.status, 'pending'),
            isNull(scoringTasks.invalidatedAt),
            sql`${scoringTasks.attemptCount} < ${scoringTasks.maxAttempts}`,
            or(isNull(scoringTasks.retryAt), lte(scoringTasks.retryAt, now)),
          ),
        )
        .orderBy(
          asc(scoringTasks.retryAt),
          asc(scoringTasks.createdAt),
          asc(scoringTasks.id),
        )
        .get();
      if (!row) return null;
      const claimed = transaction
        .update(scoringTasks)
        .set({
          status: 'running',
          attemptCount: sql`${scoringTasks.attemptCount} + 1`,
          claimedAt: now,
          retryAt: null,
          updatedAt: now,
        })
        .where(and(eq(scoringTasks.id, row.id), eq(scoringTasks.status, 'pending')))
        .run();
      if (claimed.changes !== 1) return null;
      const updated = transaction
        .select()
        .from(scoringTasks)
        .where(eq(scoringTasks.id, row.id))
        .get()!;
      const job = transaction
        .select({ job: jobs, snapshot: jobSnapshots })
        .from(jobs)
        .innerJoin(scoringTasks, eq(scoringTasks.jobId, jobs.id))
        .innerJoin(jobSnapshots, eq(jobSnapshots.id, scoringTasks.snapshotId))
        .where(eq(scoringTasks.id, row.id))
        .get();
      if (
        !job ||
        job.job.currentSnapshotId !== row.snapshotId ||
        job.snapshot.jobId !== row.jobId
      ) {
        transaction
          .update(scoringTasks)
          .set({
            status: 'failed',
            lastErrorCode: 'stale_task',
            lastErrorSummary: 'Scoring task no longer targets the current job snapshot.',
            updatedAt: now,
            invalidatedAt: now,
          })
          .where(eq(scoringTasks.id, row.id))
          .run();
        return null;
      }
      return {
        task: this.taskFromRow(updated),
        job: {
          jobId: job.job.id,
          snapshotId: job.snapshot.id,
          company: job.snapshot.company,
          title: job.snapshot.title,
          location: job.snapshot.location,
          remoteMode: job.job.remoteMode,
          employmentType: job.job.employmentType,
          publishedAt: date(job.job.publishedAt),
          active: job.job.active,
          descriptionText: job.snapshot.descriptionText,
          fetchedAt: job.snapshot.fetchedAt.toISOString(),
        },
      };
    });
  }

  public complete(taskId: string, input: CompleteScoringInput): JobScore {
    return this.client.db.transaction((transaction) => {
      const task = transaction
        .select()
        .from(scoringTasks)
        .where(eq(scoringTasks.id, taskId))
        .get();
      if (!task) {
        throw new ScoringRepositoryError(
          'SCORING_TASK_NOT_FOUND',
          'Scoring task does not exist.',
        );
      }
      if (task.status !== 'running' || task.invalidatedAt !== null) {
        throw new ScoringRepositoryError(
          'SCORING_TASK_STATE_INVALID',
          'Only a current running task can be completed.',
        );
      }
      const job = transaction.select().from(jobs).where(eq(jobs.id, task.jobId)).get();
      if (
        !job ||
        job.currentSnapshotId !== task.snapshotId ||
        job.active !== input.jobActive
      ) {
        throw new ScoringRepositoryError(
          'SCORING_TASK_STALE',
          'Scoring task no longer targets the current snapshot or lifecycle state.',
        );
      }
      const requirementId = randomUUID();
      const scoreId = randomUUID();
      transaction
        .insert(jobRequirements)
        .values({
          id: requirementId,
          taskId,
          jobId: task.jobId,
          snapshotId: task.snapshotId,
          profileVersion: task.profileVersion,
          extractorVersion: task.extractorVersion,
          extraction: input.extraction,
          confidence: confidenceToMicros(input.extraction.confidence),
          provider: input.provider,
          model: input.model,
          createdAt: input.now,
        })
        .run();
      transaction
        .insert(jobScores)
        .values({
          id: scoreId,
          taskId,
          requirementId,
          jobId: task.jobId,
          snapshotId: task.snapshotId,
          profileVersion: task.profileVersion,
          scoringVersion: task.scoringVersion,
          eligible: input.gate.eligible,
          jobActive: job.active,
          gateReasons: input.gate.reasons,
          matchScore: input.score.matchScore,
          rankingScore: input.score.rankingScore,
          rankingFactors: input.score.rankingFactors,
          breakdown: input.score.breakdown,
          matchedEvidence: input.extraction.matchedEvidence,
          gaps: input.extraction.gaps,
          unknowns: input.unknowns,
          confidence: confidenceToMicros(input.extraction.confidence),
          provider: input.provider,
          model: input.model,
          reviewState: input.reviewRequired ? 'pending' : 'not_required',
          explanation: input.explanation,
          rankingAsOf: input.gate.eligible ? input.rankingAsOf : null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .run();
      transaction
        .insert(scoringAttempts)
        .values({
          id: randomUUID(),
          taskId,
          attemptNumber: task.attemptCount,
          outcome: 'succeeded',
          provider: input.provider,
          model: input.model,
          outputBytes: 0,
          startedAt: task.claimedAt ?? input.now,
          finishedAt: input.now,
        })
        .run();
      transaction
        .update(scoringTasks)
        .set({
          status: input.reviewRequired ? 'review' : 'succeeded',
          claimedAt: null,
          lastErrorCode: null,
          lastErrorSummary: null,
          updatedAt: input.now,
        })
        .where(eq(scoringTasks.id, taskId))
        .run();
      return this.scoreFromRow(
        transaction.select().from(jobScores).where(eq(jobScores.id, scoreId)).get()!,
      );
    });
  }

  public fail(taskId: string, input: ScoringFailureInput): ScoringTask {
    return this.client.db.transaction((transaction) => {
      const task = transaction
        .select()
        .from(scoringTasks)
        .where(eq(scoringTasks.id, taskId))
        .get();
      if (!task) {
        throw new ScoringRepositoryError(
          'SCORING_TASK_NOT_FOUND',
          'Scoring task does not exist.',
        );
      }
      if (task.status !== 'running') {
        throw new ScoringRepositoryError(
          'SCORING_TASK_STATE_INVALID',
          'Only a running task can record a provider failure.',
        );
      }
      transaction
        .insert(scoringAttempts)
        .values({
          id: randomUUID(),
          taskId,
          attemptNumber: task.attemptCount,
          outcome: input.outcome,
          provider: input.provider,
          model: input.model,
          errorCode: input.code.slice(0, 80),
          errorSummary: input.summary.slice(0, 500),
          outputHash: input.outputHash,
          outputBytes: input.outputBytes,
          startedAt: task.claimedAt ?? input.now,
          finishedAt: input.now,
        })
        .run();
      const exhausted = task.attemptCount >= task.maxAttempts;
      const delay = Math.min(
        this.options.retryMaxMs,
        this.options.retryBaseMs * 2 ** Math.max(0, task.attemptCount - 1),
      );
      transaction
        .update(scoringTasks)
        .set({
          status: exhausted ? 'failed' : 'pending',
          retryAt: exhausted ? null : new Date(input.now.getTime() + delay),
          claimedAt: null,
          lastErrorCode: input.code.slice(0, 80),
          lastErrorSummary: input.summary.slice(0, 500),
          updatedAt: input.now,
        })
        .where(eq(scoringTasks.id, taskId))
        .run();
      return this.taskFromRow(
        transaction.select().from(scoringTasks).where(eq(scoringTasks.id, taskId)).get()!,
      );
    });
  }

  public retry(taskId: string, now = new Date()): ScoringTask {
    const task = this.client.db
      .select()
      .from(scoringTasks)
      .where(eq(scoringTasks.id, taskId))
      .get();
    if (!task) {
      throw new ScoringRepositoryError(
        'SCORING_TASK_NOT_FOUND',
        'Scoring task does not exist.',
      );
    }
    if (task.status !== 'failed' || task.invalidatedAt !== null) {
      throw new ScoringRepositoryError(
        'SCORING_TASK_NOT_RETRYABLE',
        'Only a current failed task can be manually retried.',
      );
    }
    this.client.db
      .update(scoringTasks)
      .set({
        status: 'pending',
        maxAttempts: task.attemptCount + this.options.maxAttempts,
        retryAt: now,
        claimedAt: null,
        lastErrorCode: null,
        lastErrorSummary: null,
        updatedAt: now,
      })
      .where(eq(scoringTasks.id, taskId))
      .run();
    return this.taskFromRow(
      this.client.db
        .select()
        .from(scoringTasks)
        .where(eq(scoringTasks.id, taskId))
        .get()!,
    );
  }

  public retryFailed(limit: number, now = new Date()): ScoringTask[] {
    const failed = this.client.db
      .select()
      .from(scoringTasks)
      .where(and(eq(scoringTasks.status, 'failed'), isNull(scoringTasks.invalidatedAt)))
      .orderBy(asc(scoringTasks.updatedAt), asc(scoringTasks.id))
      .limit(limit)
      .all();
    this.client.db.transaction((transaction) => {
      for (const task of failed) {
        transaction
          .update(scoringTasks)
          .set({
            status: 'pending',
            maxAttempts: task.attemptCount + this.options.maxAttempts,
            retryAt: now,
            claimedAt: null,
            lastErrorCode: null,
            lastErrorSummary: null,
            updatedAt: now,
          })
          .where(eq(scoringTasks.id, task.id))
          .run();
      }
    });
    return failed.map((task) =>
      this.taskFromRow(
        this.client.db
          .select()
          .from(scoringTasks)
          .where(eq(scoringTasks.id, task.id))
          .get()!,
      ),
    );
  }

  public recoverRunning(now = new Date()): number {
    const running = this.client.db
      .select()
      .from(scoringTasks)
      .where(eq(scoringTasks.status, 'running'))
      .all();
    this.client.db.transaction((transaction) => {
      for (const task of running) {
        const exhausted = task.attemptCount >= task.maxAttempts;
        transaction
          .insert(scoringAttempts)
          .values({
            id: randomUUID(),
            taskId: task.id,
            attemptNumber: task.attemptCount,
            outcome: 'failed',
            provider: 'codex_cli',
            model: 'unknown-after-restart',
            errorCode: 'interrupted',
            errorSummary:
              'The local process stopped while this scoring attempt was running.',
            outputBytes: 0,
            startedAt: task.claimedAt ?? task.updatedAt,
            finishedAt: now,
          })
          .onConflictDoNothing()
          .run();
        transaction
          .update(scoringTasks)
          .set({
            status: exhausted ? 'failed' : 'pending',
            retryAt: exhausted ? null : now,
            claimedAt: null,
            lastErrorCode: 'interrupted',
            lastErrorSummary:
              'The prior scoring attempt was interrupted and recovered safely.',
            updatedAt: now,
          })
          .where(eq(scoringTasks.id, task.id))
          .run();
      }
    });
    return running.length;
  }

  public getJobHistory(jobId: string): {
    current: JobScore | null;
    requirements: JobRequirement[];
    scores: JobScore[];
    tasks: ScoringTask[];
  } {
    if (
      !this.client.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).get()
    ) {
      throw new ScoringRepositoryError('SCORING_JOB_NOT_FOUND', 'Job does not exist.');
    }
    const requirementRows = this.client.db
      .select()
      .from(jobRequirements)
      .where(eq(jobRequirements.jobId, jobId))
      .orderBy(desc(jobRequirements.createdAt), desc(jobRequirements.id))
      .all();
    const scoreRows = this.client.db
      .select()
      .from(jobScores)
      .where(eq(jobScores.jobId, jobId))
      .orderBy(desc(jobScores.createdAt), desc(jobScores.id))
      .all();
    const tasks = this.client.db
      .select()
      .from(scoringTasks)
      .where(eq(scoringTasks.jobId, jobId))
      .orderBy(desc(scoringTasks.createdAt), desc(scoringTasks.id))
      .all();
    return {
      current: scoreRows.find(({ invalidatedAt }) => invalidatedAt === null)
        ? this.scoreFromRow(
            scoreRows.find(({ invalidatedAt }) => invalidatedAt === null)!,
          )
        : null,
      requirements: requirementRows.map((row) => this.requirementFromRow(row)),
      scores: scoreRows.map((row) => this.scoreFromRow(row)),
      tasks: tasks.map((row) => this.taskFromRow(row)),
    };
  }

  private syncJobInTransaction(
    transaction: Parameters<Parameters<DatabaseClient['db']['transaction']>[0]>[0],
    job: typeof jobs.$inferSelect,
    profileVersion: number,
    versions: ScoringVersions,
    now: Date,
    retryFailed: boolean,
  ): ScoringBackfillResult {
    if (!job.currentSnapshotId) return { queued: 0, invalidated: 0 };
    let invalidated = 0;
    const requirements = transaction
      .select()
      .from(jobRequirements)
      .where(
        and(eq(jobRequirements.jobId, job.id), isNull(jobRequirements.invalidatedAt)),
      )
      .all();
    const requirementExtractorVersions = new Map(
      requirements.map(({ id, extractorVersion }) => [id, extractorVersion]),
    );
    const currentScores = transaction
      .select()
      .from(jobScores)
      .where(and(eq(jobScores.jobId, job.id), isNull(jobScores.invalidatedAt)))
      .all();
    const staleScores = currentScores.filter(
      (score) =>
        score.snapshotId !== job.currentSnapshotId ||
        score.profileVersion !== profileVersion ||
        score.scoringVersion !== versions.scoringVersion ||
        requirementExtractorVersions.get(score.requirementId) !==
          versions.extractorVersion ||
        score.jobActive !== job.active,
    );
    for (const score of staleScores) {
      transaction
        .update(jobScores)
        .set({ invalidatedAt: now, updatedAt: now })
        .where(eq(jobScores.id, score.id))
        .run();
      invalidated += 1;
    }
    for (const requirement of requirements) {
      if (
        requirement.snapshotId !== job.currentSnapshotId ||
        requirement.profileVersion !== profileVersion ||
        requirement.extractorVersion !== versions.extractorVersion
      ) {
        transaction
          .update(jobRequirements)
          .set({ invalidatedAt: now })
          .where(eq(jobRequirements.id, requirement.id))
          .run();
      }
    }
    const tasks = transaction
      .select()
      .from(scoringTasks)
      .where(eq(scoringTasks.jobId, job.id))
      .all();
    for (const task of tasks) {
      if (
        task.invalidatedAt === null &&
        (task.snapshotId !== job.currentSnapshotId ||
          task.profileVersion !== profileVersion ||
          task.extractorVersion !== versions.extractorVersion ||
          task.scoringVersion !== versions.scoringVersion)
      ) {
        transaction
          .update(scoringTasks)
          .set({ invalidatedAt: now, updatedAt: now })
          .where(eq(scoringTasks.id, task.id))
          .run();
      }
    }
    const identity = tasks.find(
      (task) =>
        task.snapshotId === job.currentSnapshotId &&
        task.profileVersion === profileVersion &&
        task.extractorVersion === versions.extractorVersion &&
        task.scoringVersion === versions.scoringVersion,
    );
    const validScore = currentScores.some(
      (score) =>
        score.invalidatedAt === null &&
        score.snapshotId === job.currentSnapshotId &&
        score.profileVersion === profileVersion &&
        score.scoringVersion === versions.scoringVersion &&
        requirementExtractorVersions.get(score.requirementId) ===
          versions.extractorVersion &&
        score.jobActive === job.active,
    );
    if (!identity) {
      this.insertTask(
        transaction,
        job.id,
        job.currentSnapshotId,
        profileVersion,
        versions,
        now,
      );
      return { queued: 1, invalidated };
    }
    const lifecycleChanged =
      !validScore && ['succeeded', 'review'].includes(identity.status);
    const shouldRetryFailed = retryFailed && identity.status === 'failed';
    if (identity.invalidatedAt !== null || lifecycleChanged || shouldRetryFailed) {
      transaction
        .update(scoringTasks)
        .set({
          status: 'pending',
          maxAttempts: identity.attemptCount + this.options.maxAttempts,
          retryAt: null,
          claimedAt: null,
          lastErrorCode: null,
          lastErrorSummary: null,
          invalidatedAt: null,
          updatedAt: now,
        })
        .where(eq(scoringTasks.id, identity.id))
        .run();
      return { queued: 1, invalidated };
    }
    return { queued: 0, invalidated };
  }

  private insertTask(
    transaction: Parameters<Parameters<DatabaseClient['db']['transaction']>[0]>[0],
    jobId: string,
    snapshotId: string,
    profileVersion: number,
    versions: ScoringVersions,
    now: Date,
  ): void {
    transaction
      .insert(scoringTasks)
      .values({
        id: randomUUID(),
        jobId,
        snapshotId,
        profileVersion,
        extractorVersion: versions.extractorVersion,
        scoringVersion: versions.scoringVersion,
        status: 'pending',
        maxAttempts: this.options.maxAttempts,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }

  private findIdentityTask(
    jobId: string,
    snapshotId: string,
    profileVersion: number,
    versions: ScoringVersions,
  ): ScoringTask | null {
    const row = this.client.db
      .select()
      .from(scoringTasks)
      .where(
        and(
          eq(scoringTasks.jobId, jobId),
          eq(scoringTasks.snapshotId, snapshotId),
          eq(scoringTasks.profileVersion, profileVersion),
          eq(scoringTasks.extractorVersion, versions.extractorVersion),
          eq(scoringTasks.scoringVersion, versions.scoringVersion),
        ),
      )
      .get();
    return row ? this.taskFromRow(row) : null;
  }

  private taskFromRow(row: typeof scoringTasks.$inferSelect): ScoringTask {
    return scoringTaskSchema.parse({
      id: row.id,
      jobId: row.jobId,
      snapshotId: row.snapshotId,
      profileVersion: row.profileVersion,
      extractorVersion: row.extractorVersion,
      scoringVersion: row.scoringVersion,
      status: row.status,
      attemptCount: row.attemptCount,
      maxAttempts: row.maxAttempts,
      retryAt: date(row.retryAt),
      lastErrorCode: row.lastErrorCode,
      lastErrorSummary: row.lastErrorSummary,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      invalidatedAt: date(row.invalidatedAt),
    });
  }

  private scoreFromRow(row: typeof jobScores.$inferSelect): JobScore {
    return jobScoreSchema.parse({
      id: row.id,
      taskId: row.taskId,
      requirementId: row.requirementId,
      jobId: row.jobId,
      snapshotId: row.snapshotId,
      profileVersion: row.profileVersion,
      scoringVersion: row.scoringVersion,
      eligible: row.eligible,
      gateReasons: row.gateReasons,
      matchScore: row.matchScore,
      rankingScore: row.rankingScore,
      rankingFactors: row.rankingFactors,
      breakdown: row.breakdown,
      matchedEvidence: row.matchedEvidence,
      gaps: row.gaps,
      unknowns: row.unknowns,
      confidence: confidenceFromMicros(row.confidence),
      provider: row.provider,
      model: row.model,
      reviewState: row.reviewState,
      explanation: row.explanation,
      rankingAsOf: date(row.rankingAsOf),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      invalidatedAt: date(row.invalidatedAt),
    });
  }

  private requirementFromRow(row: typeof jobRequirements.$inferSelect): JobRequirement {
    return jobRequirementSchema.parse({
      id: row.id,
      taskId: row.taskId,
      jobId: row.jobId,
      snapshotId: row.snapshotId,
      profileVersion: row.profileVersion,
      extractorVersion: row.extractorVersion,
      extraction: row.extraction,
      confidence: confidenceFromMicros(row.confidence),
      provider: row.provider,
      model: row.model,
      createdAt: row.createdAt.toISOString(),
      invalidatedAt: date(row.invalidatedAt),
    });
  }
}
