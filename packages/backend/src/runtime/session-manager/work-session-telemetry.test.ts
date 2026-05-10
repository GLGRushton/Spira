import type { WorkSessionSnapshot } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { diffWorkSessionForTelemetry } from "./work-session-telemetry.js";

const baseSnapshot = (overrides: Partial<WorkSessionSnapshot> = {}): WorkSessionSnapshot => ({
  sessionId: "ws-1",
  stationId: "primary",
  taskText: "Investigate the recent test flakes",
  currentPhase: "discover",
  classification: {
    intent: "debug",
    explicitWorkIntent: false,
    requiresRepoContext: true,
    confidence: "heuristic",
  },
  phaseHistory: [
    { phase: "classify", status: "complete", summary: "intent=debug", startedAt: 1_000, updatedAt: 1_000, completedAt: 1_000 },
    { phase: "discover", status: "active", summary: "Discovering repository context.", startedAt: 1_000, updatedAt: 1_000 },
    { phase: "summarise", status: "pending", summary: null, startedAt: 1_000, updatedAt: 1_000 },
    { phase: "plan", status: "pending", summary: null, startedAt: 1_000, updatedAt: 1_000 },
    { phase: "implement", status: "pending", summary: null, startedAt: 1_000, updatedAt: 1_000 },
    { phase: "validate", status: "pending", summary: null, startedAt: 1_000, updatedAt: 1_000 },
  ],
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
  readyForReview: false,
  reviewSummary: null,
  completedAt: null,
  stalledReason: null,
  stalledAt: null,
  createdAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

describe("diffWorkSessionForTelemetry (Phase 7.1)", () => {
  it("emits worksession-started when previous is null", () => {
    const events = diffWorkSessionForTelemetry(null, baseSnapshot());
    expect(events.find((event) => event.eventType === "worksession-started")).toMatchObject({
      eventType: "worksession-started",
      phase: "discover",
      metadata: { intent: "debug" },
    });
  });

  it("emits worksession-phase-completed + entered when phase advances", () => {
    const previous = baseSnapshot();
    const next = baseSnapshot({
      currentPhase: "summarise",
      phaseHistory: previous.phaseHistory.map((entry) => {
        if (entry.phase === "discover") {
          return { ...entry, status: "complete", completedAt: 2_000, updatedAt: 2_000 };
        }
        if (entry.phase === "summarise") {
          return { ...entry, status: "active", startedAt: 2_000, updatedAt: 2_000 };
        }
        return entry;
      }),
      updatedAt: 2_000,
    });
    const events = diffWorkSessionForTelemetry(previous, next);
    expect(events.some((event) => event.eventType === "worksession-phase-completed" && event.phase === "discover")).toBe(true);
    expect(events.some((event) => event.eventType === "worksession-phase-entered" && event.phase === "summarise")).toBe(true);
  });

  it("emits worksession-validation-recorded for each fresh validation result", () => {
    const previous = baseSnapshot({ validationResults: [] });
    const next = baseSnapshot({
      validationResults: [
        { toolName: "shell", command: "pnpm test", success: true, summary: "all pass", occurredAt: 3_000 },
        { toolName: "shell", command: "pnpm lint", success: false, summary: "lint fail", errorMessage: "x", occurredAt: 3_500 },
      ],
    });
    const events = diffWorkSessionForTelemetry(previous, next);
    expect(events.filter((event) => event.eventType === "worksession-validation-recorded")).toHaveLength(2);
  });

  it("emits worksession-stalled when stalledReason is newly set", () => {
    const previous = baseSnapshot();
    const next = baseSnapshot({
      stalledReason: "Validation blocked: a tool permission was denied.",
      stalledAt: 4_000,
    });
    const events = diffWorkSessionForTelemetry(previous, next);
    expect(events.some((event) => event.eventType === "worksession-stalled")).toBe(true);
  });

  it("emits a fresh worksession-stalled when the same reason re-stalls after a clear", () => {
    const reason = "Validation blocked: tool permission denied";
    const stalled = baseSnapshot({ stalledReason: reason, stalledAt: 4_000 });
    const cleared = baseSnapshot({ stalledReason: null, stalledAt: null, updatedAt: 4_500 });
    const reStalled = baseSnapshot({ stalledReason: reason, stalledAt: 5_000, updatedAt: 5_000 });
    expect(diffWorkSessionForTelemetry(stalled, cleared).some((event) => event.eventType === "worksession-stalled")).toBe(false);
    expect(diffWorkSessionForTelemetry(cleared, reStalled).some((event) => event.eventType === "worksession-stalled")).toBe(true);
  });

  it("emits no events when nothing changed", () => {
    const snapshot = baseSnapshot();
    const events = diffWorkSessionForTelemetry(snapshot, snapshot);
    expect(events).toEqual([]);
  });
});
