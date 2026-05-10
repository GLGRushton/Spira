import {
  TICKET_RUN_MISSION_VALIDATION_KINDS,
  type MissionValidationProfileRecord,
  type MissionValidationProfilesSnapshot,
  type TicketRunMissionValidationKind,
  type UpsertMissionValidationProfileInput,
  formatDuration,
} from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import projectStyles from "../projects/ProjectsPanel/ProjectsPanel.module.css";
import { splitList } from "./admin-form-helpers.js";
import styles from "./ProofRulesEditor.module.css";

interface DraftProfile {
  id: string | null;
  projectKey: string;
  repoRelativePath: string;
  label: string;
  kind: TicketRunMissionValidationKind;
  command: string;
  workingDirectory: string;
  notes: string;
  confidence: string;
  expectedRuntimeSeconds: string;
  prerequisites: string;
}

const EMPTY_DRAFT: DraftProfile = {
  id: null,
  projectKey: "",
  repoRelativePath: "",
  label: "",
  kind: "build",
  command: "",
  workingDirectory: ".",
  notes: "",
  confidence: "0.7",
  expectedRuntimeSeconds: "",
  prerequisites: "",
};

const profileToDraft = (profile: MissionValidationProfileRecord): DraftProfile => ({
  id: profile.id,
  projectKey: profile.projectKey ?? "",
  repoRelativePath: profile.repoRelativePath ?? "",
  label: profile.label,
  kind: profile.kind,
  command: profile.command,
  workingDirectory: profile.workingDirectory,
  notes: profile.notes ?? "",
  confidence: profile.confidence.toFixed(2),
  expectedRuntimeSeconds: profile.expectedRuntimeMs ? (profile.expectedRuntimeMs / 1000).toString() : "",
  prerequisites: profile.prerequisites.join(", "),
});

const draftToInput = (draft: DraftProfile): UpsertMissionValidationProfileInput => {
  const confidence = Number.parseFloat(draft.confidence);
  const expectedRuntimeSeconds = Number.parseFloat(draft.expectedRuntimeSeconds);
  return {
    id: draft.id ?? undefined,
    projectKey: draft.projectKey.trim() || null,
    repoRelativePath: draft.repoRelativePath.trim() || null,
    label: draft.label.trim(),
    kind: draft.kind,
    command: draft.command.trim(),
    workingDirectory: draft.workingDirectory.trim(),
    notes: draft.notes.trim() || null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.7,
    expectedRuntimeMs: Number.isFinite(expectedRuntimeSeconds) ? Math.round(expectedRuntimeSeconds * 1000) : null,
    prerequisites: splitList(draft.prerequisites),
  };
};

const formatRuntime = (ms: number | null): string => formatDuration(ms, "minutes-only");

/**
 * Validation profiles admin pane. Same shape and conventions as the proof
 * rules editor: builtin (id prefix `global-`) profiles are read-only; user profiles can
 * be added and removed. Editing existing user profiles isn't supported here yet — delete
 * + re-add covers the common case and keeps the surface tight.
 */
