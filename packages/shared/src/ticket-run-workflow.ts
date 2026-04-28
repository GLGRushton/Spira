import type { TicketRunMissionWorkflowState, TicketRunSummary } from "./ticket-run-types.js";

const getCurrentAttempt = (run: TicketRunSummary) =>
  [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;

const isCurrentAttemptValue = (attemptStartedAt: number | null, updatedAt: number | null | undefined): boolean =>
  attemptStartedAt !== null && typeof updatedAt === "number" && updatedAt >= attemptStartedAt;

const getWaitReason = (
  nextAction: TicketRunMissionWorkflowState["nextAction"],
  state: Omit<TicketRunMissionWorkflowState, "waitReason" | "blockedReason">,
): TicketRunMissionWorkflowState["waitReason"] => {
  switch (nextAction) {
    case "load-context":
      return "context-not-loaded";
    case "save-classification":
      return "classification-missing";
    case "save-plan":
      return "plan-missing";
    case "record-validation":
      if (state.hasPendingValidation) {
        return "validation-pending";
      }
      return state.hasFailingValidation ? "validation-failed" : "validation-missing";
    case "save-proof-strategy":
      return "proof-strategy-missing";
    case "record-proof-result":
      return "proof-missing";
    case "save-summary":
      return "summary-missing";
    case "complete-pass":
      return "complete";
  }
};

const createBlockedReason = (state: TicketRunMissionWorkflowState): string => {
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

export const getTicketRunMissionWorkflowState = (run: TicketRunSummary): TicketRunMissionWorkflowState => {
  const currentAttempt = getCurrentAttempt(run);
  const attemptStartedAt = currentAttempt?.startedAt ?? null;
  const classificationSaved = isCurrentAttemptValue(attemptStartedAt, run.classification?.updatedAt);
  const planSaved = isCurrentAttemptValue(attemptStartedAt, run.plan?.updatedAt);
  const summarySaved =
    run.missionPhase === "summarize" && isCurrentAttemptValue(attemptStartedAt, run.missionSummary?.updatedAt);
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

  let nextAction: TicketRunMissionWorkflowState["nextAction"];
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

  const stateWithoutReason = {
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
  };

  const waitReason = getWaitReason(nextAction, stateWithoutReason);
  const state: TicketRunMissionWorkflowState = {
    ...stateWithoutReason,
    waitReason,
    blockedReason: null,
  };

  return {
    ...state,
    blockedReason: createBlockedReason(state),
  };
};

export const describeTicketRunMissionNextAction = (
  run: TicketRunSummary,
): { label: string; detail: string; complete: boolean } => {
  const state = getTicketRunMissionWorkflowState(run);
  switch (state.waitReason) {
    case "context-not-loaded":
      return {
        label: state.nextActionLabel,
        detail: "Shinra must call get_mission_context before doing real work.",
        complete: false,
      };
    case "classification-missing":
      return {
        label: state.nextActionLabel,
        detail: "Classification should be stored before planning or implementation.",
        complete: false,
      };
    case "plan-missing":
      return {
        label: state.nextActionLabel,
        detail: "The mission plan must be recorded before write-capable actions unlock.",
        complete: false,
      };
    case "validation-pending":
      return {
        label: state.nextActionLabel,
        detail: "A validation is still pending, so the pass cannot finish yet.",
        complete: false,
      };
    case "validation-failed":
      return {
        label: state.nextActionLabel,
        detail: "A failing validation is recorded and must be resolved before the pass can finish.",
        complete: false,
      };
    case "validation-missing":
      return {
        label: state.nextActionLabel,
        detail: "At least one passing validation should be recorded before the pass can finish.",
        complete: false,
      };
    case "proof-strategy-missing":
      return {
        label: state.nextActionLabel,
        detail: "UI work needs a targeted proof strategy before proof can be recorded.",
        complete: false,
      };
    case "proof-missing":
      return {
        label: state.nextActionLabel,
        detail: "This mission still needs a passing proof result.",
        complete: false,
      };
    case "summary-missing":
      return {
        label: state.nextActionLabel,
        detail: "The final mission summary is still missing.",
        complete: false,
      };
    case "complete":
      return {
        label: state.nextActionLabel,
        detail: "Lifecycle requirements are satisfied for this pass.",
        complete: true,
      };
  }
};
