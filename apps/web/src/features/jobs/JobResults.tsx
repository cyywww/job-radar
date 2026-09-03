import type { Dispatch, SetStateAction } from 'react';
import type { ReviewJobSummary } from '@job-radar/shared';
import { formatDate, lifecycleLabel } from './presentation.js';

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

interface JobResultsProps {
  jobs: ReviewJobSummary[];
  loading: boolean;
  view: 'cards' | 'table';
  selectionMode: boolean;
  selectedId: string | null;
  selectedIds: Set<string>;
  setSelectedId: (id: string) => void;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
}

export function JobResults({
  jobs,
  loading,
  view,
  selectionMode,
  selectedId,
  selectedIds,
  setSelectedId,
  setSelectedIds,
}: JobResultsProps): React.JSX.Element {
  const allSelected = jobs.length > 0 && jobs.every((job) => selectedIds.has(job.id));
  return (
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
                {selectionMode ? (
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
                ) : null}
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
                  {selectionMode ? (
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
                  ) : null}
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
                    <span className={`status-badge status-badge--${job.triage.status}`}>
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
              {selectionMode ? (
                <label className="card-select">
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
                  Select
                </label>
              ) : null}
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
  );
}
