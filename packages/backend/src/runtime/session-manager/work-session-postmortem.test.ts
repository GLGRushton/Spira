import type { WorkSessionSnapshot } from "@spira/shared";
import { describe, expect, it } from "vitest";
import {
  buildWorkSessionPostmortemFilename,
  generateWorkSessionPostmortem,
} from "./work-session-postmortem.js";
import type { WorkSessionOutcomeClassification } from "./work-session-outcome.js";

const snapshot = (overrides: Partial<WorkSessionSnapshot> = {}): WorkSessionSnapshot => ({
  sessionId: "ws-postmortem-1",
  stationId: "primary",
  taskText: "Diagnose intermittent CI failure on the renderer build",
  currentPhase: "validate",
  classification: {
    intent: "debug",
    explicitWorkIntent: true,
    requiresRepoContext: true,
    confidence: "heuristic",
  },
  phaseHistory: [
    { phase: "classify", status: "complete", summary: "intent=debug", startedAt: 1_000, updatedAt: 1_000, completedAt: 1_000 },
    { phase: "discover", status: "complete", summary: "found candidates", startedAt: 1_000, updatedAt: 2_000, completedAt: 2_000 },
    { phase: "summarise", status: "complete", summary: "summary", startedAt: 2_000, updatedAt: 2_500, completedAt: 2_500 },
    { phase: "plan", status: "complete", summary: "plan", startedAt: 2_500, updatedAt: 3_000, completedAt: 3_000 },
    { phase: "implement", status: "complete", summary: "patch", startedAt: 3_000, updatedAt: 4_000, completedAt: 4_000 },
    { phase: "validate", status: "complete", summary: "all green", startedAt: 4_000, updatedAt: 5_000, completedAt: 5_000 },
  ],
  searchTerms: [],
  candidateFiles: [],
  selectedFiles: [],
  summary: "summary",
  planSummary: "plan",
  patchAttempts: [],
  changedFiles: ["packages/renderer/src/foo.tsx"],
  validationResults: [
    { toolName: "shell", command: "pnpm test", success: true, summary: "all pass", occurredAt: 4_500 },
  ],
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

const cleanOutcome: WorkSessionOutcomeClassification = {
  kind: "clean-pass",
  rationale: "Closed cleanly on first attempt with all validations passing.",
  reason: null,
};

describe("generateWorkSessionPostmortem (Phase 7.4)", () => {
  it("renders header, task, phase timings, validations, files-changed, and observations", () => {
    const markdown = generateWorkSessionPostmortem(snapshot(), cleanOutcome);
    expect(markdown).toContain("# Spira WorkSession post-mortem — ws-postmortem-1");
    expect(markdown).toContain("Outcome: **clean-pass**");
    expect(markdown).toContain("## Task");
    expect(markdown).toContain("Diagnose intermittent CI failure on the renderer build");
    expect(markdown).toContain("## Phase timings");
    expect(markdown).toMatch(/\| classify \| complete \|/);
    expect(markdown).toMatch(/\| validate \| complete \|/);
    expect(markdown).toContain("## Validation outcomes");
    expect(markdown).toMatch(/`pnpm test`/);
    expect(markdown).toContain("## Files changed");
    expect(markdown).toContain("packages/renderer/src/foo.tsx");
    expect(markdown).toContain("## Open observations");
  });

  it("surfaces a friction note for fail-final outcomes", () => {
    const markdown = generateWorkSessionPostmortem(
      snapshot({ readyForReview: false, completedAt: null, stalledReason: "x" }),
      { kind: "fail-final", rationale: "Closed while stalled: x", reason: "x" },
    );
    expect(markdown).toContain("**Closed with friction.**");
  });

  it("filename is deterministic, date-keyed, and ms-suffixed for same-day reopen safety", () => {
    const closedAt = Date.UTC(2026, 4, 10);
    expect(buildWorkSessionPostmortemFilename(snapshot(), closedAt)).toBe(
      `spira-worksession-2026-05-10-ws-postmortem-1-${closedAt}.md`,
    );
  });
});
