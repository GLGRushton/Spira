import type { TicketRunSummary } from "@spira/shared";
import { useState } from "react";
import projectStyles from "../../projects/ProjectsPanel/ProjectsPanel.module.css";
import type { MissionRunController } from "../useMissionRunController.js";
import styles from "./MissionDetailsRoom.module.css";

interface ManualReviewPanelProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

const formatTimestamp = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toLocaleString());

/**
 * Phase 2.1 — first-class manual-review-only control.
 *
 * Two states:
 *  - **Active** (`run.proof.status === "manual-review"`): show the recorded justification + a Clear button.
 *  - **Inactive**: show a textarea + "Mark as manual review" button. Disabled until the operator has typed
 *    at least one non-whitespace character (this is the audit trail; we don't accept empty).
 *
 * The mission can only be closed when the proof gate is satisfied; this is the first-class way to
 * satisfy it without an automated proof artifact.
 */
export function ManualReviewPanel({ run, controller }: ManualReviewPanelProps) {
  const [draft, setDraft] = useState("");
  const isActive = run.proof.status === "manual-review";
  const className = `${styles.manualReviewPanel} ${isActive ? styles.manualReviewPanelActive : ""}`.trim();

  if (isActive) {
    return (
      <div className={className}>
        <div className={styles.manualReviewHeader}>
          <span className={styles.manualReviewLabel}>Manual review accepted</span>
          {run.proof.manualReviewAt !== null ? (
            <span className={styles.proofRunMeta}>{formatTimestamp(run.proof.manualReviewAt)}</span>
          ) : null}
        </div>
        {run.proof.manualReviewJustification ? (
          <div className={styles.manualReviewJustificationPreview}>{run.proof.manualReviewJustification}</div>
        ) : null}
        <div className={styles.manualReviewActions}>
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => void controller.clearMissionProofManualReview()}
            disabled={controller.isSettingManualReview}
          >
            {controller.isSettingManualReview ? "Clearing…" : "Clear manual review"}
          </button>
        </div>
      </div>
    );
  }

  const trimmed = draft.trim();
  return (
    <div className={className}>
      <div className={styles.manualReviewHeader}>
        <span className={styles.manualReviewLabel}>Mark as manual review</span>
      </div>
      <div className={styles.manualReviewBody}>
        Use this for low-risk changes you've reviewed yourself, or when the proof harness can't run.
        A short justification is required for the audit trail.
      </div>
      <textarea
        className={styles.manualReviewTextarea}
        placeholder='e.g. "5-line copy edit, eyeballed in MissionChangesRoom, no logic touched."'
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className={styles.manualReviewActions}>
        <button
          type="button"
          className={projectStyles.actionButton}
          onClick={async () => {
            await controller.setMissionProofManualReview(trimmed);
            setDraft("");
          }}
          disabled={controller.isSettingManualReview || trimmed.length === 0}
        >
          {controller.isSettingManualReview ? "Recording…" : "Mark as manual review"}
        </button>
      </div>
    </div>
  );
}
