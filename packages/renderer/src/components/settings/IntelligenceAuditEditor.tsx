import { type IntelligenceAuditEvent, formatIsoTimestamp } from "@spira/shared";
import { useEffect, useState } from "react";
import projectStyles from "../projects/ProjectsPanel/ProjectsPanel.module.css";
import styles from "./ProofRulesEditor.module.css";

/**
 * Cross-mission audit feed for `learned-candidate-promoted` and `-revoked` events. Read-only;
 * the LearnedCandidatesEditor handles actual revocation.
 */
export function IntelligenceAuditEditor() {
  const [events, setEvents] = useState<IntelligenceAuditEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fresh = await window.electronAPI.listMissionIntelligenceAudit(200);
      setEvents(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load intelligence audit feed.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Intelligence audit</h3>
          <p className={styles.lead}>
            Cross-mission feed of every learned-candidate promotion and revocation. Use this to
            answer "why is this entry approved?" without scanning per-mission timelines.
          </p>
        </div>
        <button
          type="button"
          className={projectStyles.secondaryButton}
          onClick={() => void load()}
          disabled={isLoading}
        >
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? <div className={projectStyles.error}>{error}</div> : null}

      <ul className={styles.ruleList}>
        {events.length === 0 && !isLoading ? (
          <li className={styles.empty}>No intelligence audit events recorded yet.</li>
        ) : null}
        {events.map((event) => (
          <li key={event.id} className={styles.ruleRow}>
            <div className={styles.ruleHeader}>
              <span className={styles.ruleId}>{event.candidateId}</span>
              <span
                className={`${styles.sourceBadge} ${
                  event.eventType === "learned-candidate-promoted"
                    ? styles.sourceBadgeUser
                    : ""
                }`}
              >
                {event.eventType === "learned-candidate-promoted" ? "promoted" : "revoked"}
              </span>
              {event.candidateType ? (
                <span className={styles.levelBadge}>{event.candidateType}</span>
              ) : null}
              {event.archived ? <span className={styles.levelBadge}>archived</span> : null}
            </div>
            <div className={styles.ruleMeta}>
              <span>Run: {event.runId}</span>
              <span>{formatIsoTimestamp(event.occurredAt)}</span>
              {event.confidence !== null ? (
                <span>Confidence: {event.confidence.toFixed(2)} (threshold {event.threshold ?? "?"})</span>
              ) : null}
              {event.formulaVersion !== null ? <span>Formula v{event.formulaVersion}</span> : null}
              {event.contributingRunIds && event.contributingRunIds.length > 0 ? (
                <span>Contributing: {event.contributingRunIds.length}</span>
              ) : null}
              {event.contradictingRunIds && event.contradictingRunIds.length > 0 ? (
                <span>Contradicting: {event.contradictingRunIds.length}</span>
              ) : null}
              {event.blockedContributingRunIds && event.blockedContributingRunIds.length > 0 ? (
                <span>Blocked: {event.blockedContributingRunIds.length}</span>
              ) : null}
            </div>
            {event.reason ? <div className={styles.ruleBody}>Reason: {event.reason}</div> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
