import {
  type MissionLearnedCandidateRecord,
  type MissionLearnedCandidatesSnapshot,
} from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import projectStyles from "../projects/ProjectsPanel/ProjectsPanel.module.css";
import styles from "./ProofRulesEditor.module.css";

/**
 * Learned candidates admin pane. Lists every learned intelligence entry — pending,
 * auto-promoted, and revoked — with its audit-trail metadata (contributing run ids,
 * blocked-evidence run ids, archived flag). Operators can revoke a promoted entry with
 * a free-text reason; the snapshot returned by the backend covers both the demotion and
 * the new "must not auto-re-promote on the same evidence" tag set.
 */

const describeStatus = (record: MissionLearnedCandidateRecord): "promoted" | "pending" | "revoked" | "archived" => {
  if (record.archived) return "archived";
  if (record.revoked) return "revoked";
  if (record.approved) return "promoted";
  return "pending";
};

export function LearnedCandidatesEditor() {
  const [snapshot, setSnapshot] = useState<MissionLearnedCandidatesSnapshot>({ candidates: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});

  const loadCandidates = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fresh = await window.electronAPI.listMissionLearnedCandidates();
      setSnapshot(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load learned candidates.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadCandidates();
  }, []);

  const sortedCandidates = useMemo(
    () =>
      [...snapshot.candidates].sort((left, right) => right.updatedAt - left.updatedAt),
    [snapshot.candidates],
  );

  const handleRevoke = async (candidate: MissionLearnedCandidateRecord, archive: boolean) => {
    const reason = revokeReasons[candidate.id]?.trim() ?? "";
    if (!reason) {
      setError("Provide a reason before revoking a learned candidate.");
      return;
    }
    setPendingRevokeId(candidate.id);
    setError(null);
    setNotice(null);
    try {
      const next = await window.electronAPI.revokeMissionLearnedCandidate({
        candidateId: candidate.id,
        reason,
        archive,
      });
      setSnapshot(next);
      setNotice(`Revoked ${candidate.id}${archive ? " (archived)" : ""}.`);
      setRevokeReasons((current) => {
        const fresh = { ...current };
        delete fresh[candidate.id];
        return fresh;
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to revoke learned candidate.");
    } finally {
      setPendingRevokeId(null);
    }
  };

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Learned candidates</h3>
          <p className={styles.lead}>
            Auto-promoted intelligence entries surface from the close path. Revoke (with
            a reason) to demote and refuse re-promotion on the same evidence; archive
            when the candidate is wrong rather than just stale.
          </p>
        </div>
        <button
          type="button"
          className={projectStyles.secondaryButton}
          onClick={() => void loadCandidates()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? <div className={projectStyles.error}>{error}</div> : null}
      {notice ? <div className={projectStyles.notice}>{notice}</div> : null}

      <ul className={styles.ruleList}>
        {sortedCandidates.length === 0 && !isLoading ? (
          <li className={styles.empty}>No learned candidates recorded yet.</li>
        ) : null}
        {sortedCandidates.map((candidate) => {
          const status = describeStatus(candidate);
          return (
            <li key={candidate.id} className={styles.ruleRow}>
              <div className={styles.ruleHeader}>
                <span className={styles.ruleId}>{candidate.id}</span>
                <span className={`${styles.sourceBadge} ${styles.sourceBadgeUser}`}>{candidate.source}</span>
                <span className={styles.levelBadge}>{candidate.type}</span>
                <span className={styles.levelBadge}>{status}</span>
              </div>
              <div className={styles.ruleBody}>
                <strong>{candidate.title}</strong>
                <p style={{ marginTop: 6 }}>{candidate.content}</p>
              </div>
              <div className={styles.ruleMeta}>
                <span>Project: {candidate.projectKey ?? "(any)"}</span>
                <span>Repo: {candidate.repoRelativePath ?? "(any)"}</span>
                <span>Promoted runs: {candidate.promotedRunIds.length}</span>
                <span>Blocked runs: {candidate.revokedRunIds.length}</span>
              </div>
              {candidate.approved && !candidate.revoked ? (
                <div className={styles.ruleActions} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Revocation reason (required)"
                    value={revokeReasons[candidate.id] ?? ""}
                    onChange={(event) =>
                      setRevokeReasons((current) => ({ ...current, [candidate.id]: event.target.value }))
                    }
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={projectStyles.secondaryButton}
                      disabled={pendingRevokeId === candidate.id}
                      onClick={() => void handleRevoke(candidate, false)}
                    >
                      {pendingRevokeId === candidate.id ? "Revoking…" : "Revoke"}
                    </button>
                    <button
                      type="button"
                      className={projectStyles.secondaryButton}
                      disabled={pendingRevokeId === candidate.id}
                      onClick={() => void handleRevoke(candidate, true)}
                    >
                      {pendingRevokeId === candidate.id ? "Revoking…" : "Archive (revoke + mark wrong)"}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
