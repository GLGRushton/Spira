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
  const stationLabel = useStationStore((store) =>
    run.stationId ? (store.stations[run.stationId]?.label ?? run.stationId) : null,
  );
  const latestAttempt = run.attempts[run.attempts.length - 1] ?? null;
  const latestProofRun = [...run.proofRuns].sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
  const canRecoverErroredRun = run.status === "error" && run.attempts.length > 0;
  const canCloseMission = controller.reviewSnapshot?.canClose ?? false;
  const canDeleteMission = controller.reviewSnapshot?.canDelete ?? false;
  const deleteBlockersText =
    controller.reviewSnapshot?.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.reason}`).join("; ") ??
    null;
  const canRunProof = run.status === "awaiting-review";

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
              Command flow lives here. Git workflow and launch profiles have their own rooms now; cleaner decks, fewer
              collisions.
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
        {controller.gitError ? <div className={projectStyles.error}>{controller.gitError}</div> : null}
        {controller.proofNotice ? <div className={projectStyles.notice}>{controller.proofNotice}</div> : null}
        {controller.proofError ? <div className={projectStyles.error}>{controller.proofError}</div> : null}

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
                disabled={controller.isCompletingRun || controller.isReviewSnapshotLoading || !canCloseMission}
              >
                {controller.isCompletingRun
                  ? "Closing..."
                  : controller.isReviewSnapshotLoading
                    ? "Checking..."
                    : "Close mission"}
              </button>
            </div>
            {controller.reviewSnapshot !== null && !canCloseMission ? (
              <div className={projectStyles.workHint}>
                Finish the remaining repo and managed submodule review work before closing this mission.
              </div>
            ) : null}
          </div>
        ) : null}

        {run.status === "error" ? (
          canRecoverErroredRun ? (
            <div className={projectStyles.reviewPanel}>
              <div className={projectStyles.workMeta}>
                The last launch failed before the next pass could settle. Add a corrective prompt or retry the pass
                as-is.
              </div>
              <label className={projectStyles.field}>
                <span>Recovery prompt</span>
                <textarea
                  className={`${projectStyles.input} ${projectStyles.textarea}`}
                  value={controller.continueDraft}
                  onChange={(event) => controller.setContinueDraft(event.target.value)}
                  placeholder="Optional: tell Shinra what to correct before retrying the pass."
                />
              </label>
              <div className={projectStyles.inlineActions}>
                <button
                  type="button"
                  className={projectStyles.actionButton}
                  onClick={() => void controller.continueRunWork()}
                  disabled={controller.isContinuingWork}
                >
                  {controller.isContinuingWork ? "Retrying..." : "Retry failed pass"}
                </button>
              </div>
            </div>
          ) : (
            <div className={projectStyles.workActions}>
              <span className={projectStyles.workMeta}>
                This mission failed before a fresh pass could recover itself. Review the worktrees below, then relaunch
                from the ticket lane once the underlying issue is resolved.
              </span>
            </div>
          )
        ) : null}

        <div className={projectStyles.reviewPanel}>
          <div className={projectStyles.sectionHeader}>
            <div>
              <div className={projectStyles.sectionLabel}>Proof of completion</div>
              <div className={projectStyles.sectionCaption}>
                Project-native UI proof runs live here: Playwright, artifacts, and a little evidence instead of wishful
                thinking.
              </div>
            </div>
            <button
              type="button"
              className={projectStyles.secondaryButton}
              onClick={() => void controller.refreshMissionProofs()}
              disabled={controller.isProofLoading}
            >
              {controller.isProofLoading ? "Refreshing..." : "Refresh proofs"}
            </button>
          </div>

          <div className={projectStyles.workHint}>
            Status: <strong>{run.proof.status}</strong>
            {run.proof.lastProofAt ? ` · Last run ${new Date(run.proof.lastProofAt).toLocaleString()}` : ""}
            {run.proof.staleReason ? ` · ${run.proof.staleReason}` : ""}
          </div>
          {run.proof.lastProofSummary ? (
            <div className={projectStyles.workHint}>{run.proof.lastProofSummary}</div>
          ) : null}

          {controller.proofProfiles.length > 0 ? (
            <div className={projectStyles.attemptList}>
              {controller.proofProfiles.map((profile) => {
                const isRunning = controller.runningProofProfileId === profile.profileId;
                return (
                  <div key={profile.profileId} className={projectStyles.attemptCard}>
                    <div className={projectStyles.workHeader}>
                      <strong>{profile.label}</strong>
                      <span className={projectStyles.statusBadge}>{profile.kind}</span>
                    </div>
                    <div className={projectStyles.workHint}>{profile.repoRelativePath}</div>
                    {profile.description ? <div className={projectStyles.workHint}>{profile.description}</div> : null}
                    <div className={projectStyles.inlineActions}>
                      <button
                        type="button"
                        className={projectStyles.actionButton}
                        onClick={() => void controller.runMissionProof(profile.profileId)}
                        disabled={!canRunProof || isRunning || controller.runningProofProfileId !== null}
                      >
                        {isRunning ? "Running proof..." : "Run proof"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={projectStyles.workHint}>
              {controller.isProofLoading
                ? "Discovering proof profiles."
                : "No proof profiles are currently discoverable for this mission."}
            </div>
          )}

          {latestProofRun ? (
            <div className={projectStyles.attemptCard}>
              <div className={projectStyles.workHeader}>
                <strong>Latest proof run</strong>
                <span className={projectStyles.statusBadge}>{latestProofRun.status}</span>
              </div>
              <div className={projectStyles.workHint}>
                {latestProofRun.profileLabel} · Started {new Date(latestProofRun.startedAt).toLocaleString()}
                {latestProofRun.completedAt
                  ? ` · Finished ${new Date(latestProofRun.completedAt).toLocaleString()}`
                  : ""}
              </div>
              {latestProofRun.summary ? <div className={projectStyles.workHint}>{latestProofRun.summary}</div> : null}
              {latestProofRun.artifacts.length > 0 ? (
                <div className={projectStyles.inlineActions}>
                  {latestProofRun.artifacts.map((artifact) => (
                    <button
                      key={artifact.artifactId}
                      type="button"
                      className={projectStyles.secondaryButton}
                      onClick={() => void window.electronAPI.openExternal(artifact.fileUrl)}
                    >
                      Open {artifact.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className={projectStyles.reviewPanel}>
          <div className={projectStyles.sectionLabel}>Local teardown</div>
          <div className={projectStyles.workHint}>
            Delete removes local mission worktrees and unpublished mission branches, then forgets the run entirely.
          </div>
          <div className={projectStyles.inlineActions}>
            <button
              type="button"
              className={projectStyles.secondaryButton}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete mission ${run.ticketId}? This removes local worktrees and unpublished mission branches.`,
                  )
                ) {
                  void controller.deleteRun();
                }
              }}
              disabled={controller.isDeletingRun || controller.isReviewSnapshotLoading || !canDeleteMission}
            >
              {controller.isDeletingRun
                ? "Deleting..."
                : controller.isReviewSnapshotLoading
                  ? "Checking..."
                  : "Delete mission"}
            </button>
          </div>
          {controller.reviewSnapshot === null && !controller.isReviewSnapshotLoading ? (
            <div className={projectStyles.workHint}>Refresh the mission review before deleting.</div>
          ) : controller.reviewSnapshot !== null && !canDeleteMission ? (
            <div className={projectStyles.workHint}>
              Delete is disabled because published branches were found: {deleteBlockersText ?? "state is unresolved"}.
            </div>
          ) : null}
        </div>
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
