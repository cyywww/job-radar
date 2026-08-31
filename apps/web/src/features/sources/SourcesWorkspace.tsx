import { useCallback, useEffect, useState, type FormEvent } from 'react';

import type {
  CreateSourceRequest,
  SourceCapability,
  SourceErrorCategory,
  SourceView,
  UpdateSourceRequest,
} from '@job-radar/shared';

import {
  createSource,
  deleteSource,
  fetchSourceCapabilities,
  fetchSources,
  rerunSource,
  testSource,
  updateSource,
} from '../../api/jobs.js';

type ConfigurableType = 'greenhouse' | 'lever' | 'ashby' | 'teamtailor' | 'generic_web';

interface SourceDraft {
  type: ConfigurableType;
  name: string;
  companyName: string;
  identifier: string;
  region: 'global' | 'eu' | 'na' | 'au';
  includeCompensation: boolean;
  apiTokenEnv: string;
  startUrl: string;
}

const emptyDraft = (): SourceDraft => ({
  type: 'greenhouse',
  name: '',
  companyName: '',
  identifier: '',
  region: 'global',
  includeCompensation: true,
  apiTokenEnv: 'JOB_RADAR_TEAMTAILOR_TOKEN',
  startUrl: '',
});

const errorLabels: Record<SourceErrorCategory, string> = {
  rate_limited: 'Rate limited by the source',
  timeout: 'The source did not respond in time',
  transport: 'Could not reach the source',
  http_client: 'The source rejected the request',
  http_server: 'The source is temporarily unavailable',
  invalid_response: 'The source returned an unsupported response',
  not_found: 'The configured job board was not found',
  configuration: 'The source configuration is invalid',
  unsafe_url: 'The URL was blocked by the SSRF safety policy',
  partial_detail: 'Some job details could not be fetched',
  cancelled: 'The scan was cancelled',
  connector_unavailable: 'No connector is available for this source',
  unexpected: 'The connector failed unexpectedly',
};

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function identifierLabel(type: ConfigurableType): string {
  if (type === 'greenhouse') return 'Board token';
  if (type === 'lever') return 'Lever site';
  return 'Ashby board name';
}

function draftFromSource(source: SourceView): SourceDraft | null {
  if (source.config.kind === 'jobtech') return null;
  if (source.config.kind === 'teamtailor') {
    return {
      ...emptyDraft(),
      type: 'teamtailor',
      name: source.name,
      companyName: source.config.companyName,
      region: source.config.region,
      apiTokenEnv: source.config.apiTokenEnv,
    };
  }
  if (source.config.kind === 'generic_web') {
    return {
      ...emptyDraft(),
      type: 'generic_web',
      name: source.name,
      companyName: source.config.companyName,
      startUrl: source.config.startUrl,
    };
  }
  return {
    type: source.config.kind,
    name: source.name,
    companyName: source.config.companyName,
    identifier:
      source.config.kind === 'greenhouse'
        ? source.config.boardToken
        : source.config.kind === 'lever'
          ? source.config.site
          : source.config.boardName,
    region: source.config.kind === 'lever' ? source.config.region : 'global',
    includeCompensation:
      source.config.kind === 'ashby' ? source.config.includeCompensation : true,
    apiTokenEnv: 'JOB_RADAR_TEAMTAILOR_TOKEN',
    startUrl: '',
  };
}

