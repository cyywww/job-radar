import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type {
  CreateSourceRequest,
  SourceErrorCategory,
  SourceView,
  UpdateSourceRequest,
} from '@job-radar/shared';

import {
  createSource,
  deleteSource,
  fetchSources,
  rerunSource,
  testSource,
  updateSource,
} from '../../api/jobs.js';

interface SourceDraft {
  name: string;
  companyName: string;
  startUrl: string;
}

const emptyDraft = (): SourceDraft => ({
  name: '',
  companyName: '',
  startUrl: '',
});

const errorLabels: Record<SourceErrorCategory, string> = {
  rate_limited: 'Rate limited by the source',
  timeout: 'The source did not respond in time',
  transport: 'Could not reach the source',
  http_client: 'The source rejected the request',
  http_server: 'The source is temporarily unavailable',
  invalid_response: 'The page did not contain supported JobPosting JSON-LD',
  not_found: 'The configured page was not found',
  configuration: 'The source configuration is invalid',
  unsafe_url: 'The URL was blocked by the SSRF safety policy',
  partial_detail: 'Some job details could not be fetched',
  cancelled: 'The scan was cancelled',
  connector_unavailable: 'No connector is available for this source',
  unexpected: 'The source failed unexpectedly',
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function draftFromSource(source: SourceView): SourceDraft | null {
  if (source.config.kind !== 'generic_web') return null;
  return {
    name: source.name,
    companyName: source.config.companyName,
    startUrl: source.config.startUrl,
  };
}

export function SourcesWorkspace(): React.JSX.Element {
  const [sources, setSources] = useState<SourceView[]>([]);
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSources(await fetchSources(true));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load sources');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  function resetForm(): void {
    setDraft(emptyDraft());
    setEditingId(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusyId(editingId ?? 'create');
    setError(null);
    setNotice(null);
    try {
      const saved = editingId
        ? await updateSource(editingId, {
            name: draft.name,
            companyName: draft.companyName,
            startUrl: draft.startUrl,
          } satisfies UpdateSourceRequest)
        : await createSource({
            type: 'generic_web',
            name: draft.name,
            companyName: draft.companyName,
            startUrl: draft.startUrl,
          } satisfies CreateSourceRequest);
      setSources((current) =>
        [...current.filter((source) => source.id !== saved.id), saved].sort(
          (left, right) => left.name.localeCompare(right.name),
        ),
      );
      setNotice(editingId ? 'Target page updated.' : 'Target page added and paused.');
      resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save target page');
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(source: SourceView): Promise<void> {
    setBusyId(source.id);
    setError(null);
    setNotice(null);
    try {
      const result = await testSource(source.id);
      setSources((current) =>
        current.map((entry) => (entry.id === source.id ? result.source : entry)),
      );
      if (result.status === 'healthy') {
        setNotice(`${source.name} is reachable.`);
      } else {
        setError(
          result.errorCategory
            ? `${errorLabels[result.errorCategory]}. ${result.message ?? ''}`.trim()
            : (result.message ?? `${source.name} is not healthy.`),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not test source');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(source: SourceView): Promise<void> {
    setBusyId(source.id);
    setError(null);
    try {
      const updated = await updateSource(source.id, { enabled: !source.enabled });
      setSources((current) =>
        current.map((entry) => (entry.id === source.id ? updated : entry)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update source');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRerun(source: SourceView): Promise<void> {
    setBusyId(source.id);
    setError(null);
    setNotice(null);
    try {
      const run = await rerunSource(source.id);
      setNotice(
        `${source.name} scan queued with configuration version ${run.sourceRuns[0]?.configVersion ?? source.configVersion}.`,
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not queue source scan');
    } finally {
      setBusyId(null);
    }
  }

  function handleEdit(source: SourceView): void {
    const nextDraft = draftFromSource(source);
    if (!nextDraft) return;
    setEditingId(source.id);
    setDraft(nextDraft);
    setError(null);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleDelete(source: SourceView): Promise<void> {
    if (
      !window.confirm(`Delete ${source.name}? Its historical job links remain local.`)
    ) {
      return;
    }
    setBusyId(source.id);
    setError(null);
    try {
      await deleteSource(source.id);
      if (editingId === source.id) resetForm();
      setNotice('Target page deleted. Historical provenance was retained.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete target page');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="workspace-stack" aria-labelledby="sources-heading">
      <header className="workspace-hero workspace-hero--compact">
        <div>
          <p className="eyebrow">Sweden-first collection</p>
          <h1 id="sources-heading">Platsbanken first, company pages only when needed.</h1>
          <p>
            JobTech searches Sweden&apos;s Data/IT field with your confirmed role
            keywords. Add a target-company page only when it publishes valid JobPosting
            JSON-LD.
          </p>
        </div>
        <div className="source-health-strip" aria-label="Source model">
          <span>
            <strong>Primary</strong> JobTech / Platsbanken
          </span>
          <span>
            <strong>Optional</strong> selected company pages
          </span>
        </div>
      </header>

      <div className="live-message" aria-live="polite" aria-atomic="true">
        {error ? <p className="alert alert--error">{error}</p> : null}
        {notice ? <p className="alert alert--success">{notice}</p> : null}
      </div>

      <div className="source-settings-layout">
        <form className="source-form" onSubmit={(event) => void handleSubmit(event)}>
          <p className="eyebrow">
            {editingId ? 'Edit target page' : 'Optional supplement'}
          </p>
          <h2>{editingId ? 'Update company page' : 'Add target-company page'}</h2>
          <p className="form-hint">
            Starts paused. Only one public HTTPS page is read; crawling, selectors,
            JavaScript, login and access-control bypass are not supported.
          </p>
          <label>
            Source name
            <input
              value={draft.name}
              maxLength={120}
              required
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <label>
            Company name
            <input
              value={draft.companyName}
              maxLength={240}
              required
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  companyName: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Public careers page URL
            <input
              type="url"
              value={draft.startUrl}
              placeholder="https://careers.example.com/jobs"
              required
              onChange={(event) =>
                setDraft((current) => ({ ...current, startUrl: event.target.value }))
              }
            />
          </label>
          <div className="source-form__actions">
            <button className="button" type="submit" disabled={busyId !== null}>
              {busyId === 'create'
                ? 'Adding…'
                : editingId
                  ? 'Save target page'
                  : 'Add target page'}
            </button>
            {editingId ? (
              <button
                className="button button--quiet"
                type="button"
                disabled={busyId !== null}
                onClick={resetForm}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </form>

        <section className="source-list" aria-label="Configured sources">
          <div className="source-list__heading">
            <div>
              <p className="eyebrow">Collection status</p>
              <h2>Configured sources</h2>
            </div>
            <button
              className="button button--quiet"
              type="button"
              disabled={loading}
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          </div>
          {loading ? <p>Loading sources…</p> : null}
          {!loading && sources.length === 0 ? <p>No sources configured.</p> : null}
          {sources.map((source) => (
            <article className="source-item" key={source.id}>
              <div className="source-item__title">
                <div>
                  <strong>{source.name}</strong>
                  <small>
                    {source.type === 'jobtech'
                      ? 'Sweden Data/IT · Platsbanken'
                      : 'Optional target-company page'}
                  </small>
                  <small>
                    {source.supportLevel} · {source.supportReason}
                  </small>
                </div>
                <span className={`health-badge health-badge--${source.healthStatus}`}>
                  {source.configurationState === 'deleted'
                    ? 'deleted'
                    : source.enabled
                      ? source.healthStatus
                      : 'paused'}
                </span>
              </div>
              <div className="source-metrics">
                <span>
                  <strong>{source.metrics.totalRuns}</strong> runs
                </span>
                <span>
                  <strong>{source.metrics.jobsDiscovered}</strong> found
                </span>
                <span>
                  <strong>{source.metrics.jobsCreated}</strong> new
                </span>
                <span>
                  <strong>{source.metrics.jobsUpdated}</strong> changed
                </span>
                <span>
                  <strong>{source.metrics.jobsFailed}</strong> failed
                </span>
              </div>
              <div className="source-latest">
                <span>Last success {formatDate(source.lastSuccessAt)}</span>
                <span>
                  Latest run {source.latestRun?.status ?? 'not run'}
                  {source.latestRun?.stage ? ` · ${source.latestRun.stage}` : ''}
                </span>
              </div>
              {source.latestRun ? (
                <p className="source-run-detail">
                  {source.latestRun.counts.discovered} found ·{' '}
                  {source.latestRun.counts.fetched} fetched ·{' '}
                  {source.latestRun.counts.created} new ·{' '}
                  {source.latestRun.counts.updated} changed ·{' '}
                  {source.latestRun.counts.failed} failed · {source.latestRun.retryCount}{' '}
                  retries
                  {source.latestRun.failureStage
                    ? ` · failed during ${source.latestRun.failureStage}`
                    : ''}
                </p>
              ) : null}
              {source.lastError ? (
                <p className="source-friendly-error">
                  {source.lastErrorCategory
                    ? `${errorLabels[source.lastErrorCategory]} — `
                    : ''}
                  {source.lastError}
                </p>
              ) : null}
              <div className="source-item__actions">
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={
                    busyId !== null ||
                    !source.enabled ||
                    source.configurationState === 'deleted'
                  }
                  aria-label={`Rerun ${source.name}`}
                  onClick={() => void handleRerun(source)}
                >
                  {busyId === source.id ? 'Working…' : 'Run source'}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busyId !== null || source.configurationState === 'deleted'}
                  aria-label={`Test ${source.name}`}
                  onClick={() => void handleTest(source)}
                >
                  Test
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busyId !== null || source.configurationState === 'deleted'}
                  aria-label={`${source.enabled ? 'Pause' : 'Enable'} ${source.name}`}
                  onClick={() => void handleToggle(source)}
                >
                  {source.enabled ? 'Pause' : 'Enable'}
                </button>
                {source.config.kind === 'generic_web' &&
                source.configurationState !== 'deleted' ? (
                  <>
                    <button
                      className="button button--quiet"
                      type="button"
                      disabled={busyId !== null}
                      aria-label={`Edit ${source.name}`}
                      onClick={() => handleEdit(source)}
                    >
                      Edit
                    </button>
                    <button
                      className="text-button text-button--danger"
                      type="button"
                      disabled={busyId !== null}
                      aria-label={`Delete ${source.name}`}
                      onClick={() => void handleDelete(source)}
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      </div>
    </section>
  );
}
