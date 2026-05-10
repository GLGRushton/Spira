import type { WorkSessionSnapshot } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { classifyWorkSessionOutcome } from "./work-session-outcome.js";

const baseSnapshot = (overrides: Partial<WorkSessionSnapshot> = {}): WorkSessionSnapshot => ({
  sessionId: "ws-1",
  stationId: "primary",
  taskText: "Outcome",
  currentPhase: "validate",
  classification: {
    intent: "edit",
    explicitWorkIntent: true,
    requiresRepoContext: true,
    confidence: "heuristic",
  },
  phaseHistory: [],
  searchTerms: [],
  candidateFiles: [],
  selectedFiles: [],
  summary: null,
  planSummary: null,
  patchAttempts: [],
  changedFiles: [],
  validationResults: [],
  pendingValidationShellId: null,
  pendingValidationCommand: null,
  fixIterationCount: 0,
  repeatFailureCount: 0,
  lastValidationFingerprint: null,
  readyForReview: true,
  reviewSummary: "ok",
  completedAt: 5_000,
  stalledReason: null,
  stalledAt: null,
  createdAt: 1_000,
  updatedAt: 5_000,
  ...overrides,
});

describe("classifyWorkSessionOutcome (Phase 7.4)", () => {
  it("clean-pass when first-try success with no validation failure", () => {
    const result = classifyWorkSessionOutcome(baseSnapshot());
    expect(result.kind).toBe("clean-pass");
  });

  it("pass-with-friction when fixIterationCount > 0", () => {
    const result = classifyWorkSessionOutcome(baseSnapshot({ fixIterationCount: 2 }));
    expect(result.kind).toBe("pass-with-friction");
  });

  it("pass-with-friction when a validation failed before passing", () => {
    const result = classifyWorkSessionOutcome(
      baseSnapshot({
        validationResults: [
          { toolName: "shell", command: "pnpm test", success: false, summary: "fail", occurredAt: 2_000 },
          { toolName: "shell", command: "pnpm test", success: true, summary: "ok", occurredAt: 3_000 },
        ],
      }),
    );
    expect(result.kind).toBe("pass-with-friction");
  });

  it("fail-with-recovery when caller signals everStalled but session ultimately completed", () => {
    // Note: snapshot's own `stalledAt` is sticky-cleared on validation pass; the close
    // path supplies `everStalled` from the work_session_events table.
    const result = classifyWorkSessionOutcome(baseSnapshot(), { everStalled: true });
    expect(result.kind).toBe("fail-with-recovery");
  });

  it("fail-final when stalled at close time", () => {
    const result = classifyWorkSessionOutcome(
      baseSnapshot({
        stalledReason: "Validation blocked",
        stalledAt: 2_500,
        readyForReview: false,
        completedAt: null,
      }),
    );
    expect(result.kind).toBe("fail-final");
  });

  it("fail-final when never reached ready-for-review", () => {
    const result = classifyWorkSessionOutcome(
      baseSnapshot({ readyForReview: false, completedAt: null }),
    );
    expect(result.kind).toBe("fail-final");
  });
});
