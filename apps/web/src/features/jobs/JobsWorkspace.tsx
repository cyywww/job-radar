import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

import { JobDetailPanel } from './JobDetailPanel.js';
import { JobFilters } from './JobFilters.js';
import { JobResults } from './JobResults.js';

const SAVED_FILTERS_KEY = 'job-radar.jobs.filters.v1';
const terminalStatuses = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
function initialWorkspaceState(): {
  query: ReviewJobsQuery;
  view: 'table' | 'cards';
} {
  const fallback = {
    query: reviewJobsQuerySchema.parse({ includeClosed: 'false' }),
    view: 'cards' as const,
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

export function JobsWorkspace(): React.JSX.Element {
  const initial = useMemo(() => initialWorkspaceState(), []);
  const [query, setQuery] = useState<ReviewJobsQuery>(initial.query);
  const [view, setView] = useState<'table' | 'cards'>(initial.view);
  const [jobs, setJobs] = useState<ReviewJobSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState<SourceView[]>([]);
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [scoringConfiguration, setScoringConfiguration] =
    useState<ScoringConfiguration | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [detail, setDetail] = useState<JobReviewDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [undoRecords, setUndoRecords] = useState<TriageRecord[] | null>(null);
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
    [query],
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

  const activeRunId = activeRun?.id;
  useEffect(() => {
    if (!activeRunId) return;
    const events = new EventSource(`/api/scans/${activeRunId}/events`);
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
  }, [activeRunId, refreshList]);

  function updateQuery(patch: Partial<ReviewJobsQuery>): void {
    setQuery((current) => ({ ...current, ...patch, offset: 0 }));
  }

  function showQuickView(viewName: 'all' | 'new' | 'saved' | 'review'): void {
    setQuery((current) => ({
      ...current,
      triage:
        viewName === 'new' ? 'new' : viewName === 'saved' ? 'shortlisted' : undefined,
      reviewState: viewName === 'review' ? 'pending' : undefined,
      includeClosed: false,
      offset: 0,
    }));
    setSelectedIds(new Set());
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
  ): Promise<boolean> {
    if (busyAction) return false;
    setBusyAction(key);
    setError(null);
    setNotice(null);
    try {
      await operation();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : failure);
      return false;
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
          setNotice('Refreshing this job from its current source.');
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

  async function handleReview(
    state: 'pending' | 'approved' | 'rejected',
    reason: string,
  ): Promise<boolean> {
    if (!detail || !reason.trim()) {
      setError('Enter a review explanation before saving the decision.');
      return false;
    }
    return runAction(
      `review-${state}`,
      async () => {
        await updateJobReview(detail.job.id, state, reason);
        setNotice(`Human review marked ${state}; the formal score was not changed.`);
        await refreshList(true);
        await refreshDetail(detail.job.id);
      },
      'Could not save the review decision',
    );
  }

  async function handleFeedback(input: CreateFeedbackRequest): Promise<boolean> {
    if (!detail) return false;
    return runAction(
      'feedback',
      async () => {
        await createJobFeedback(detail.job.id, input);
        setNotice('Correction feedback appended separately from the formal M3 score.');
        await refreshDetail(detail.job.id);
      },
      'Could not append correction feedback',
    );
  }

  const visibleDetail = detail?.job.id === selectedId ? detail : null;

  return (
    <section
      className={`jobs-workspace${selectionMode ? ' jobs-workspace--selecting' : ''}`}
      aria-labelledby="jobs-heading"
    >
      <header className="workspace-hero jobs-heading">
        <div>
          <p className="eyebrow">Opportunities</p>
          <h1 id="jobs-heading">Your job matches</h1>
          <p>Find promising roles, save the best ones, and move on quickly.</p>
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
                : 'Update jobs'}
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
            Analyze next job
          </button>
          <small className="audit-note">
            {scoringConfiguration?.ready
              ? 'Analyzes one waiting job. Usage is recorded locally.'
              : 'AI analysis is off. Choose a model in the local environment to enable it.'}
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
              <strong>{activeRun.stage}</strong>
            </div>
          </div>
          <p>
            {activeRun.counts.discovered} found · {activeRun.counts.fetched} fetched ·{' '}
            {activeRun.counts.failed} failed
          </p>
          <small>State is durable; reconnecting restores this snapshot.</small>
        </section>
      ) : null}

      <JobFilters
        query={query}
        sources={sources}
        onChange={updateQuery}
        onQuickView={showQuickView}
        onSave={saveFilters}
        onClear={clearFilters}
      />

      <div className="jobs-toolbar">
        <div>
          <strong>{total}</strong> role{total === 1 ? '' : 's'}
        </div>
        <details className="list-tools">
          <summary>List tools</summary>
          <div className="list-tools__body">
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
              <button
                type="button"
                aria-pressed={selectionMode}
                onClick={() => {
                  setSelectionMode((current) => !current);
                  setSelectedIds(new Set());
                }}
              >
                Select jobs
              </button>
            </div>
            {selectionMode ? (
              <div className="bulk-actions" aria-label="Bulk actions">
                <span>{selectedIds.size} selected</span>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || Boolean(busyAction)}
                  onClick={() => void handleTriage([...selectedIds], 'shortlisted', true)}
                >
                  Save
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
                  Reanalyze
                </button>
                <button
                  type="button"
                  disabled={Boolean(busyAction)}
                  onClick={() =>
                    void runAction(
                      'retry-failed',
                      async () => {
                        const tasks = await retryFailedScoring();
                        setNotice(
                          `${tasks.length} retryable failure(s) returned to pending.`,
                        );
                        await refreshList(true);
                      },
                      'Could not retry failed scoring tasks',
                    )
                  }
                >
                  Retry failures
                </button>
              </div>
            ) : null}
          </div>
        </details>
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
        <JobResults
          jobs={jobs}
          loading={loading}
          view={view}
          selectionMode={selectionMode}
          selectedId={selectedId}
          selectedIds={selectedIds}
          setSelectedId={setSelectedId}
          setSelectedIds={setSelectedIds}
        />

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
              key={visibleDetail.job.id}
              detail={visibleDetail}
              busy={Boolean(busyAction)}
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
