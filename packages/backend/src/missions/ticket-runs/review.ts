import type {
  TicketRunDeleteBlocker,
  TicketRunDiffFileSummary,
  TicketRunGitState,
  TicketRunProofSummary,
  TicketRunReviewRepoState,
  TicketRunReviewSubmoduleState,
  TicketRunSubmoduleGitState,
  TicketRunSummary,
} from "@spira/shared";

export const normalizeMissionPrompt = (value: string | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeCommitDraft = (ticketId: string, rawDraft: string, fallbackBullets: string[]): string => {
  const cleaned = rawDraft
    .replace(/^```[a-z0-9-]*\s*/gim, "")
    .replace(/```$/gim, "")
    .trim();
  const lines = cleaned
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const summaryCandidate = lines.find((line) => !/^(?:[-*]\s+|\d+\.\s+)/u.test(line)) ?? "";
  const normalizedSummary = (summaryCandidate.match(/^feat\(([^)]+)\):\s*(.+)$/iu)?.[2] ?? summaryCandidate)
    .replace(/^[-*]\s+/u, "")
    .trim()
    .replace(/\.+$/u, "");
  const summary = normalizedSummary || "update implementation";
  const extractedBullets = lines
    .filter((line) => line !== summaryCandidate)
    .map((line) => line.replace(/^(?:[-*]\s+|\d+\.\s+)/u, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);
  const bullets = (extractedBullets.length > 0 ? extractedBullets : fallbackBullets).slice(0, 6);
  return [`feat(${ticketId}): ${summary}`, "", ...bullets.map((line) => `- ${line}`)].join("\n");
};

export const buildFallbackCommitBullets = (files: readonly TicketRunDiffFileSummary[]): string[] => {
  const bullets = files.slice(0, 6).map((file) => {
    const action =
      file.status === "A"
        ? "Add"
        : file.status === "D"
          ? "Remove"
          : file.status === "R"
            ? "Rename"
            : file.status === "C"
              ? "Copy"
              : "Update";
    const detailParts: string[] = [action, file.path];
    if (file.additions !== null || file.deletions !== null) {
      detailParts.push(
        `(${file.additions ?? 0} insertion${file.additions === 1 ? "" : "s"}, ${file.deletions ?? 0} deletion${
          file.deletions === 1 ? "" : "s"
        })`,
      );
    }
    return detailParts.join(" ");
  });
  return bullets.length > 0 ? bullets : ["Review the completed ticket changes and prepare them for publish."];
};

export const isRepoBlockingClose = (gitState: Pick<TicketRunGitState, "hasDiff" | "pushAction">): boolean =>
  gitState.hasDiff || gitState.pushAction !== "none";

export const isRepoVisibleInReview = (gitState: Pick<TicketRunGitState, "hasDiff" | "pushAction">): boolean =>
  isRepoBlockingClose(gitState);

export const isSubmoduleBlockingClose = (
  gitState: Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction" | "parents">,
): boolean =>
  gitState.hasDiff ||
  gitState.reconcileRequired ||
  gitState.pushAction !== "none" ||
  gitState.parents.some((parentState) => !parentState.isAligned);

export const isSubmoduleBlockingRepoWorkflow = (
  gitState: Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction">,
): boolean => gitState.hasDiff || gitState.reconcileRequired || gitState.pushAction !== "none";

export const isSubmoduleVisibleInReview = (
  gitState: Pick<TicketRunSubmoduleGitState, "hasDiff" | "reconcileRequired" | "pushAction" | "parents">,
): boolean => isSubmoduleBlockingClose(gitState);

export const toReviewRepoState = ({ files: _files, ...gitState }: TicketRunGitState): TicketRunReviewRepoState =>
  gitState;

export const toReviewSubmoduleState = ({
  files: _files,
  ...gitState
}: TicketRunSubmoduleGitState): TicketRunReviewSubmoduleState => gitState;

export const describeReviewLoadError = (error: unknown, fallbackMessage: string): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackMessage;

export const describeDeleteBlockers = (deleteBlockers: readonly TicketRunDeleteBlocker[]): string =>
  deleteBlockers.map((blocker) => `${blocker.label} (${blocker.reason})`).join(", ");

export const buildDefaultProofSummary = (): TicketRunProofSummary => ({
  status: "not-run",
  lastProofRunId: null,
  lastProofProfileId: null,
  lastProofAt: null,
  lastProofSummary: null,
  staleReason: null,
});

export const buildStaleProofSummary = (run: TicketRunSummary, staleReason: string): TicketRunProofSummary =>
  run.proof.lastProofRunId
    ? {
        ...run.proof,
        status: "stale",
        staleReason,
      }
    : buildDefaultProofSummary();
