import type { TicketRunSummary } from "@spira/shared";
import { useNavigationStore } from "../../../stores/navigation-store.js";
import { useStationStore } from "../../../stores/station-store.js";
import projectStyles from "../../projects/ProjectsPanel.module.css";
import shellStyles from "../MissionShell.module.css";
import { describeAttemptStatus, describeRunStatus } from "../mission-display-utils.js";
import type { MissionRunController } from "../useMissionRunController.js";

interface MissionDetailsRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

export function MissionDetailsRoom({ run, controller }: MissionDetailsRoomProps) {
  const setMissionRoom = useNavigationStore((store) => store.setMissionRoom);
  const stationLabel = useStationStore((store) => (run.stationId ? store.stations[run.stationId]?.label ?? run.stationId : null));
  const latestAttempt = run.attempts[run.attempts.length - 1] ?? null;

  return (
    <section className={shellStyles.roomSection}>
      <article className={shellStyles.sectionCard}>
        <h3 className={shellStyles.sectionTitle}>Mission overview</h3>
        <div className={shellStyles.factsGrid}>
          <div>
            <span className={shellStyles.factLabel}>Ticket</span>
            <span className={shellStyles.factValue}>{run.ticketId}</span>
          </div>
          <div>
            <span className={shellStyles.factLabel}>Project</span>
            <span className={shellStyles.factValue}>{run.projectKey}</span>
          </div>
          <div>
            <span className={shellStyles.factLabel}>Status</span>
            <span className={shellStyles.factValue}>{describeRunStatus(run)}</span>
          </div>
          <div>
            <span className={shellStyles.factLabel}>Updated</span>
            <span className={shellStyles.factValue}>{new Date(run.updatedAt).toLocaleString()}</span>
          </div>
          <div>
            <span className={shellStyles.factLabel}>Attempts</span>
            <span className={shellStyles.factValue}>{run.attempts.length}</span>
          </div>
          <div>
            <span className={shellStyles.factLabel}>Station</span>
            <span className={shellStyles.factValue}>{stationLabel ?? "Not bound"}</span>
          </div>
        </div>
        {run.statusMessage ? <p className={shellStyles.sectionCopy}>{run.statusMessage}</p> : null}
      </article>

      <article className={projectStyles.detailCard}>
        <div className={projectStyles.sectionHeader}>
          <div>
            <div className={projectStyles.sectionLabel}>Mission actions</div>
            <div className={projectStyles.sectionCaption}>
              Command flow lives here. Git workflow and launch profiles have their own rooms now; cleaner decks, fewer collisions.
            </div>
          </div>
          {run.stationId ? (
            <button
              type="button"
              className={projectStyles.secondaryButton}
              onClick={() => setMissionRoom(run.runId, "bridge")}
            >
              Open mission bridge
            </button>
          ) : null}
        </div>

        {controller.runNotice ? <div className={projectStyles.notice}>{controller.runNotice}</div> : null}
        {controller.runError ? <div className={projectStyles.error}>{controller.runError}</div> : null}

        {run.status === "blocked" ? (
          <div className={projectStyles.workActions}>
            <span className={projectStyles.workMeta}>YouTrack state sync is retryable.</span>
            <button
              type="button"
              className={projectStyles.actionButton}
              onClick={() => void controller.retryTicketRunSync()}
              disabled={controller.isRetryingSync}
            >
              {controller.isRetryingSync ? "Syncing..." : "Retry state sync"}
            </button>
          </div>
        ) : null}

        {run.status === "ready" ? (
          <div className={projectStyles.workActions}>
            <span className={projectStyles.workMeta}>
              The mission workspace is prepared. Spira has not started coding yet.
            </span>
            <button
              type="button"
              className={projectStyles.actionButton}
              onClick={() => void controller.startRunWork()}
              disabled={controller.isStartingWork}
            >
              {controller.isStartingWork ? "Starting work..." : "Start work"}
            </button>
          </div>
        ) : null}

        {run.status === "working" ? (
          <div className={projectStyles.workActions}>
            <span className={projectStyles.workMeta}>
              {latestAttempt ? `Attempt ${latestAttempt.sequence} is active.` : "Mission pass is active."}
            </span>
            <button
              type="button"
              className={projectStyles.secondaryButton}
              onClick={() => void controller.cancelRunWork()}
              disabled={controller.isCancellingWork}
            >
              {controller.isCancellingWork ? "Cancelling..." : "Cancel pass"}
            </button>
          </div>
        ) : null}

        {run.status === "awaiting-review" ? (
          <div className={projectStyles.reviewPanel}>
            <label className={projectStyles.field}>
              <span>Next prompt</span>
              <textarea
                className={`${projectStyles.input} ${projectStyles.textarea}`}
                value={controller.continueDraft}
                onChange={(event) => controller.setContinueDraft(event.target.value)}
                placeholder="Tighten anything you want on the next pass."
              />
            </label>
            <div className={projectStyles.inlineActions}>
              <button
                type="button"
                className={projectStyles.secondaryButton}
                onClick={() => void controller.continueRunWork()}
                disabled={controller.isContinuingWork}
              >
                {controller.isContinuingWork ? "Continuing..." : "Continue work"}
              </button>
              <button
                type="button"
                className={projectStyles.actionButton}
                onClick={() => void controller.completeRun()}
                disabled={controller.isCompletingRun}
              >
                {controller.isCompletingRun ? "Completing..." : "Mark complete"}
              </button>
            </div>
          </div>
        ) : null}
      </article>

      {run.attempts.length > 0 ? (
        <article className={projectStyles.detailCard}>
          <div className={projectStyles.sectionLabel}>Mission attempts</div>
          <div className={projectStyles.attemptList}>
            {[...run.attempts].reverse().map((attempt) => (
              <div key={attempt.attemptId} className={projectStyles.attemptCard}>
                <div className={projectStyles.workHeader}>
                  <strong>Attempt {attempt.sequence}</strong>
                  <span className={projectStyles.statusBadge}>{describeAttemptStatus(attempt.status)}</span>
                </div>
                {attempt.prompt ? <div className={projectStyles.workHint}>Prompt: {attempt.prompt}</div> : null}
                {attempt.summary ? <div className={projectStyles.workHint}>{attempt.summary}</div> : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      <article className={shellStyles.sectionCard}>
        <h3 className={shellStyles.sectionTitle}>Managed worktrees</h3>
        <div className={shellStyles.worktreeList}>
          {run.worktrees.map((worktree) => (
            <div key={`${run.runId}:${worktree.repoRelativePath}`} className={shellStyles.worktreeCard}>
              <div className={shellStyles.worktreeTitle}>
                <span>{worktree.repoRelativePath}</span>
                <span>{worktree.branchName}</span>
              </div>
              <div className={shellStyles.worktreeMeta}>
                <span>{worktree.worktreePath}</span>
                <span>Repo: {worktree.repoAbsolutePath}</span>
              </div>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
