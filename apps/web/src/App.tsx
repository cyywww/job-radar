import { useState } from 'react';

import { ProfileWorkspace } from './features/profile/ProfileWorkspace.js';
import { SystemPanel } from './features/system/SystemPanel.js';

export default function App(): React.JSX.Element {
  const [view, setView] = useState<'profile' | 'system'>('profile');

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
            className={view === 'system' ? 'nav-button nav-button--active' : 'nav-button'}
            type="button"
            onClick={() => setView('system')}
          >
            System
          </button>
        </nav>
        <span className="phase-label">Profile · M1</span>
      </header>
      <main>{view === 'profile' ? <ProfileWorkspace /> : <SystemPanel />}</main>
      <footer>
        <span>Job Radar · local-first candidate data</span>
        <span>Bound to this Mac</span>
      </footer>
    </>
  );
}
