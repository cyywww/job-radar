import { useState } from 'react';

import { SourcesWorkspace } from './SourcesWorkspace.js';
import { SystemPanel } from './SystemPanel.js';

export function SettingsWorkspace(): React.JSX.Element {
  const [section, setSection] = useState<'sources' | 'system'>('sources');

  return (
    <section className="settings-workspace" aria-labelledby="settings-heading">
      <header className="page-heading settings-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h1 id="settings-heading">Sources and local status</h1>
          <p>These controls are rarely needed during daily job review.</p>
        </div>
        <div className="settings-switch" aria-label="Settings section">
          <button
            type="button"
            aria-pressed={section === 'sources'}
            onClick={() => setSection('sources')}
          >
            Sources
          </button>
          <button
            type="button"
            aria-pressed={section === 'system'}
            onClick={() => setSection('system')}
          >
            System status
          </button>
        </div>
      </header>

      {section === 'sources' ? <SourcesWorkspace /> : <SystemPanel />}
    </section>
  );
}
