import { randomUUID } from 'node:crypto';

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import {
  reviewJobSummarySchema,
  scoreFeedbackSchema,
  scoreReviewEventSchema,
  triageRecordSchema,
  type CreateFeedbackRequest,
  type JobScoreSummary,
  type ReviewJobSummary,
  type ReviewJobsQuery,
  type ScoreFeedback,
  type ScoreReviewEvent,
  type TriageRecord,
  type TriageStatus,
} from '@job-radar/shared';

import type { DatabaseClient } from './database.js';
import {
  jobScores,
  jobTriage,
  jobs,
  profiles,
  profileVersions,
  scoreFeedback,
  scoreReviewEvents,
} from './schema.js';

export class ReviewRepositoryError extends Error {
  public constructor(
    public readonly code: 'JOB_NOT_FOUND' | 'SCORE_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ReviewRepositoryError';
  }
}

interface ReviewListRow {
  id: string;
  company: string;
  title: string;
  location: string;
  remote_mode: 'onsite' | 'hybrid' | 'remote' | 'unknown';
  employment_type: string | null;
  published_at: number | null;
  deadline: number | null;
  first_seen_at: number;
  last_seen_at: number;
  last_changed_at: number;
  active: number;
  lifecycle_status: 'open' | 'possibly_closed' | 'closed';
  closed_at: number | null;
  canonical_url: string;
  current_snapshot_id: string;
  source_count: number;
  source_names: string;
  skills: string | null;
  triage_status: TriageStatus;
  triage_note: string | null;
  triage_updated_at: number | null;
  score_state: JobScoreSummary['state'];
  task_id: string | null;
  task_status: JobScoreSummary['taskStatus'];
  match_score: number | null;
  ranking_score: number | null;
  eligible: number | null;
  confidence_micros: number | null;
  unknowns_json: string | null;
  review_state: JobScoreSummary['reviewState'];
  scoring_version: string | null;
  last_error_code: string | null;
  last_error_summary: string | null;
  total_count: number;
}

