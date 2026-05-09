import type {
  MissionRepoProfileRecord,
  MissionRepoProfilesSnapshot,
  UpsertMissionRepoProfileInput,
} from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import projectStyles from "../projects/ProjectsPanel/ProjectsPanel.module.css";
import { splitList } from "./admin-form-helpers.js";
import styles from "./ProofRulesEditor.module.css";

interface DraftProfile {
  projectKey: string;
  displayName: string;
  description: string;
  defaultBranch: string;
  defaultBuildWorkingDirectory: string;
  defaultRegistry: string;
  registryHints: string;
  requiredEnvVars: string;
  requiredSdks: string;
  userFacingCopyGlobs: string;
  uiTestGlobs: string;
  notes: string;
}

const EMPTY_DRAFT: DraftProfile = {
  projectKey: "",
  displayName: "",
  description: "",
  defaultBranch: "",
  defaultBuildWorkingDirectory: "",
  defaultRegistry: "",
  registryHints: "",
  requiredEnvVars: "",
  requiredSdks: "",
  userFacingCopyGlobs: "",
  uiTestGlobs: "",
  notes: "",
};

const draftToInput = (draft: DraftProfile): UpsertMissionRepoProfileInput => ({
  projectKey: draft.projectKey.trim(),
  displayName: draft.displayName.trim(),
  description: draft.description.trim() || null,
  defaultBranch: draft.defaultBranch.trim() || null,
  defaultBuildWorkingDirectory: draft.defaultBuildWorkingDirectory.trim() || null,
  defaultRegistry: draft.defaultRegistry.trim() || null,
  registryHints: splitList(draft.registryHints),
  requiredEnvVars: splitList(draft.requiredEnvVars),
  requiredSdks: splitList(draft.requiredSdks),
  userFacingCopyGlobs: splitList(draft.userFacingCopyGlobs),
  uiTestGlobs: splitList(draft.uiTestGlobs),
  notes: draft.notes.trim() || null,
});

const profileToDraft = (profile: MissionRepoProfileRecord): DraftProfile => ({
  projectKey: profile.projectKey,
  displayName: profile.displayName,
  description: profile.description ?? "",
  defaultBranch: profile.defaultBranch ?? "",
  defaultBuildWorkingDirectory: profile.defaultBuildWorkingDirectory ?? "",
  defaultRegistry: profile.defaultRegistry ?? "",
  registryHints: profile.registryHints.join("\n"),
  requiredEnvVars: profile.requiredEnvVars.join("\n"),
  requiredSdks: profile.requiredSdks.join("\n"),
  userFacingCopyGlobs: profile.userFacingCopyGlobs.join("\n"),
  uiTestGlobs: profile.uiTestGlobs.join("\n"),
  notes: profile.notes ?? "",
});

/**
 * Phase 3.2 / 3.3 — Repo profiles admin pane.
 *
 * One row per `projectKey`. The editor doubles as the onboarding wizard from §3.2 — a fresh
 * "Add profile" form with `projectKey` empty captures everything an operator might want to
 * register about a new repo. Editing an existing profile loads its values into the same
 * form so the surface stays small.
 */
