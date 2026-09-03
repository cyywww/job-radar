import { useCallback, useEffect, useState } from 'react';

import {
  createProfileRequestSchema,
  updateProfileRequestSchema,
  type CreateProfileRequest,
  type ProfileImportResponse,
  type ProfileSnapshot,
  type ProfileSummary,
  type ProfileVersionSummary,
} from '@job-radar/shared';

import {
  confirmProfile,
  createProfile,
  deleteProfile,
  fetchProfile,
  fetchProfileVersions,
  fetchProfiles,
  importPastedProfile,
  importProfileFile,
  selectProfile,
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
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('New profile');
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
  const [dirty, setDirty] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const refreshProfiles = useCallback(async () => {
    setProfiles(await fetchProfiles());
  }, []);

  const showProfile = useCallback(async (profileId: string, select = false) => {
    const resource = select
      ? await selectProfile(profileId)
      : await fetchProfile(profileId);
    setSelectedProfileId(profileId);
    setProfileName(resource.summary.name);
    setProfile(resource.profile);
    setDraft(snapshotToDraft(resource.profile));
    setVersions(await fetchProfileVersions(profileId));
    setDirty(false);
    setConfirmingDelete(false);
    return resource;
  }, []);

  const startNewProfile = () => {
    setSelectedProfileId(null);
    setProfileName(`New profile ${profiles.length + 1}`);
    setProfile(null);
    setDraft(createBlankProfileDraft());
    setVersions([]);
    setPasteText('');
    setMessage(null);
    setError(null);
    setDirty(false);
    setConfirmingDelete(false);
  };

  const canDiscardChanges = () =>
    !dirty || window.confirm('Discard the unsaved changes to this profile?');

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const available = await fetchProfiles();
        if (!active) return;
        setProfiles(available);
        const current = available.find((item) => item.isActive) ?? available[0];
        if (current) {
          await showProfile(current.id);
        } else {
          setSelectedProfileId(null);
          setProfileName('New profile 1');
          setProfile(null);
          setDraft(createBlankProfileDraft());
          setVersions([]);
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
  }, [showProfile]);

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
    setDirty(true);
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
    setDirty(true);
  };

  const handleProfileSelection = async (profileId: string) => {
    if (!profileId || profileId === selectedProfileId || !canDiscardChanges()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const resource = await showProfile(profileId, true);
      await refreshProfiles();
      setMessage(`“${resource.summary.name}” now drives job search and scoring.`);
    } catch (selectionError) {
      setError(errorMessage(selectionError));
    } finally {
      setBusy(false);
    }
  };

  const handleNewProfile = () => {
    if (canDiscardChanges()) startNewProfile();
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
            profile.id,
            profileName,
            updateProfileRequestSchema.parse({
              ...draft,
              baseVersion: profile.version,
              changeSummary: 'Updated profile in browser',
            }),
          )
        : await createProfile(profileName, createProfileRequestSchema.parse(draft));
      setSelectedProfileId(saved.profile.id);
      setProfileName(saved.summary.name);
      setProfile(saved.profile);
      setDraft(snapshotToDraft(saved.profile));
      setVersions(await fetchProfileVersions(saved.profile.id));
      await refreshProfiles();
      setDirty(false);
      setMessage(`“${saved.summary.name}” saved and selected.`);
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
      const confirmed = await confirmProfile(profile.id, {
        baseVersion: profile.version,
        factIds: [],
        confirmAllPending: true,
        changeSummary: 'Confirmed reviewed profile facts in browser',
      });
      setProfile(confirmed.profile);
      setDraft(snapshotToDraft(confirmed.profile));
      setVersions(await fetchProfileVersions(profile.id));
      await refreshProfiles();
      setDirty(false);
      setMessage('Imported facts confirmed.');
    } catch (confirmError) {
      setError(errorMessage(confirmError));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteProfile = async () => {
    if (!profile) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const deletedName = profileName;
      const result = await deleteProfile(profile.id);
      const available = await fetchProfiles();
      setProfiles(available);
      if (result.activeProfileId) {
        await showProfile(result.activeProfileId);
        setMessage(`“${deletedName}” deleted. Another profile is now selected.`);
      } else {
        startNewProfile();
        setMessage(`“${deletedName}” deleted. Create a profile to continue.`);
      }
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  };

  if (loading) return <p className="notice">Loading your local profile…</p>;

  return (
    <div className="profile-page">
      <div className="page-heading profile-heading">
        <div>
          <p className="eyebrow">Job search strategies</p>
          <h1>Profiles</h1>
          <p>Keep a focused profile for each kind of role you want to pursue.</p>
        </div>
        <div className="version-pill" aria-label="Current profile version">
          <span>{profile ? 'Selected profile' : 'New profile'}</span>
          <strong>
            {profile?.status === 'confirmed'
              ? profileName
              : profile
                ? 'Needs review'
                : 'Not saved'}
          </strong>
        </div>
      </div>

      <section className="profile-manager" aria-labelledby="profile-manager-heading">
        <div>
          <h2 id="profile-manager-heading">Choose a profile</h2>
          <p>The selected profile controls job searches, eligibility, and scores.</p>
        </div>
        <label className="profile-manager__select">
          Profile
          <select
            value={selectedProfileId ?? ''}
            disabled={busy || profiles.length === 0}
            onChange={(event) => void handleProfileSelection(event.target.value)}
          >
            {!selectedProfileId ? <option value="">Unsaved profile</option> : null}
            {profiles.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
                {item.isActive ? ' — selected' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="profile-manager__actions">
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            onClick={handleNewProfile}
          >
            New profile
          </button>
          <button
            className="text-button text-button--danger"
            type="button"
            disabled={busy || !profile}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete profile
          </button>
        </div>
        {confirmingDelete && profile ? (
          <div className="profile-delete-confirmation" role="alert">
            <div>
              <strong>Delete “{profileName}”?</strong>
              <span>
                Its profile data and scores will be removed. Jobs stay available.
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleDeleteProfile()}
            >
              Delete permanently
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </div>
        ) : null}
      </section>

      <div aria-live="polite">
        {message && <p className="notice notice--success">{message}</p>}
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
      </div>

      <label className="profile-name-field">
        <span>
          Profile name <small>Required</small>
        </span>
        <input
          value={profileName}
          maxLength={80}
          placeholder="Backend roles in Sweden"
          onChange={(event) => {
            setProfileName(event.target.value);
            setDirty(true);
          }}
        />
      </label>

      <ProfileEditor draft={draft} onChange={applyUserEdit} />

      <div className="save-bar">
        <div>
          <strong>{profile ? 'Save changes' : 'Finish setup'}</strong>
          <span>
            {profile
              ? 'This profile keeps its own history and scores.'
              : 'Saving also selects this profile.'}
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
            {busy ? 'Working…' : profile ? 'Save changes' : 'Create profile'}
          </button>
        </div>
      </div>

      <details className="profile-disclosure profile-disclosure--section">
        <summary>
          <span>Import and history</span>
          <small>
            Optional · {versions.length || 'no'} saved version
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
