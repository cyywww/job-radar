import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  SAVED_JOB_FILTERS_VERSION,
  reviewJobsQuerySchema,
  savedJobFiltersSchema,
  scanEventSchema,
  type CreateFeedbackRequest,
  type JobReviewDetail,
  type ReviewJobSummary,
  type ReviewJobsQuery,
  type ScanRun,
  type ScoringConfiguration,
  type SourceView,
  type TriageRecord,
  type TriageStatus,
} from '@job-radar/shared';

import {
  bulkRescoreJobs,
  bulkUpdateJobTriage,
  cancelScan,
  createJobFeedback,
  fetchReviewJob,
  fetchReviewJobs,
  fetchScoringConfiguration,
  fetchScans,
  fetchSources,
  processScoringQueue,
  refreshJob,
  rescoreJob,
  retryFailedScoring,
  retryScoringTask,
  restoreJobTriage,
  startScan,
  updateJobReview,
  updateJobTriage,
} from '../../api/jobs.js';

const SAVED_FILTERS_KEY = 'job-radar.jobs.filters.v1';
const terminalStatuses = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
const scoreDimensions = [
  ['requiredSkills', 'Required skills'],
  ['skillDepth', 'Skill depth'],
  ['responsibilities', 'Responsibilities'],
  ['seniority', 'Experience & seniority'],
  ['domain', 'Domain'],
  ['location', 'Location & work mode'],
  ['softPreferences', 'Soft preferences'],
] as const;

interface JobsWorkspaceProps {
  readonly initialSelectedId?: string;
}

