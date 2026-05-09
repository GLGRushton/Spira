import type { TicketRunMissionEventSummary, TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { buildPostmortemFilename, generateMissionPostmortem } from "./post-mortem-generator.js";

const baseRun = (overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => ({
  runId: overrides.runId ?? "run-postmortem-1",
  stationId: null,
  ticketId: overrides.ticketId ?? "SPI-201",
  ticketSummary: overrides.ticketSummary ?? "Stop the bleeding",
  ticketUrl: overrides.ticketUrl ?? "https://example.test/issue/SPI-201",
  projectKey: "SPI",
  status: "done",
  statusMessage: null,
  commitMessageDraft: overrides.commitMessageDraft ?? null,
  createdAt: 1_000,
  updatedAt: overrides.updatedAt ?? 4_900_000,
  startedAt: overrides.startedAt ?? 1_000,
  worktrees: [],
  submodules: [],
  attempts: [],
  missionPhase: overrides.missionPhase ?? "summarize",
  missionPhaseUpdatedAt: 4_800_000,
  classification: overrides.classification ?? null,
  plan: overrides.plan ?? null,
  validations: overrides.validations ?? [],
  proofStrategy: null,
  missionSummary: overrides.missionSummary ?? null,
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
  proofRuns: overrides.proofRuns ?? [],
});

const evt = (
  id: number,
  stage: TicketRunMissionEventSummary["stage"],
  eventType: string,
  occurredAt: number,
): TicketRunMissionEventSummary => ({
  id,
  runId: "run-postmortem-1",
  attemptId: null,
  stage,
  eventType,
  metadata: null,
  occurredAt,
});

describe("generateMissionPostmortem", () => {
  it("renders header, stage timings, validations, proof runs, files-changed, and observation sections", () => {
    const run = baseRun({
      validations: [
        {
          validationId: "v-1",
          runId: "run-postmortem-1",
          kind: "build",
          command: "pnpm build",
          cwd: ".",
          status: "passed",
          summary: "Build OK",
          artifacts: [],
          startedAt: 2_000_000,
          completedAt: 2_120_000,
          createdAt: 2_000_000,
          updatedAt: 2_120_000,
          supersedesValidationIds: [],
        },
      ],
      proofRuns: [
        {
          proofRunId: "pr-1",
          runId: "run-postmortem-1",
          profileId: "builtin:demo",
          profileLabel: "Demo proof",
          startedAt: 3_000_000,
          completedAt: 3_180_000,
          status: "passed",
          summary: "Proof OK",
          exitCode: 0,
          command: "dotnet test ./Demo.csproj",
          artifacts: [],
        },
      ],
      missionSummary: {
        completedWork: "Done",
        changedRepoRelativePaths: ["repo-a"],
        validationSummary: null,
        proofSummary: null,
        openQuestions: [],
        followUps: [],
        createdAt: 4_000_000,
        updatedAt: 4_000_000,
      },
    });
    const events: TicketRunMissionEventSummary[] = [
      evt(1, "system", "workspace-prepared", 1_000),
      evt(2, "classification", "context-loaded", 100_000),
      evt(3, "plan", "plan-saved", 200_000),
      evt(4, "implement", "attempt-started", 300_000),
      evt(5, "validate", "validation-recorded", 2_120_000),
      evt(6, "proof", "proof-finished", 3_180_000),
      evt(7, "summarize", "summary-saved", 4_000_000),
    ];

    const markdown = generateMissionPostmortem(run, events);

    expect(markdown).toContain("# SPI-201 Mission Postmortem");
    expect(markdown).toContain("**Total elapsed time:**");
    expect(markdown).toContain("## Stage timings");
    expect(markdown).toContain("Classify");
    expect(markdown).toContain("Implement");
    expect(markdown).toContain("## Validations");
    expect(markdown).toContain("`pnpm build`");
    expect(markdown).toContain("## Proof runs");
    expect(markdown).toContain("Demo proof");
    expect(markdown).toContain("## Files changed");
    expect(markdown).toContain("- repo-a");
    expect(markdown).toContain("## Open observations");
  });

  it("computes per-phase durations from event entry timestamps", () => {
    const run = baseRun({ updatedAt: 5_000_000 });
    const events: TicketRunMissionEventSummary[] = [
      // 1m mark, 2m mark, 4m mark — phases entered at 60s / 120s / 240s.
      evt(1, "classification", "context-loaded", 60_000),
      evt(2, "implement", "attempt-started", 120_000),
      evt(3, "validate", "validation-recorded", 240_000),
    ];
    const markdown = generateMissionPostmortem(run, events);
    // Classification entered at 1m, implement entered at 2m → classification duration 1m.
    // Implement entered at 2m, validate entered at 4m → implement duration 2m.
    // Validate entered at 4m, run closed at 5_000_000 → validate duration covers the rest.
    expect(markdown).toMatch(/\bClassify\b[^\n]*\b1 min\b/);
    expect(markdown).toMatch(/\bImplement\b[^\n]*\b2 min\b/);
  });

  it("renders an empty section instead of throwing when validations / proof runs are absent", () => {
    const run = baseRun();
    const markdown = generateMissionPostmortem(run, []);
    expect(markdown).toContain("No validations were recorded.");
    expect(markdown).toContain("No proof runs were attempted.");
    expect(markdown).toContain("No changed-repo summary was captured.");
  });
});

describe("buildPostmortemFilename", () => {
  it("normalises the ticket id and includes the close date", () => {
    const filename = buildPostmortemFilename(
      baseRun({ ticketId: "LH-402" }),
      Date.UTC(2026, 4, 9, 12, 0, 0),
    );
    expect(filename).toBe("lh-402-mission-postmortem-2026-05-09.md");
  });

  it("strips path separators from the ticket id", () => {
    const filename = buildPostmortemFilename(
      baseRun({ ticketId: "weird/../id" }),
      Date.UTC(2026, 0, 1),
    );
    // No path traversal characters anywhere in the produced filename, but `.md` extension is allowed.
    expect(filename).not.toMatch(/[/\\]/);
    expect(filename).toMatch(/^weird-id-mission-postmortem-2026-01-01\.md$/);
  });
});
