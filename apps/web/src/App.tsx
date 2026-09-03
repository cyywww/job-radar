import { useState } from 'react';

import { JobsWorkspace } from './features/jobs/JobsWorkspace.js';
import { ProfileWorkspace } from './features/profile/ProfileWorkspace.js';
import { SettingsWorkspace } from './features/settings/SettingsWorkspace.js';

export default function App(): React.JSX.Element {
  const [view, setView] = useState<'opportunities' | 'profile' | 'settings'>(
    'opportunities',
  );

  function openOpportunities(): void {
    setView('opportunities');
  }

  return (
    <>
      <header className="site-header">
        <button className="brand" type="button" onClick={() => openOpportunities()}>
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
              view === 'opportunities' ? 'nav-button nav-button--active' : 'nav-button'
            }
            type="button"
            onClick={() => openOpportunities()}
          >
            Opportunities
          </button>
          <button
            className={
              view === 'profile' ? 'nav-button nav-button--active' : 'nav-button'
            }
            type="button"
            onClick={() => setView('profile')}
          >
            Profiles
          </button>
          <button
            className={
              view === 'settings' ? 'nav-button nav-button--active' : 'nav-button'
            }
            type="button"
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </nav>
        <span className="phase-label">Local and private</span>
      </header>
      <main>
        {view === 'profile' ? (
          <ProfileWorkspace />
        ) : view === 'opportunities' ? (
          <JobsWorkspace />
        ) : (
          <SettingsWorkspace />
        )}
      </main>
      <footer>
        <span>Job Radar · local-first candidate data</span>
        <span>Bound to this Mac</span>
      </footer>
    </>
  );
}
