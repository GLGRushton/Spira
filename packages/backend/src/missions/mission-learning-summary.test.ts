import type { MissionEventRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { assembleMissionLearningSummary } from "./mission-learning-summary.js";

const baseRun = (overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => ({
  runId: "run-1",
  stationId: "primary",
  ticketId: "LA-2692",
  ticketSummary: "Demo",
  ticketUrl: "https://example.test/LA-2692",
  projectKey: "LA",
  status: "awaiting-review",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: 1,
  updatedAt: 5_000,
  startedAt: 1,
  worktrees: [
    {
      repoRelativePath: "legapp_legapp-admin",
      repoAbsolutePath: "C:/repos/legapp-admin",
      worktreePath: "C:/repos/.spira/run-1/legapp-admin",
      branchName: "feat/la-2692",
      cleanupState: "retained",
      createdAt: 1,
      updatedAt: 1,
    },
  ],
  submodules: [],
  attempts: [],
  missionPhase: "summarize",
  missionPhaseUpdatedAt: 1,
  classification: null,
  plan: null,
  validations: [],
  proofStrategy: null,
  missionSummary: null,
  previousPassContext: null,
  proof: {
    status: "passed",
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofAt: null,
    lastProofSummary: null,
    staleReason: null,
    manualReviewJustification: null,
    manualReviewAt: null,
  },
  proofRuns: [],
  ...overrides,
});

const event = (
  id: number,
  eventType: string,
  metadata: Record<string, unknown>,
  occurredAt = id * 1_000,
): MissionEventRecord => ({
  id,
  runId: "run-1",
  attemptId: null,
  stage: "system",
  eventType,
  metadata,
  occurredAt,
});

describe("assembleMissionLearningSummary", () => {
  it("returns the empty case when no learning events fired and the project already has profiles", () => {
    const summary = assembleMissionLearningSummary({
      run: baseRun(),
      events: [],
      projectHasRepoProfile: true,
      projectHasValidationProfiles: true,
    });
    expect(summary.runId).toBe("run-1");
    expect(summary.autoPromoted).toEqual([]);
    expect(summary.proposed).toEqual([]);
    expect(summary.bootstrapProfile).toBeNull();
    expect(summary.bootstrapValidationProfiles).toEqual([]);
  });

  it("projects validation-profile-auto-promoted into autoPromoted", () => {
    const summary = assembleMissionLearningSummary({
      run: baseRun(),
      events: [
        event(1, "validation-profile-auto-promoted", {
          candidateId: "vp-1",
          kind: "build",
          command: "dotnet build",
          successCount: 5,
          threshold: 5,
        }),
      ],
      projectHasRepoProfile: true,
      projectHasValidationProfiles: true,
    });
    expect(summary.autoPromoted).toHaveLength(1);
    expect(summary.autoPromoted[0]?.candidateId).toBe("vp-1");
    expect(summary.autoPromoted[0]?.acceptanceMode).toBe("automatic");
    expect(summary.autoPromoted[0]?.rationale).toBe("5/5 confirming missions");
  });

  it("surfaces sub-threshold validation candidates as proposals", () => {
    const summary = assembleMissionLearningSummary({
      run: baseRun(),
      events: [
        event(2, "validation-profile-candidate-observed", {
          candidateId: "vp-pending",
          kind: "unit-test",
          command: "dotnet test",
          successCount: 1,
        }),
      ],
      projectHasRepoProfile: true,
      projectHasValidationProfiles: true,
    });
    expect(summary.proposed).toHaveLength(1);
    expect(summary.proposed[0]?.candidateId).toBe("vp-pending");
    expect(summary.proposed[0]?.currentScore).toBe(1);
    expect(summary.proposed[0]?.threshold).toBe(5);
  });

  it("emits a bootstrap profile draft when the project has no repo_profiles row", () => {
    const summary = assembleMissionLearningSummary({
      run: baseRun(),
      events: [
        event(1, "attempt-shell-command", {
          command: "dotnet build LegApp.Admin.sln",
          cwd: "C:/repos/.spira/run-1/legapp-admin",
          status: "passed",
        }),
      ],
      projectHasRepoProfile: false,
      projectHasValidationProfiles: false,
    });
    expect(summary.bootstrapProfile).not.toBeNull();
    expect(summary.bootstrapProfile?.projectKey).toBe("LA");
    expect(summary.bootstrapProfile?.requiredSdks).toContain(".NET 8+");
    expect(summary.bootstrapValidationProfiles.length).toBeGreaterThan(0);
  });

  it("does not double-count when a validation candidate was both observed and auto-promoted", () => {
    const summary = assembleMissionLearningSummary({
      run: baseRun(),
      events: [
        event(1, "validation-profile-candidate-observed", {
          candidateId: "vp-x",
          kind: "build",
          command: "ng build",
          successCount: 5,
        }),
        event(2, "validation-profile-auto-promoted", {
          candidateId: "vp-x",
          kind: "build",
          command: "ng build",
          successCount: 5,
          threshold: 5,
        }),
      ],
      projectHasRepoProfile: true,
      projectHasValidationProfiles: true,
    });
    expect(summary.autoPromoted).toHaveLength(1);
    expect(summary.proposed).toHaveLength(0);
  });
});