export function RepoProfilesEditor() {
  const [snapshot, setSnapshot] = useState<MissionRepoProfilesSnapshot>({ profiles: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<DraftProfile>(EMPTY_DRAFT);
  const [editingProjectKey, setEditingProjectKey] = useState<string | null>(null);

  const loadProfiles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fresh = await window.electronAPI.listMissionRepoProfiles();
      setSnapshot(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load repo profiles.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  const sortedProfiles = useMemo(
    () =>
      [...snapshot.profiles].sort((left, right) => {
        if (left.source !== right.source) return left.source === "builtin" ? -1 : 1;
        return left.projectKey.localeCompare(right.projectKey);
      }),
    [snapshot.profiles],
  );

  const beginEdit = (profile: MissionRepoProfileRecord) => {
    setDraft(profileToDraft(profile));
    setEditingProjectKey(profile.projectKey);
    setError(null);
    setNotice(null);
  };

  const resetForm = () => {
    setDraft(EMPTY_DRAFT);
    setEditingProjectKey(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input = draftToInput(draft);
      if (!input.projectKey || !input.displayName) {
        throw new Error("projectKey and displayName are required.");
      }
      const next = await window.electronAPI.upsertMissionRepoProfile(input);
      setSnapshot(next);
      setNotice(`Saved ${input.projectKey}.`);
      resetForm();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save repo profile.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (projectKey: string) => {
    setPendingDeleteKey(projectKey);
    setError(null);
    setNotice(null);
    try {
      const next = await window.electronAPI.deleteMissionRepoProfile(projectKey);
      setSnapshot(next);
      setNotice(`Deleted ${projectKey}.`);
      if (editingProjectKey === projectKey) {
        resetForm();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete repo profile.");
    } finally {
      setPendingDeleteKey(null);
    }
  };

  const submitDisabled = isSaving || draft.projectKey.trim().length === 0 || draft.displayName.trim().length === 0;

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Repo profiles</h3>
          <p className={styles.lead}>
            Per-project metadata Spira leans on at mission start: registry, default branch, required
            SDKs, where user-facing copy lives. Captured here once, surfaced in mission prompts,
            re-used across every mission for the project.
          </p>
        </div>
        <button
          type="button"
          className={projectStyles.secondaryButton}
          onClick={() => void loadProfiles()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? <div className={projectStyles.error}>{error}</div> : null}
      {notice ? <div className={projectStyles.notice}>{notice}</div> : null}

      <ul className={styles.ruleList}>
        {sortedProfiles.length === 0 && !isLoading ? (
          <li className={styles.empty}>No repo profiles registered yet.</li>
        ) : null}
        {sortedProfiles.map((profile) => (
          <li key={profile.projectKey} className={styles.ruleRow}>
            <div className={styles.ruleHeader}>
              <span className={styles.ruleId}>{profile.projectKey}</span>
              <span className={`${styles.sourceBadge} ${profile.source === "user" ? styles.sourceBadgeUser : ""}`}>
                {profile.source}
              </span>
              <span className={styles.levelBadge}>{profile.displayName}</span>
            </div>
            {profile.description ? <div className={styles.ruleBody}>{profile.description}</div> : null}
            <div className={styles.ruleMeta}>
              {profile.defaultBranch ? <RepoMetaCell label="Branch" value={profile.defaultBranch} /> : null}
              {profile.defaultBuildWorkingDirectory ? (
                <RepoMetaCell label="Build dir" value={profile.defaultBuildWorkingDirectory} />
              ) : null}
              {profile.defaultRegistry ? <RepoMetaCell label="Registry" value={profile.defaultRegistry} /> : null}
              {profile.requiredSdks.length > 0 ? (
                <RepoMetaCell label="Required SDKs" value={profile.requiredSdks.join(", ")} />
              ) : null}
              {profile.requiredEnvVars.length > 0 ? (
                <RepoMetaCell label="Required env" value={profile.requiredEnvVars.join(", ")} />
              ) : null}
              {profile.userFacingCopyGlobs.length > 0 ? (
                <RepoMetaCell label="Copy globs" value={profile.userFacingCopyGlobs.join(", ")} />
              ) : null}
              {profile.uiTestGlobs.length > 0 ? (
                <RepoMetaCell label="UI test globs" value={profile.uiTestGlobs.join(", ")} />
              ) : null}
            </div>
            {profile.notes ? <div className={styles.ruleBody}>{profile.notes}</div> : null}
            <div className={styles.ruleActions}>
              <button type="button" className={projectStyles.secondaryButton} onClick={() => beginEdit(profile)}>
                Edit
              </button>
              <button
                type="button"
                className={projectStyles.secondaryButton}
                onClick={() => void handleDelete(profile.projectKey)}
                disabled={pendingDeleteKey === profile.projectKey}
              >
                {pendingDeleteKey === profile.projectKey ? "Deleting…" : "Delete"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className={styles.form} onSubmit={handleSubmit}>
        <h4 className={styles.formTitle}>{editingProjectKey ? `Edit ${editingProjectKey}` : "Add a repo profile"}</h4>
        <div className={styles.formGrid}>
          <label>
            <span>Project key</span>
            <input
              type="text"
              value={draft.projectKey}
              onChange={(event) => setDraft({ ...draft, projectKey: event.target.value })}
              placeholder="legapp-entry"
              disabled={editingProjectKey !== null}
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              type="text"
              value={draft.displayName}
              onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              placeholder="LegApp Entry"
            />
          </label>
          <label>
            <span>Default branch</span>
            <input
              type="text"
              value={draft.defaultBranch}
              onChange={(event) => setDraft({ ...draft, defaultBranch: event.target.value })}
              placeholder="main"
            />
          </label>
          <label>
            <span>Default build dir</span>
            <input
              type="text"
              value={draft.defaultBuildWorkingDirectory}
              onChange={(event) => setDraft({ ...draft, defaultBuildWorkingDirectory: event.target.value })}
              placeholder="LegApp.Entry.UI/ClientApp"
            />
          </label>
          <label>
            <span>Default registry</span>
            <input
              type="text"
              value={draft.defaultRegistry}
              onChange={(event) => setDraft({ ...draft, defaultRegistry: event.target.value })}
              placeholder="https://npm.parliament.uk"
            />
          </label>
        </div>
        <label className={styles.fullWidth}>
          <span>Description</span>
          <textarea
            rows={2}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
        </label>
        <label className={styles.fullWidth}>
          <span>Required SDKs (comma- or newline-separated)</span>
          <textarea
            rows={2}
            value={draft.requiredSdks}
            onChange={(event) => setDraft({ ...draft, requiredSdks: event.target.value })}
            placeholder="node 22, .NET 8"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>Required env vars</span>
          <textarea
            rows={2}
            value={draft.requiredEnvVars}
            onChange={(event) => setDraft({ ...draft, requiredEnvVars: event.target.value })}
            placeholder="GITHUB_TOKEN, AZURE_TENANT_ID"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>Registry hints</span>
          <textarea
            rows={2}
            value={draft.registryHints}
            onChange={(event) => setDraft({ ...draft, registryHints: event.target.value })}
            placeholder="@pds-design-system/* requires the Parliament registry"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>User-facing copy globs</span>
          <textarea
            rows={2}
            value={draft.userFacingCopyGlobs}
            onChange={(event) => setDraft({ ...draft, userFacingCopyGlobs: event.target.value })}
            placeholder="LegApp.Entry.UI/ClientApp/src/**/*.html"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>UI test globs</span>
          <textarea
            rows={2}
            value={draft.uiTestGlobs}
            onChange={(event) => setDraft({ ...draft, uiTestGlobs: event.target.value })}
            placeholder="LegApp.Admin.UI.Tests/PageTests/**/*.cs"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>Notes (free-text)</span>
          <textarea
            rows={3}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </label>
        <div className={styles.formActions}>
          {editingProjectKey ? (
            <button type="button" className={projectStyles.secondaryButton} onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
          <button type="submit" className={projectStyles.actionButton} disabled={submitDisabled}>
            {isSaving ? "Saving…" : editingProjectKey ? "Save changes" : "Add profile"}
          </button>
        </div>
      </form>
    </section>
  );
}

function RepoMetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaCell}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  );
}