function iso(milliseconds: number | null): string | null {
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const sortColumns: Record<ReviewJobsQuery['sort'], string> = {
  matchScore: 'match_score',
  rankingScore: 'ranking_score',
  publishedAt: 'published_at',
  deadline: 'deadline',
  lastChangedAt: 'last_changed_at',
};

function scoreStateSql(alias = ''): string {
  const prefix = alias ? `${alias}.` : '';
  return `case
    when ${prefix}score_id is not null and ${prefix}eligible = 0 then 'gate_failed'
    when ${prefix}score_id is not null and ${prefix}review_state = 'pending' then 'review'
    when ${prefix}score_id is not null then 'scored'
    when ${prefix}task_status = 'running' then 'running'
    when ${prefix}task_status = 'failed' then 'failed'
    when ${prefix}task_status = 'pending' and ${prefix}retry_at is not null then 'retry_wait'
    when ${prefix}task_status = 'pending' then 'pending'
    when ${prefix}task_status = 'review' then 'review'
    else 'unscored'
  end`;
}

export class ReviewRepository {
  public constructor(private readonly client: DatabaseClient) {}

  public listJobs(query: ReviewJobsQuery): {
    jobs: ReviewJobSummary[];
    total: number;
    limit: number;
    offset: number;
  } {
    const activeProfileVersion = this.activeProfileVersion() ?? -1;
    const where: string[] = [];
    const values: Array<string | number> = [];
    if (!query.includeClosed) where.push('active = 1');
    if (query.search) {
      where.push(`(
        lower(title) like ? or lower(company) like ? or
        lower(coalesce(skills, '')) like ?
      )`);
      const pattern = `%${query.search.toLocaleLowerCase()}%`;
      values.push(pattern, pattern, pattern);
    }
    if (query.triage) {
      where.push('triage_status = ?');
      values.push(query.triage);
    }
    if (query.location) {
      where.push('lower(location) like ?');
      values.push(`%${query.location.toLocaleLowerCase()}%`);
    }
    if (query.remoteMode) {
      where.push('remote_mode = ?');
      values.push(query.remoteMode);
    }
    if (query.company) {
      where.push('lower(company) like ?');
      values.push(`%${query.company.toLocaleLowerCase()}%`);
    }
    if (query.sourceId) {
      where.push('source_ids like ?');
      values.push(`%|${query.sourceId}|%`);
    }
    if (query.lifecycle) {
      where.push('lifecycle_status = ?');
      values.push(query.lifecycle);
    }
    if (query.gate === 'passed') where.push('score_id is not null and eligible = 1');
    if (query.gate === 'failed') where.push('score_id is not null and eligible = 0');
    if (query.gate === 'unscored') where.push('score_id is null');
    if (query.scoreStatus) {
      where.push(`${scoreStateSql()} = ?`);
      values.push(query.scoreStatus);
    }
    if (query.reviewState) {
      where.push('review_state = ?');
      values.push(query.reviewState);
    }

    const sortColumn = sortColumns[query.sort];
    const direction = query.direction === 'asc' ? 'asc' : 'desc';
    const statement = this.client.sqlite.prepare(`
      with ranked_scores as (
        select js.*, row_number() over (
          partition by js.job_id order by js.created_at desc, js.id desc
        ) as row_number
        from job_scores js
        where js.invalidated_at is null and js.profile_version = ?
      ), current_scores as (
        select * from ranked_scores where row_number = 1
      ), ranked_tasks as (
        select st.*, row_number() over (
          partition by st.job_id order by st.updated_at desc, st.id desc
        ) as row_number
        from scoring_tasks st
        where st.invalidated_at is null and st.profile_version = ?
      ), current_tasks as (
        select * from ranked_tasks where row_number = 1
      ), source_summary as (
        select
          js.job_id,
          count(*) as source_count,
          json_group_array(s.name) as source_names,
          '|' || group_concat(js.source_id, '|') || '|' as source_ids,
          max(case when js.active = 1 and js.consecutive_misses = 0 then 1 else 0 end)
            as confirmed_open
        from job_sources js
        inner join sources s on s.id = js.source_id
        group by js.job_id
      ), base as (
        select
          j.*,
          case
            when j.active = 0 then 'closed'
            when ss.confirmed_open = 1 then 'open'
            else 'possibly_closed'
          end as lifecycle_status,
          ss.source_count,
          ss.source_names,
          ss.source_ids,
          coalesce(jt.status, 'new') as triage_status,
          jt.note as triage_note,
          jt.updated_at as triage_updated_at,
          cs.id as score_id,
          cs.eligible,
          cs.match_score,
          cs.ranking_score,
          cs.confidence_micros,
          cs.unknowns_json,
          cs.review_state,
          cs.scoring_version,
          ct.id as task_id,
          ct.status as task_status,
          ct.retry_at,
          ct.last_error_code,
          ct.last_error_summary,
          (
            select json_group_array(skill_name)
            from (
              select distinct json_extract(skill.value, '$.name') as skill_name
              from json_each(json_extract(jr.extraction_json, '$.requiredSkills')) skill
              union
              select distinct json_extract(skill.value, '$.name') as skill_name
              from json_each(json_extract(jr.extraction_json, '$.preferredSkills')) skill
            ) where skill_name is not null
          ) as skills
        from jobs j
        inner join source_summary ss on ss.job_id = j.id
        left join job_triage jt on jt.job_id = j.id
        left join current_scores cs on cs.job_id = j.id
        left join current_tasks ct on ct.job_id = j.id
        left join job_requirements jr on jr.id = cs.requirement_id
      ), filtered as (
        select base.*, ${scoreStateSql()} as score_state
        from base
        ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
      )
      select filtered.*, count(*) over () as total_count
      from filtered
      order by (${sortColumn} is null) asc, ${sortColumn} ${direction}, id asc
      limit ? offset ?
    `);
    const rows = statement.all(
      activeProfileVersion,
      activeProfileVersion,
      ...values,
      query.limit,
      query.offset,
    ) as ReviewListRow[];
    return {
      jobs: rows.map((row) => this.summaryFromRow(row)),
      total: rows[0]?.total_count ?? this.countJobs(query),
      limit: query.limit,
      offset: query.offset,
    };
  }

  public getTriage(jobId: string): TriageRecord {
    this.requireJob(jobId);
    const row = this.client.db
      .select()
      .from(jobTriage)
      .where(eq(jobTriage.jobId, jobId))
      .get();
    return triageRecordSchema.parse(
      row
        ? {
            jobId: row.jobId,
            status: row.status,
            note: row.note,
            updatedAt: row.updatedAt.toISOString(),
          }
        : { jobId, status: 'new', note: null, updatedAt: null },
    );
  }

  public updateTriage(
    jobId: string,
    status: TriageStatus,
    note: string | null | undefined,
    now = new Date(),
  ): { current: TriageRecord; previous: TriageRecord } {
    const previous = this.getTriage(jobId);
    const nextNote = note === undefined ? previous.note : note;
    if (previous.status === status && previous.note === nextNote) {
      return { current: previous, previous };
    }
    if (status === 'new' && nextNote === null) {
      this.client.db.delete(jobTriage).where(eq(jobTriage.jobId, jobId)).run();
      return { current: this.getTriage(jobId), previous };
    }
    this.client.db
      .insert(jobTriage)
      .values({
        jobId,
        status,
        note: nextNote,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: jobTriage.jobId,
        set: {
          status,
          note: nextNote,
          updatedAt: now,
        },
      })
      .run();
    return { current: this.getTriage(jobId), previous };
  }

  public bulkUpdateTriage(
    jobIds: readonly string[],
    status: TriageStatus,
    now = new Date(),
  ): { current: TriageRecord[]; previous: TriageRecord[] } {
    const rows = this.client.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(inArray(jobs.id, [...jobIds]))
      .all();
    if (rows.length !== jobIds.length) {
      throw new ReviewRepositoryError('JOB_NOT_FOUND', 'One or more jobs do not exist.');
    }
    const previous = jobIds.map((jobId) => this.getTriage(jobId));
    this.client.db.transaction((transaction) => {
      for (const item of previous) {
        if (item.status === status) continue;
        if (status === 'new' && item.note === null) {
          transaction.delete(jobTriage).where(eq(jobTriage.jobId, item.jobId)).run();
          continue;
        }
        transaction
          .insert(jobTriage)
          .values({ jobId: item.jobId, status, note: item.note, updatedAt: now })
          .onConflictDoUpdate({
            target: jobTriage.jobId,
            set: { status, updatedAt: now },
          })
          .run();
      }
    });
    return { current: jobIds.map((jobId) => this.getTriage(jobId)), previous };
  }

  public restoreTriage(records: ReadonlyArray<TriageRecord>): TriageRecord[] {
    const jobIds = records.map(({ jobId }) => jobId);
    const rows = this.client.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(inArray(jobs.id, jobIds))
      .all();
    if (rows.length !== records.length) {
      throw new ReviewRepositoryError('JOB_NOT_FOUND', 'One or more jobs do not exist.');
    }
    this.client.db.transaction((transaction) => {
      for (const record of records) {
        if (record.updatedAt === null) {
          transaction.delete(jobTriage).where(eq(jobTriage.jobId, record.jobId)).run();
          continue;
        }
        transaction
          .insert(jobTriage)
          .values({
            jobId: record.jobId,
            status: record.status,
            note: record.note,
            updatedAt: new Date(record.updatedAt),
          })
          .onConflictDoUpdate({
            target: jobTriage.jobId,
            set: {
              status: record.status,
              note: record.note,
              updatedAt: new Date(record.updatedAt),
            },
          })
          .run();
      }
    });
    return jobIds.map((jobId) => this.getTriage(jobId));
  }

  public listFeedback(jobId: string): ScoreFeedback[] {
    this.requireJob(jobId);
    const versions = this.activeProfileVersions();
    if (versions.length === 0) return [];
    return this.client.db
      .select({ feedback: scoreFeedback })
      .from(scoreFeedback)
      .innerJoin(jobScores, eq(scoreFeedback.scoreId, jobScores.id))
      .where(
        and(eq(scoreFeedback.jobId, jobId), inArray(jobScores.profileVersion, versions)),
      )
      .orderBy(desc(scoreFeedback.createdAt), desc(scoreFeedback.id))
      .all()
      .map(({ feedback }) => this.feedbackFromRow(feedback));
  }

  public createFeedback(
    jobId: string,
    input: CreateFeedbackRequest,
    now = new Date(),
  ): ScoreFeedback {
    this.requireJob(jobId);
    const current = this.currentScore(jobId);
    const id = randomUUID();
    this.client.db
      .insert(scoreFeedback)
      .values({
        id,
        jobId,
        scoreId: current?.id ?? null,
        type: input.type,
        originalScore: current?.matchScore ?? null,
        suggestedScore: input.suggestedScore ?? null,
        reason: input.reason,
        createdAt: now,
      })
      .run();
    return this.feedbackFromRow(
      this.client.db.select().from(scoreFeedback).where(eq(scoreFeedback.id, id)).get()!,
    );
  }

  public listReviewEvents(jobId: string): ScoreReviewEvent[] {
    this.requireJob(jobId);
    const versions = this.activeProfileVersions();
    if (versions.length === 0) return [];
    return this.client.db
      .select({ event: scoreReviewEvents })
      .from(scoreReviewEvents)
      .innerJoin(jobScores, eq(scoreReviewEvents.scoreId, jobScores.id))
      .where(
        and(
          eq(scoreReviewEvents.jobId, jobId),
          inArray(jobScores.profileVersion, versions),
        ),
      )
      .orderBy(desc(scoreReviewEvents.createdAt), desc(scoreReviewEvents.id))
      .all()
      .map(({ event }) => this.reviewEventFromRow(event));
  }

  public updateReviewState(
    jobId: string,
    state: 'pending' | 'approved' | 'rejected',
    reason: string,
    now = new Date(),
  ): ScoreReviewEvent {
    this.requireJob(jobId);
    const score = this.currentScore(jobId);
    if (!score) {
      throw new ReviewRepositoryError(
        'SCORE_NOT_FOUND',
        'This job has no current formal score to review.',
      );
    }
    const existing = this.client.db
      .select()
      .from(scoreReviewEvents)
      .where(
        and(
          eq(scoreReviewEvents.scoreId, score.id),
          eq(scoreReviewEvents.state, state),
          eq(scoreReviewEvents.reason, reason),
        ),
      )
      .orderBy(desc(scoreReviewEvents.createdAt))
      .get();
    if (score.reviewState === state && existing) return this.reviewEventFromRow(existing);

    const id = randomUUID();
    this.client.db.transaction((transaction) => {
      transaction
        .insert(scoreReviewEvents)
        .values({
          id,
          jobId,
          scoreId: score.id,
          previousState: score.reviewState,
          state,
          reason,
          createdAt: now,
        })
        .run();
      transaction
        .update(jobScores)
        .set({ reviewState: state, updatedAt: now })
        .where(eq(jobScores.id, score.id))
        .run();
    });
    return this.reviewEventFromRow(
      this.client.db
        .select()
        .from(scoreReviewEvents)
        .where(eq(scoreReviewEvents.id, id))
        .get()!,
    );
  }

  private countJobs(query: ReviewJobsQuery): number {
    if (query.offset === 0) return 0;
    return this.listJobs({ ...query, offset: 0, limit: 1 }).total;
  }

  private requireJob(jobId: string): void {
    if (
      !this.client.db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).get()
    ) {
      throw new ReviewRepositoryError('JOB_NOT_FOUND', 'Job does not exist.');
    }
  }

  private currentScore(jobId: string): typeof jobScores.$inferSelect | undefined {
    const activeProfileVersion = this.activeProfileVersion();
    if (activeProfileVersion === null) return undefined;
    return this.client.db
      .select()
      .from(jobScores)
      .where(
        and(
          eq(jobScores.jobId, jobId),
          eq(jobScores.profileVersion, activeProfileVersion),
          isNull(jobScores.invalidatedAt),
        ),
      )
      .orderBy(desc(jobScores.createdAt), desc(jobScores.id))
      .get();
  }

  private activeProfileVersion(): number | null {
    return (
      this.client.db
        .select({ version: profiles.currentVersion })
        .from(profiles)
        .where(eq(profiles.isActive, true))
        .get()?.version ?? null
    );
  }

  private activeProfileVersions(): number[] {
    const active = this.client.db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.isActive, true))
      .get();
    if (!active) return [];
    return this.client.db
      .select({ version: profileVersions.version })
      .from(profileVersions)
      .where(eq(profileVersions.profileId, active.id))
      .all()
      .map(({ version }) => version);
  }

  private summaryFromRow(row: ReviewListRow): ReviewJobSummary {
    const unknowns = parseJsonArray(row.unknowns_json);
    const sourceNames = parseJsonArray(row.source_names).filter(
      (value): value is string => typeof value === 'string',
    );
    const extractedSkills = parseJsonArray(row.skills).filter(
      (value): value is string => typeof value === 'string',
    );
    return reviewJobSummarySchema.parse({
      id: row.id,
      company: row.company,
      title: row.title,
      location: row.location,
      remoteMode: row.remote_mode,
      employmentType: row.employment_type,
      publishedAt: iso(row.published_at),
      deadline: iso(row.deadline),
      firstSeenAt: iso(row.first_seen_at),
      lastSeenAt: iso(row.last_seen_at),
      lastChangedAt: iso(row.last_changed_at),
      active: Boolean(row.active),
      lifecycleStatus: row.lifecycle_status,
      closedAt: iso(row.closed_at),
      canonicalUrl: row.canonical_url,
      currentSnapshotId: row.current_snapshot_id,
      sourceCount: row.source_count,
      sourceNames,
      extractedSkills,
      triage: {
        jobId: row.id,
        status: row.triage_status,
        note: row.triage_note,
        updatedAt: iso(row.triage_updated_at),
      },
      score: {
        state: row.score_state,
        taskId: row.task_id,
        taskStatus: row.task_status,
        matchScore: row.match_score,
        rankingScore: row.ranking_score,
        eligible: row.eligible === null ? null : Boolean(row.eligible),
        confidence:
          row.confidence_micros === null ? null : row.confidence_micros / 1_000_000,
        unknownCount: unknowns.length,
        reviewState: row.review_state,
        scoringVersion: row.scoring_version,
        lastErrorCode: row.last_error_code,
        lastErrorSummary: row.last_error_summary,
      },
    });
  }

  private feedbackFromRow(row: typeof scoreFeedback.$inferSelect): ScoreFeedback {
    return scoreFeedbackSchema.parse({
      id: row.id,
      jobId: row.jobId,
      scoreId: row.scoreId,
      type: row.type,
      originalScore: row.originalScore,
      suggestedScore: row.suggestedScore,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    });
  }

  private reviewEventFromRow(
    row: typeof scoreReviewEvents.$inferSelect,
  ): ScoreReviewEvent {
    return scoreReviewEventSchema.parse({
      id: row.id,
      jobId: row.jobId,
      scoreId: row.scoreId,
      previousState: row.previousState,
      state: row.state,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
