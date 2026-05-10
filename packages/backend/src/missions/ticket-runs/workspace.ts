import path from "node:path";
import type { TicketRunPreviousPassContext, TicketRunSummary } from "@spira/shared";
import { MAX_BRANCH_NAME_LENGTH, MAX_SLUG_LENGTH, WORKTREE_DIRECTORY_NAME } from "./constants.js";

const slugify = (value: string, maxLength: number): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug.slice(0, maxLength).replace(/-+$/g, "");
};

export const buildTicketRunBranchName = (ticketId: string, summary: string): string => {
  const normalizedTicketId = slugify(ticketId, MAX_BRANCH_NAME_LENGTH).replace(/^-+|-+$/g, "") || "ticket";
  const prefix = `feat/${normalizedTicketId}`;
  const fallbackSlug = "work";
  const availableSlugLength = Math.max(0, Math.min(MAX_SLUG_LENGTH, MAX_BRANCH_NAME_LENGTH - prefix.length - 1));
  const summarySlug = slugify(summary, availableSlugLength) || fallbackSlug;
  const branchName = `${prefix}-${summarySlug}`;
  return branchName.slice(0, MAX_BRANCH_NAME_LENGTH).replace(/-+$/g, "");
};

const buildTicketRunMissionDirectory = (workspaceRoot: string, ticketId: string): string => {
  const ticketSlug = slugify(ticketId, 24) || "ticket";
  return path.join(workspaceRoot, WORKTREE_DIRECTORY_NAME, ticketSlug);
};

export const buildTicketRunWorktreePath = (workspaceRoot: string, ticketId: string, repoName: string): string => {
  const repoSlug = slugify(repoName, 20) || "repo";
  return path.join(buildTicketRunMissionDirectory(workspaceRoot, ticketId), repoSlug);
};

const resolveTicketRunWorkspacePath = (
  worktrees: ReadonlyArray<Pick<TicketRunSummary["worktrees"][number], "worktreePath">>,
): string => {
  const firstWorktree = worktrees[0];
  if (!firstWorktree) {
    return "the managed worktree";
  }

  const parents = [...new Set(worktrees.map((worktree) => path.dirname(worktree.worktreePath)))];
  if (parents.length === 1 && path.basename(parents[0] ?? "") !== WORKTREE_DIRECTORY_NAME) {
    return parents[0] ?? firstWorktree.worktreePath;
  }

  return firstWorktree.worktreePath;
};

export const resolveTicketRunMissionDirectory = (
  worktrees: ReadonlyArray<Pick<TicketRunSummary["worktrees"][number], "worktreePath">>,
): string | null => {
  if (worktrees.length === 0) {
    return null;
  }

  const parents = [...new Set(worktrees.map((worktree) => path.dirname(worktree.worktreePath)))];
  return parents.length === 1 ? (parents[0] ?? null) : null;
};

export const describeTicketRunWorkspace = (worktrees: ReadonlyArray<TicketRunSummary["worktrees"][number]>) => {
  const workspacePath = resolveTicketRunWorkspacePath(worktrees);
  if (workspacePath === worktrees[0]?.worktreePath) {
    return {
      path: workspacePath,
      noun: "worktree",
      phrase: `managed worktree at ${workspacePath}`,
    };
  }

  const repoCount = worktrees.length;
  return {
    path: workspacePath,
    noun: "mission directory",
    phrase: `mission directory at ${workspacePath} for ${repoCount} repo${repoCount === 1 ? "" : "s"}`,
  };
};

export const formatTicketRunWorktreeList = (worktrees: ReadonlyArray<TicketRunSummary["worktrees"][number]>): string =>
  worktrees.map((worktree) => `- ${worktree.repoRelativePath}: ${worktree.worktreePath}`).join("\n");

/**
 * Compact, prompt-friendly snapshot of the last completed pass. Surfaces the artifact paths,
 * touched files, validation/proof commands, and proof artifact paths that the next pass
 * would otherwise have to re-discover via grep/glob — eliminating the most common cause of
 * runaway implement-phase exploration on follow-up passes.
 *
 * Returns null when no prior pass context is available.
 */
export const formatPreviousPassContextSection = (
  context: TicketRunPreviousPassContext | null,
): string | null => {
  if (!context) {
    return null;
  }

  const lines: string[] = [`Prior pass #${context.sequence} context (do not re-discover this — use it):`];

  const summary = context.missionSummary;
  if (summary) {
    if (summary.completedWork) {
      lines.push(`- Completed work: ${summary.completedWork}`);
    }
    if (summary.changedRepoRelativePaths.length > 0) {
      lines.push(`- Files changed: ${summary.changedRepoRelativePaths.join(", ")}`);
    }
    if (summary.validationSummary) {
      lines.push(`- Validation summary: ${summary.validationSummary}`);
    }
    if (summary.proofSummary) {
      lines.push(`- Proof summary: ${summary.proofSummary}`);
    }
    if (summary.followUps.length > 0) {
      lines.push(`- Follow-ups noted: ${summary.followUps.join("; ")}`);
    }
    if (summary.openQuestions.length > 0) {
      lines.push(`- Open questions: ${summary.openQuestions.join("; ")}`);
    }
  }

  if (context.proofStrategy) {
    lines.push(`- Proof command: ${context.proofStrategy.command}`);
  }

  const artifactPaths = new Set<string>();
  for (const validation of context.validations) {
    for (const artifact of validation.artifacts) {
      artifactPaths.add(artifact.path);
    }
  }
  if (artifactPaths.size > 0) {
    lines.push(`- Prior artifact paths: ${[...artifactPaths].join(", ")}`);
  }

  return lines.length > 1 ? lines.join("\n") : null;
};
