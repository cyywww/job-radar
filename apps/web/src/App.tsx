import { useState } from 'react';

import { JobsWorkspace } from './features/jobs/JobsWorkspace.js';
import { ProfileWorkspace } from './features/profile/ProfileWorkspace.js';
import { SourcesWorkspace } from './features/sources/SourcesWorkspace.js';
import { SystemPanel } from './features/system/SystemPanel.js';

export default function App(): React.JSX.Element {
  const [view, setView] = useState<'profile' | 'jobs' | 'sources' | 'system'>('profile');

  return (
    <>
      <header className="site-header">
        <button className="brand" type="button" onClick={() => setView('profile')}>
          <span className="brand__signal" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>Job Radar</span>
        </button>
        <nav aria-label="Primary navigation">
          <button
            className={
              view === 'profile' ? 'nav-button nav-button--active' : 'nav-button'
            }
            type="button"
            onClick={() => setView('profile')}
          >
            Profile
          </button>
          <button
            className={view === 'jobs' ? 'nav-button nav-button--active' : 'nav-button'}
            type="button"
            onClick={() => setView('jobs')}
          >
            Jobs
          </button>
          <button
            className={
              view === 'sources' ? 'nav-button nav-button--active' : 'nav-button'
            }
            type="button"
            onClick={() => setView('sources')}
          >
            Sources
          </button>
          <button
            className={view === 'system' ? 'nav-button nav-button--active' : 'nav-button'}
            type="button"
            onClick={() => setView('system')}
          >
            System
          </button>
        </nav>
        <span className="phase-label">Public ATS · M2</span>
      </header>
      <main>
        {view === 'profile' ? (
          <ProfileWorkspace />
        ) : view === 'jobs' ? (
          <JobsWorkspace />
        ) : view === 'sources' ? (
          <SourcesWorkspace />
        ) : (
          <SystemPanel />
        )}
      </main>
      <footer>
        <span>Job Radar · local-first candidate data</span>
        <span>Bound to this Mac</span>
      </footer>
    </>
  );
}
