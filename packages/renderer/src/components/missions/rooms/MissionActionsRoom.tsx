import type { TicketRunReviewRepoState, TicketRunReviewSubmoduleState, TicketRunSummary } from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import projectStyles from "../../projects/ProjectsPanel.module.css";
import { formatDiffDelta } from "../mission-display-utils.js";
import type { MissionRunController } from "../useMissionRunController.js";

interface MissionActionsRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

const SUBMODULE_DIFF_KEY_SEPARATOR = "\u0000";

const getDiffStatusTone = (status: string): string => {
  switch (status) {
    case "A":
      return projectStyles.diffStatusAdded;
    case "D":
      return projectStyles.diffStatusDeleted;
    default:
      return projectStyles.diffStatusModified;
  }
};

const getDiffLineTone = (line: string): string => {
  if (line.startsWith("@@")) {
    return projectStyles.diffLineModified;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return projectStyles.diffLineAdded;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return projectStyles.diffLineDeleted;
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
    return projectStyles.diffLineMeta;
  }
  return "";
};

const describeSubmoduleParentState = (parent: TicketRunReviewSubmoduleState["parents"][number]): string => {
  if (parent.isPrimary) {
    if (parent.isAligned) {
      return "Primary";
    }
    return parent.hasDiff ? "Primary - dirty" : "Primary - pending";
  }

  if (parent.isAligned) {
    return "Aligned";
  }

  return parent.hasDiff ? "Needs alignment" : "Pending alignment";
};

const getSubmoduleSyncLabel = (gitState: TicketRunReviewSubmoduleState | null, needsAlignment: boolean): string => {
  if (gitState?.pushAction === "publish") {
    return "Publish";
  }
  if (gitState?.pushAction === "push") {
    return "Push";
  }
  return needsAlignment ? "Align parents" : "Push";
};

const getSubmoduleHint = (
  gitState: TicketRunReviewSubmoduleState,
  needsAlignment: boolean,
  runStatus: TicketRunSummary["status"],
): string => {
  if (runStatus !== "awaiting-review") {
    return runStatus === "done"
      ? "This mission is closed. Managed submodule actions are now read-only."
      : "Finish the active mission pass before committing, publishing, or opening pull requests for managed submodules.";
  }
  if (gitState.reconcileRequired) {
    return gitState.reconcileReason ?? "This managed submodule needs reconciliation.";
  }
  if (gitState.hasDiff) {
    return "Submodule changes are still waiting to be committed.";
  }
  if (gitState.pushAction === "publish") {
    return "This submodule branch is ready to publish to origin.";
  }
  if (gitState.pushAction === "push") {
    return "This submodule branch has local commits ready to push.";
  }
  if (needsAlignment) {
    return "Parent repos still need to align to the canonical submodule commit. Use Align parents to restage the shared pointer updates.";
  }
  return "The submodule branch is currently up to date and aligned across parent repos.";
};

const getRepoHint = (
  gitState: TicketRunReviewRepoState,
  blockingSubmoduleNames: string[],
  runStatus: TicketRunSummary["status"],
): string => {
  if (runStatus !== "awaiting-review") {
    return runStatus === "done"
      ? "This mission is closed. Repo actions are now read-only."
      : "Finish the active mission pass before committing, publishing, or opening pull requests for repo changes.";
  }
  if (blockingSubmoduleNames.length > 0) {
    return "Managed submodules still need to be committed, published, or aligned before this repo can move.";
  }
  if (gitState.hasDiff) {
    return "Changes are still waiting to be committed.";
  }
  if (gitState.pushAction === "publish") {
    return "This branch is ready to publish to origin.";
  }
  if (gitState.pushAction === "push") {
    return "This branch has local commits ready to push.";
  }
  return "The branch is currently up to date.";
};

