import type { TicketRunReviewRepoState, TicketRunReviewSubmoduleState } from "@spira/shared";

export type WorkflowStage = "diff" | "commit" | "push" | "pr" | "clean";

export interface WorkflowStageState {
  stage: WorkflowStage;
  blocked: boolean;
  blockedReason: string | null;
}

interface RepoStageInput {
  kind: "repo";
  gitState: TicketRunReviewRepoState;
  blockingSubmoduleNames: string[];
}

interface SubmoduleStageInput {
  kind: "submodule";
  gitState: TicketRunReviewSubmoduleState;
  needsAlignment: boolean;
}

export type WorkflowStageInput = RepoStageInput | SubmoduleStageInput;

export const WORKFLOW_STAGE_ORDER = ["diff", "commit", "push", "pr"] as const;

export type OrderedWorkflowStage = (typeof WORKFLOW_STAGE_ORDER)[number];

function deriveBaseStage(gitState: { hasDiff: boolean; pushAction: string; pullRequestUrls: { open: string | null } }): WorkflowStage {
  if (gitState.hasDiff) {
    return "commit";
  }
  if (gitState.pushAction !== "none") {
    return "push";
  }
  if (gitState.pullRequestUrls.open !== null) {
    return "pr";
  }
  return "clean";
}

export function deriveWorkflowStage(input: WorkflowStageInput): WorkflowStageState {
  if (input.kind === "submodule") {
    const { gitState } = input;
    if (gitState.reconcileRequired) {
      return {
        stage: "diff",
        blocked: true,
        blockedReason: gitState.reconcileReason ?? "Reconciliation required",
      };
    }
    if (input.needsAlignment && !gitState.hasDiff && gitState.pushAction === "none") {
      return { stage: "push", blocked: true, blockedReason: "Parent repos need alignment" };
    }
    return { stage: deriveBaseStage(gitState), blocked: false, blockedReason: null };
  }

  const { gitState, blockingSubmoduleNames } = input;
  if (blockingSubmoduleNames.length > 0) {
    return {
      stage: gitState.hasDiff ? "commit" : "push",
      blocked: true,
      blockedReason: `Waiting on managed submodule${blockingSubmoduleNames.length === 1 ? "" : "s"}: ${blockingSubmoduleNames.join(", ")}`,
    };
  }
  return { stage: deriveBaseStage(gitState), blocked: false, blockedReason: null };
}

export function stageIndex(stage: WorkflowStage): number {
  if (stage === "clean") {
    return WORKFLOW_STAGE_ORDER.length;
  }
  return WORKFLOW_STAGE_ORDER.indexOf(stage as OrderedWorkflowStage);
}
