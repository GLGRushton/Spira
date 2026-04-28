import { describe, expect, it } from "vitest";
import { assertMissionWorkflowStateActionAllowed, type MissionWorkflowState } from "./mission-workflow-guard.js";

const createState = (): MissionWorkflowState => ({
  kickoffComplete: true,
  classificationSaved: true,
  planSaved: true,
  hasPassingValidation: true,
  hasFailingValidation: false,
  hasPendingValidation: false,
  proofRequired: true,
  proofStrategySaved: true,
  proofPassed: true,
  summarySaved: true,
  nextAction: "complete-pass",
  nextActionLabel: "Complete mission",
  waitReason: "complete",
  blockedReason: "Mission workflow is complete.",
});

describe("assertMissionWorkflowStateActionAllowed", () => {
  it("blocks proof mutations after summary has been saved", () => {
    const state = createState();

    expect(() => assertMissionWorkflowStateActionAllowed(state, "save-proof-strategy")).toThrow(
      "Mission workflow is complete.",
    );
    expect(() => assertMissionWorkflowStateActionAllowed(state, "record-proof-result")).toThrow(
      "Mission workflow is complete.",
    );
  });
});
