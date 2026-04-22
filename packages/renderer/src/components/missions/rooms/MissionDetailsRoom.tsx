import {
  TICKET_RUN_MISSION_PHASES,
  type TicketRunMissionPhase,
  type TicketRunProofArtifact,
  type TicketRunSummary,
} from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import { useNavigationStore } from "../../../stores/navigation-store.js";
import projectStyles from "../../projects/ProjectsPanel.module.css";
import shellStyles from "../MissionShell.module.css";
import { describeMissionNextAction, describeRunStatus } from "../mission-display-utils.js";
import type { MissionRunController } from "../useMissionRunController.js";
import styles from "./MissionDetailsRoom.module.css";

interface MissionDetailsRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

type PhaseVisualState = "complete" | "active" | "pending";

const PHASE_DETAILS: Record<TicketRunMissionPhase, { label: string; icon: string; subtitle: string }> = {
  classification: {
    label: "Classify",
    icon: "◎",
    subtitle: "Scope, kind, acceptance criteria, and proof expectations.",
  },
  plan: {
    label: "Plan",
    icon: "≡",
    subtitle: "Execution steps, touched repos, validation, and proof intent.",
  },
  implement: {
    label: "Implement",
    icon: "⚡",
    subtitle: "Live coding pass and mission execution state.",
  },
  validate: {
    label: "Validate",
    icon: "✓",
    subtitle: "Builds, tests, and recorded validation outcomes.",
  },
  proof: {
    label: "Prove",
    icon: "◉",
    subtitle: "Targeted UI proof, screenshots, and evidence artifacts.",
  },
  summarize: {
    label: "Summarize",
    icon: "✦",
    subtitle: "Completed work, repo changes, and follow-up notes.",
  },
};

const formatDateTime = (value: number | null | undefined): string | null =>
  typeof value === "number" ? new Date(value).toLocaleString() : null;

const formatEnumLabel = (value: string): string =>
  value
    .split("-")
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");

const getRunTone = (status: TicketRunSummary["status"]): "ready" | "working" | "blocked" | "error" | "done" => {
  switch (status) {
    case "ready":
      return "ready";
    case "working":
    case "awaiting-review":
      return "working";
    case "blocked":
      return "blocked";
    case "error":
      return "error";
    case "done":
      return "done";
    default:
      return "ready";
  }
};

const getPhaseTimestamp = (
  run: TicketRunSummary,
  phase: TicketRunMissionPhase,
  latestProofRun: TicketRunSummary["proofRuns"][number] | null,
): number | null => {
  switch (phase) {
    case "classification":
      return run.classification?.updatedAt ?? null;
    case "plan":
      return run.plan?.updatedAt ?? null;
    case "implement": {
      const latestAttempt = run.attempts[run.attempts.length - 1] ?? null;
      return latestAttempt?.startedAt ?? null;
    }
    case "validate":
      return [...run.validations].sort((left, right) => right.updatedAt - left.updatedAt)[0]?.updatedAt ?? null;
    case "proof":
      return (
        latestProofRun?.completedAt ??
        latestProofRun?.startedAt ??
        run.proof.lastProofAt ??
        run.proofStrategy?.updatedAt ??
        null
      );
    case "summarize":
      return run.missionSummary?.updatedAt ?? null;
  }
};

const getPhaseVisualState = (
  phase: TicketRunMissionPhase,
  activePhase: TicketRunMissionPhase,
  workflowComplete: boolean,
): PhaseVisualState => {
  const activeIndex = TICKET_RUN_MISSION_PHASES.indexOf(activePhase);
  const phaseIndex = TICKET_RUN_MISSION_PHASES.indexOf(phase);
  if (workflowComplete) {
    return phaseIndex <= activeIndex ? "complete" : "pending";
  }
  if (phaseIndex < activeIndex) {
    return "complete";
  }
  if (phaseIndex === activeIndex) {
    return "active";
  }
  return "pending";
};

