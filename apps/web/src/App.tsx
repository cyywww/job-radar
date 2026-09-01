import { useState } from 'react';

import { DashboardWorkspace } from './features/dashboard/DashboardWorkspace.js';
import { JobsWorkspace } from './features/jobs/JobsWorkspace.js';
import { ProfileWorkspace } from './features/profile/ProfileWorkspace.js';
import { SourcesWorkspace } from './features/sources/SourcesWorkspace.js';
import { SystemPanel } from './features/system/SystemPanel.js';

export default function App(): React.JSX.Element {
  const [view, setView] = useState<
    'dashboard' | 'profile' | 'jobs' | 'sources' | 'system'
  >('dashboard');
  const [requestedJobId, setRequestedJobId] = useState<string | undefined>();

  function openJobs(jobId?: string): void {
    setRequestedJobId(jobId);
    setView('jobs');
  }

  return (
    <>
      <header className="site-header">
        <button className="brand" type="button" onClick={() => setView('dashboard')}>
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
              view === 'dashboard' ? 'nav-button nav-button--active' : 'nav-button'
            }
            type="button"
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
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
            onClick={() => openJobs()}
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
        <span className="phase-label">Evidence review · M4</span>
      </header>
      <main>
        {view === 'dashboard' ? (
          <DashboardWorkspace
            onOpenJobs={openJobs}
            onOpenProfile={() => setView('profile')}
          />
        ) : view === 'profile' ? (
          <ProfileWorkspace />
        ) : view === 'jobs' ? (
          <JobsWorkspace
            {...(requestedJobId ? { initialSelectedId: requestedJobId } : {})}
          />
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
