import type {
  MissionLearningSummary,
  ProposedLearningItem,
  PromoteLearningCandidateKind,
  TicketRunSummary,
} from "@spira/shared";
import { useEffect, useState } from "react";
import projectStyles from "../../projects/ProjectsPanel/ProjectsPanel.module.css";
// rule-list / rule-row / formTitle classes live in ProofRulesEditor.module.css; the
// detail-room module only carries the surface/section styling we need below.
import ruleStyles from "../../settings/ProofRulesEditor.module.css";
import styles from "./MissionDetailsRoom.module.css";

interface MissionCloseLearningPanelProps {
  run: TicketRunSummary;
}

const proposedKindToPromoteKind = (
  kind: ProposedLearningItem["kind"],
): "validation-profile-proposed" | "repo-intelligence" =>
  kind === "validation-profile" ? "validation-profile-proposed" : "repo-intelligence";

/**
 * Per-mission close-screen panel. Surfaces what Spira learned from this run:
 *  - Auto-promoted entries (informational; already saved).
 *  - Proposed entries below threshold (one-click manual accept).
 *  - First-mission profile draft (when the project has no `repo_profiles` row).
 *
 * Non-blocking: the mission stays closed regardless of whether the operator engages.
 * Skipped items remain pending in the LearnedCandidatesEditor for later review.
 */