function formatDate(value: string | null): string {
  if (!value) return 'Not specified';
  return new Intl.DateTimeFormat('en-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function lifecycleLabel(status: ReviewJobSummary['lifecycleStatus']): string {
  return status === 'possibly_closed' ? 'possibly closed' : status;
}

function safeExternalHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function scoreLabel(job: ReviewJobSummary): React.JSX.Element {
  const score = job.score;
  if (score.state === 'gate_failed') {
    return (
      <span className="score-state score-state--failed">Gate failed · no score</span>
    );
  }
  if (score.matchScore === null || score.rankingScore === null) {
    const labels: Record<typeof score.state, string> = {
      unscored: 'Not scored',
      pending: 'Scoring pending',
      running: 'Scoring running',
      failed: 'Scoring failed',
      retry_wait: 'Retry scheduled',
      review: 'Review required',
      scored: 'Scored',
    };
    return (
      <span className={`score-state score-state--${score.state}`}>
        {labels[score.state]}
      </span>
    );
  }
  return (
    <span
      className="score-pair"
      aria-label={`Match ${score.matchScore}; ranking ${score.rankingScore}`}
    >
      <b>{score.matchScore}</b>
      <small>match</small>
      <b>{score.rankingScore}</b>
      <small>rank</small>
    </span>
  );
}

function initialWorkspaceState(): {
  query: ReviewJobsQuery;
  view: 'table' | 'cards';
} {
  const fallback = {
    query: reviewJobsQuerySchema.parse({ includeClosed: 'false' }),
    view: 'table' as const,
  };
  try {
    const raw = window.localStorage.getItem(SAVED_FILTERS_KEY);
    if (!raw) return fallback;
    const saved = savedJobFiltersSchema.parse(JSON.parse(raw));
    return {
      query: reviewJobsQuerySchema.parse({
        ...saved.filters,
        includeClosed: saved.filters.includeClosed ? 'true' : 'false',
        limit: 50,
        offset: 0,
      }),
      view: saved.view,
    };
  } catch {
    return fallback;
  }
}

export function JobsWorkspace({
  initialSelectedId,
}: JobsWorkspaceProps): React.JSX.Element {
  const initial = useMemo(() => initialWorkspaceState(), []);
  const [query, setQuery] = useState<ReviewJobsQuery>(initial.query);
  const [view, setView] = useState<'table' | 'cards'>(initial.view);
  const [jobs, setJobs] = useState<ReviewJobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState<SourceView[]>([]);
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [scoringConfiguration, setScoringConfiguration] =
    useState<ScoringConfiguration | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<JobReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoRecords, setUndoRecords] = useState<TriageRecord[] | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [feedbackType, setFeedbackType] =
    useState<CreateFeedbackRequest['type']>('job_specific');
  const [feedbackScore, setFeedbackScore] = useState('');
  const [feedbackReason, setFeedbackReason] = useState('');
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);

  const activeRun = useMemo(
    () => runs.find((run) => !terminalStatuses.has(run.status)) ?? null,
    [runs],
  );

  const refreshList = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [result, nextSources, nextRuns, nextScoringConfiguration] =
          await Promise.all([
            fetchReviewJobs(query),
            fetchSources(true),
            fetchScans(),
            fetchScoringConfiguration(),
          ]);
        setJobs(result.jobs);
        setTotal(result.total);
        setSources(nextSources);
        setRuns(nextRuns);
        setScoringConfiguration(nextScoringConfiguration);
        setSelectedId((current) => {
          if (
            initialSelectedId &&
            result.jobs.some((job) => job.id === initialSelectedId)
          ) {
            return initialSelectedId;
          }
          return current && result.jobs.some((job) => job.id === current)
            ? current
            : (result.jobs[0]?.id ?? null);
        });
        setSelectedIds(
          (current) =>
            new Set(
              [...current].filter((id) => result.jobs.some((job) => job.id === id)),
            ),
        );
        setError(null);
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : 'Could not load the job review',
        );
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [initialSelectedId, query],
  );

  const refreshDetail = useCallback(async (jobId: string) => {
    setDetailLoading(true);
    try {
      const next = await fetchReviewJob(jobId);
      setDetail(next);
      setError(null);
      window.setTimeout(() => detailHeadingRef.current?.focus(), 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load job detail');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshList(), 0);
    return () => window.clearTimeout(initial);
  }, [refreshList]);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      if (selectedId) void refreshDetail(selectedId);
      else setDetail(null);
    }, 0);
    return () => window.clearTimeout(initial);
  }, [refreshDetail, selectedId]);

  useEffect(() => {
    if (!activeRun) return;
    if (typeof EventSource === 'undefined') {
      const fallback = window.setInterval(() => void refreshList(true), 1_000);
      return () => window.clearInterval(fallback);
    }
    const events = new EventSource(`/api/scans/${activeRun.id}/events`);
    const onScan = (message: MessageEvent<string>) => {
      try {
        const event = scanEventSchema.parse(JSON.parse(message.data));
        setRuns((current) => [
          event.scan,
          ...current.filter((run) => run.id !== event.scan.id),
        ]);
        setNotice(
          event.terminal
            ? `Scan ${event.scan.status}. ${event.scan.counts.created} new, ${event.scan.counts.failed} failed.`
            : `Scan phase: ${event.phase}.`,
        );
        if (event.terminal) {
          events.close();
          void refreshList(true);
        }
      } catch {
        setError('Scan progress did not match the local SSE contract.');
      }
    };
    events.addEventListener('scan', onScan as EventListener);
    events.onerror = () => {
      events.close();
      void refreshList(true);
    };
    return () => events.close();
  }, [activeRun, refreshList]);

  function updateQuery(patch: Partial<ReviewJobsQuery>): void {
    setQuery((current) => ({ ...current, ...patch, offset: 0 }));
  }

  function saveFilters(): void {
    const filters = {
      search: query.search,
      triage: query.triage,
      location: query.location,
      remoteMode: query.remoteMode,
      company: query.company,
      sourceId: query.sourceId,
      lifecycle: query.lifecycle,
      gate: query.gate,
      scoreStatus: query.scoreStatus,
      reviewState: query.reviewState,
      includeClosed: query.includeClosed,
      sort: query.sort,
      direction: query.direction,
    };
    window.localStorage.setItem(
      SAVED_FILTERS_KEY,
      JSON.stringify(
        savedJobFiltersSchema.parse({
          version: SAVED_JOB_FILTERS_VERSION,
          view,
          filters,
        }),
      ),
    );
    setNotice('Filters and view saved in this browser.');
  }

  function clearFilters(): void {
    window.localStorage.removeItem(SAVED_FILTERS_KEY);
    setQuery(reviewJobsQuerySchema.parse({ includeClosed: 'false' }));
    setSelectedIds(new Set());
  }

  function changePage(offset: number): void {
    setQuery((current) => ({ ...current, offset: Math.max(0, offset) }));
    setSelectedIds(new Set());
  }

  async function runAction(
    key: string,
    operation: () => Promise<void>,
    failure: string,
  ): Promise<void> {
    if (busyAction) return;
    setBusyAction(key);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : failure);
    } finally {
      setBusyAction(null);
    }
  }

  async function handleStart(): Promise<void> {
    await runAction(
      'scan',
      async () => {
        const run = await startScan();
        setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
        setNotice('Explicit scan queued. Progress will stream from persisted run state.');
      },
      'Could not start scan',
    );
  }

  async function handleCancel(): Promise<void> {
    if (!activeRun) return;
    await runAction(
      'cancel',
      async () => {
        await cancelScan(activeRun.id);
        await refreshList(true);
      },
      'Could not cancel scan',
    );
  }

  async function handleTriage(
    jobIds: string[],
    status: TriageStatus,
    forceBulk = false,
  ): Promise<void> {
    const before = jobs;
    setJobs((current) =>
      current.map((job) =>
        jobIds.includes(job.id) ? { ...job, triage: { ...job.triage, status } } : job,
      ),
    );
    await runAction(
      `triage-${status}`,
      async () => {
        try {
          if (jobIds.length === 1 && !forceBulk) {
            const result = await updateJobTriage(jobIds[0]!, status);
            setUndoRecords([result.previous]);
            setDetail((current) =>
              current && current.job.id === jobIds[0]
                ? { ...current, triage: result.current }
                : current,
            );
          } else {
            const result = await bulkUpdateJobTriage(jobIds, status);
            setUndoRecords(result.previous);
          }
          setNotice(
            `${jobIds.length} job${jobIds.length === 1 ? '' : 's'} marked ${status}.`,
          );
          setSelectedIds(new Set());
          window.setTimeout(() => undoRef.current?.focus(), 0);
        } catch (reason) {
          setJobs(before);
          throw reason;
        }
      },
      'Could not update job state',
    );
  }

  async function handleUndo(): Promise<void> {
    if (!undoRecords) return;
    const records = undoRecords;
    await runAction(
      'undo',
      async () => {
        await restoreJobTriage(records);
        setUndoRecords(null);
        setNotice('The last triage action was undone.');
        await refreshList(true);
        if (selectedId) await refreshDetail(selectedId);
      },
      'Could not undo the last triage action',
    );
  }

  async function handleBulkRescore(): Promise<void> {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    await runAction(
      'bulk-rescore',
      async () => {
        const tasks = await bulkRescoreJobs(ids);
        setNotice(`${tasks.length} deterministic rescore task(s) queued.`);
        setSelectedIds(new Set());
        await refreshList(true);
      },
      'Could not queue bulk rescoring',
    );
  }

  async function handleDetailAction(action: 'refresh' | 'rescore'): Promise<void> {
    if (!detail) return;
    await runAction(
      action,
      async () => {
        if (action === 'refresh') {
          const run = await refreshJob(detail.job.id);
          setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
          setNotice('Current source refresh queued; this is not history reprocessing.');
        } else {
          await rescoreJob(detail.job.id);
          setNotice('A new scoring attempt was queued. Historical scores were retained.');
          await refreshList(true);
          await refreshDetail(detail.job.id);
        }
      },
      action === 'refresh' ? 'Could not refresh the job' : 'Could not queue rescoring',
    );
  }

  async function handleReview(state: 'pending' | 'approved' | 'rejected'): Promise<void> {
    if (!detail || !reviewReason.trim()) {
      setError('Enter a review explanation before saving the decision.');
      return;
    }
    await runAction(
      `review-${state}`,
      async () => {
        await updateJobReview(detail.job.id, state, reviewReason);
        setReviewReason('');
        setNotice(`Human review marked ${state}; the formal score was not changed.`);
        await refreshList(true);
        await refreshDetail(detail.job.id);
      },
      'Could not save the review decision',
    );
  }

  async function handleFeedback(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!detail) return;
    await runAction(
      'feedback',
      async () => {
        await createJobFeedback(detail.job.id, {
          type: feedbackType,
          ...(feedbackScore === '' ? {} : { suggestedScore: Number(feedbackScore) }),
          reason: feedbackReason,
        });
        setFeedbackReason('');
        setFeedbackScore('');
        setNotice('Correction feedback appended separately from the formal M3 score.');
        await refreshDetail(detail.job.id);
      },
      'Could not append correction feedback',
    );
  }

  const visibleDetail = detail?.job.id === selectedId ? detail : null;
  const allSelected = jobs.length > 0 && jobs.every((job) => selectedIds.has(job.id));

  return (
    <section className="jobs-workspace" aria-labelledby="jobs-heading">
      <header className="workspace-hero jobs-heading">
        <div>
          <p className="eyebrow">Daily review workspace</p>
          <h1 id="jobs-heading">Jobs, evidence, and explicit decisions.</h1>
          <p>
            Closed roles stay hidden by default. Gate failures, retries, and human review
            remain distinct states—not zeroes.
          </p>
        </div>
        <div className="scan-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={Boolean(busyAction || activeRun)}
            onClick={() => void handleStart()}
          >
            {activeRun
              ? 'Scan in progress'
              : busyAction === 'scan'
                ? 'Starting…'
                : 'Scan sources'}
          </button>
          {activeRun ? (
            <button
              className="button button--quiet"
              type="button"
              disabled={Boolean(busyAction)}
              onClick={() => void handleCancel()}
            >
              Cancel
            </button>
          ) : null}
          <button
            className="button button--quiet"
            type="button"
            disabled={Boolean(busyAction) || !scoringConfiguration?.ready}
            onClick={() =>
              void runAction(
                'process',
                async () => {
                  const result = await processScoringQueue();
                  setNotice(
                    `Scoring run: ${result.succeeded} succeeded, ${result.review} need review, ${result.failed} failed; ${result.usage.totalTokens.toLocaleString()} tokens used.`,
                  );
                  await refreshList(true);
                },
                'Could not process the scoring queue',
              )
            }
          >
            Process scoring queue
          </button>
          <small className="audit-note">
            {scoringConfiguration?.ready
              ? `${scoringConfiguration.model} · one job per click · actual usage recorded`
              : 'Scoring disabled until JOB_RADAR_CODEX_MODEL is configured.'}
          </small>
        </div>
      </header>

      <div className="live-message" aria-live="polite" aria-atomic="true">
        {error ? <p className="alert alert--error">{error}</p> : null}
        {notice ? (
          <p className="alert alert--success">
            {notice}{' '}
            {undoRecords ? (
              <button
                ref={undoRef}
                type="button"
                className="inline-action"
                onClick={() => void handleUndo()}
              >
                Undo
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {activeRun ? (
        <section className="run-strip" aria-label="Current scan progress">
          <div>
            <span className={`run-state run-state--${activeRun.status}`} />
            <div>
              <p className="eyebrow">Scan progress</p>
              <strong>{activeRun.stage ?? activeRun.status}</strong>
            </div>
          </div>
          <p>
            {activeRun.counts.discovered} found · {activeRun.counts.fetched} fetched ·{' '}
            {activeRun.counts.failed} failed
          </p>
          <small>State is durable; reconnecting restores this snapshot.</small>
        </section>
      ) : null}

      <form
        className="job-filters"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="filter-search">
          Search title, company, or skill
          <input
            type="search"
            value={query.search}
            maxLength={200}
            onChange={(event) => updateQuery({ search: event.target.value })}
          />
        </label>
        <label>
          State
          <select
            value={query.triage ?? ''}
            onChange={(event) =>
              updateQuery({
                triage: (event.target.value || undefined) as TriageStatus | undefined,
              })
            }
          >
            <option value="">All</option>
            <option value="new">New</option>
            <option value="shortlisted">Shortlisted</option>
            <option value="ignored">Ignored</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>
          Remote
          <select
            value={query.remoteMode ?? ''}
            onChange={(event) =>
              updateQuery({
                remoteMode: (event.target.value ||
                  undefined) as ReviewJobsQuery['remoteMode'],
              })
            }
          >
            <option value="">All</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="onsite">Onsite</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          Source
          <select
            value={query.sourceId ?? ''}
            onChange={(event) =>
              updateQuery({ sourceId: event.target.value || undefined })
            }
          >
            <option value="">All</option>
            {sources.map((source) => (
              <option value={source.id} key={source.id}>
                {source.name}
                {source.configurationState === 'deleted' ? ' (deleted)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lifecycle
          <select
            value={query.lifecycle ?? ''}
            onChange={(event) =>
              updateQuery({
                lifecycle: (event.target.value ||
                  undefined) as ReviewJobsQuery['lifecycle'],
              })
            }
          >
            <option value="">All open states</option>
            <option value="open">Open</option>
            <option value="possibly_closed">Possibly closed</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label>
          Gate
          <select
            value={query.gate ?? ''}
            onChange={(event) =>
              updateQuery({
                gate: (event.target.value || undefined) as ReviewJobsQuery['gate'],
              })
            }
          >
            <option value="">All</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
            <option value="unscored">Not evaluated</option>
          </select>
        </label>
        <label>
          Score status
          <select
            value={query.scoreStatus ?? ''}
            onChange={(event) =>
              updateQuery({
                scoreStatus: (event.target.value ||
                  undefined) as ReviewJobsQuery['scoreStatus'],
              })
            }
          >
            <option value="">All</option>
            <option value="unscored">Unscored</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="retry_wait">Retry wait</option>
            <option value="gate_failed">Gate failed</option>
            <option value="review">Review</option>
            <option value="scored">Scored</option>
          </select>
        </label>
        <label>
          Review
          <select
            value={query.reviewState ?? ''}
            onChange={(event) =>
              updateQuery({
                reviewState: (event.target.value ||
                  undefined) as ReviewJobsQuery['reviewState'],
              })
            }
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="not_required">Not required</option>
          </select>
        </label>
        <label>
          Location
          <input
            value={query.location ?? ''}
            maxLength={160}
            onChange={(event) =>
              updateQuery({ location: event.target.value || undefined })
            }
          />
        </label>
        <label>
          Company
          <input
            value={query.company ?? ''}
            maxLength={160}
            onChange={(event) =>
              updateQuery({ company: event.target.value || undefined })
            }
          />
        </label>
        <label>
          Sort
          <select
            value={query.sort}
            onChange={(event) =>
              updateQuery({ sort: event.target.value as ReviewJobsQuery['sort'] })
            }
          >
            <option value="rankingScore">Ranking score</option>
            <option value="matchScore">Match score</option>
            <option value="publishedAt">Published</option>
            <option value="deadline">Deadline</option>
            <option value="lastChangedAt">Recently changed</option>
          </select>
        </label>
        <label>
          Direction
          <select
            value={query.direction}
            onChange={(event) =>
              updateQuery({
                direction: event.target.value as ReviewJobsQuery['direction'],
              })
            }
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={query.includeClosed}
            onChange={(event) => updateQuery({ includeClosed: event.target.checked })}
          />
          Show closed jobs
        </label>
        <div className="filter-actions">
          <button className="button button--quiet" type="button" onClick={saveFilters}>
            Save filters
          </button>
          <button className="text-button" type="button" onClick={clearFilters}>
            Clear
          </button>
        </div>
      </form>

      <div className="jobs-toolbar">
        <div>
          <strong>{total}</strong> matching role{total === 1 ? '' : 's'}
        </div>
        <div className="view-switch" aria-label="Job view">
          <button
            type="button"
            aria-pressed={view === 'table'}
            onClick={() => setView('table')}
          >
            Table
          </button>
          <button
            type="button"
            aria-pressed={view === 'cards'}
            onClick={() => setView('cards')}
          >
            Cards
          </button>
        </div>
        <div className="bulk-actions" aria-label="Bulk actions">
          <span>{selectedIds.size} selected</span>
          <button
            type="button"
            disabled={selectedIds.size === 0 || Boolean(busyAction)}
            onClick={() => void handleTriage([...selectedIds], 'shortlisted', true)}
          >
            Shortlist
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0 || Boolean(busyAction)}
            onClick={() => void handleTriage([...selectedIds], 'ignored', true)}
          >
            Ignore
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0 || Boolean(busyAction)}
            onClick={() => void handleTriage([...selectedIds], 'new', true)}
          >
            Restore
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0 || Boolean(busyAction)}
            onClick={() => void handleBulkRescore()}
          >
            Rescore
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() =>
              void runAction(
                'retry-failed',
                async () => {
                  const tasks = await retryFailedScoring();
                  setNotice(`${tasks.length} retryable failure(s) returned to pending.`);
                  await refreshList(true);
                },
                'Could not retry failed scoring tasks',
              )
            }
          >
            Retry failures
          </button>
        </div>
      </div>

      <nav className="job-pagination" aria-label="Job result pages">
        <span>
          {total === 0
            ? 'No results'
            : `${query.offset + 1}–${Math.min(query.offset + query.limit, total)} of ${total}`}
        </span>
        <button
          type="button"
          disabled={query.offset === 0 || loading}
          onClick={() => changePage(query.offset - query.limit)}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={query.offset + query.limit >= total || loading}
          onClick={() => changePage(query.offset + query.limit)}
        >
          Next
        </button>
      </nav>

      <div className="review-layout">
        <section className="review-results" aria-label="Job results" aria-busy={loading}>
          {loading ? (
            <p className="page-state" role="status">
              Loading filtered jobs…
            </p>
          ) : null}
          {!loading && jobs.length === 0 ? (
            <div className="empty-state">
              <strong>No jobs match these filters.</strong>
              <p>Clear filters, include closed roles, or run an explicit scan.</p>
            </div>
          ) : null}
          {!loading && view === 'table' && jobs.length > 0 ? (
            <div className="job-table-wrap">
              <table className="job-table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Select all visible jobs"
                        checked={allSelected}
                        onChange={(event) =>
                          setSelectedIds(
                            event.target.checked
                              ? new Set(jobs.map((job) => job.id))
                              : new Set(),
                          )
                        }
                      />
                    </th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Scores</th>
                    <th>Published</th>
                    <th>Changed</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className={selectedId === job.id ? 'is-selected' : undefined}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${job.title}`}
                          checked={selectedIds.has(job.id)}
                          onChange={(event) =>
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(job.id);
                              else next.delete(job.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="job-title-button"
                          type="button"
                          onClick={() => setSelectedId(job.id)}
                        >
                          <strong>{job.title}</strong>
                          <span>
                            {job.company} · {job.location}
                          </span>
                          <small>
                            {job.extractedSkills.slice(0, 4).join(' · ') ||
                              'No extracted skills yet'}
                          </small>
                        </button>
                      </td>
                      <td>
                        <span
                          className={`status-badge status-badge--${job.triage.status}`}
                        >
                          {job.triage.status}
                        </span>
                        <small>{lifecycleLabel(job.lifecycleStatus)}</small>
                      </td>
                      <td>{scoreLabel(job)}</td>
                      <td>{formatDate(job.publishedAt)}</td>
                      <td>{formatDate(job.lastChangedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!loading && view === 'cards' ? (
            <div className="job-card-grid">
              {jobs.map((job) => (
                <article
                  className={`job-card${selectedId === job.id ? ' is-selected' : ''}`}
                  key={job.id}
                >
                  <label className="card-select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(job.id)}
                      onChange={(event) =>
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(job.id);
                          else next.delete(job.id);
                          return next;
                        })
                      }
                    />
                    Select
                  </label>
                  <button
                    type="button"
                    className="job-card__main"
                    onClick={() => setSelectedId(job.id)}
                  >
                    <span className="eyebrow">{job.company}</span>
                    <strong>{job.title}</strong>
                    <span>
                      {job.location} · {job.remoteMode}
                    </span>
                    {scoreLabel(job)}
                    <small>
                      {job.triage.status} · {lifecycleLabel(job.lifecycleStatus)}
                    </small>
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <aside
          className="review-detail"
          aria-label="Job detail"
          aria-busy={detailLoading}
        >
          {detailLoading && !visibleDetail ? (
            <p className="page-state" role="status">
              Loading detail…
            </p>
          ) : null}
          {!detailLoading && !visibleDetail ? (
            <div className="empty-state">
              <strong>Select a role.</strong>
              <p>
                Formal score evidence and the safely rendered full description will appear
                here.
              </p>
            </div>
          ) : null}
          {visibleDetail ? (
            <JobDetailPanel
              detail={visibleDetail}
              busy={Boolean(busyAction)}
              reviewReason={reviewReason}
              setReviewReason={setReviewReason}
              feedbackType={feedbackType}
              setFeedbackType={setFeedbackType}
              feedbackScore={feedbackScore}
              setFeedbackScore={setFeedbackScore}
              feedbackReason={feedbackReason}
              setFeedbackReason={setFeedbackReason}
              headingRef={detailHeadingRef}
              onTriage={(status) => handleTriage([visibleDetail.job.id], status)}
              onRefresh={() => handleDetailAction('refresh')}
              onRescore={() => handleDetailAction('rescore')}
              onReview={handleReview}
              onFeedback={handleFeedback}
              onRetry={(taskId) =>
                runAction(
                  `retry-${taskId}`,
                  async () => {
                    await retryScoringTask(taskId);
                    setNotice('Failed scoring task returned to pending.');
                    await refreshList(true);
                    await refreshDetail(visibleDetail.job.id);
                  },
                  'Could not retry the scoring task',
                )
              }
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}

interface JobDetailPanelProps {
  readonly detail: JobReviewDetail;
  readonly busy: boolean;
  readonly reviewReason: string;
  readonly setReviewReason: (value: string) => void;
  readonly feedbackType: CreateFeedbackRequest['type'];
  readonly setFeedbackType: (value: CreateFeedbackRequest['type']) => void;
  readonly feedbackScore: string;
  readonly setFeedbackScore: (value: string) => void;
  readonly feedbackReason: string;
  readonly setFeedbackReason: (value: string) => void;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onTriage: (status: TriageStatus) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onRescore: () => Promise<void>;
  readonly onReview: (state: 'pending' | 'approved' | 'rejected') => Promise<void>;
  readonly onFeedback: (event: FormEvent) => Promise<void>;
  readonly onRetry: (taskId: string) => Promise<void>;
}

function JobDetailPanel({
  detail,
  busy,
  reviewReason,
  setReviewReason,
  feedbackType,
  setFeedbackType,
  feedbackScore,
  setFeedbackScore,
  feedbackReason,
  setFeedbackReason,
  headingRef,
  onTriage,
  onRefresh,
  onRescore,
  onReview,
  onFeedback,
  onRetry,
}: JobDetailPanelProps): React.JSX.Element {
  const { job, triage, currentScore, currentRequirement } = detail;
  const latestTask = detail.tasks[0] ?? null;
  const canonicalHref = safeExternalHref(job.canonicalUrl);
  return (
    <>
      <p className="eyebrow">{job.company}</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {job.title}
      </h2>
      <p className="audit-note">
        {lifecycleLabel(job.lifecycleStatus)} · first found {formatDate(job.firstSeenAt)}{' '}
        · last confirmed {formatDate(job.lastSeenAt)} · changed{' '}
        {formatDate(job.lastChangedAt)}
      </p>
      <div className="detail-actions" aria-label="Job actions">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onTriage('shortlisted')}
        >
          {triage.status === 'shortlisted' ? 'Shortlisted' : 'Shortlist'}
        </button>
        <button type="button" disabled={busy} onClick={() => void onTriage('ignored')}>
          Ignore
        </button>
        <button type="button" disabled={busy} onClick={() => void onTriage('archived')}>
          Archive
        </button>
        <button type="button" disabled={busy} onClick={() => void onTriage('new')}>
          Restore
        </button>
        <button type="button" disabled={busy} onClick={() => void onRefresh()}>
          Refresh source
        </button>
        <button type="button" disabled={busy} onClick={() => void onRescore()}>
          Rescore
        </button>
      </div>
      <dl className="job-meta">
        <div>
          <dt>Published</dt>
          <dd>{formatDate(job.publishedAt)}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{formatDate(job.deadline)}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{job.remoteMode}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{triage.status}</dd>
        </div>
      </dl>
      {canonicalHref ? (
        <a
          className="source-link"
          href={canonicalHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open original listing ↗
        </a>
      ) : (
        <span className="audit-note">Original listing URL is unavailable.</span>
      )}

      <section className="score-explanation" aria-labelledby="score-heading">
        <div className="description-heading">
          <h3 id="score-heading">Formal deterministic score</h3>
          <span>{currentScore?.scoringVersion ?? 'No current score'}</span>
        </div>
        {!currentScore ? (
          <div className="empty-state compact">
            <strong>{latestTask ? `Scoring ${latestTask.status}` : 'Not scored'}</strong>
            {latestTask?.lastErrorSummary ? <p>{latestTask.lastErrorSummary}</p> : null}
            {latestTask?.status === 'failed' ? (
              <button
                className="button button--quiet"
                type="button"
                disabled={busy}
                onClick={() => void onRetry(latestTask.id)}
              >
                Retry failed task
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="formal-score-grid">
              <article>
                <strong>{currentScore.matchScore ?? '—'}</strong>
                <span>Match score</span>
                <small>Evidence fit only</small>
              </article>
              <article>
                <strong>{currentScore.rankingScore ?? '—'}</strong>
                <span>Ranking score</span>
                <small>Ordering with freshness/uncertainty</small>
              </article>
              <article>
                <strong>{Math.round(currentScore.confidence * 100)}%</strong>
                <span>Confidence</span>
                <small>{currentScore.reviewState.replaceAll('_', ' ')}</small>
              </article>
            </div>
            {!currentScore.eligible ? (
              <p className="gate-banner gate-banner--failed">
                <strong>Gate failed — no numeric score.</strong> This is an eligibility
                result, not a 0 match.
              </p>
            ) : null}
            <h4>Eligibility Gate</h4>
            <ul className="gate-list">
              {currentScore.gateReasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`}>
                  <span className={`status-badge status-badge--${reason.outcome}`}>
                    {reason.outcome}
                  </span>
                  <strong>{reason.code.replaceAll('_', ' ')}</strong>
                  <p>{reason.explanation}</p>
                </li>
              ))}
            </ul>
            {currentScore.breakdown ? (
              <>
                <h4>Seven fixed dimensions</h4>
                <div className="breakdown-list">
                  {scoreDimensions.map(([key, label]) => {
                    const component = currentScore.breakdown![key];
                    return (
                      <article key={key}>
                        <div>
                          <strong>{label}</strong>
                          <span>
                            {component.points}/{component.weight} points
                          </span>
                        </div>
                        <progress
                          max={component.weight}
                          value={component.points}
                          aria-label={`${label}: ${component.points} of ${component.weight}`}
                        />
                        <p>{component.explanation}</p>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : null}
            <div className="evidence-grid">
              <section>
                <h4>Matched evidence</h4>
                {currentScore.matchedEvidence.length === 0 ? (
                  <p>None recorded.</p>
                ) : (
                  <ul>
                    {currentScore.matchedEvidence.map((item, index) => (
                      <li key={`${item.requirementId}-${index}`}>
                        <blockquote>{item.jdSnippet}</blockquote>
                        <strong>{item.evidenceDepth}</strong>
                        <p>{item.explanation}</p>
                        <small>Profile evidence {item.profileEvidenceId}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h4>Gaps</h4>
                {currentScore.gaps.length === 0 ? (
                  <p>No explicit gaps.</p>
                ) : (
                  <ul>
                    {currentScore.gaps.map((gap, index) => (
                      <li key={`${gap.requirementId ?? 'gap'}-${index}`}>
                        <strong>{gap.requirement}</strong>
                        <p>{gap.explanation}</p>
                        <small>{gap.severity}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h4>Unknowns</h4>
                {currentScore.unknowns.length === 0 ? (
                  <p>No unresolved conditions.</p>
                ) : (
                  <ul>
                    {currentScore.unknowns.map((unknown, index) => (
                      <li key={`${unknown.code}-${index}`}>
                        <strong>{unknown.question}</strong>
                        <p>{unknown.explanation}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
            <dl className="version-grid">
              <div>
                <dt>Extractor</dt>
                <dd>{currentRequirement?.extractorVersion ?? '—'}</dd>
              </div>
              <div>
                <dt>Scoring</dt>
                <dd>{currentScore.scoringVersion}</dd>
              </div>
              <div>
                <dt>Profile</dt>
                <dd>v{currentScore.profileVersion}</dd>
              </div>
              <div>
                <dt>Snapshot</dt>
                <dd>{currentScore.snapshotId}</dd>
              </div>
              <div>
                <dt>Provider/model</dt>
                <dd>
                  {currentScore.provider} / {currentScore.model}
                </dd>
              </div>
              <div>
                <dt>Ranking as of</dt>
                <dd>{formatDate(currentScore.rankingAsOf)}</dd>
              </div>
            </dl>
          </>
        )}
      </section>

      <section className="score-explanation" aria-labelledby="token-audit-heading">
        <div className="description-heading">
          <h3 id="token-audit-heading">AI token audit</h3>
          <span>Append-only attempts</span>
        </div>
        {detail.attempts.length === 0 ? (
          <p className="audit-note">No AI attempt has been recorded for this job.</p>
        ) : (
          <ul className="feedback-history">
            {detail.attempts.map((attempt) => (
              <li key={attempt.id}>
                <strong>
                  Attempt {attempt.attemptNumber} · {attempt.outcome}
                </strong>
                <p>
                  {attempt.model} ·{' '}
                  {attempt.usage
                    ? `${attempt.usage.totalTokens.toLocaleString()} total tokens (${attempt.usage.inputTokens.toLocaleString()} input, ${attempt.usage.outputTokens.toLocaleString()} output, ${attempt.usage.cachedInputTokens.toLocaleString()} cached, ${attempt.usage.reasoningOutputTokens.toLocaleString()} reasoning)`
                    : 'usage unavailable for this historical/interrupted attempt'}
                </p>
                <small>Finished {formatDate(attempt.finishedAt)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {currentScore && currentScore.reviewState !== 'not_required' ? (
        <section className="human-review" aria-labelledby="human-review-heading">
          <h3 id="human-review-heading">Human review</h3>
          <p>
            A decision changes only review state. It never rewrites match, ranking,
            breakdown, Gate, or versions.
          </p>
          <label>
            Required explanation
            <textarea
              value={reviewReason}
              maxLength={1000}
              onChange={(event) => setReviewReason(event.target.value)}
            />
          </label>
          <div>
            <button
              type="button"
              disabled={busy || !reviewReason.trim()}
              onClick={() => void onReview('approved')}
            >
              Approve extraction
            </button>
            <button
              type="button"
              disabled={busy || !reviewReason.trim()}
              onClick={() => void onReview('rejected')}
            >
              Reject / needs correction
            </button>
            <button
              type="button"
              disabled={busy || !reviewReason.trim()}
              onClick={() => void onReview('pending')}
            >
              Return to pending
            </button>
          </div>
          {detail.reviewHistory.length > 0 ? (
            <ol className="feedback-history" aria-label="Review decision history">
              {detail.reviewHistory.map((event) => (
                <li key={event.id}>
                  <strong>{event.state}</strong>
                  <span>
                    {event.previousState.replaceAll('_', ' ')} → {event.state}
                  </span>
                  <p>{event.reason}</p>
                  <small>{formatDate(event.createdAt)}</small>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      <form className="feedback-form" onSubmit={(event) => void onFeedback(event)}>
        <h3>Correction feedback</h3>
        <p>
          A suggested score is advisory and displayed separately from the formal M3 score.
        </p>
        <label>
          Feedback type
          <select
            value={feedbackType}
            onChange={(event) =>
              setFeedbackType(event.target.value as CreateFeedbackRequest['type'])
            }
          >
            <option value="job_specific">Job-specific</option>
            <option value="scoring_rule">Scoring rule</option>
            <option value="preference">Preference</option>
            <option value="profile_correction">Profile correction</option>
          </select>
        </label>
        <label>
          Suggested score (optional)
          <input
            type="number"
            min={0}
            max={100}
            value={feedbackScore}
            onChange={(event) => setFeedbackScore(event.target.value)}
          />
        </label>
        <label>
          Reason
          <textarea
            required
            maxLength={1000}
            value={feedbackReason}
            onChange={(event) => setFeedbackReason(event.target.value)}
          />
        </label>
        <button
          className="button button--quiet"
          type="submit"
          disabled={busy || !feedbackReason.trim()}
        >
          Append feedback
        </button>
        {detail.feedback.length > 0 ? (
          <ol className="feedback-history">
            {detail.feedback.map((feedback) => (
              <li key={feedback.id}>
                <strong>{feedback.type.replaceAll('_', ' ')}</strong>
                <span>
                  Formal {feedback.originalScore ?? 'none'} · suggested{' '}
                  {feedback.suggestedScore ?? 'none'}
                </span>
                <p>{feedback.reason}</p>
                <small>{formatDate(feedback.createdAt)}</small>
              </li>
            ))}
          </ol>
        ) : null}
      </form>

      <div className="description-heading">
        <h3>Complete description</h3>
        <span>Untrusted plain text</span>
      </div>
      <pre className="job-description">{job.snapshot.descriptionText}</pre>
      <p className="audit-note">
        HTML, scripts, model text, source metadata, and prompts are never rendered as
        executable content.
      </p>
      <div className="description-heading">
        <h3>Sources and merge evidence</h3>
        <span>{job.sources.length} source(s)</span>
      </div>
      <div className="job-audit-list">
        {job.sources.map((source) => {
          const sourceHref = safeExternalHref(source.sourceUrl);
          return (
            <article className="source-item" key={source.sourceId}>
              <div className="source-item__title">
                <strong>{source.sourceName}</strong>
                <span>
                  {source.active
                    ? source.consecutiveMisses > 0
                      ? `possibly missing (${source.consecutiveMisses})`
                      : 'open'
                    : 'closed'}
                </span>
              </div>
              <p>{source.matchExplanation}</p>
              <small>
                {source.matchStrategy.replaceAll('_', ' ')} · last confirmed{' '}
                {formatDate(source.lastSeenAt)}
              </small>
              {sourceHref ? (
                <a
                  className="source-link"
                  href={sourceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open source ↗
                </a>
              ) : (
                <span className="audit-note">Source URL is unavailable.</span>
              )}
            </article>
          );
        })}
      </div>
      <div className="description-heading">
        <h3>Snapshot history</h3>
        <span>Immutable</span>
      </div>
      <ol className="job-history">
        {job.history.map((snapshot) => (
          <li key={snapshot.id}>
            <strong>{formatDate(snapshot.fetchedAt)}</strong>
            <span>
              {snapshot.sourceName ?? 'Historical source'} ·{' '}
              {snapshot.changedFields.join(', ') || 'no material change classified'}
            </span>
            <small>
              {snapshot.location} · deadline {formatDate(snapshot.deadline)} · snapshot{' '}
              {snapshot.id}
            </small>
          </li>
        ))}
      </ol>
    </>
  );
}
