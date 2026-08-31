import { useCallback, useEffect, useState } from 'react';

import type { HealthResponse } from '@job-radar/shared';

import { fetchHealth } from '../../api/health.js';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; health: HealthResponse }
  | { status: 'error'; message: string };

export function SystemPanel(): React.JSX.Element {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', health: await fetchHealth() });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Health check failed',
      });
    }
  }, []);

  useEffect(() => {
    const initialRequest = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initialRequest);
  }, [refresh]);

  return (
    <section className="system-panel" aria-live="polite">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Local system status</p>
          <h1>The foundation is listening.</h1>
        </div>
        <button
          className="button button--quiet"
          type="button"
          onClick={() => void refresh()}
        >
          Refresh status
        </button>
      </div>

      {state.status === 'loading' && <p className="notice">Contacting the local API…</p>}
      {state.status === 'error' && (
        <p className="notice notice--error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <div className="health-grid">
          <article>
            <span className="status-dot status-dot--ok" />
            <p>Fastify API</p>
            <strong>{state.health.api.status}</strong>
            <small>{state.health.api.uptimeSeconds.toFixed(1)}s uptime</small>
          </article>
          <article>
            <span className="status-dot status-dot--ok" />
            <p>SQLite database</p>
            <strong>{state.health.database.status}</strong>
            <small>{state.health.database.latencyMs.toFixed(3)}ms response</small>
          </article>
        </div>
      )}
    </section>
  );
}
