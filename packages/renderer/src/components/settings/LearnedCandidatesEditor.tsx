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

const DEFAULT_BULK_ROLLBACK_COUNT = 5;

export function LearnedCandidatesEditor() {
  const [snapshot, setSnapshot] = useState<MissionLearnedCandidatesSnapshot>({ candidates: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});
  const [bulkRollbackOpen, setBulkRollbackOpen] = useState(false);
  const [bulkRollbackCount, setBulkRollbackCount] = useState(DEFAULT_BULK_ROLLBACK_COUNT);
  const [bulkRollbackSelected, setBulkRollbackSelected] = useState<Set<string>>(new Set());
  const [bulkRollbackPending, setBulkRollbackPending] = useState(false);
  const [digestPending, setDigestPending] = useState(false);

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

  const recentlyPromoted = useMemo(
    () =>
      [...snapshot.candidates]
        .filter((entry) => entry.approved && !entry.revoked && entry.promotedRunIds.length > 0)
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, bulkRollbackCount),
    [snapshot.candidates, bulkRollbackCount],
  );

  const handleBulkRollback = async () => {
    if (bulkRollbackSelected.size === 0) return;
    setBulkRollbackPending(true);
    setError(null);
    setNotice(null);
    const today = new Date().toISOString().split("T")[0];
    const reason = `Bulk rollback ${today}`;
    let next = snapshot;
    try {
      for (const candidateId of bulkRollbackSelected) {
        next = await window.electronAPI.revokeMissionLearnedCandidate({
          candidateId,
          reason,
          archive: false,
        });
      }
      setSnapshot(next);
      setNotice(`Bulk-rolled-back ${bulkRollbackSelected.size} promoted entr${bulkRollbackSelected.size === 1 ? "y" : "ies"}.`);
      setBulkRollbackSelected(new Set());
      setBulkRollbackOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Bulk rollback failed.");
    } finally {
      setBulkRollbackPending(false);
    }
  };

  const handleGenerateDigest = async () => {
    setDigestPending(true);
    setError(null);
    setNotice(null);
    try {
      const path = await window.electronAPI.generateMissionWeeklyDigest();
      setNotice(path ? `Digest written to ${path}` : "No closed runs in the digest window — nothing to report.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to generate weekly digest.");
    } finally {
      setDigestPending(false);
    }
  };

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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => void loadCandidates()}
            disabled={isLoading}
          >
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => setBulkRollbackOpen((current) => !current)}
            disabled={isLoading}
          >
            {bulkRollbackOpen ? "Close bulk rollback" : "Rollback last N promotions"}
          </button>
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => void handleGenerateDigest()}
            disabled={digestPending}
          >
            {digestPending ? "Generating…" : "Generate weekly digest now"}
          </button>
        </div>
      </header>

      {bulkRollbackOpen ? (
        <div className={styles.ruleRow} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label htmlFor="bulk-rollback-count">Most recent</label>
            <input
              id="bulk-rollback-count"
              type="number"
              min={1}
              max={50}
              value={bulkRollbackCount}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                if (Number.isFinite(next) && next >= 1) setBulkRollbackCount(Math.min(50, next));
              }}
              style={{ width: 64 }}
            />
            <span>auto-promotions, tick to revoke each:</span>
          </div>
          {recentlyPromoted.length === 0 ? (
            <p>No auto-promoted entries to roll back.</p>
          ) : (
            <ul className={styles.ruleList}>
              {recentlyPromoted.map((candidate) => (
                <li key={candidate.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    id={`bulk-${candidate.id}`}
                    checked={bulkRollbackSelected.has(candidate.id)}
                    onChange={(event) =>
                      setBulkRollbackSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        return next;
                      })
                    }
                  />
                  <label htmlFor={`bulk-${candidate.id}`}>
                    <strong>{candidate.title}</strong> ({candidate.type}, {candidate.promotedRunIds.length} runs)
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => void handleBulkRollback()}
            disabled={bulkRollbackPending || bulkRollbackSelected.size === 0}
          >
            {bulkRollbackPending
              ? "Rolling back…"
              : `Confirm rollback of ${bulkRollbackSelected.size} entries`}
          </button>
        </div>
      ) : null}

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
