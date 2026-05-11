import styles from "./StageRail.module.css";
import {
  stageIndex,
  WORKFLOW_STAGE_ORDER,
  type OrderedWorkflowStage,
  type WorkflowStage,
} from "./workflow-stage.js";

interface StageRailProps {
  stage: WorkflowStage;
  blocked?: boolean;
  variant?: "full" | "micro";
}

const STAGE_LABELS: Record<OrderedWorkflowStage, string> = {
  diff: "Diff",
  commit: "Commit",
  push: "Push",
  pr: "PR",
};

function stageLabel(stage: WorkflowStage): string {
  return stage === "clean" ? "Clean" : STAGE_LABELS[stage];
}

export function StageRail({ stage, blocked = false, variant = "full" }: StageRailProps) {
  const cur = stageIndex(stage);
  const fillSegments = Math.max(0, Math.min(cur, WORKFLOW_STAGE_ORDER.length - 1));
  const fillWidth = (fillSegments / (WORKFLOW_STAGE_ORDER.length - 1)) * 75;

  if (variant === "micro") {
    return (
      <span className={styles.micro} aria-hidden="true">
        {WORKFLOW_STAGE_ORDER.map((s, i) => {
          const done = i < cur;
          const here = i === cur;
          const dotClass = [
            styles.microDot,
            done ? styles.microDotDone : "",
            here && !blocked ? styles.microDotCurrent : "",
            here && blocked ? styles.microDotCurrentBlocked : "",
          ]
            .filter(Boolean)
            .join(" ");
          const barClass = [
            styles.microBar,
            i < cur ? styles.microBarDone : "",
            i === cur - 1 && blocked ? styles.microBarCurrentBlocked : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <span key={s} className={styles.micro}>
              <span className={dotClass} />
              {i < WORKFLOW_STAGE_ORDER.length - 1 ? <span className={barClass} /> : null}
            </span>
          );
        })}
      </span>
    );
  }

  return (
    <div className={styles.full} role="img" aria-label={`Workflow stage: ${stageLabel(stage)}${blocked ? " (blocked)" : ""}`}>
      <span className={styles.fullTrack} />
      <span
        className={[styles.fullTrackFill, blocked ? styles.fullTrackFillBlocked : ""].filter(Boolean).join(" ")}
        style={{ width: `${fillWidth}%` }}
      />
      {WORKFLOW_STAGE_ORDER.map((s, i) => {
        const done = i < cur;
        const here = i === cur;
        const glyphClass = [
          styles.glyph,
          done ? styles.glyphDone : "",
          here && !blocked ? styles.glyphCurrent : "",
          here && blocked ? styles.glyphCurrentBlocked : "",
        ]
          .filter(Boolean)
          .join(" ");
        const labelClass = [
          styles.label,
          done ? styles.labelDone : "",
          here && !blocked ? styles.labelCurrent : "",
          here && blocked ? styles.labelCurrentBlocked : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <span key={s} className={styles.node}>
            <span className={glyphClass} aria-hidden="true">
              {done ? "✓" : i + 1}
            </span>
            <span className={labelClass}>{STAGE_LABELS[s]}</span>
          </span>
        );
      })}
    </div>
  );
}
