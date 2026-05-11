import type { TicketRunReviewRepoState, TicketRunReviewSubmoduleState } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { deriveWorkflowStage, stageIndex } from "./workflow-stage.js";

const repoState = (overrides: Partial<TicketRunReviewRepoState> = {}): TicketRunReviewRepoState => ({
  runId: "run-1",
  repoRelativePath: "packages/renderer",
  worktreePath: "/tmp/wt",
  branchName: "feature/lh-417",
  upstreamBranch: "origin/feature/lh-417",
  aheadCount: 0,
  behindCount: 0,
  hasDiff: false,
  pushAction: "none",
  commitMessageDraft: null,
  pullRequestUrls: { open: null, draft: null },
  blockedBySubmoduleCanonicalUrls: [],
  ...overrides,
});

const submoduleState = (overrides: Partial<TicketRunReviewSubmoduleState> = {}): TicketRunReviewSubmoduleState => ({
  runId: "run-1",
  canonicalUrl: "https://example.com/spira-mcp-cli.git",
  name: "spira-mcp-cli",
  branchName: "feature/lh-417",
  worktreePath: "/tmp/sm",
  upstreamBranch: "origin/feature/lh-417",
  aheadCount: 0,
  behindCount: 0,
  hasDiff: false,
  pushAction: "none",
  commitMessageDraft: null,
  pullRequestUrls: { open: null, draft: null },
  parents: [],
  primaryParentRepoRelativePath: null,
  committedSha: null,
  reconcileRequired: false,
  reconcileReason: null,
  ...overrides,
});

describe("deriveWorkflowStage (repo)", () => {
  it("returns commit when the repo has an uncommitted diff", () => {
    const result = deriveWorkflowStage({ kind: "repo", gitState: repoState({ hasDiff: true }), blockingSubmoduleNames: [] });
    expect(result).toEqual({ stage: "commit", blocked: false, blockedReason: null });
  });

  it("returns push when commits are ready to publish", () => {
    const result = deriveWorkflowStage({
      kind: "repo",
      gitState: repoState({ pushAction: "publish" }),
      blockingSubmoduleNames: [],
    });
    expect(result.stage).toBe("push");
    expect(result.blocked).toBe(false);
  });

  it("returns push when commits are ahead of remote", () => {
    const result = deriveWorkflowStage({
      kind: "repo",
      gitState: repoState({ pushAction: "push", aheadCount: 1 }),
      blockingSubmoduleNames: [],
    });
    expect(result.stage).toBe("push");
  });

  it("returns pr when the branch is pushed and a PR url is available", () => {
    const result = deriveWorkflowStage({
      kind: "repo",
      gitState: repoState({ pullRequestUrls: { open: "https://gh/x/y/pulls/new", draft: "https://gh/x/y/pulls/new?draft=1" } }),
      blockingSubmoduleNames: [],
    });
    expect(result.stage).toBe("pr");
  });

  it("returns clean when nothing is pending", () => {
    const result = deriveWorkflowStage({ kind: "repo", gitState: repoState(), blockingSubmoduleNames: [] });
    expect(result.stage).toBe("clean");
  });

  it("flags blocked + commit stage when blocking submodules and a local diff coexist", () => {
    const result = deriveWorkflowStage({
      kind: "repo",
      gitState: repoState({ hasDiff: true }),
      blockingSubmoduleNames: ["spira-mcp-cli"],
    });
    expect(result.blocked).toBe(true);
    expect(result.stage).toBe("commit");
    expect(result.blockedReason).toContain("spira-mcp-cli");
  });

  it("flags blocked + push stage when blocking submodules and no local diff", () => {
    const result = deriveWorkflowStage({
      kind: "repo",
      gitState: repoState({ pushAction: "push" }),
      blockingSubmoduleNames: ["spira-mcp-cli"],
    });
    expect(result.blocked).toBe(true);
    expect(result.stage).toBe("push");
  });
});

describe("deriveWorkflowStage (submodule)", () => {
  it("blocks at diff stage when reconciliation is required", () => {
    const result = deriveWorkflowStage({
      kind: "submodule",
      gitState: submoduleState({ reconcileRequired: true, reconcileReason: "Conflicting edits across parents." }),
      needsAlignment: false,
    });
    expect(result).toEqual({ stage: "diff", blocked: true, blockedReason: "Conflicting edits across parents." });
  });

  it("blocks at push stage when parents need alignment and no other action is pending", () => {
    const result = deriveWorkflowStage({
      kind: "submodule",
      gitState: submoduleState(),
      needsAlignment: true,
    });
    expect(result.stage).toBe("push");
    expect(result.blocked).toBe(true);
  });

  it("prefers commit over alignment when the submodule still has a diff", () => {
    const result = deriveWorkflowStage({
      kind: "submodule",
      gitState: submoduleState({ hasDiff: true }),
      needsAlignment: true,
    });
    expect(result.stage).toBe("commit");
    expect(result.blocked).toBe(false);
  });

  it("returns clean when no work is pending and parents are aligned", () => {
    const result = deriveWorkflowStage({
      kind: "submodule",
      gitState: submoduleState(),
      needsAlignment: false,
    });
    expect(result.stage).toBe("clean");
  });
});

describe("stageIndex", () => {
  it("returns 0..3 for the four ordered stages and 4 for clean", () => {
    expect(stageIndex("diff")).toBe(0);
    expect(stageIndex("commit")).toBe(1);
    expect(stageIndex("push")).toBe(2);
    expect(stageIndex("pr")).toBe(3);
    expect(stageIndex("clean")).toBe(4);
  });
});
