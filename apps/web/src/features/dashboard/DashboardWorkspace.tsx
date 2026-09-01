import { useCallback, useEffect, useState } from 'react';

import type { DashboardResponse } from '@job-radar/shared';

import { fetchDashboard, startScan } from '../../api/jobs.js';

interface DashboardWorkspaceProps {
  readonly onOpenJobs: (jobId?: string) => void;
  readonly onOpenProfile: () => void;
}

function formatDate(value: string | null): string {
  if (!value) return 'Not yet';
  return new Intl.DateTimeFormat('en-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function DashboardWorkspace({
  onOpenJobs,
  onOpenProfile,
}: DashboardWorkspaceProps): React.JSX.Element {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDashboard(await fetchDashboard());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load the dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  async function handleScan(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const run = await startScan();
      setNotice(`Scan ${run.id.slice(0, 8)} queued. Open Jobs to follow its progress.`);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the scan');
    } finally {
      setStarting(false);
    }
  }

  if (loading && !dashboard) {
    return (
      <p className="page-state" role="status">
        Loading the daily radar…
      </p>
    );
  }

  if (!dashboard) {
    return (
      <section className="page-state page-state--error" role="alert">
        <h1>Dashboard unavailable</h1>
        <p>{error ?? 'The local API did not return dashboard data.'}</p>
        <button className="button" type="button" onClick={() => void refresh()}>
          Retry
        </button>
      </section>
    );
  }

  const activeScan =
    dashboard.latestScan &&
    !['succeeded', 'partial', 'failed', 'cancelled'].includes(
      dashboard.latestScan.status,
    );

  return (
    <section className="dashboard-workspace" aria-labelledby="dashboard-heading">
      <header className="workspace-hero dashboard-hero">
        <div>
          <p className="eyebrow">Daily review</p>
          <h1 id="dashboard-heading">Your evidence-backed job radar.</h1>
          <p>
            Review strong matches, resolve uncertain scores, and run explicit collection
            from one local workspace.
          </p>
        </div>
        <div className="dashboard-actions">
          <button
            className="button button--primary"
            type="button"
            disabled={!dashboard.profileReady || starting || Boolean(activeScan)}
            onClick={() => void handleScan()}
          >
            {activeScan ? 'Scan running' : starting ? 'Starting…' : 'Scan sources'}
          </button>
          <button
            className="button button--quiet"
            type="button"
            onClick={() => onOpenJobs()}
          >
            Review jobs
          </button>
        </div>
      </header>

      <div className="live-message" aria-live="polite">
        {error ? <p className="alert alert--error">{error}</p> : null}
        {notice ? <p className="alert alert--success">{notice}</p> : null}
      </div>

      {!dashboard.profileReady ? (
        <section
          className="empty-state dashboard-profile-state"
          aria-label="Profile required"
        >
          <strong>Create and confirm your Profile before scanning.</strong>
          <p>
            Add at least one target role so collection and scoring have an explicit scope.
          </p>
          <button
            className="button button--primary"
            type="button"
            onClick={onOpenProfile}
          >
            Open Profile
          </button>
        </section>
      ) : null}

      <div className="metric-grid" aria-label="Job review summary">
        <article>
          <strong>{dashboard.counts.newToday}</strong>
          <span>New today</span>
        </article>
        <article>
          <strong>{dashboard.counts.strongMatches}</strong>
          <span>Strong matches (≥ {dashboard.strongMatchThreshold})</span>
        </article>
        <article>
          <strong>{dashboard.counts.pendingScoring}</strong>
          <span>Awaiting score</span>
        </article>
        <article>
          <strong>{dashboard.counts.pendingReview}</strong>
          <span>Needs review</span>
        </article>
        <article>
          <strong>{dashboard.counts.closed}</strong>
          <span>Closed</span>
        </article>
      </div>

      <div className="dashboard-grid">
        <section className="dashboard-panel" aria-labelledby="top-jobs-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Recommended order</p>
              <h2 id="top-jobs-heading">Top 10</h2>
            </div>
            <button className="text-button" type="button" onClick={() => onOpenJobs()}>
              See all jobs
            </button>
          </div>
          {dashboard.topJobs.length === 0 ? (
            <div className="empty-state">
              <strong>No scored recommendations yet.</strong>
              <p>
                Run a scan and process the explicit scoring queue to populate this list.
              </p>
            </div>
          ) : (
            <ol className="top-job-list">
              {dashboard.topJobs.map((job) => (
                <li key={job.id}>
                  <button type="button" onClick={() => onOpenJobs(job.id)}>
                    <span>
                      <strong>{job.title}</strong>
                      <small>
                        {job.company} · {job.location}
                      </small>
                    </span>
                    <span className="score-pair">
                      <b>{job.score.matchScore}</b>
                      <small>match</small>
                      <b>{job.score.rankingScore}</b>
                      <small>rank</small>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="dashboard-panel" aria-labelledby="health-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Collection</p>
              <h2 id="health-heading">Sources & latest run</h2>
            </div>
          </div>
          <p className="latest-run-summary">
            <strong>{dashboard.latestScan?.status ?? 'No scan yet'}</strong>
            <span>
              {formatDate(
                dashboard.latestScan?.finishedAt ??
                  dashboard.latestScan?.createdAt ??
                  null,
              )}
            </span>
            {dashboard.latestScan?.errorSummary ? (
              <span className="error-text">{dashboard.latestScan.errorSummary}</span>
            ) : null}
          </p>
          <ul className="health-list">
            {dashboard.sources.map((source) => (
              <li key={source.id}>
                <span>
                  <strong>{source.name}</strong>
                  <small>Last success {formatDate(source.lastSuccessAt)}</small>
                </span>
                <span className={`status-badge status-badge--${source.healthStatus}`}>
                  {source.enabled ? source.healthStatus : 'paused'}
                </span>
                {source.lastError ? (
                  <small className="error-text">{source.lastError}</small>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="next-actions">
            <h3>Next actions</h3>
            <button type="button" onClick={() => onOpenJobs()}>
              Review {dashboard.counts.pendingReview} uncertain score(s)
            </button>
            <button type="button" onClick={() => onOpenJobs()}>
              Triage today&apos;s {dashboard.counts.newToday} new role(s)
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
