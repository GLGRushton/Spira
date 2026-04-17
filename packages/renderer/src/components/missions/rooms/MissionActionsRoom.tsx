import type { TicketRunSummary } from "@spira/shared";
import { useEffect } from "react";
import projectStyles from "../../projects/ProjectsPanel.module.css";
import type { MissionRunController } from "../useMissionRunController.js";

interface MissionActionsRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

export function MissionActionsRoom({ run, controller }: MissionActionsRoomProps) {
  useEffect(() => {
    void controller.ensureAllGitStateLoaded();
  }, [controller.ensureAllGitStateLoaded]);

  return (
    <section className={projectStyles.section}>
      <article className={projectStyles.detailCard}>
        <div className={projectStyles.sectionHeader}>
          <div>
            <div className={projectStyles.sectionLabel}>Git actions</div>
            <div className={projectStyles.sectionCaption}>
              Commit, publish, push, and PR flow per repo, grouped instead of hidden behind a single selector.
            </div>
          </div>
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => void controller.refreshAllGitState()}
            disabled={controller.isRefreshingAnyGit}
          >
            {controller.isRefreshingAnyGit ? "Refreshing..." : "Refresh git"}
          </button>
        </div>
        {controller.gitNotice ? <div className={projectStyles.notice}>{controller.gitNotice}</div> : null}
        {controller.gitError ? <div className={projectStyles.error}>{controller.gitError}</div> : null}

        <div className={projectStyles.serviceGroupList}>
          {run.worktrees.map((worktree) => {
            const repoRelativePath = worktree.repoRelativePath;
            const gitState = controller.gitStatesByRepo[repoRelativePath] ?? null;
            const commitDraft = controller.commitDrafts[repoRelativePath] ?? "";
            const repoError = controller.gitErrorsByRepo[repoRelativePath] ?? null;
            const repoLoading = controller.loadingGitRepoPaths[repoRelativePath] ?? false;
            const showPullRequestActions =
              gitState !== null &&
              !gitState.hasDiff &&
              gitState.pushAction === "none" &&
              gitState.pullRequestUrls.draft !== null;

            return (
              <div key={`${run.runId}:${repoRelativePath}`} className={projectStyles.serviceGroup}>
                <div className={projectStyles.serviceGroupHeader}>
                  <span className={projectStyles.pathBadge}>{repoRelativePath}</span>
                  <span className={projectStyles.repoTabMeta}>{worktree.branchName}</span>
                </div>
                {repoError ? <div className={projectStyles.error}>{repoError}</div> : null}
                {repoLoading && !gitState ? (
                  <div className={projectStyles.emptyState}>Loading git state...</div>
                ) : gitState ? (
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
                            disabled={controller.savingCommitDraftRepo === repoRelativePath}
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
                              !commitDraft.trim() ||
                              !gitState.hasDiff ||
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
                              controller.syncingRemoteRepo === repoRelativePath || gitState.pushAction === "none"
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
                          {gitState.hasDiff
                            ? "Tracked changes are still waiting to be committed."
                            : gitState.pushAction === "publish"
                              ? "This branch is ready to publish to origin."
                              : gitState.pushAction === "push"
                                ? "This branch has local commits ready to push."
                                : "The branch is currently up to date."}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className={projectStyles.emptyState}>Mission git actions are waiting to load.</div>
                )}
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}
