import { describe, expect, it } from "vitest";
import { decideWorkSessionMode, deriveWorkSessionClassification } from "./work-session-gate.js";

describe("work-session gate", () => {
  it("defaults ambiguous prompts to conversational mode", () => {
    expect(decideWorkSessionMode({ text: "Can you explain how the bridge UI works?" })).toMatchObject({
      mode: "conversational",
      reason: "Defaulting to conversational mode on ambiguity.",
    });
  });

  it("activates work-session mode for explicit coding tasks", () => {
    expect(decideWorkSessionMode({ text: "Implement the bridge UI status chip for the repo" })).toMatchObject({
      mode: "work-session",
      reason: "Explicit coding work intent detected.",
    });
  });

  it("treats review prompts over repo artifacts as explicit work", () => {
    expect(
      decideWorkSessionMode({
        text: "Review the current Phase 5 changes in packages/backend/src/copilot/session-manager.ts",
      }),
    ).toMatchObject({
      mode: "work-session",
      classification: expect.objectContaining({
        intent: "review",
        explicitWorkIntent: true,
        requiresRepoContext: true,
      }),
    });
  });

  it("keeps mission stations in mission mode", () => {
    expect(decideWorkSessionMode({ text: "Fix the failing proof", missionRunId: "mission-1" })).toMatchObject({
      mode: "mission",
      reason: "Mission context is active.",
      classification: null,
    });
  });

  it("derives a work-oriented classification for explicit repo changes", () => {
    expect(deriveWorkSessionClassification("Plan the next phased slice for the codebase")).toEqual({
      intent: "plan",
      explicitWorkIntent: true,
      requiresRepoContext: true,
      confidence: "heuristic",
    });
  });

  it("falls back to conversational mode for non-work follow-ups after activation", () => {
    expect(
      decideWorkSessionMode({
        text: "Can you explain what changed?",
        hasActiveWorkSession: true,
      }),
    ).toMatchObject({
      mode: "conversational",
      reason: "Falling back to conversational mode for a non-work follow-up.",
      classification: expect.objectContaining({
        explicitWorkIntent: false,
      }),
    });
  });

  it("keeps continuation prompts inside an active work session", () => {
    expect(
      decideWorkSessionMode({
        text: "continue",
        hasActiveWorkSession: true,
      }),
    ).toMatchObject({
      mode: "work-session",
      reason: "Continuing an active WorkSession.",
    });
  });

  it("starts a new work session for a new explicit task while one is already active", () => {
    expect(
      decideWorkSessionMode({
        text: "Review the current diff in packages/backend/src/copilot/station-registry.ts",
        hasActiveWorkSession: true,
      }),
    ).toMatchObject({
      mode: "work-session",
      reason: "Starting a new WorkSession task.",
      startsNewSession: true,
      classification: expect.objectContaining({
        intent: "review",
        explicitWorkIntent: true,
      }),
    });
  });

  it("does not treat weak segue words as mandatory continuation for new tasks", () => {
    expect(
      decideWorkSessionMode({
        text: "Next, review the current diff in packages/backend/src/copilot/station-registry.ts",
        hasActiveWorkSession: true,
      }),
    ).toMatchObject({
      mode: "work-session",
      reason: "Starting a new WorkSession task.",
      startsNewSession: true,
    });
  });
});
