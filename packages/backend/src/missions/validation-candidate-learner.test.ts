import type { MissionEventRecord, ValidationProfileRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VALIDATION_CANDIDATE_THRESHOLD,
  deriveValidationProfileCandidates,
  inferValidationKindFromCommand,
} from "./validation-candidate-learner.js";

const baseRun = (runId: string, overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => ({
  runId,
  stationId: null,
  ticketId: `SPI-${runId}`,
  ticketSummary: "Run me",
  ticketUrl: `https://example.test/${runId}`,
  projectKey: "SPI",
  status: "done",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_000,
  worktrees: [
    {
      repoRelativePath: "ClientApp",
      repoAbsolutePath: "C:\\Repos\\ClientApp",
      worktreePath: "C:\\Repos\\.spira-worktrees\\spi-x\\ClientApp",
      branchName: "feat/spi-x",
      commitMessageDraft: null,
      cleanupState: "retained",
      createdAt: 1_000,
      updatedAt: 1_000,
    },
  ],
  submodules: [],
  attempts: [],
  missionPhase: "summarize",
  missionPhaseUpdatedAt: 1_500,
  classification: null,
  plan: null,
  validations: [],
  proofStrategy: null,
  missionSummary: null,
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
  ...overrides,
});

const event = (
  id: number,
  runId: string,
  command: string,
  cwd: string,
  status: "passed" | "failed",
  durationMs: number,
): MissionEventRecord => ({
  id,
  runId,
  attemptId: null,
  stage: "validate",
  eventType: "attempt-shell-command",
  metadata: { command, cwd, status, durationMs, attemptId: "a-1" },
  occurredAt: 1_000 + id,
});

describe("inferValidationKindFromCommand (Phase 5.2)", () => {
  it("matches the documented kind heuristics", () => {
    expect(inferValidationKindFromCommand("npm ci")).toBe("restore");
    expect(inferValidationKindFromCommand("pnpm install --prefer-offline")).toBe("restore");
    expect(inferValidationKindFromCommand("dotnet restore")).toBe("restore");
    expect(inferValidationKindFromCommand("eslint .")).toBe("lint");
    expect(inferValidationKindFromCommand("tsc --noEmit")).toBe("typecheck");
    expect(inferValidationKindFromCommand("vitest run")).toBe("unit-test");
    expect(inferValidationKindFromCommand("dotnet test")).toBe("unit-test");
    expect(inferValidationKindFromCommand("playwright test")).toBe("e2e-smoke");
    expect(inferValidationKindFromCommand("dotnet format --check")).toBe("format");
  });

  it("returns null for commands that don't match a heuristic", () => {
    expect(inferValidationKindFromCommand("echo hello")).toBeNull();
    expect(inferValidationKindFromCommand("")).toBeNull();
  });
});

describe("deriveValidationProfileCandidates (Phase 5.2)", () => {
  const cwd = "C:\\Repos\\.spira-worktrees\\spi-x\\ClientApp";

  it("requires the success threshold across distinct runs before proposing", () => {
    const runs = [baseRun("run-1"), baseRun("run-2")];
    const events = [
      event(1, "run-1", "npm ci", cwd, "passed", 12_000),
      event(2, "run-2", "npm ci", cwd, "passed", 11_000),
    ];
    expect(
      deriveValidationProfileCandidates({
        events,
        runs,
        existingProfiles: [],
        threshold: DEFAULT_VALIDATION_CANDIDATE_THRESHOLD,
      }),
    ).toEqual([]);
  });

  it("emits a candidate once the threshold is met", () => {
    const runs = [baseRun("run-1"), baseRun("run-2"), baseRun("run-3")];
    const events = [
      event(1, "run-1", "npm ci", cwd, "passed", 12_000),
      event(2, "run-2", "npm ci", cwd, "passed", 14_000),
      event(3, "run-3", "npm ci", cwd, "passed", 13_000),
    ];
    const candidates = deriveValidationProfileCandidates({
      events,
      runs,
      existingProfiles: [],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "restore",
      command: "npm ci",
      successCount: 3,
      observedRuntimeMs: 13_000,
      projectKey: "SPI",
      repoRelativePath: "ClientApp",
    });
  });

  it("ignores failed observations and counts only distinct runs", () => {
    const runs = [baseRun("run-1"), baseRun("run-2")];
    const events = [
      event(1, "run-1", "npm ci", cwd, "passed", 10_000),
      event(2, "run-1", "npm ci", cwd, "passed", 11_000), // duplicate run
      event(3, "run-2", "npm ci", cwd, "failed", 9_000),
    ];
    const candidates = deriveValidationProfileCandidates({ events, runs, existingProfiles: [], threshold: 2 });
    expect(candidates).toEqual([]);
  });

  it("suppresses commands that already have a registered profile", () => {
    const runs = [baseRun("run-1"), baseRun("run-2"), baseRun("run-3")];
    const events = [
      event(1, "run-1", "npm ci", cwd, "passed", 10_000),
      event(2, "run-2", "npm ci", cwd, "passed", 11_000),
      event(3, "run-3", "npm ci", cwd, "passed", 12_000),
    ];
    const existing: ValidationProfileRecord = {
      id: "existing",
      projectKey: "SPI",
      repoRelativePath: "ClientApp",
      scope: "project",
      label: "Existing restore",
      kind: "restore",
      command: "npm ci",
      workingDirectory: cwd,
      notes: null,
      confidence: 0.7,
      expectedRuntimeMs: null,
      lastObservedRuntimeMs: null,
      prerequisites: [],
      source: "user",
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    expect(deriveValidationProfileCandidates({ events, runs, existingProfiles: [existing] })).toEqual([]);
  });

  it("skips commands whose kind cannot be inferred", () => {
    const runs = [baseRun("run-1"), baseRun("run-2"), baseRun("run-3")];
    const events = [
      event(1, "run-1", "echo hi", cwd, "passed", 10),
      event(2, "run-2", "echo hi", cwd, "passed", 12),
      event(3, "run-3", "echo hi", cwd, "passed", 14),
    ];
    expect(deriveValidationProfileCandidates({ events, runs, existingProfiles: [] })).toEqual([]);
  });
});
