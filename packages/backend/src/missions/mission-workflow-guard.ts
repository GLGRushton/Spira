import { getTicketRunMissionWorkflowState, type McpTool, type TicketRunMissionWorkflowState, type TicketRunSummary } from "@spira/shared";

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

export type MissionWorkflowState = TicketRunMissionWorkflowState;

export const getMissionWorkflowState = (run: TicketRunSummary): MissionWorkflowState =>
  getTicketRunMissionWorkflowState(run);

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
      if (state.planSaved && !state.summarySaved) {
        return;
      }
      break;
    case "record-validation":
      if (state.planSaved && !state.summarySaved) {
        return;
      }
      break;
    case "save-proof-strategy":
      if (state.planSaved && state.proofRequired && !state.summarySaved) {
        return;
      }
      break;
    case "record-proof-result":
      if (state.planSaved && state.proofRequired && state.proofStrategySaved && !state.summarySaved) {
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