export function ValidationProfilesEditor() {
  const [snapshot, setSnapshot] = useState<MissionValidationProfilesSnapshot>({ profiles: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<DraftProfile>(EMPTY_DRAFT);

  const loadProfiles = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fresh = await window.electronAPI.listMissionValidationProfiles();
      setSnapshot(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load validation profiles.");
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
        return left.id.localeCompare(right.id);
      }),
    [snapshot.profiles],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const input = draftToInput(draft);
      if (!input.label || !input.command || !input.workingDirectory) {
        throw new Error("label, command, and workingDirectory are required.");
      }
      const next = await window.electronAPI.upsertMissionValidationProfile(input);
      setSnapshot(next);
      setNotice(`Saved validation profile.`);
      setDraft(EMPTY_DRAFT);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save validation profile.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    setPendingDeleteId(profileId);
    setError(null);
    setNotice(null);
    try {
      const next = await window.electronAPI.deleteMissionValidationProfile(profileId);
      setSnapshot(next);
      setNotice(`Deleted ${profileId}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete validation profile.");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const submitDisabled = isSaving || draft.label.trim().length === 0 || draft.command.trim().length === 0;

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Validation profiles</h3>
          <p className={styles.lead}>
            Per-repo validation commands (build, test, lint, restore, format, e2e-smoke). Builtin
            profiles ship with the application; user profiles let you register the right command
            for a project so the agent doesn't have to re-discover it every mission.
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
          <li className={styles.empty}>No validation profiles registered yet.</li>
        ) : null}
        {sortedProfiles.map((profile) => (
          <li key={profile.id} className={styles.ruleRow}>
            <div className={styles.ruleHeader}>
              <span className={styles.ruleId}>{profile.id}</span>
              <span className={`${styles.sourceBadge} ${profile.source === "user" ? styles.sourceBadgeUser : ""}`}>
                {profile.source}
              </span>
              <span className={styles.levelBadge}>{profile.kind}</span>
            </div>
            <div className={styles.ruleBody}>
              <strong>{profile.label}</strong>
              <div style={{ fontFamily: "var(--font-mono, monospace)", marginTop: 6 }}>$ {profile.command}</div>
            </div>
            <div className={styles.ruleMeta}>
              <ProfileMetaCell label="Project" value={profile.projectKey ?? "(any)"} />
              <ProfileMetaCell label="Repo path" value={profile.repoRelativePath ?? "(any)"} />
              <ProfileMetaCell label="Working dir" value={profile.workingDirectory} />
              <ProfileMetaCell label="Confidence" value={profile.confidence.toFixed(2)} />
              <ProfileMetaCell label="Expected runtime" value={formatRuntime(profile.expectedRuntimeMs)} />
              <ProfileMetaCell label="Last observed" value={formatRuntime(profile.lastObservedRuntimeMs)} />
              {profile.prerequisites.length > 0 ? (
                <ProfileMetaCell label="Prerequisites" value={profile.prerequisites.join(", ")} />
              ) : null}
            </div>
            {profile.notes ? <div className={styles.ruleBody}>{profile.notes}</div> : null}
            {profile.source === "user" ? (
              <div className={styles.ruleActions}>
                <button
                  type="button"
                  className={projectStyles.secondaryButton}
                  onClick={() => {
                    setDraft(profileToDraft(profile));
                    setError(null);
                    setNotice(null);
                  }}
                  disabled={pendingDeleteId === profile.id}
                >
                  Edit profile
                </button>
                <button
                  type="button"
                  className={projectStyles.secondaryButton}
                  onClick={() => void handleDelete(profile.id)}
                  disabled={pendingDeleteId === profile.id}
                >
                  {pendingDeleteId === profile.id ? "Deleting…" : "Delete profile"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <form className={styles.form} onSubmit={handleSubmit}>
        <h4 className={styles.formTitle}>
          {draft.id ? `Edit ${draft.id}` : "Add a user validation profile"}
        </h4>
        <div className={styles.formGrid}>
          <label>
            <span>Project key{draft.id ? " (locked)" : ""}</span>
            <input
              type="text"
              value={draft.projectKey}
              onChange={(event) => setDraft({ ...draft, projectKey: event.target.value })}
              placeholder="(any)"
              disabled={draft.id !== null}
            />
          </label>
          <label>
            <span>Repo path</span>
            <input
              type="text"
              value={draft.repoRelativePath}
              onChange={(event) => setDraft({ ...draft, repoRelativePath: event.target.value })}
              placeholder="(any)"
            />
          </label>
          <label>
            <span>Label</span>
            <input
              type="text"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              placeholder="ClientApp build"
            />
          </label>
          <label>
            <span>Kind</span>
            <select
              value={draft.kind}
              onChange={(event) => setDraft({ ...draft, kind: event.target.value as TicketRunMissionValidationKind })}
            >
              {TICKET_RUN_MISSION_VALIDATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Working dir</span>
            <input
              type="text"
              value={draft.workingDirectory}
              onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })}
              placeholder="."
            />
          </label>
          <label>
            <span>Confidence (0–1)</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={draft.confidence}
              onChange={(event) => setDraft({ ...draft, confidence: event.target.value })}
              placeholder="0.7"
            />
          </label>
          <label>
            <span>Expected runtime (s)</span>
            <input
              type="text"
              value={draft.expectedRuntimeSeconds}
              onChange={(event) => setDraft({ ...draft, expectedRuntimeSeconds: event.target.value })}
              placeholder="120"
            />
          </label>
        </div>
        <label className={styles.fullWidth}>
          <span>Command</span>
          <textarea
            rows={2}
            value={draft.command}
            onChange={(event) => setDraft({ ...draft, command: event.target.value })}
            placeholder="npm run build"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>Prerequisites</span>
          <textarea
            rows={2}
            value={draft.prerequisites}
            onChange={(event) => setDraft({ ...draft, prerequisites: event.target.value })}
            placeholder="npm ci --registry https://npm.parliament.uk"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>Notes</span>
          <textarea
            rows={2}
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
          />
        </label>
        <div className={styles.formActions}>
          <button type="submit" className={projectStyles.actionButton} disabled={submitDisabled}>
            {isSaving ? "Saving…" : draft.id ? "Save changes" : "Add profile"}
          </button>
          {draft.id ? (
            <button
              type="button"
              className={projectStyles.secondaryButton}
              onClick={() => setDraft(EMPTY_DRAFT)}
              disabled={isSaving}
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function ProfileMetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaCell}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  );
}
