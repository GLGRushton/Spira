import type { MissionEventRecord, RepoIntelligenceRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { buildWeeklyDigestFilename, generateWeeklyDigest } from "./weekly-digest-generator.js";

const closedRun = (runId: string, ticketId: string, updatedAt: number): TicketRunSummary => ({
  runId,
  stationId: null,
  ticketId,
  ticketSummary: "x",
  ticketUrl: `https://example.test/${ticketId}`,
  projectKey: "SPI",
  status: "done",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: updatedAt - 10_000,
  updatedAt,
  startedAt: updatedAt - 10_000,
  worktrees: [],
  submodules: [],
  attempts: [],
  missionPhase: "summarize",
  missionPhaseUpdatedAt: updatedAt - 1_000,
  classification: {
    kind: "frontend",
    scopeSummary: "x",
    acceptanceCriteria: [],
    impactedRepoRelativePaths: ["web"],
    risks: [],
    uiChange: true,
    proofRequired: false,
    proofArtifactMode: "none",
    rationale: null,
    createdAt: updatedAt - 10_000,
    updatedAt: updatedAt - 5_000,
  },
  plan: {
    steps: [],
    touchedRepoRelativePaths: ["web"],
    validationPlan: ["pnpm test"],
    proofIntent: null,
    blockers: [],
    assumptions: [],
    createdAt: updatedAt - 9_000,
    updatedAt: updatedAt - 4_000,
  },
  validations: [
    {
      validationId: "v-1",
      runId,
      kind: "build",
      command: "pnpm test",
      cwd: "C:\\Repos\\web",
      status: "passed",
      summary: null,
      artifacts: [],
      startedAt: updatedAt - 5_000,
      completedAt: updatedAt - 4_000,
      createdAt: updatedAt - 5_000,
      updatedAt: updatedAt - 4_000,
    },
  ],
  proofStrategy: null,
  missionSummary: {
    completedWork: "Did it",
    changedRepoRelativePaths: ["web"],
    validationSummary: "passed",
    proofSummary: null,
    openQuestions: [],
    followUps: [],
    createdAt: updatedAt - 2_000,
    updatedAt,
  },
  previousPassContext: null,
  proof: {
    status: "passed",
    lastProofAt: null,
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofSummary: null,
    staleReason: null,
    manualReviewJustification: null,
    manualReviewAt: null,
  },
  proofRuns: [],
});

const event = (
  id: number,
  runId: string,
  stage: MissionEventRecord["stage"],
  eventType: string,
  occurredAt: number,
  metadata: Record<string, unknown> = {},
): MissionEventRecord => ({
  id,
  runId,
  attemptId: null,
  stage,
  eventType,
  metadata,
  occurredAt,
});

describe("generateWeeklyDigest (Phase 5.3)", () => {
  it("builds a deterministic filename keyed on the window end", () => {
    expect(buildWeeklyDigestFilename(Date.UTC(2026, 4, 9))).toBe("weekly-mission-digest-2026-05-09.md");
  });

  it("renders header, outcome distribution, and 'no data' fallbacks for an empty window", () => {
    const result = generateWeeklyDigest({
      runs: [],
      events: [],
      pendingCandidates: [],
      windowStartMs: Date.UTC(2026, 4, 2),
      windowEndMs: Date.UTC(2026, 4, 9),
    });
    expect(result.markdown).toContain("# Weekly mission digest — 2026-05-09");
    expect(result.markdown).toContain("Closed missions in window: **0**");
    expect(result.markdown).toContain("No closed missions to classify.");
    expect(result.markdown).toContain("No phase timing data available.");
    expect(result.markdown).toContain("No preflight blockers in window.");
    expect(result.markdown).toContain("No failed proof runs in window.");
    expect(result.markdown).toContain("No learned candidates currently pending approval.");
  });

  it("counts outcomes, tabulates longest phases, blockers, failed proofs, and pending candidates", () => {
    const windowEnd = Date.UTC(2026, 4, 9);
    const baseTime = Date.UTC(2026, 4, 5);
    const run = closedRun("run-1", "SPI-1", baseTime);
    const events: MissionEventRecord[] = [
      event(1, "run-1", "implement", "context-loaded", baseTime - 60_000),
      event(2, "run-1", "implement", "plan-saved", baseTime - 30_000),
      event(3, "run-1", "validate", "validation-recorded", baseTime - 10_000),
      event(4, "run-1", "proof", "proof-preflight-finished", baseTime - 5_000, {
        ok: false,
        summary: "dotnet not on PATH",
      }),
      event(5, "run-1", "proof", "proof-preflight-finished", baseTime - 4_000, {
        ok: false,
        summary: "dotnet not on PATH",
      }),
      event(6, "run-1", "proof", "proof-finished", baseTime - 3_000, {
        status: "failed",
        profileId: "builtin:legapp-admin-ui-proof",
      }),
    ];
    const pending: RepoIntelligenceRecord[] = [
      {
        id: "learned-1",
        projectKey: "SPI",
        repoRelativePath: "web",
        type: "briefing",
        title: "Pending briefing",
        content: "Useful note",
        tags: ["learned"],
        source: "learned",
        approved: false,
        createdAt: baseTime - 1_000,
        updatedAt: baseTime,
      },
    ];

    const result = generateWeeklyDigest({
      runs: [run],
      events,
      pendingCandidates: pending,
      windowStartMs: Date.UTC(2026, 4, 2),
      windowEndMs: windowEnd,
    });

    expect(result.markdown).toContain("Closed missions in window: **1**");
    expect(result.markdown).toMatch(/\*\*clean-pass\*\* — 1/);
    expect(result.markdown).toContain("| SPI-1 |"); // longest-phases table
    expect(result.markdown).toContain("**2×** dotnet not on PATH");
    expect(result.markdown).toContain("**1×** builtin:legapp-admin-ui-proof");
    expect(result.markdown).toContain("Pending briefing");
  });
});
