import { useState, type FormEvent } from 'react';
import type {
  CreateFeedbackRequest,
  JobReviewDetail,
  TriageStatus,
} from '@job-radar/shared';
import { formatDate, lifecycleLabel, safeExternalHref } from './presentation.js';

const scoreDimensions = [
  ['requiredSkills', 'Required skills'],
  ['skillDepth', 'Skill depth'],
  ['responsibilities', 'Responsibilities'],
  ['seniority', 'Experience & seniority'],
  ['domain', 'Domain'],
  ['location', 'Location & work mode'],
  ['softPreferences', 'Soft preferences'],
] as const;

interface JobDetailPanelProps {
  readonly detail: JobReviewDetail;
  readonly busy: boolean;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onTriage: (status: TriageStatus) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onRescore: () => Promise<void>;
  readonly onReview: (
    state: 'pending' | 'approved' | 'rejected',
    reason: string,
  ) => Promise<boolean>;
  readonly onFeedback: (input: CreateFeedbackRequest) => Promise<boolean>;
  readonly onRetry: (taskId: string) => Promise<boolean>;
}

export function JobDetailPanel({
  detail,
  busy,
  headingRef,
  onTriage,
  onRefresh,
  onRescore,
  onReview,
  onFeedback,
  onRetry,
}: JobDetailPanelProps): React.JSX.Element {
  const [reviewReason, setReviewReason] = useState('');
  const [feedbackType, setFeedbackType] =
    useState<CreateFeedbackRequest['type']>('job_specific');
  const [feedbackScore, setFeedbackScore] = useState('');
  const [feedbackReason, setFeedbackReason] = useState('');
  async function submitReview(
    state: 'approved' | 'rejected',
    reason: string,
  ): Promise<void> {
    if (await onReview(state, reason)) setReviewReason('');
  }

  async function submitFeedback(event: FormEvent): Promise<void> {
    event.preventDefault();
    const saved = await onFeedback({
      type: feedbackType,
      ...(feedbackScore === '' ? {} : { suggestedScore: Number(feedbackScore) }),
      reason: feedbackReason,
    });
    if (saved) {
      setFeedbackReason('');
      setFeedbackScore('');
    }
  }

  const { job, triage, currentScore, currentRequirement } = detail;
  const latestTask = detail.tasks[0] ?? null;
  const canonicalHref = safeExternalHref(job.canonicalUrl);
  return (
    <>
      <p className="eyebrow">{job.company}</p>
      <h2 ref={headingRef} tabIndex={-1}>
        {job.title}
      </h2>
      <p className="job-detail-summary">
        {job.location} · {job.remoteMode} · {lifecycleLabel(job.lifecycleStatus)}
      </p>
      <div className="detail-actions" aria-label="Job actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => void onTriage('shortlisted')}
        >
          {triage.status === 'shortlisted' ? 'Saved' : 'Save'}
        </button>
        <button type="button" disabled={busy} onClick={() => void onTriage('ignored')}>
          Ignore
        </button>
        {canonicalHref ? (
          <a
            className="button button--quiet"
            href={canonicalHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open listing ↗
          </a>
        ) : null}
        <details className="detail-action-menu">
          <summary>More</summary>
          <div>
            <button type="button" disabled={busy} onClick={() => void onTriage('new')}>
              Restore
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onTriage('archived')}
            >
              Archive
            </button>
            <button type="button" disabled={busy} onClick={() => void onRefresh()}>
              Refresh source
            </button>
            <button type="button" disabled={busy} onClick={() => void onRescore()}>
              Reanalyze
            </button>
          </div>
        </details>
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
      {!canonicalHref ? (
        <span className="audit-note">Original listing URL is unavailable.</span>
      ) : null}

      <section className="score-explanation" aria-labelledby="score-heading">
        <div className="description-heading">
          <h3 id="score-heading">Why this job</h3>
          <span>{currentScore ? 'Evidence-based analysis' : 'Waiting for analysis'}</span>
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
                <span>Match</span>
                <small>Based on confirmed experience</small>
              </article>
              <article>
                <strong>{currentScore.rankingScore ?? '—'}</strong>
                <span>Priority</span>
                <small>Match plus timing and certainty</small>
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
            <div className="evidence-grid">
              <section>
                <h4>Strengths</h4>
                {currentScore.matchedEvidence.length === 0 ? (
                  <p>None recorded.</p>
                ) : (
                  <ul>
                    {currentScore.matchedEvidence.map((item, index) => (
                      <li key={`${item.requirementId}-${index}`}>
                        <blockquote>{item.jdSnippet}</blockquote>
                        <strong>{item.evidenceDepth}</strong>
                        <p>{item.explanation}</p>
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
                <h4>Questions</h4>
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
            <details className="detail-disclosure technical-details">
              <summary>How this score was calculated</summary>
              <div className="detail-disclosure__body">
                <h4>Eligibility checks</h4>
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
                    <h4>Score breakdown</h4>
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
              </div>
            </details>
          </>
        )}
      </section>

      <details className="detail-disclosure">
        <summary>AI usage</summary>
        <div className="detail-disclosure__body">
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
        </div>
      </details>

      {currentScore && currentScore.reviewState !== 'not_required' ? (
        <section className="human-review" aria-labelledby="human-review-heading">
          <div>
            <h3 id="human-review-heading">Does this analysis look right?</h3>
            <p>Your answer records feedback without changing the formal score.</p>
          </div>
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={() =>
              void submitReview('approved', 'Confirmed as accurate by the user.')
            }
          >
            Looks right
          </button>
          <details className="review-correction">
            <summary>Needs correction</summary>
            <div className="review-correction__body">
              <label>
                What needs correction?
                <textarea
                  value={reviewReason}
                  maxLength={1000}
                  onChange={(event) => setReviewReason(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy || !reviewReason.trim()}
                onClick={() => void submitReview('rejected', reviewReason)}
              >
                Save correction request
              </button>
            </div>
          </details>
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

      <details className="detail-disclosure">
        <summary>Detailed feedback</summary>
        <form
          className="feedback-form detail-disclosure__body"
          onSubmit={(event) => void submitFeedback(event)}
        >
          <p>A suggested score stays separate from the formal score.</p>
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
            Save feedback
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
      </details>

      <details className="detail-disclosure">
        <summary>Job description</summary>
        <div className="detail-disclosure__body">
          <pre className="job-description">{job.snapshot.descriptionText}</pre>
          <p className="audit-note">Shown as safe plain text.</p>
        </div>
      </details>
      <details className="detail-disclosure">
        <summary>Source and history</summary>
        <div className="detail-disclosure__body">
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
          <ol className="job-history">
            {job.history.map((snapshot) => (
              <li key={snapshot.id}>
                <strong>{formatDate(snapshot.fetchedAt)}</strong>
                <span>
                  {snapshot.sourceName ?? 'Historical source'} ·{' '}
                  {snapshot.changedFields.join(', ') || 'no material change classified'}
                </span>
                <small>
                  {snapshot.location} · deadline {formatDate(snapshot.deadline)} ·
                  snapshot {snapshot.id}
                </small>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </>
  );
}
