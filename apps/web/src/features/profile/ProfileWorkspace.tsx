import { useEffect, useState } from 'react';

import {
  createProfileRequestSchema,
  updateProfileRequestSchema,
  type CreateProfileRequest,
  type ProfileImportResponse,
  type ProfileSnapshot,
  type ProfileVersionSummary,
} from '@job-radar/shared';

import {
  confirmProfile,
  createProfile,
  fetchProfile,
  fetchProfileVersions,
  importPastedProfile,
  importProfileFile,
  updateProfile,
} from '../../api/profile.js';
import { ProfileEditor } from './ProfileEditor.js';
import {
  createBlankProfileDraft,
  ensureManualSource,
  snapshotToDraft,
} from './profile-draft.js';

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray(error.issues)
  ) {
    const issue = error.issues[0] as
      { path?: Array<string | number>; message?: string } | undefined;
    return issue
      ? `${issue.path?.join('.') || 'Profile'}: ${issue.message ?? 'Invalid value'}`
      : 'Profile validation failed';
  }
  return error instanceof Error ? error.message : 'The request failed';
}

export function ProfileWorkspace(): React.JSX.Element {
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null);
  const [draft, setDraft] = useState<CreateProfileRequest>(() =>
    createBlankProfileDraft(),
  );
  const [versions, setVersions] = useState<ProfileVersionSummary[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshVersions = async () => setVersions(await fetchProfileVersions());

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const current = await fetchProfile();
        if (!active) return;
        setProfile(current);
        if (current) {
          setDraft(snapshotToDraft(current));
          setVersions(await fetchProfileVersions());
        }
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const applyImport = (result: ProfileImportResponse) => {
    if (profile) {
      const sourceIds = new Set(draft.sources.map((source) => source.id));
      setDraft({
        ...draft,
        sources: [
          ...draft.sources,
          ...result.draft.sources.filter((source) => !sourceIds.has(source.id)),
        ],
        basics: result.draft.basics,
        changeSummary: 'Updated basics from deterministic import substitute',
      });
    } else {
      setDraft(result.draft);
    }
    setMessage(result.warnings.join(' '));
    setError(null);
  };

  const applyUserEdit = (next: CreateProfileRequest) => {
    let adjusted = next;
    if (JSON.stringify(next.basics.data) !== JSON.stringify(draft.basics.data)) {
      const manual = ensureManualSource(adjusted);
      adjusted = {
        ...manual.draft,
        basics: {
          ...manual.draft.basics,
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          evidenceExcerpt: 'Entered directly in Job Radar',
        },
      };
    }
    if (
      JSON.stringify(next.preferences.data) !== JSON.stringify(draft.preferences.data)
    ) {
      const manual = ensureManualSource(adjusted);
      adjusted = {
        ...manual.draft,
        preferences: {
          ...manual.draft.preferences,
          sourceId: manual.sourceId,
          confirmationStatus: 'confirmed',
          evidenceExcerpt: 'Entered directly in Job Radar',
        },
      };
    }
    setDraft(adjusted);
  };

  const handlePasteImport = async () => {
    setBusy(true);
    setError(null);
    try {
      applyImport(await importPastedProfile(pasteText));
      setPasteText('');
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setBusy(false);
    }
  };

  const handleFileImport = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      applyImport(await importProfileFile(file));
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = profile
        ? await updateProfile(
            updateProfileRequestSchema.parse({
              ...draft,
              baseVersion: profile.version,
              changeSummary: 'Updated profile in browser',
            }),
          )
        : await createProfile(createProfileRequestSchema.parse(draft));
      setProfile(saved);
      setDraft(snapshotToDraft(saved));
      await refreshVersions();
      setMessage(
        `Saved as version ${saved.version}. Historical versions were preserved.`,
      );
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  const confirmPending = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const confirmed = await confirmProfile({
        baseVersion: profile.version,
        factIds: [],
        confirmAllPending: true,
        changeSummary: 'Confirmed reviewed profile facts in browser',
      });
      setProfile(confirmed);
      setDraft(snapshotToDraft(confirmed));
      await refreshVersions();
      setMessage(`Pending facts confirmed in new version ${confirmed.version}.`);
    } catch (confirmError) {
      setError(errorMessage(confirmError));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="notice">Loading your local profile…</p>;

  return (
    <div className="profile-page">
      <div className="page-heading profile-heading">
        <div>
          <p className="eyebrow">Candidate profile</p>
          <h1>Your profile</h1>
          <p>
            Start with one target role. Location and core skills are useful; every other
            detail is optional.
          </p>
        </div>
        <div className="version-pill" aria-label="Current profile version">
          <span>{profile ? `Version ${profile.version}` : 'Not saved'}</span>
          <strong>{profile?.status ?? 'onboarding'}</strong>
        </div>
      </div>

      <div aria-live="polite">
        {message && <p className="notice notice--success">{message}</p>}
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
      </div>

      <ProfileEditor draft={draft} onChange={applyUserEdit} />

      <div className="save-bar">
        <div>
          <strong>{profile ? 'Save a new version' : 'Create profile'}</strong>
          <span>
            {profile
              ? 'Your previous versions and evidence remain unchanged.'
              : 'You can add optional details later.'}
          </span>
        </div>
        <div>
          {profile?.status === 'draft' && (
            <button
              className="button button--secondary"
              type="button"
              disabled={busy}
              onClick={() => void confirmPending()}
            >
              Confirm imported facts
            </button>
          )}
          <button
            className="button button--primary"
            type="button"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? 'Working…' : profile ? 'Save new version' : 'Create profile'}
          </button>
        </div>
      </div>

      <details className="profile-disclosure profile-disclosure--section">
        <summary>
          <span>Profile tools and history</span>
          <small>
            Optional import · {versions.length || 'no'} saved version
            {versions.length === 1 ? '' : 's'}
          </small>
        </summary>
        <div className="detail-body profile-tools">
          <section className="profile-import__body">
            <div>
              <h2>Import basic details</h2>
              <p>
                Optional labeled text for name, headline, location and summary. Imported
                facts remain pending until reviewed.
              </p>
            </div>
            <div className="import-controls">
              <label>
                Paste labeled text
                <textarea
                  rows={5}
                  value={pasteText}
                  placeholder={'Name: Robin North\nLocation: Stockholm'}
                  onChange={(event) => setPasteText(event.target.value)}
                />
              </label>
              <div className="import-actions">
                <button
                  className="button button--secondary"
                  type="button"
                  disabled={busy || pasteText.trim().length === 0}
                  onClick={() => void handlePasteImport()}
                >
                  Import basics
                </button>
                <label className="file-button">
                  Import .txt or .md
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    disabled={busy}
                    onChange={(event) => void handleFileImport(event.target.files?.[0])}
                  />
                </label>
              </div>
              <small>Local text only · maximum 512 KiB · source text is not stored</small>
            </div>
          </section>
          <div className="profile-history-grid">
            <section>
              <h2>Evidence sources</h2>
              <ul className="plain-record-list">
                {draft.sources.map((source) => (
                  <li key={source.id}>
                    <strong>{source.label}</strong>
                    <small>{source.type.replaceAll('_', ' ')}</small>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2>Version history</h2>
              {versions.length === 0 ? (
                <p className="empty-hint">Save your profile to create version 1.</p>
              ) : (
                <ol className="plain-record-list">
                  {versions.map((version) => (
                    <li key={version.versionId}>
                      <div>
                        <strong>Version {version.version}</strong>
                        <span className={`fact-state fact-state--${version.status}`}>
                          {version.status}
                        </span>
                      </div>
                      <p>{version.changeSummary}</p>
                      <small>
                        {version.confirmedFactCount} confirmed ·{' '}
                        {version.pendingFactCount} pending
                      </small>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      </details>
    </div>
  );
}
