import { useEffect, useMemo, useState } from 'react';

import {
  computeProfileCompleteness,
  createProfileRequestSchema,
  previewPreferences,
  updateProfileRequestSchema,
  type CreateProfileRequest,
  type ProfileImportResponse,
  type PreferencesPreviewResponse,
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

function PreviewList({
  empty,
  items,
}: {
  empty: string;
  items: string[];
}): React.JSX.Element {
  return items.length > 0 ? (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : (
    <p>{empty}</p>
  );
}

function PreferencesPreviewCard({
  preview,
  targetRoleCount,
}: {
  preview: PreferencesPreviewResponse;
  targetRoleCount: number;
}): React.JSX.Element {
  return (
    <section className="preferences-preview-card" aria-labelledby="gate-preview-heading">
      <p className="eyebrow">Search &amp; Gate preview</p>
      <h2 id="gate-preview-heading">
        {targetRoleCount > 0
          ? `${targetRoleCount} search lane${targetRoleCount === 1 ? '' : 's'}`
          : 'No active search lane'}
      </h2>
      <span
        className={`fact-state fact-state--${preview.ready ? 'confirmed' : 'pending'}`}
      >
        {preview.ready ? 'ready' : 'needs input'}
      </span>

      <h3>Search terms</h3>
      <PreviewList
        empty="Add a role, location, or industry."
        items={preview.searchTerms}
      />

      <h3>Hard gates</h3>
      <PreviewList
        empty="No hard constraints configured."
        items={[
          ...preview.hardConstraints,
          ...preview.exclusions.map((item) => `Exclude: ${item}`),
        ]}
      />

      {preview.warnings.length > 0 && (
        <div className="preview-warnings">
          <h3>Before search</h3>
          <PreviewList empty="" items={preview.warnings} />
        </div>
      )}
    </section>
  );
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

  const completeness = useMemo(
    () =>
      computeProfileCompleteness({
        basics: draft.basics,
        workExperiences: draft.workExperiences,
        projects: draft.projects,
        skills: draft.skills,
        languages: draft.languages,
        preferences: draft.preferences,
      }),
    [draft],
  );
  const preferencesPreview = useMemo(
    () =>
      previewPreferences({
        preferences: draft.preferences.data,
        confirmationStatus: draft.preferences.confirmationStatus,
      }),
    [draft.preferences],
  );

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
    <div className="profile-layout">
      <section className="profile-main">
        <div className="page-heading profile-heading">
          <div>
            <p className="eyebrow">Trusted candidate record · M1</p>
            <h1>{profile ? 'Keep the record honest.' : 'Build your trusted profile.'}</h1>
            <p>
              Every statement has evidence and a review state. Pending imports stay out of
              future matching until you confirm them.
            </p>
          </div>
          <div className="version-pill">
            <span>{profile ? `Version ${profile.version}` : 'Not saved'}</span>
            <strong>{profile?.status ?? 'onboarding'}</strong>
          </div>
        </div>

        <section className="import-panel" aria-labelledby="import-heading">
          <div>
            <p className="eyebrow">Optional starting point</p>
            <h2 id="import-heading">Bring your own text</h2>
            <p>
              No AI runs yet. The test substitute only reads exact Name, Headline,
              Location, and Summary labels, then marks them pending.
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
                Extract pending basics
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

        {message && <p className="notice notice--success">{message}</p>}
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        <ProfileEditor draft={draft} onChange={applyUserEdit} />

        <div className="save-bar">
          <div>
            <strong>
              {profile ? 'Create a new immutable version' : 'Create profile'}
            </strong>
            <span>No historical data will be overwritten.</span>
          </div>
          <div>
            {profile?.status === 'draft' && (
              <button
                className="button button--secondary"
                type="button"
                disabled={busy}
                onClick={() => void confirmPending()}
              >
                Confirm all pending
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
      </section>

      <aside className="profile-aside">
        <section className="completeness-card">
          <div
            className="completeness-ring"
            style={{ '--score': `${completeness.score * 3.6}deg` } as React.CSSProperties}
          >
            <strong>{completeness.score}%</strong>
            <span>complete</span>
          </div>
          <div>
            <p className="eyebrow">Confirmed completeness</p>
            <h2>
              {completeness.completed} of {completeness.total} signals ready
            </h2>
          </div>
          {completeness.missing.length > 0 ? (
            <ul>
              {completeness.missing.map((item) => (
                <li key={item.code}>{item.label}</li>
              ))}
            </ul>
          ) : (
            <p className="complete-copy">All baseline profile signals are confirmed.</p>
          )}
        </section>

        <PreferencesPreviewCard
          preview={preferencesPreview}
          targetRoleCount={draft.preferences.data.targetRoles.length}
        />

        <section className="sources-card">
          <p className="eyebrow">Evidence ledger</p>
          <h2>
            {draft.sources.length} source{draft.sources.length === 1 ? '' : 's'}
          </h2>
          <ul>
            {draft.sources.map((source) => (
              <li key={source.id}>
                <span>{source.label}</span>
                <small>{source.type.replaceAll('_', ' ')}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="versions-card">
          <p className="eyebrow">Version history</p>
          <h2>
            {versions.length || 'No'} saved version{versions.length === 1 ? '' : 's'}
          </h2>
          <ol>
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
                  {version.confirmedFactCount} confirmed · {version.pendingFactCount}{' '}
                  pending
                </small>
              </li>
            ))}
          </ol>
        </section>
      </aside>
    </div>
  );
}