export function SourcesWorkspace(): React.JSX.Element {
  const [sources, setSources] = useState<SourceView[]>([]);
  const [capabilities, setCapabilities] = useState<SourceCapability[]>([]);
  const [draft, setDraft] = useState<SourceDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSources, nextCapabilities] = await Promise.all([
        fetchSources(),
        fetchSourceCapabilities(),
      ]);
      setSources(nextSources);
      setCapabilities(nextCapabilities);
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
      let saved: SourceView;
      if (editingId) {
        const input: UpdateSourceRequest = {
          name: draft.name,
          companyName: draft.companyName,
          ...(['greenhouse', 'lever', 'ashby'].includes(draft.type)
            ? { identifier: draft.identifier }
            : {}),
          ...(draft.type === 'lever' ? { region: draft.region } : {}),
          ...(draft.type === 'ashby'
            ? { includeCompensation: draft.includeCompensation }
            : {}),
          ...(draft.type === 'teamtailor'
            ? { region: draft.region, apiTokenEnv: draft.apiTokenEnv }
            : {}),
          ...(draft.type === 'generic_web' ? { startUrl: draft.startUrl } : {}),
        };
        saved = await updateSource(editingId, input);
      } else {
        let input: CreateSourceRequest;
        if (draft.type === 'greenhouse') {
          input = {
            type: draft.type,
            name: draft.name,
            companyName: draft.companyName,
            identifier: draft.identifier,
          };
        } else if (draft.type === 'lever') {
          input = {
            type: draft.type,
            name: draft.name,
            companyName: draft.companyName,
            identifier: draft.identifier,
            region: draft.region === 'eu' ? 'eu' : 'global',
          };
        } else if (draft.type === 'ashby') {
          input = {
            type: draft.type,
            name: draft.name,
            companyName: draft.companyName,
            identifier: draft.identifier,
            includeCompensation: draft.includeCompensation,
          };
        } else if (draft.type === 'teamtailor') {
          input = {
            type: draft.type,
            name: draft.name,
            companyName: draft.companyName,
            region: draft.region === 'na' || draft.region === 'au' ? draft.region : 'eu',
            apiTokenEnv: draft.apiTokenEnv,
          };
        } else {
          input = {
            type: draft.type,
            name: draft.name,
            companyName: draft.companyName,
            startUrl: draft.startUrl,
          };
        }
        saved = await createSource(input);
      }
      setSources((current) =>
        [...current.filter((source) => source.id !== saved.id), saved].sort(
          (left, right) => left.name.localeCompare(right.name),
        ),
      );
      setNotice(editingId ? 'Source configuration updated.' : 'Source added.');
      resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save source');
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
        `${source.name} rerun queued with configuration version ${run.sourceRuns[0]?.configVersion ?? source.configVersion}.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rerun source');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(source: SourceView): Promise<void> {
    if (
      !window.confirm(`Delete ${source.name}? Historical runs and jobs will be kept.`)
    ) {
      return;
    }
    setBusyId(source.id);
    setError(null);
    try {
      await deleteSource(source.id);
      setSources((current) => current.filter((entry) => entry.id !== source.id));
      if (editingId === source.id) resetForm();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete source');
    } finally {
      setBusyId(null);
    }
  }

  function handleEdit(source: SourceView): void {
    const nextDraft = draftFromSource(source);
    if (!nextDraft) return;
    setDraft(nextDraft);
    setEditingId(source.id);
    setNotice(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <section className="sources-workspace">
      <div className="page-heading sources-heading">
        <div>
          <p className="eyebrow">Reviewed source connectors</p>
          <h1>Sources with explicit support boundaries.</h1>
          <p>
            Supported connectors use reviewed public interfaces. Limited connectors stay
            paused until you explicitly test and enable them. Connection errors never
            retain a response body or secret.
          </p>
        </div>
      </div>

      {error ? <div className="notice notice--error">{error}</div> : null}
      {notice ? <div className="notice notice--success">{notice}</div> : null}

      <div className="source-settings-layout">
        <form className="source-form" onSubmit={(event) => void handleSubmit(event)}>
          <p className="eyebrow">{editingId ? 'Edit source' : 'Add source'}</p>
          <h2>{editingId ? 'Update this board' : 'Connect a job board'}</h2>
          <label>
            Source type
            <select
              aria-label="ATS"
              value={draft.type}
              disabled={editingId !== null}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  type: event.target.value as ConfigurableType,
                }))
              }
            >
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
              <option value="teamtailor">Teamtailor (limited)</option>
              <option value="generic_web">Generic JSON-LD page (limited)</option>
            </select>
          </label>
          <label>
            Source name
            <input
              value={draft.name}
              required
              maxLength={120}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Northstar careers"
            />
          </label>
          <label>
            Company name
            <input
              value={draft.companyName}
              required
              maxLength={240}
              onChange={(event) =>
                setDraft((current) => ({ ...current, companyName: event.target.value }))
              }
              placeholder="Northstar Example AB"
            />
          </label>
          {['greenhouse', 'lever', 'ashby'].includes(draft.type) ? (
            <label>
              {identifierLabel(draft.type)}
              <input
                value={draft.identifier}
                required
                maxLength={120}
                pattern="[A-Za-z0-9_-]+"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, identifier: event.target.value }))
                }
                placeholder="northstar-example"
              />
            </label>
          ) : null}
          {draft.type === 'lever' ? (
            <label>
              Lever region
              <select
                value={draft.region}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    region: event.target.value as 'global' | 'eu',
                  }))
                }
              >
                <option value="global">Global</option>
                <option value="eu">EU</option>
              </select>
            </label>
          ) : null}
          {draft.type === 'ashby' ? (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={draft.includeCompensation}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    includeCompensation: event.target.checked,
                  }))
                }
              />
              Include public compensation data
            </label>
          ) : null}
          {draft.type === 'teamtailor' ? (
            <>
              <label>
                Teamtailor region
                <select
                  value={draft.region === 'global' ? 'eu' : draft.region}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      region: event.target.value as 'eu' | 'na' | 'au',
                    }))
                  }
                >
                  <option value="eu">Europe</option>
                  <option value="na">North America</option>
                  <option value="au">Asia-Pacific</option>
                </select>
              </label>
              <label>
                API token environment variable
                <input
                  value={draft.apiTokenEnv}
                  required
                  pattern="[A-Z][A-Z0-9_]*"
                  maxLength={120}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      apiTokenEnv: event.target.value,
                    }))
                  }
                />
              </label>
              <p className="audit-note">
                Store only the variable name here. The Public Read token stays in your
                local environment and is never saved in SQLite.
              </p>
            </>
          ) : null}
          {draft.type === 'generic_web' ? (
            <>
              <label>
                Public HTTPS page
                <input
                  type="url"
                  value={draft.startUrl}
                  required
                  maxLength={2048}
                  placeholder="https://careers.example.com/jobs"
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      startUrl: event.target.value,
                    }))
                  }
                />
              </label>
              <p className="audit-note">
                One page only; schema.org JobPosting JSON-LD only. Private networks,
                metadata services, redirects to unsafe hosts, non-HTTPS URLs, login, and
                CAPTCHA flows are blocked.
              </p>
            </>
          ) : null}
          <div className="source-form__actions">
            <button
              className="button button--primary"
              type="submit"
              disabled={busyId !== null}
            >
              {busyId === (editingId ?? 'create')
                ? 'Saving…'
                : editingId
                  ? 'Save source'
                  : 'Add source'}
            </button>
            {editingId ? (
              <button className="button button--quiet" type="button" onClick={resetForm}>
                Cancel edit
              </button>
            ) : null}
          </div>
        </form>

        <section className="source-list" aria-label="Configured sources">
          <div className="source-list__heading">
            <div>
              <p className="eyebrow">Configured</p>
              <h2>{sources.length} sources</h2>
            </div>
            <button className="text-button" type="button" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          {loading ? <p className="empty-hint">Loading source health…</p> : null}
          {!loading && sources.length === 0 ? (
            <div className="jobs-empty">
              <strong>No sources configured.</strong>
              <p>Add a Greenhouse, Lever, or Ashby public board.</p>
            </div>
          ) : null}
          {sources.map((source) => (
            <article className="source-item" key={source.id}>
              <div className="source-item__title">
                <div>
                  <span className={`health-dot health-dot--${source.healthStatus}`} />
                  <div>
                    <strong>{source.name}</strong>
                    <small>
                      {source.type} · {source.enabled ? 'enabled' : 'paused'}
                    </small>
                  </div>
                </div>
                <span
                  className={`fact-state fact-state--${source.enabled ? 'confirmed' : 'pending'}`}
                >
                  {source.enabled ? source.healthStatus : 'paused'}
                </span>
              </div>
              <div className="source-metrics">
                <span>
                  <strong>{source.metrics.totalRuns}</strong> runs
                </span>
                <span>
                  <strong>{source.metrics.jobsCreated}</strong> new
                </span>
                <span>
                  <strong>{source.metrics.totalRetries}</strong> retries
                </span>
                <span>
                  <strong>{source.metrics.jobsFailed}</strong> failed
                </span>
              </div>
              <div className="source-latest">
                <span>Last success {formatDate(source.lastSuccessAt)}</span>
                <span>
                  Latest run {source.latestRun?.status ?? 'not run'}
                  {source.latestRun?.finishedAt
                    ? ` · ${formatDate(source.latestRun.finishedAt)}`
                    : ''}
                </span>
              </div>
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
                  disabled={busyId !== null || !source.enabled}
                  aria-label={`Rerun ${source.name}`}
                  onClick={() => void handleRerun(source)}
                >
                  {busyId === source.id ? 'Working…' : 'Run this source'}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busyId !== null}
                  aria-label={`Test ${source.name}`}
                  onClick={() => void handleTest(source)}
                >
                  {busyId === source.id ? 'Working…' : 'Test connection'}
                </button>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={busyId !== null}
                  aria-label={`${source.enabled ? 'Pause' : 'Enable'} ${source.name}`}
                  onClick={() => void handleToggle(source)}
                >
                  {source.enabled ? 'Pause' : 'Enable'}
                </button>
                {source.config.kind !== 'jobtech' ? (
                  <button
                    className="button button--quiet"
                    type="button"
                    disabled={busyId !== null}
                    aria-label={`Edit ${source.name}`}
                    onClick={() => handleEdit(source)}
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  className="text-button text-button--danger"
                  type="button"
                  disabled={busyId !== null}
                  aria-label={`Delete ${source.name}`}
                  onClick={() => void handleDelete(source)}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
      <section className="source-support" aria-label="Connector support matrix">
        <div className="source-list__heading">
          <div>
            <p className="eyebrow">Support matrix</p>
            <h2>Reviewed connector coverage</h2>
          </div>
        </div>
        <div className="source-metrics">
          {capabilities.map((capability) => (
            <article className="source-item" key={capability.type}>
              <div className="source-item__title">
                <strong>{capability.label}</strong>
                <span className="fact-state fact-state--pending">
                  {capability.supportLevel.replace('_', ' ')}
                </span>
              </div>
              <p>{capability.reason}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}