export function MissionCloseLearningPanel({ run }: MissionCloseLearningPanelProps) {
  const [summary, setSummary] = useState<MissionLearningSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const showPanel =
    run.status === "awaiting-review" || run.status === "done" || run.status === "blocked";

  useEffect(() => {
    if (!showPanel) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const fresh = await window.electronAPI.getMissionLearningSummary(run.runId);
        if (cancelled) return;
        setSummary(fresh);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Failed to load learning summary.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [showPanel, run.runId]);

  if (!showPanel || !summary) return null;

  const totalSurfaced =
    summary.autoPromoted.length +
    summary.proposed.length +
    (summary.bootstrapProfile ? 1 : 0) +
    summary.bootstrapValidationProfiles.length;

  if (totalSurfaced === 0) {
    // Quiet success: don't render an empty card. The audit-feed badge in Settings is the
    // operator's path to "what got learned" when the mission produced nothing surfaceable.
    return null;
  }

  const handlePromote = async (
    candidateId: string,
    kind: PromoteLearningCandidateKind,
    pendingKey: string = candidateId,
  ) => {
    setPendingActionId(pendingKey);
    setError(null);
    try {
      const fresh = await window.electronAPI.promoteMissionLearningCandidate({
        runId: run.runId,
        candidateId,
        kind,
      });
      setSummary(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to promote learning candidate.");
    } finally {
      setPendingActionId(null);
    }
  };

  const handleSkip = async (candidateId: string) => {
    setPendingActionId(candidateId);
    setError(null);
    try {
      const fresh = await window.electronAPI.skipMissionLearningCandidate({
        runId: run.runId,
        candidateId,
      });
      setSummary(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to skip learning candidate.");
    } finally {
      setPendingActionId(null);
    }
  };

  return (
    <article className={styles.surface} aria-labelledby={`learning-${run.runId}`}>
      <header className={styles.sectionTopline}>
        <div>
          <div>Mission learning</div>
          <h3 id={`learning-${run.runId}`} className={styles.sectionTitle}>
            Spira learned {totalSurfaced} thing{totalSurfaced === 1 ? "" : "s"} from this mission
          </h3>
          <p className={styles.sectionLead}>
            Auto-promoted items are already saved. Proposed items need one-click acceptance to land
            in the catalogue. Skipped items stay pending in Settings → Learned candidates.
          </p>
        </div>
        <button
          type="button"
          className={projectStyles.secondaryButton}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </header>

      {error ? <div className={projectStyles.error}>{error}</div> : null}
      {isLoading ? <div className={styles.commandHint}>Loading…</div> : null}

      {!collapsed ? (
        <>
          {summary.autoPromoted.length > 0 ? (
            <section style={{ marginTop: 12 }}>
              <h4 className={ruleStyles.formTitle}>✅ Auto-promoted ({summary.autoPromoted.length})</h4>
              <ul className={ruleStyles.ruleList}>
                {summary.autoPromoted.map((entry) => (
                  <li key={entry.candidateId} className={ruleStyles.ruleRow}>
                    <div className={ruleStyles.ruleHeader}>
                      <span className={ruleStyles.ruleId}>{entry.kind}</span>
                      <strong>{entry.title}</strong>
                    </div>
                    <div className={ruleStyles.ruleMeta}>
                      <span>{entry.rationale}</span>
                      <span>· {entry.acceptanceMode}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {summary.bootstrapProfile ? (
            <section style={{ marginTop: 12 }}>
              <h4 className={ruleStyles.formTitle}>
                🆕 No profile for project {summary.bootstrapProfile.projectKey} yet
              </h4>
              <div className={ruleStyles.ruleRow}>
                <div className={ruleStyles.ruleHeader}>
                  <strong>{summary.bootstrapProfile.displayName}</strong>
                </div>
                <div className={ruleStyles.ruleMeta}>
                  {summary.bootstrapProfile.defaultBranch ? (
                    <span>branch: {summary.bootstrapProfile.defaultBranch}</span>
                  ) : null}
                  {summary.bootstrapProfile.defaultBuildWorkingDirectory ? (
                    <span>build dir: {summary.bootstrapProfile.defaultBuildWorkingDirectory}</span>
                  ) : null}
                  {summary.bootstrapProfile.requiredSdks.length > 0 ? (
                    <span>SDKs: {summary.bootstrapProfile.requiredSdks.join(", ")}</span>
                  ) : null}
                </div>
                <div className={ruleStyles.ruleActions}>
                  <button
                    type="button"
                    className={projectStyles.actionButton}
                    onClick={() =>
                      void handlePromote(
                        summary.bootstrapProfile!.projectKey,
                        "repo-profile-bootstrap",
                        "__bootstrap-profile__",
                      )
                    }
                    disabled={pendingActionId === "__bootstrap-profile__"}
                  >
                    Save profile
                  </button>
                </div>
              </div>
            </section>
          ) : null}

          {summary.proposed.length > 0 ? (
            <section style={{ marginTop: 12 }}>
              <h4 className={ruleStyles.formTitle}>📋 Awaiting your nod ({summary.proposed.length})</h4>
              <ul className={ruleStyles.ruleList}>
                {summary.proposed.map((entry) => (
                  <li key={entry.candidateId} className={ruleStyles.ruleRow}>
                    <div className={ruleStyles.ruleHeader}>
                      <span className={ruleStyles.ruleId}>{entry.kind}</span>
                      <strong>{entry.title}</strong>
                    </div>
                    <div className={ruleStyles.ruleMeta}>
                      <span>{entry.rationale}</span>
                    </div>
                    <div className={ruleStyles.ruleActions}>
                      <button
                        type="button"
                        className={projectStyles.secondaryButton}
                        onClick={() =>
                          void handlePromote(entry.candidateId, proposedKindToPromoteKind(entry.kind))
                        }
                        disabled={pendingActionId === entry.candidateId}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className={projectStyles.secondaryButton}
                        onClick={() => void handleSkip(entry.candidateId)}
                        disabled={pendingActionId === entry.candidateId}
                      >
                        Skip for now
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {summary.bootstrapValidationProfiles.length > 0 ? (
            <section style={{ marginTop: 12 }}>
              <h4 className={ruleStyles.formTitle}>
                🆕 First-mission validation drafts ({summary.bootstrapValidationProfiles.length})
              </h4>
              <ul className={ruleStyles.ruleList}>
                {summary.bootstrapValidationProfiles.map((entry) => (
                  <li key={entry.candidateId} className={ruleStyles.ruleRow}>
                    <div className={ruleStyles.ruleHeader}>
                      <span className={ruleStyles.ruleId}>{entry.kind}</span>
                      <strong>{entry.command}</strong>
                    </div>
                    <div className={ruleStyles.ruleMeta}>
                      <span>cwd: {entry.workingDirectory}</span>
                      {entry.repoRelativePath ? <span>repo: {entry.repoRelativePath}</span> : null}
                      <span>{entry.successCount} successful run(s)</span>
                    </div>
                    <div className={ruleStyles.ruleActions}>
                      <button
                        type="button"
                        className={projectStyles.actionButton}
                        onClick={() => void handlePromote(entry.candidateId, "validation-profile-bootstrap")}
                        disabled={pendingActionId === entry.candidateId}
                      >
                        Save validation profile
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