const renderArtifacts = (artifacts: readonly TicketRunProofArtifact[]) => {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className={styles.inlineActions}>
      {artifacts.map((artifact) => (
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
  );
};

export function MissionDetailsRoom({ run, controller }: MissionDetailsRoomProps) {
  const setMissionRoom = useNavigationStore((store) => store.setMissionRoom);
  const [expandedCompletedPhases, setExpandedCompletedPhases] = useState<Set<TicketRunMissionPhase>>(() => new Set());
  const [showWorktrees, setShowWorktrees] = useState(false);

  const latestAttempt = run.attempts[run.attempts.length - 1] ?? null;
  const latestProofRun = [...run.proofRuns].sort((left, right) => right.startedAt - left.startedAt)[0] ?? null;
  const missionNextAction = describeMissionNextAction(run);
  const canRecoverErroredRun = run.status === "error" && run.attempts.length > 0;
  const canCloseMission = controller.reviewSnapshot?.canClose ?? false;
  const canDeleteMission = controller.reviewSnapshot?.canDelete ?? false;
  const deleteBlockersText =
    controller.reviewSnapshot?.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.reason}`).join("; ") ??
    null;
  const canRunProof = run.status === "awaiting-review";
  const runTone = getRunTone(run.status);
  const workflowComplete = missionNextAction.complete;

  useEffect(() => {
    setExpandedCompletedPhases(new Set());
  }, [run.runId, run.missionPhase, run.missionPhaseUpdatedAt]);

  const phaseStates = useMemo(
    () =>
      TICKET_RUN_MISSION_PHASES.map((phase) => ({
        phase,
        detail: PHASE_DETAILS[phase],
        visualState: getPhaseVisualState(phase, run.missionPhase, workflowComplete),
        timestamp: getPhaseTimestamp(run, phase, latestProofRun),
      })),
    [latestProofRun, run, workflowComplete],
  );

  const messages = [
    controller.runNotice ? { tone: "notice" as const, text: controller.runNotice } : null,
    controller.runError ? { tone: "error" as const, text: controller.runError } : null,
    controller.gitError ? { tone: "error" as const, text: controller.gitError } : null,
    controller.proofNotice ? { tone: "notice" as const, text: controller.proofNotice } : null,
    controller.proofError ? { tone: "error" as const, text: controller.proofError } : null,
  ].filter((entry): entry is { tone: "notice" | "error"; text: string } => entry !== null);

  const toggleCompletedPhase = (phase: TicketRunMissionPhase) => {
    setExpandedCompletedPhases((current) => {
      const next = new Set(current);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  const renderCommandArea = () => {
    switch (run.status) {
      case "blocked":
        return (
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>YouTrack state sync stalled, but the run can be recovered.</div>
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={projectStyles.actionButton}
                onClick={() => void controller.retryTicketRunSync()}
                disabled={controller.isRetryingSync}
              >
                {controller.isRetryingSync ? "Syncing..." : "Retry state sync"}
              </button>
            </div>
          </div>
        );
      case "ready":
        return (
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>Workspace prepared. Shinra is standing by for the first pass.</div>
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={projectStyles.actionButton}
                onClick={() => void controller.startRunWork()}
                disabled={controller.isStartingWork}
              >
                {controller.isStartingWork ? "Starting work..." : "Start work"}
              </button>
            </div>
          </div>
        );
      case "working":
        return (
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>
              {latestAttempt ? `Pass ${latestAttempt.sequence} is active.` : "Mission pass is active."}
            </div>
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={projectStyles.secondaryButton}
                onClick={() => void controller.cancelRunWork()}
                disabled={controller.isCancellingWork}
              >
                {controller.isCancellingWork ? "Cancelling..." : "Cancel pass"}
              </button>
            </div>
          </div>
        );
      case "awaiting-review":
        return (
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>
              Reviewable state reached. Continue refining or close the mission.
            </div>
            <label className={styles.commandField}>
              <span>Next prompt</span>
              <textarea
                className={`${projectStyles.input} ${projectStyles.textarea}`}
                value={controller.continueDraft}
                onChange={(event) => controller.setContinueDraft(event.target.value)}
                placeholder="Tighten anything you want on the next pass."
              />
            </label>
            <div className={styles.inlineActions}>
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
                disabled={
                  controller.isCompletingRun ||
                  controller.isReviewSnapshotLoading ||
                  !canCloseMission ||
                  !missionNextAction.complete
                }
              >
                {controller.isCompletingRun
                  ? "Closing..."
                  : controller.isReviewSnapshotLoading
                    ? "Checking..."
                    : "Close mission"}
              </button>
            </div>
            {controller.reviewSnapshot !== null && !canCloseMission ? (
              <div className={styles.commandHint}>
                Finish the remaining repo and managed submodule review work before closing the mission.
              </div>
            ) : !missionNextAction.complete ? (
              <div className={styles.commandHint}>
                Complete the lifecycle first: {missionNextAction.label}. {missionNextAction.detail}
              </div>
            ) : null}
          </div>
        );
      case "error":
        return canRecoverErroredRun ? (
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>
              The last pass failed before it could settle. Retry cleanly or add a corrective instruction.
            </div>
            <label className={styles.commandField}>
              <span>Recovery prompt</span>
              <textarea
                className={`${projectStyles.input} ${projectStyles.textarea}`}
                value={controller.continueDraft}
                onChange={(event) => controller.setContinueDraft(event.target.value)}
                placeholder="Optional: tell Shinra what to correct before retrying the pass."
              />
            </label>
            <div className={styles.inlineActions}>
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
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>
              This mission failed before a recoverable pass could be staged. Resolve the underlying issue, then
              relaunch.
            </div>
          </div>
        );
      case "done":
        return (
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>Mission closed. This room is now read-only.</div>
          </div>
        );
      default:
        return (
          <div className={styles.commandFlow}>
            <div className={styles.commandSummary}>Mission workspace is still being prepared.</div>
          </div>
        );
    }
  };

  const renderPhaseBody = (phase: TicketRunMissionPhase) => {
    switch (phase) {
      case "classification":
        return run.classification ? (
          <div className={styles.phaseContent}>
            <div className={styles.metricRow}>
              <span className={styles.metricBadge}>{formatEnumLabel(run.classification.kind)}</span>
              <span className={styles.metricBadgeMuted}>
                Artifact: {formatEnumLabel(run.classification.proofArtifactMode)}
              </span>
            </div>
            <p className={styles.phaseCopy}>{run.classification.scopeSummary}</p>
            <div className={styles.chipRow}>
              <span className={styles.chip}>UI change: {run.classification.uiChange ? "Yes" : "No"}</span>
              <span className={styles.chip}>Proof required: {run.classification.proofRequired ? "Yes" : "No"}</span>
            </div>
            {run.classification.acceptanceCriteria.length > 0 ? (
              <ol className={projectStyles.workList}>
                {run.classification.acceptanceCriteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ol>
            ) : null}
            {run.classification.impactedRepoRelativePaths.length > 0 ? (
              <div className={styles.chipRow}>
                {run.classification.impactedRepoRelativePaths.map((repoPath) => (
                  <span key={repoPath} className={styles.chip}>
                    {repoPath}
                  </span>
                ))}
              </div>
            ) : null}
            {run.classification.risks.length > 0 ? (
              <details className={styles.subsection}>
                <summary className={styles.subsectionSummary}>Risks</summary>
                <ul className={projectStyles.workList}>
                  {run.classification.risks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <div className={styles.placeholder}>No classification has been stored yet.</div>
        );
      case "plan":
        return run.plan ? (
          <div className={styles.phaseContent}>
            {run.plan.steps.length > 0 ? (
              <ol className={projectStyles.workList}>
                {run.plan.steps.map((step, index) => (
                  <li key={`${index + 1}:${step}`}>{step}</li>
                ))}
              </ol>
            ) : (
              <div className={styles.placeholder}>No discrete implementation steps were stored.</div>
            )}
            {run.plan.validationPlan.length > 0 ? (
              <p className={styles.phaseCopy}>Validation plan: {run.plan.validationPlan.join("; ")}</p>
            ) : null}
            {run.plan.proofIntent ? <p className={styles.phaseCopy}>Proof intent: {run.plan.proofIntent}</p> : null}
            {run.plan.touchedRepoRelativePaths.length > 0 ? (
              <div className={styles.chipRow}>
                {run.plan.touchedRepoRelativePaths.map((repoPath) => (
                  <span key={repoPath} className={styles.chip}>
                    {repoPath}
                  </span>
                ))}
              </div>
            ) : null}
            {run.plan.blockers.length > 0 ? (
              <div className={styles.warningPanel}>Blockers: {run.plan.blockers.join("; ")}</div>
            ) : null}
          </div>
        ) : (
          <div className={styles.placeholder}>No mission plan has been stored yet.</div>
        );
      case "implement":
        return (
          <div className={styles.phaseContent}>
            <p className={styles.phaseCopy}>
              {run.missionPhase === "implement"
                ? "Shinra is currently inside the implementation pass."
                : "Implementation has moved on from the active coding pass."}
            </p>
            {latestAttempt?.summary ? <div className={styles.commandHint}>{latestAttempt.summary}</div> : null}
          </div>
        );
      case "validate":
        return run.validations.length > 0 ? (
          <div className={styles.phaseContent}>
            {[...run.validations]
              .sort((left, right) => right.startedAt - left.startedAt)
              .map((validation) => (
                <div key={validation.validationId} className={styles.subCard}>
                  <div className={styles.subCardHeader}>
                    <strong>{formatEnumLabel(validation.kind)}</strong>
                    <span className={styles.metricBadge}>{formatEnumLabel(validation.status)}</span>
                  </div>
                  <div className={styles.subCardMeta}>
                    {validation.command} {validation.cwd ? `· ${validation.cwd}` : ""}
                  </div>
                  {validation.summary ? <div className={styles.phaseCopy}>{validation.summary}</div> : null}
                  {renderArtifacts(validation.artifacts)}
                </div>
              ))}
          </div>
        ) : (
          <div className={styles.placeholder}>No validation records have been stored yet.</div>
        );
      case "proof":
        return (
          <div className={styles.phaseContent}>
            <div className={styles.subCard}>
              <div className={styles.subCardHeader}>
                <strong>Proof state</strong>
                <span className={styles.metricBadge}>{formatEnumLabel(run.proof.status)}</span>
              </div>
              <div className={styles.subCardMeta}>
                {run.proof.lastProofAt
                  ? `Last run ${new Date(run.proof.lastProofAt).toLocaleString()}`
                  : "No proof run yet."}
              </div>
              {run.proof.lastProofSummary ? <div className={styles.phaseCopy}>{run.proof.lastProofSummary}</div> : null}
              {run.proof.staleReason ? <div className={styles.commandHint}>{run.proof.staleReason}</div> : null}
            </div>

            <div className={styles.subCard}>
              <div className={styles.subCardHeader}>
                <strong>Proof strategy</strong>
                <span className={styles.metricBadge}>{run.proofStrategy ? "Stored" : "Pending"}</span>
              </div>
              {run.proofStrategy ? (
                <>
                  <div className={styles.subCardMeta}>
                    {run.proofStrategy.adapterId} · {run.proofStrategy.repoRelativePath}
                  </div>
                  {run.proofStrategy.scenarioName || run.proofStrategy.scenarioPath ? (
                    <div className={styles.phaseCopy}>
                      Scenario: {run.proofStrategy.scenarioName ?? run.proofStrategy.scenarioPath}
                    </div>
                  ) : null}
                  <div className={styles.phaseCopy}>{run.proofStrategy.command}</div>
                  <div className={styles.commandHint}>{run.proofStrategy.rationale}</div>
                </>
              ) : (
                <div className={styles.placeholder}>No targeted proof strategy has been stored yet.</div>
              )}
            </div>

            <div className={styles.subCard}>
              <div className={styles.subCardHeader}>
                <strong>Proof profiles</strong>
                <div className={styles.inlineActions}>
                  <button
                    type="button"
                    className={projectStyles.secondaryButton}
                    onClick={() => void controller.refreshMissionProofs()}
                    disabled={controller.isProofLoading}
                  >
                    {controller.isProofLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>
              {controller.proofProfiles.length > 0 ? (
                <div className={styles.profileList}>
                  {controller.proofProfiles.map((profile) => {
                    const isRunning = controller.runningProofProfileId === profile.profileId;
                    return (
                      <div key={profile.profileId} className={styles.profileRow}>
                        <div className={styles.profileCopy}>
                          <strong>{profile.label}</strong>
                          <span>
                            {profile.repoRelativePath}
                            {profile.description ? ` · ${profile.description}` : ""}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={projectStyles.actionButton}
                          onClick={() => void controller.runMissionProof(profile.profileId)}
                          disabled={!canRunProof || isRunning || controller.runningProofProfileId !== null}
                        >
                          {isRunning ? "Running proof..." : "Run proof"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.placeholder}>
                  {controller.isProofLoading
                    ? "Discovering proof profiles."
                    : "No proof profiles are currently discoverable for this mission."}
                </div>
              )}
            </div>

            {latestProofRun ? (
              <div className={styles.subCard}>
                <div className={styles.subCardHeader}>
                  <strong>Latest proof run</strong>
                  <span className={styles.metricBadge}>{formatEnumLabel(latestProofRun.status)}</span>
                </div>
                <div className={styles.subCardMeta}>
                  {latestProofRun.profileLabel} · Started {new Date(latestProofRun.startedAt).toLocaleString()}
                  {latestProofRun.completedAt
                    ? ` · Finished ${new Date(latestProofRun.completedAt).toLocaleString()}`
                    : ""}
                </div>
                {latestProofRun.summary ? <div className={styles.phaseCopy}>{latestProofRun.summary}</div> : null}
                {renderArtifacts(latestProofRun.artifacts)}
              </div>
            ) : null}
          </div>
        );
      case "summarize":
        return run.missionSummary ? (
          <div className={styles.phaseContent}>
            <p className={styles.phaseCopy}>{run.missionSummary.completedWork}</p>
            {run.missionSummary.changedRepoRelativePaths.length > 0 ? (
              <div className={styles.chipRow}>
                {run.missionSummary.changedRepoRelativePaths.map((repoPath) => (
                  <span key={repoPath} className={styles.chip}>
                    {repoPath}
                  </span>
                ))}
              </div>
            ) : null}
            {run.missionSummary.validationSummary ? (
              <div className={styles.commandHint}>Validation outcome: {run.missionSummary.validationSummary}</div>
            ) : null}
            {run.missionSummary.proofSummary ? (
              <div className={styles.commandHint}>Proof outcome: {run.missionSummary.proofSummary}</div>
            ) : null}
            {run.missionSummary.openQuestions.length > 0 ? (
              <details className={styles.subsection}>
                <summary className={styles.subsectionSummary}>Open questions</summary>
                <ul className={projectStyles.workList}>
                  {run.missionSummary.openQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </details>
            ) : null}
            {run.missionSummary.followUps.length > 0 ? (
              <details className={styles.subsection}>
                <summary className={styles.subsectionSummary}>Follow-ups</summary>
                <ul className={projectStyles.workList}>
                  {run.missionSummary.followUps.map((followUp) => (
                    <li key={followUp}>{followUp}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <div className={styles.placeholder}>No final mission summary has been stored yet.</div>
        );
    }
  };

  return (
    <section className={styles.room}>
      <article className={`${styles.surface} ${styles.commandCard}`}>
        <div className={styles.commandTopline}>
          <div className={styles.commandHeader}>
            <div className={shellStyles.eyebrow}>Mission actions</div>
            <div className={styles.commandTitleRow}>
              <span className={`${styles.commandDot} ${styles[`commandDot${runTone}`]}`} aria-hidden="true" />
              <div className={styles.commandTitleStack}>
                <h3 className={styles.commandTitle}>{describeRunStatus(run)}</h3>
                <p className={styles.commandLead}>
                  {run.ticketId} · {run.ticketSummary}
                </p>
              </div>
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

        {run.statusMessage ? <div className={styles.commandHint}>{run.statusMessage}</div> : null}
        {run.previousPassContext ? (
          <div className={styles.commandHint}>
            Previous completed pass: {run.previousPassContext.sequence}
            {run.previousPassContext.summary ? ` · ${run.previousPassContext.summary}` : ""}
          </div>
        ) : null}

        {messages.length > 0 ? (
          <div className={styles.messageStack}>
            {messages.map((message) => (
              <div
                key={`${message.tone}:${message.text}`}
                className={message.tone === "notice" ? projectStyles.notice : projectStyles.error}
              >
                {message.text}
              </div>
            ))}
          </div>
        ) : null}

        {renderCommandArea()}
      </article>

      <article className={styles.surface}>
        <div className={styles.sectionTopline}>
          <div>
            <div className={shellStyles.eyebrow}>Mission journey</div>
            <h3 className={styles.sectionTitle}>Shinra workflow</h3>
            <p className={styles.sectionLead}>
              Completed phases fold away. The live phase stays open and drives the room.
            </p>
          </div>
        </div>

        <div className={styles.phaseList}>
          {phaseStates.map(({ phase, detail, visualState, timestamp }, index) => {
            const isExpanded =
              visualState === "active" ||
              (workflowComplete && phase === run.missionPhase) ||
              expandedCompletedPhases.has(phase);
            const canToggle = visualState === "complete";
            const timestampLabel = formatDateTime(timestamp);
            return (
              <article
                key={phase}
                className={`${styles.phaseCard} ${styles[`phaseCard${visualState}`]}`}
                data-state={visualState}
              >
                <div className={styles.phaseRail} aria-hidden="true">
                  <span className={`${styles.phaseLine} ${index === 0 ? styles.phaseLineHidden : ""}`} />
                  <span className={`${styles.phaseIcon} ${styles[`phaseIcon${visualState}`]}`}>{detail.icon}</span>
                  <span
                    className={`${styles.phaseLine} ${index === phaseStates.length - 1 ? styles.phaseLineHidden : ""}`}
                  />
                </div>

                <div className={styles.phaseMain}>
                  {canToggle ? (
                    <button
                      type="button"
                      className={styles.phaseHeader}
                      onClick={() => toggleCompletedPhase(phase)}
                      aria-expanded={isExpanded}
                    >
                      <div className={styles.phaseHeaderCopy}>
                        <span className={styles.phaseTitle}>{detail.label}</span>
                        <span className={styles.phaseSubtitle}>{detail.subtitle}</span>
                      </div>
                      <div className={styles.phaseHeaderMeta}>
                        <span className={styles.phaseStateBadge}>Done</span>
                        {timestampLabel ? <span className={styles.phaseTimestamp}>{timestampLabel}</span> : null}
                        <span className={styles.phaseChevron}>{isExpanded ? "-" : "+"}</span>
                      </div>
                    </button>
                  ) : (
                    <div className={styles.phaseHeaderStatic}>
                      <div className={styles.phaseHeaderCopy}>
                        <span className={styles.phaseTitle}>{detail.label}</span>
                        <span className={styles.phaseSubtitle}>{detail.subtitle}</span>
                      </div>
                      <div className={styles.phaseHeaderMeta}>
                        <span className={styles.phaseStateBadge}>
                          {visualState === "active" ? "Active" : "Pending"}
                        </span>
                        {timestampLabel ? <span className={styles.phaseTimestamp}>{timestampLabel}</span> : null}
                      </div>
                    </div>
                  )}

                  {isExpanded ? <div className={styles.phaseBody}>{renderPhaseBody(phase)}</div> : null}
                </div>
              </article>
            );
          })}
        </div>
      </article>

      <div className={styles.nextStepStrip}>
        <strong>{missionNextAction.complete ? "Workflow complete" : `Next step: ${missionNextAction.label}`}</strong>
        <span>{missionNextAction.detail}</span>
      </div>

      <article className={`${styles.surface} ${styles.footerCard}`}>
        <button
          type="button"
          className={styles.worktreeToggle}
          onClick={() => setShowWorktrees((current) => !current)}
          aria-expanded={showWorktrees}
        >
          <span className={styles.worktreeToggleCopy}>
            Worktrees · {run.worktrees.length} repo{run.worktrees.length === 1 ? "" : "s"}
          </span>
          <span className={styles.phaseChevron}>{showWorktrees ? "-" : "+"}</span>
        </button>

        {showWorktrees ? (
          <div className={styles.worktreeList}>
            {run.worktrees.map((worktree) => (
              <div key={worktree.repoRelativePath} className={styles.worktreeRow}>
                <div className={styles.worktreeCopy}>
                  <strong>{worktree.repoRelativePath}</strong>
                  <span>{worktree.branchName}</span>
                </div>
                <div className={styles.worktreeMeta}>
                  <span className={styles.metricBadgeMuted}>{formatEnumLabel(worktree.cleanupState)}</span>
                </div>
              </div>
            ))}
            {run.submodules.length > 0 ? (
              <div className={styles.commandHint}>
                Managed submodule review stays in the Actions room, where it belongs.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className={styles.deleteRow}>
          <button
            type="button"
            className={styles.deleteButton}
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
          {controller.reviewSnapshot === null && !controller.isReviewSnapshotLoading ? (
            <span className={styles.deleteHint}>Refresh the mission review before deleting.</span>
          ) : controller.reviewSnapshot !== null && !canDeleteMission ? (
            <span className={styles.deleteHint}>
              Delete is blocked because published branches were found: {deleteBlockersText ?? "state is unresolved"}.
            </span>
          ) : null}
        </div>
      </article>
    </section>
  );
}
