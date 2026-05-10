import type { RepoIntelligenceRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import {
  buildPromotedTags,
  buildRevokedTags,
  DEFAULT_PROMOTION_THRESHOLDS,
  PROMOTION_FORMULA_VERSION,
  scoreLearnedCandidates,
  TAG_PREFIXES,
} from "./learned-candidate-promoter.js";

const cleanRun = (runId: string, classificationKind = "frontend"): TicketRunSummary => ({
  runId,
  stationId: null,
  ticketId: `SPI-${runId}`,
  ticketSummary: "Outcome",
  ticketUrl: `https://example.test/${runId}`,
  projectKey: "SPI",
  status: "done",
  statusMessage: null,
  commitMessageDraft: null,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_000,
  worktrees: [],
  submodules: [],
  attempts: [],
  missionPhase: "summarize",
  missionPhaseUpdatedAt: 1_500,
  classification: {
    kind: classificationKind as "frontend",
    scopeSummary: "x",
    acceptanceCriteria: [],
    impactedRepoRelativePaths: ["web"],
    risks: [],
    uiChange: true,
    proofRequired: false,
    proofArtifactMode: "none",
    rationale: null,
    createdAt: 1_000,
    updatedAt: 1_000,
  },
  plan: {
    steps: ["x"],
    touchedRepoRelativePaths: ["web"],
    validationPlan: ["pnpm test"],
    proofIntent: null,
    blockers: [],
    assumptions: [],
    createdAt: 1_000,
    updatedAt: 1_000,
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
      startedAt: 1_000,
      completedAt: 1_500,
      createdAt: 1_000,
      updatedAt: 1_000,
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
    createdAt: 1_000,
    updatedAt: 1_000,
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

const learnedCandidate = (overrides: Partial<RepoIntelligenceRecord> & { id: string; runId?: string }): RepoIntelligenceRecord => ({
  id: overrides.id,
  projectKey: overrides.projectKey ?? "SPI",
  repoRelativePath: overrides.repoRelativePath ?? "web",
  type: overrides.type ?? "briefing",
  title: overrides.title ?? "Learned",
  content: overrides.content ?? "Some learning",
  tags: overrides.tags ?? [
    "learned",
    `run:${overrides.runId ?? "run-1"}`,
    "outcome:clean-pass",
    "classification:frontend",
  ],
  source: overrides.source ?? "learned",
  approved: overrides.approved ?? false,
  createdAt: overrides.createdAt ?? 1_000,
  updatedAt: overrides.updatedAt ?? 2_000,
});

describe("scoreLearnedCandidates (Phase 5.4)", () => {
  it("promotes a briefing once 3 distinct clean-pass runs corroborate it", () => {
    const candidates = [
      learnedCandidate({ id: "c-1", runId: "run-1" }),
      learnedCandidate({ id: "c-2", runId: "run-2" }),
      learnedCandidate({ id: "c-3", runId: "run-3" }),
    ];
    const runs = [cleanRun("run-1"), cleanRun("run-2"), cleanRun("run-3")];
    const decisions = scoreLearnedCandidates({ candidates, runs, now: 2_000 });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ promote: true, type: "briefing" });
    expect(decisions[0]?.confidence).toBeGreaterThanOrEqual(DEFAULT_PROMOTION_THRESHOLDS.briefing);
    expect(decisions[0]?.contributingRunIds).toEqual(["run-1", "run-2", "run-3"]);
  });

  it("does NOT promote when only 2 corroborating runs exist (below threshold for briefing=3)", () => {
    const candidates = [
      learnedCandidate({ id: "c-1", runId: "run-1" }),
      learnedCandidate({ id: "c-2", runId: "run-2" }),
    ];
    const runs = [cleanRun("run-1"), cleanRun("run-2")];
    const decisions = scoreLearnedCandidates({ candidates, runs, now: 2_000 });
    expect(decisions[0]?.promote).toBe(false);
    expect(decisions[0]?.skipReason).toMatch(/below threshold/);
  });

  it("requires more evidence for higher-blast-radius types (pitfall threshold = 6)", () => {
    const candidates = Array.from({ length: 5 }).map((_, index) =>
      learnedCandidate({ id: `c-${index}`, runId: `run-${index}`, type: "pitfall" }),
    );
    const runs = Array.from({ length: 5 }).map((_, index) => cleanRun(`run-${index}`));
    const decisions = scoreLearnedCandidates({ candidates, runs, now: 2_000 });
    expect(decisions[0]?.promote).toBe(false);
  });

  it("subtracts contradiction weight for fail-final corroborating runs", () => {
    const cleanRuns = [cleanRun("run-1"), cleanRun("run-2"), cleanRun("run-3")];
    const failedRun = {
      ...cleanRun("run-bad"),
      validations: [
        { ...cleanRun("run-bad").validations[0]!, status: "failed" as const },
      ],
    };
    const candidates = [
      learnedCandidate({ id: "c-1", runId: "run-1" }),
      learnedCandidate({ id: "c-2", runId: "run-2" }),
      learnedCandidate({ id: "c-3", runId: "run-3" }),
      learnedCandidate({ id: "c-bad", runId: "run-bad" }),
    ];
    const decisions = scoreLearnedCandidates({
      candidates,
      runs: [...cleanRuns, failedRun],
      now: 2_000,
    });
    expect(decisions[0]?.contradictingRunIds).toContain("run-bad");
    // 3 clean-pass runs (~1.0 each, recency ~1.0) − 2 = ~1; below threshold 3.
    expect(decisions[0]?.promote).toBe(false);
  });

  it("respects per-type threshold overrides", () => {
    const candidates = [
      learnedCandidate({ id: "c-1", runId: "run-1" }),
      learnedCandidate({ id: "c-2", runId: "run-2" }),
    ];
    const runs = [cleanRun("run-1"), cleanRun("run-2")];
    const decisions = scoreLearnedCandidates({
      candidates,
      runs,
      now: 2_000,
      thresholds: { briefing: 1 },
    });
    expect(decisions[0]?.promote).toBe(true);
  });

  it("skips already-approved candidates", () => {
    const candidates = [learnedCandidate({ id: "c-1", runId: "run-1", approved: true })];
    const decisions = scoreLearnedCandidates({ candidates, runs: [cleanRun("run-1")], now: 2_000 });
    expect(decisions[0]?.skipReason).toBe("candidate already approved");
  });

  it("skips revoked candidates whose contributing runs are blocked", () => {
    const candidates = [
      learnedCandidate({
        id: "c-1",
        runId: "run-1",
        tags: ["learned", "run:run-1", "classification:frontend", "revoked", "revoked-run:run-1"],
      }),
    ];
    const decisions = scoreLearnedCandidates({ candidates, runs: [cleanRun("run-1")], now: 2_000 });
    expect(decisions[0]?.skipReason).toBe("candidate previously revoked");
  });
});

describe("buildPromotedTags / buildRevokedTags", () => {
  it("appends contributing-run + formula-version markers on promotion", () => {
    const candidate = learnedCandidate({ id: "c-1", runId: "run-1" });
    const tags = buildPromotedTags(candidate, ["run-1", "run-2"]);
    expect(tags).toContain(`${TAG_PREFIXES.promotedRun}run-1`);
    expect(tags).toContain(`${TAG_PREFIXES.promotedRun}run-2`);
    expect(tags).toContain(`promoted-formula-v${PROMOTION_FORMULA_VERSION}`);
  });

  it("strips prior promoted-run tags and adds blocked-run + revoked markers on revocation", () => {
    const candidate = learnedCandidate({
      id: "c-1",
      runId: "run-1",
      tags: ["learned", "run:run-1", "promoted-run:run-1", "promoted-run:run-2"],
    });
    const tags = buildRevokedTags(candidate, ["run-1", "run-2"]);
    expect(tags.some((tag) => tag.startsWith("promoted-run:"))).toBe(false);
    expect(tags).toContain(`${TAG_PREFIXES.revokedRun}run-1`);
    expect(tags).toContain(`${TAG_PREFIXES.revokedRun}run-2`);
    expect(tags).toContain(TAG_PREFIXES.revoked);
  });
});
