import { useState } from "react";
import projectStyles from "../../projects/ProjectsPanel/ProjectsPanel.module.css";
import type { MissionRunController } from "../useMissionRunController.js";
import styles from "./MissionDetailsRoom.module.css";

interface AbortMissionPanelProps {
  controller: MissionRunController;
}

/**
 * Inline abort form. Two visual states:
 *  - Collapsed: a single "Abort and write off" button.
 *  - Expanded: a textarea + Cancel / Confirm pair. Confirm requires a non-empty reason.
 *
 * Mirrors the ManualReviewPanel pattern so abort uses the same shape as the other
 * lifecycle actions (no `window.prompt` modal; no Electron-specific surprises).
 */
export function AbortMissionPanel({ controller }: AbortMissionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();

  if (!expanded) {
    return (
      <button
        type="button"
        className={projectStyles.secondaryButton}
        onClick={() => setExpanded(true)}
      >
        Abort and write off
      </button>
    );
  }

  return (
    <div className={styles.manualReviewPanel}>
      <div className={styles.manualReviewHeader}>
        <span className={styles.manualReviewLabel}>Abort mission</span>
      </div>
      <div className={styles.manualReviewBody}>
        Closes this mission with status <code>aborted</code>. The reason is saved into the
        post-mortem stub. Required.
      </div>
      <textarea
        className={styles.manualReviewTextarea}
        placeholder='e.g. "Underlying API redesign deferred; revisit when SPI-301 lands."'
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className={styles.manualReviewActions}>
        <button
          type="button"
          className={projectStyles.secondaryButton}
          onClick={() => {
            setExpanded(false);
            setReason("");
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className={projectStyles.actionButton}
          onClick={async () => {
            await controller.abortRun(trimmed);
            setExpanded(false);
            setReason("");
          }}
          disabled={trimmed.length === 0}
        >
          Confirm abort
        </button>
      </div>
    </div>
  );
}