export function MissionActionsRoom({ run, controller }: MissionActionsRoomProps) {
  const [showAll, setShowAll] = useState(false);

  const visibleRepoPaths = useMemo(
    () => new Set(controller.reviewSnapshot?.visibleRepoPaths ?? []),
    [controller.reviewSnapshot?.visibleRepoPaths],
  );
  const visibleSubmoduleUrls = useMemo(
    () => new Set(controller.reviewSnapshot?.visibleSubmoduleUrls ?? []),
    [controller.reviewSnapshot?.visibleSubmoduleUrls],
  );
  const displayedRepoEntries = useMemo(() => {
    const entries = controller.reviewSnapshot?.repoEntries ?? [];
    return showAll ? entries : entries.filter((entry) => visibleRepoPaths.has(entry.repoRelativePath));
  }, [controller.reviewSnapshot?.repoEntries, showAll, visibleRepoPaths]);
  const displayedSubmoduleEntries = useMemo(() => {
    const entries = controller.reviewSnapshot?.submoduleEntries ?? [];
    return showAll ? entries : entries.filter((entry) => visibleSubmoduleUrls.has(entry.canonicalUrl));
  }, [controller.reviewSnapshot?.submoduleEntries, showAll, visibleSubmoduleUrls]);
  const ensureSubmoduleGitState = controller.ensureSubmoduleGitState;

  useEffect(() => {
    for (const entry of displayedSubmoduleEntries) {
      if (entry.error === null && entry.gitState?.hasDiff) {
        void ensureSubmoduleGitState(entry.canonicalUrl);
      }
    }
  }, [displayedSubmoduleEntries, ensureSubmoduleGitState]);

  const reviewActive = run.status === "awaiting-review";

  return (
    <section className={projectStyles.section}>
      {run.submodules.length > 0 ? (
        <article className={projectStyles.detailCard}>
          <div className={projectStyles.sectionHeader}>
            <div>
              <div className={projectStyles.sectionLabel}>Managed submodules</div>
              <div className={projectStyles.sectionCaption}>
                Shared submodule work is committed, published, and PR&apos;d once here before the parent repos take
                their turn.
              </div>
            </div>
            <div className={projectStyles.inlineActions}>
              <button
                type="button"
                className={projectStyles.secondaryButton}
                onClick={() => setShowAll((current) => !current)}
              >
                {showAll ? "Show changed only" : "Show all"}
              </button>
              <button
                type="button"
                className={projectStyles.secondaryButton}
                onClick={() => void controller.refreshReviewSnapshot()}
                disabled={controller.isReviewSnapshotLoading}
              >
                {controller.isReviewSnapshotLoading ? "Refreshing..." : "Refresh review"}
              </button>
            </div>
          </div>
          {controller.gitNotice ? <div className={projectStyles.notice}>{controller.gitNotice}</div> : null}
          {controller.gitError ? <div className={projectStyles.error}>{controller.gitError}</div> : null}
          {controller.reviewSnapshot === null ? (
            <div className={projectStyles.emptyState}>
              {controller.isReviewSnapshotLoading
                ? "Loading managed submodule state..."
                : "Mission review is waiting to load."}
            </div>
          ) : displayedSubmoduleEntries.length > 0 ? (
            <div className={projectStyles.serviceGroupList}>
              {displayedSubmoduleEntries.map((entry) => {
                const canonicalUrl = entry.canonicalUrl;
                const gitState = entry.gitState;
                const diffState = controller.submoduleGitStatesByUrl[canonicalUrl] ?? null;
                const submoduleError = entry.error ?? controller.submoduleGitErrorsByUrl[canonicalUrl];
                const submodule = run.submodules.find((candidate) => candidate.canonicalUrl === canonicalUrl);
                const commitDraft = controller.submoduleCommitDrafts[canonicalUrl] ?? "";
                const needsAlignment = gitState?.parents.some((parent) => !parent.isAligned) ?? false;
                const canSync = gitState !== null && (gitState.pushAction !== "none" || needsAlignment);
                const syncLabel = getSubmoduleSyncLabel(gitState, needsAlignment);
                const showPullRequestActions =
                  reviewActive &&
                  gitState !== null &&
                  !gitState.reconcileRequired &&
                  !needsAlignment &&
                  !gitState.hasDiff &&
                  gitState.pushAction === "none" &&
                  gitState.pullRequestUrls.open !== null &&
                  gitState.pullRequestUrls.draft !== null;

                return (
                  <div key={`${run.runId}:${canonicalUrl}`} className={projectStyles.serviceGroup}>
                    <div className={projectStyles.serviceGroupHeader}>
                      <span className={projectStyles.pathBadge}>
                        {gitState?.name ?? submodule?.name ?? canonicalUrl}
                      </span>
                      <span className={projectStyles.repoTabMeta}>
                        {gitState?.branchName ?? submodule?.branchName ?? "Managed submodule"}
                      </span>
                    </div>
                    {submoduleError ? <div className={projectStyles.error}>{submoduleError}</div> : null}
                    {gitState ? (
                      <div className={projectStyles.reviewPanel}>
                        <div className={projectStyles.inlineRunFacts}>
                          <div className={projectStyles.inlineRunFact}>
                            <strong>Branch</strong>
                            {gitState.branchName}
                          </div>
                          <div className={projectStyles.inlineRunFact}>
                            <strong>Canonical commit</strong>
                            {gitState.committedSha?.slice(0, 12) ?? "Unknown"}
                          </div>
                          <div className={projectStyles.inlineRunFact}>
                            <strong>Source</strong>
                            {gitState.worktreePath}
                          </div>
                        </div>

                        {gitState.reconcileRequired ? (
                          <>
                            <div className={projectStyles.blockedState}>
                              {gitState.reconcileReason ?? "This managed submodule needs reconciliation."}
                            </div>
                            <div className={projectStyles.workHint}>
                              Consolidate the wanted submodule edits into one parent copy, discard the conflicting
                              duplicate edits in the others, then refresh the managed submodule state.
                            </div>
                          </>
                        ) : null}

                        <div className={projectStyles.sectionLabel}>Parent repos</div>
                        <div className={projectStyles.runWorktrees}>
                          {gitState.parents.map((parent) => (
                            <div
                              key={`${canonicalUrl}:${parent.parentRepoRelativePath}:${parent.submodulePath}`}
                              className={projectStyles.runWorktree}
                            >
                              <strong>{parent.parentRepoRelativePath}</strong>
                              <span>{parent.submodulePath}</span>
                              <span>{describeSubmoduleParentState(parent)}</span>
                            </div>
                          ))}
                        </div>

                        {showPullRequestActions ? (
                          <>
                            <div className={projectStyles.sectionLabel}>Pull request</div>
                            <div className={projectStyles.inlineActions}>
                              <button
                                type="button"
                                className={projectStyles.actionLinkButton}
                                onClick={() => void controller.openSubmodulePullRequest(canonicalUrl)}
                                disabled={controller.creatingSubmodulePullRequestUrl === canonicalUrl}
                              >
                                {controller.creatingSubmodulePullRequestUrl === canonicalUrl
                                  ? "Opening PR..."
                                  : "Open PR"}
                              </button>
                              <a
                                className={projectStyles.secondaryLinkButton}
                                href={gitState.pullRequestUrls.draft ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open draft PR
                              </a>
                            </div>
                            <div className={projectStyles.workHint}>
                              This managed submodule is published, aligned across every parent repo, and ready for
                              review.
                            </div>
                          </>
                        ) : (
                          <>
                            <label className={projectStyles.field}>
                              <span>Commit draft</span>
                              <textarea
                                className={`${projectStyles.input} ${projectStyles.textarea}`}
                                value={commitDraft}
                                disabled={!reviewActive || controller.savingSubmoduleCommitDraftUrl === canonicalUrl}
                                onChange={(event) =>
                                  controller.setSubmoduleCommitDraft(canonicalUrl, event.target.value)
                                }
                                onBlur={() => {
                                  if (controller.dirtySubmoduleCommitDrafts[canonicalUrl]) {
                                    void controller.persistSubmoduleCommitDraft(canonicalUrl);
                                  }
                                }}
                                placeholder={`feat(${run.ticketId}): summary`}
                              />
                            </label>
                            <div className={projectStyles.inlineActions}>
                              <button
                                type="button"
                                className={projectStyles.secondaryButton}
                                onClick={() => void controller.generateSubmoduleCommitDraft(canonicalUrl)}
                                disabled={
                                  !reviewActive ||
                                  controller.generatingSubmoduleCommitDraftUrl === canonicalUrl ||
                                  controller.savingSubmoduleCommitDraftUrl === canonicalUrl
                                }
                              >
                                {controller.generatingSubmoduleCommitDraftUrl === canonicalUrl
                                  ? "Regenerating..."
                                  : "Regenerate"}
                              </button>
                              <button
                                type="button"
                                className={projectStyles.actionButton}
                                onClick={() => void controller.commitMissionSubmodule(canonicalUrl)}
                                disabled={
                                  !reviewActive ||
                                  !commitDraft.trim() ||
                                  !gitState.hasDiff ||
                                  gitState.reconcileRequired ||
                                  controller.committingSubmoduleUrl === canonicalUrl ||
                                  controller.savingSubmoduleCommitDraftUrl === canonicalUrl
                                }
                              >
                                {controller.committingSubmoduleUrl === canonicalUrl ? "Committing..." : "Commit"}
                              </button>
                              <button
                                type="button"
                                className={projectStyles.secondaryButton}
                                onClick={() =>
                                  void controller.syncSubmoduleRemote(
                                    canonicalUrl,
                                    gitState.pushAction === "publish" ? "publish" : "push",
                                  )
                                }
                                disabled={
                                  !reviewActive ||
                                  controller.syncingSubmoduleUrl === canonicalUrl ||
                                  gitState.reconcileRequired ||
                                  !canSync
                                }
                              >
                                {controller.syncingSubmoduleUrl === canonicalUrl ? "Syncing..." : syncLabel}
                              </button>
                            </div>
                            <div className={projectStyles.workHint}>
                              {getSubmoduleHint(gitState, needsAlignment, run.status)}
                            </div>
                          </>
                        )}

                        <div className={projectStyles.sectionLabel}>Submodule diff</div>
                        {diffState && diffState.files.length > 0 ? (
                          <div className={projectStyles.diffList}>
                            {diffState.files.map((file) => {
                              const expandedKey = `${canonicalUrl}${SUBMODULE_DIFF_KEY_SEPARATOR}${file.path}`;
                              const expanded = controller.expandedSubmoduleDiffPaths[expandedKey] ?? false;
                              const diffStatusTone = getDiffStatusTone(file.status);
                              return (
                                <div
                                  key={`${canonicalUrl}:${file.path}-${file.status}`}
                                  className={`${projectStyles.diffFileCard} ${diffStatusTone}`}
                                >
                                  <button
                                    type="button"
                                    className={`${projectStyles.diffFileButton} ${diffStatusTone}`}
                                    onClick={() => controller.toggleSubmoduleDiffPath(canonicalUrl, file.path)}
                                  >
                                    <span className={`${projectStyles.statusBadge} ${diffStatusTone}`}>
                                      {file.status}
                                    </span>
                                    <span className={projectStyles.diffFilePath}>
                                      {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
                                    </span>
                                    <span className={projectStyles.diffFileDelta}>
                                      {formatDiffDelta(file.additions, file.deletions)}
                                    </span>
                                  </button>
                                  {expanded ? (
                                    <div className={projectStyles.diffPatch}>
                                      {file.patch.split(/\r?\n/u).map((line, index) => (
                                        <div
                                          key={`${canonicalUrl}:${file.path}-${file.status}-${index}`}
                                          className={`${projectStyles.diffPatchLine} ${getDiffLineTone(line)}`}
                                        >
                                          {line || " "}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : gitState.hasDiff && !submoduleError ? (
                          <div className={projectStyles.emptyState}>Loading managed submodule diff...</div>
                        ) : (
                          <div className={projectStyles.emptyState}>
                            No tracked diff remains in this managed submodule.
                          </div>
                        )}
                      </div>
                    ) : submoduleError ? null : (
                      <div className={projectStyles.emptyState}>Managed submodule state is waiting to load.</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={projectStyles.emptyState}>
              {showAll
                ? "No managed submodule actions are attached to this mission."
                : "No changed managed submodules to show."}
            </div>
          )}
        </article>
      ) : null}

      <article className={projectStyles.detailCard}>
        <div className={projectStyles.sectionHeader}>
          <div>
            <div className={projectStyles.sectionLabel}>Git actions</div>
            <div className={projectStyles.sectionCaption}>
              Commit, publish, push, and PR flow per repo, grouped instead of hidden behind a single selector.
            </div>
          </div>
          <div className={projectStyles.inlineActions}>
            <button
              type="button"
              className={projectStyles.secondaryButton}
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? "Show changed only" : "Show all"}
            </button>
            <button
              type="button"
              className={projectStyles.secondaryButton}
              onClick={() => void controller.refreshReviewSnapshot()}
              disabled={controller.isReviewSnapshotLoading}
            >
              {controller.isReviewSnapshotLoading ? "Refreshing..." : "Refresh review"}
            </button>
          </div>
        </div>
        {controller.gitNotice ? <div className={projectStyles.notice}>{controller.gitNotice}</div> : null}
        {controller.gitError ? <div className={projectStyles.error}>{controller.gitError}</div> : null}

        {controller.reviewSnapshot === null ? (
          <div className={projectStyles.emptyState}>
            {controller.isReviewSnapshotLoading ? "Loading git state..." : "Mission review is waiting to load."}
          </div>
        ) : displayedRepoEntries.length > 0 ? (
          <div className={projectStyles.serviceGroupList}>
            {displayedRepoEntries.map((entry) => {
              const repoRelativePath = entry.repoRelativePath;
              const worktree = run.worktrees.find((candidate) => candidate.repoRelativePath === repoRelativePath);
              const gitState = entry.gitState;
              const commitDraft = controller.commitDrafts[repoRelativePath] ?? "";
              const blockingSubmoduleNames =
                gitState?.blockedBySubmoduleCanonicalUrls.map(
                  (canonicalUrl) =>
                    run.submodules.find((submodule) => submodule.canonicalUrl === canonicalUrl)?.name ?? canonicalUrl,
                ) ?? [];
              const showPullRequestActions =
                reviewActive &&
                gitState !== null &&
                blockingSubmoduleNames.length === 0 &&
                !gitState.hasDiff &&
                gitState.pushAction === "none" &&
                gitState.pullRequestUrls.open !== null &&
                gitState.pullRequestUrls.draft !== null;

              return (
                <div key={`${run.runId}:${repoRelativePath}`} className={projectStyles.serviceGroup}>
                  <div className={projectStyles.serviceGroupHeader}>
                    <span className={projectStyles.pathBadge}>{repoRelativePath}</span>
                    <span className={projectStyles.repoTabMeta}>
                      {worktree?.branchName ?? gitState?.branchName ?? "Repo"}
                    </span>
                  </div>
                  {entry.error ? <div className={projectStyles.error}>{entry.error}</div> : null}
                  {gitState ? (
                    <div className={projectStyles.reviewPanel}>
                      <div className={projectStyles.inlineRunFacts}>
                        <div className={projectStyles.inlineRunFact}>
                          <strong>Branch</strong>
                          {gitState.branchName}
                        </div>
                        <div className={projectStyles.inlineRunFact}>
                          <strong>Upstream</strong>
                          {gitState.upstreamBranch ?? "Not published"}
                        </div>
                        <div className={projectStyles.inlineRunFact}>
                          <strong>Ahead / behind</strong>
                          {`${gitState.aheadCount} / ${gitState.behindCount}`}
                        </div>
                      </div>

                      {blockingSubmoduleNames.length > 0 ? (
                        <div className={projectStyles.blockedState}>
                          Finish the managed submodule workflow first: {blockingSubmoduleNames.join(", ")}.
                        </div>
                      ) : null}

                      {showPullRequestActions ? (
                        <>
                          <div className={projectStyles.sectionLabel}>Pull request</div>
                          <div className={projectStyles.inlineActions}>
                            <button
                              type="button"
                              className={projectStyles.actionLinkButton}
                              onClick={() => void controller.openMissionPullRequest(repoRelativePath)}
                              disabled={controller.creatingPullRequestRepo === repoRelativePath}
                            >
                              {controller.creatingPullRequestRepo === repoRelativePath ? "Opening PR..." : "Open PR"}
                            </button>
                            <a
                              className={projectStyles.secondaryLinkButton}
                              href={gitState.pullRequestUrls.draft ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open draft PR
                            </a>
                          </div>
                          <div className={projectStyles.workHint}>
                            Everything in this repo has reached the remote branch. Open the pull request when you are
                            ready.
                          </div>
                        </>
                      ) : (
                        <>
                          <label className={projectStyles.field}>
                            <span>Commit draft</span>
                            <textarea
                              className={`${projectStyles.input} ${projectStyles.textarea}`}
                              value={commitDraft}
                              disabled={!reviewActive || controller.savingCommitDraftRepo === repoRelativePath}
                              onChange={(event) => controller.setCommitDraft(repoRelativePath, event.target.value)}
                              onBlur={() => {
                                if (controller.dirtyCommitDrafts[repoRelativePath]) {
                                  void controller.persistCommitDraft(repoRelativePath);
                                }
                              }}
                              placeholder={`feat(${run.ticketId}): summary`}
                            />
                          </label>
                          <div className={projectStyles.inlineActions}>
                            <button
                              type="button"
                              className={projectStyles.secondaryButton}
                              onClick={() => void controller.generateCommitDraft(repoRelativePath)}
                              disabled={
                                !reviewActive ||
                                controller.generatingCommitDraftRepo === repoRelativePath ||
                                controller.savingCommitDraftRepo === repoRelativePath
                              }
                            >
                              {controller.generatingCommitDraftRepo === repoRelativePath
                                ? "Regenerating..."
                                : "Regenerate"}
                            </button>
                            <button
                              type="button"
                              className={projectStyles.actionButton}
                              onClick={() => void controller.commitMissionRun(repoRelativePath)}
                              disabled={
                                !reviewActive ||
                                !commitDraft.trim() ||
                                !gitState.hasDiff ||
                                blockingSubmoduleNames.length > 0 ||
                                controller.committingRepo === repoRelativePath ||
                                controller.savingCommitDraftRepo === repoRelativePath
                              }
                            >
                              {controller.committingRepo === repoRelativePath ? "Committing..." : "Commit"}
                            </button>
                            <button
                              type="button"
                              className={projectStyles.secondaryButton}
                              onClick={() =>
                                void controller.syncMissionRemote(
                                  repoRelativePath,
                                  gitState.pushAction === "publish" ? "publish" : "push",
                                )
                              }
                              disabled={
                                !reviewActive ||
                                controller.syncingRemoteRepo === repoRelativePath ||
                                blockingSubmoduleNames.length > 0 ||
                                gitState.pushAction === "none"
                              }
                            >
                              {controller.syncingRemoteRepo === repoRelativePath
                                ? "Syncing..."
                                : gitState.pushAction === "publish"
                                  ? "Publish"
                                  : "Push"}
                            </button>
                          </div>
                          <div className={projectStyles.workHint}>
                            {getRepoHint(gitState, blockingSubmoduleNames, run.status)}
                          </div>
                        </>
                      )}
                    </div>
                  ) : entry.error ? null : (
                    <div className={projectStyles.emptyState}>Mission git actions are waiting to load.</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={projectStyles.emptyState}>
            {showAll ? "No managed repo actions are attached to this mission." : "No changed repos to show."}
          </div>
        )}
      </article>
    </section>
  );
}
