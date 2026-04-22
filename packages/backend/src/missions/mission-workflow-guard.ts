import type { McpTool, TicketRunSummary } from "@spira/shared";

export type MissionWorkflowAction =
  | "load-context"
  | "save-classification"
  | "save-plan"
  | "save-proof-strategy"
  | "record-proof-result"
  | "repo-read"
  | "repo-write"
  | "delegate"
  | "service-read"
  | "service-write"
  | "proof-read"
  | "record-validation"
  | "save-summary"
  | "complete-pass";

export interface MissionWorkflowState {
  kickoffComplete: boolean;
  classificationSaved: boolean;
  planSaved: boolean;
  hasPassingValidation: boolean;
  hasFailingValidation: boolean;
  hasPendingValidation: boolean;
  proofRequired: boolean;
  proofStrategySaved: boolean;
  proofPassed: boolean;
  summarySaved: boolean;
  nextAction:
    | "load-context"
    | "save-classification"
    | "save-plan"
    | "record-validation"
    | "save-proof-strategy"
    | "record-proof-result"
    | "save-summary"
    | "complete-pass";
  nextActionLabel: string;
  blockedReason: string | null;
}

const getCurrentAttempt = (run: TicketRunSummary) =>
  [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;

const isCurrentAttemptValue = (attemptStartedAt: number | null, updatedAt: number | null | undefined): boolean =>
  attemptStartedAt !== null && typeof updatedAt === "number" && updatedAt >= attemptStartedAt;

const createBlockedReason = (state: MissionWorkflowState): string => {
  switch (state.nextAction) {
    case "load-context":
      return "Call get_mission_context before taking mission actions.";
    case "save-classification":
      return "Save mission classification before planning or implementing.";
    case "save-plan":
      return "Save the mission plan before mutating code, delegating, or starting services.";
    case "record-validation":
      if (state.hasPendingValidation) {
        return "Wait for pending validation work to finish before finishing the pass.";
      }
      return state.hasFailingValidation
        ? "Resolve or replace failing validation results before finishing the pass."
        : "Record at least one passing validation result before finishing the pass.";
    case "save-proof-strategy":
      return "Save a proof strategy before running or recording UI proof.";
    case "record-proof-result":
      return "Record a passing proof result before finishing this UI mission.";
    case "save-summary":
      return "Save the final mission summary before finishing the pass.";
    case "complete-pass":
      return "Mission workflow is complete.";
  }
};

export const getMissionWorkflowState = (run: TicketRunSummary): MissionWorkflowState => {
  const currentAttempt = getCurrentAttempt(run);
  const attemptStartedAt = currentAttempt?.startedAt ?? null;
  const classificationSaved = isCurrentAttemptValue(attemptStartedAt, run.classification?.updatedAt);
  const planSaved = isCurrentAttemptValue(attemptStartedAt, run.plan?.updatedAt);
  const summarySaved = isCurrentAttemptValue(attemptStartedAt, run.missionSummary?.updatedAt);
  const kickoffComplete =
    classificationSaved ||
    planSaved ||
    summarySaved ||
    run.validations.length > 0 ||
    run.proofStrategy !== null ||
    (attemptStartedAt !== null &&
      run.missionPhase === "classification" &&
      run.missionPhaseUpdatedAt > attemptStartedAt);
  const hasPassingValidation = run.validations.some((validation) => validation.status === "passed");
  const hasFailingValidation = run.validations.some((validation) => validation.status === "failed");
  const hasPendingValidation = run.validations.some((validation) => validation.status === "pending");
  const proofRequired = run.classification?.proofRequired === true;
  const proofStrategySaved = !proofRequired || isCurrentAttemptValue(attemptStartedAt, run.proofStrategy?.updatedAt);
  const proofPassed = !proofRequired || run.proof.status === "passed";

  let nextAction: MissionWorkflowState["nextAction"];
  if (!kickoffComplete) {
    nextAction = "load-context";
  } else if (!classificationSaved) {
    nextAction = "save-classification";
  } else if (!planSaved) {
    nextAction = "save-plan";
  } else if (!hasPassingValidation || hasFailingValidation || hasPendingValidation) {
    nextAction = "record-validation";
  } else if (proofRequired && !proofStrategySaved) {
    nextAction = "save-proof-strategy";
  } else if (proofRequired && !proofPassed) {
    nextAction = "record-proof-result";
  } else if (!summarySaved) {
    nextAction = "save-summary";
  } else {
    nextAction = "complete-pass";
  }

  const nextActionLabel =
    nextAction === "load-context"
      ? "Load mission context"
      : nextAction === "save-classification"
        ? "Save classification"
        : nextAction === "save-plan"
          ? "Save plan"
          : nextAction === "record-validation"
            ? "Record validation"
            : nextAction === "save-proof-strategy"
              ? "Save proof strategy"
              : nextAction === "record-proof-result"
                ? "Record proof result"
                : nextAction === "save-summary"
                  ? "Save summary"
                  : "Mission workflow complete";

  const state: MissionWorkflowState = {
    kickoffComplete,
    classificationSaved,
    planSaved,
    hasPassingValidation,
    hasFailingValidation,
    hasPendingValidation,
    proofRequired,
    proofStrategySaved,
    proofPassed,
    summarySaved,
    nextAction,
    nextActionLabel,
    blockedReason: null,
  };

  return {
    ...state,
    blockedReason: createBlockedReason(state),
  };
};

export const assertMissionWorkflowActionAllowed = (run: TicketRunSummary, action: MissionWorkflowAction): void => {
  assertMissionWorkflowStateActionAllowed(getMissionWorkflowState(run), action);
};

export const assertMissionWorkflowStateActionAllowed = (
  state: MissionWorkflowState,
  action: MissionWorkflowAction,
): void => {
  switch (action) {
    case "load-context":
      return;
    case "repo-read":
      if (state.kickoffComplete) {
        return;
      }
      break;
    case "save-classification":
      if (state.kickoffComplete) {
        return;
      }
      break;
    case "save-plan":
    case "service-read":
    case "proof-read":
      if (state.classificationSaved) {
        return;
      }
      break;
    case "repo-write":
    case "delegate":
    case "service-write":
    case "record-validation":
      if (state.planSaved) {
        return;
      }
      break;
    case "save-proof-strategy":
      if (state.planSaved && state.proofRequired) {
        return;
      }
      break;
    case "record-proof-result":
      if (state.planSaved && state.proofRequired && state.proofStrategySaved) {
        return;
      }
      break;
    case "save-summary":
      if (
        state.planSaved &&
        state.hasPassingValidation &&
        !state.hasFailingValidation &&
        !state.hasPendingValidation &&
        state.proofStrategySaved &&
        state.proofPassed
      ) {
        return;
      }
      break;
    case "complete-pass":
      if (state.nextAction === "complete-pass") {
        return;
      }
      break;
  }

  throw new Error(state.blockedReason ?? "Mission workflow is not ready for that action.");
};

export const assertMissionMcpToolAllowed = (run: TicketRunSummary, tool: McpTool): void => {
  assertMissionMcpToolAllowedForState(getMissionWorkflowState(run), tool);
};

export const assertMissionMcpToolAllowedForState = (state: MissionWorkflowState, tool: McpTool): void => {
  if (tool.access?.mode === "write") {
    assertMissionWorkflowStateActionAllowed(state, "repo-write");
    return;
  }
  assertMissionWorkflowStateActionAllowed(state, "repo-read");
};

export const buildMissionWorkflowRepairPrompt = (run: TicketRunSummary): string => {
  const state = getMissionWorkflowState(run);
  return [
    `Your previous mission reply for ${run.ticketId} ended before the required lifecycle state was recorded.`,
    `Required next step: ${state.nextActionLabel}.`,
    state.blockedReason ?? "Finish the missing lifecycle work before replying.",
    "Use the mission lifecycle tools now. Do not explain the omission first.",
    "If implementation is already complete, record the missing lifecycle data, validation, proof (when required), and summary, then reply with a concise completion handoff.",
  ].join("\n");
};
