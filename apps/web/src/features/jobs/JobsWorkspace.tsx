import { useCallback, useEffect, useMemo, useState } from 'react';

import type { JobDetail, JobSummary, ScanRun, Source } from '@job-radar/shared';

import {
  cancelScan,
  fetchJob,
  fetchJobs,
  fetchScans,
  fetchSources,
  startScan,
} from '../../api/jobs.js';

const terminalStatuses = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

function formatDate(value: string | null): string {
  if (!value) return 'Not specified';
  return new Intl.DateTimeFormat('en-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function runLabel(run: ScanRun): string {
  const counts = run.counts;
  return `${counts.created} new · ${counts.updated} changed · ${counts.unchanged} unchanged · ${counts.failed} failed`;
}

export function JobsWorkspace(): React.JSX.Element {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [nextJobs, nextSources, nextRuns] = await Promise.all([
        fetchJobs(),
        fetchSources(),
        fetchScans(),
      ]);
      setJobs(nextJobs);
      setSources(nextSources);
      setRuns(nextRuns);
      setSelectedId((current) =>
        current && nextJobs.some((job) => job.id === current)
          ? current
          : (nextJobs[0]?.id ?? null),
      );
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load jobs');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  const activeRun = useMemo(
    () => runs.find((run) => !terminalStatuses.has(run.status)) ?? null,
    [runs],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  useEffect(() => {
    if (!activeRun) return;
    const timer = window.setInterval(() => void refresh(true), 1_500);
    return () => window.clearInterval(timer);
  }, [activeRun, refresh]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void fetchJob(selectedId)
      .then((job) => {
        if (active) setDetail(job);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Could not load job');
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const latestRun = runs[0] ?? null;
  const visibleDetail = detail?.id === selectedId ? detail : null;

  async function handleStart(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const run = await startScan();
      setRuns((current) => [run, ...current.filter((entry) => entry.id !== run.id)]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start scan');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(): Promise<void> {
    if (!activeRun) return;
    setSubmitting(true);
    try {
      await cancelScan(activeRun.id);
      await refresh(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not cancel scan');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="jobs-workspace">
      <div className="page-heading jobs-heading">
        <div>
          <p className="eyebrow">JobTech · collection loop</p>
          <h1>Fresh roles, captured in full.</h1>
          <p>
            Start a scan from this Mac, then inspect normalized metadata and the complete
            source description stored in SQLite.
          </p>
        </div>
        <div className="scan-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={submitting || activeRun !== null}
            onClick={() => void handleStart()}
          >
            {activeRun ? 'Scan in progress' : submitting ? 'Starting…' : 'Scan JobTech'}
          </button>
          {activeRun ? (
            <button
              className="button button--quiet"
              type="button"
              disabled={submitting}
              onClick={() => void handleCancel()}
            >
              Cancel scan
            </button>
          ) : null}
        </div>
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}

      <div className="run-strip" aria-live="polite">
        <div>
          <span className={`run-state run-state--${latestRun?.status ?? 'none'}`} />
          <div>
            <p className="eyebrow">Latest scan</p>
            <strong>{latestRun ? latestRun.status : 'No runs yet'}</strong>
          </div>
        </div>
        <p>
          {latestRun ? runLabel(latestRun) : 'Run JobTech once to populate the radar.'}
        </p>
        <small>
          {latestRun
            ? `Created ${formatDate(latestRun.createdAt)}`
            : `${sources.length} configured source`}
        </small>
      </div>

      {latestRun?.sourceRuns.map((run) => (
        <div className="source-run-line" key={run.id}>
          <strong>{run.sourceName}</strong>
          <span>{run.status}</span>
          <span>{run.pagesFetched} pages</span>
          <span>{run.retryCount} retries</span>
          {run.errorSummary ? (
            <span className="source-run-error">{run.errorSummary}</span>
          ) : null}
        </div>
      ))}

      <div className="jobs-layout">
        <section className="jobs-list" aria-label="Jobs">
          <div className="jobs-list__header">
            <div>
              <p className="eyebrow">Active jobs</p>
              <h2>{jobs.length} captured roles</h2>
            </div>
            <button className="text-button" type="button" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          {loading ? <p className="empty-hint">Loading the local radar…</p> : null}
          {!loading && jobs.length === 0 ? (
            <div className="jobs-empty">
              <strong>No active jobs yet.</strong>
              <p>Confirm target roles in Profile, then start a JobTech scan.</p>
            </div>
          ) : null}
          {jobs.map((job) => (
            <button
              className={`job-row${selectedId === job.id ? ' job-row--active' : ''}`}
              key={job.id}
              type="button"
              onClick={() => setSelectedId(job.id)}
            >
              <span className="job-row__date">{formatDate(job.publishedAt)}</span>
              <strong>{job.title}</strong>
              <span>{job.company}</span>
              <small>
                {job.location} · {job.remoteMode}
              </small>
            </button>
          ))}
        </section>

        <aside className="job-detail" aria-label="Job detail">
          {!visibleDetail ? (
            <div className="jobs-empty">
              <strong>Select a role.</strong>
              <p>The complete captured description will appear here.</p>
            </div>
          ) : (
            <>
              <p className="eyebrow">{visibleDetail.company}</p>
              <h2>{visibleDetail.title}</h2>
              <div className="job-detail__meta">
                <span>{visibleDetail.location}</span>
                <span>{visibleDetail.remoteMode}</span>
                <span>
                  {visibleDetail.employmentType ?? 'Employment type not specified'}
                </span>
              </div>
              <dl>
                <div>
                  <dt>Published</dt>
                  <dd>{formatDate(visibleDetail.publishedAt)}</dd>
                </div>
                <div>
                  <dt>Deadline</dt>
                  <dd>{formatDate(visibleDetail.deadline)}</dd>
                </div>
                <div>
                  <dt>Last seen</dt>
                  <dd>{formatDate(visibleDetail.lastSeenAt)}</dd>
                </div>
              </dl>
              <a
                className="source-link"
                href={visibleDetail.canonicalUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open original JobTech listing ↗
              </a>
              <div className="description-heading">
                <h3>Complete description</h3>
                <span>{visibleDetail.history.length} captured version(s)</span>
              </div>
              <div className="job-description">
                {visibleDetail.snapshot.descriptionText}
              </div>
              <p className="audit-note">
                Raw JobTech response retained locally · SHA-256{' '}
                {visibleDetail.snapshot.contentHash.slice(0, 12)}…
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
