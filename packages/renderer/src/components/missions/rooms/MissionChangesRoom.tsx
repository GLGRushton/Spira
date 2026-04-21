import type { TicketRunSummary } from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import projectStyles from "../../projects/ProjectsPanel.module.css";
import { formatDiffDelta } from "../mission-display-utils.js";
import type { MissionRunController } from "../useMissionRunController.js";

interface MissionChangesRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

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

export function MissionChangesRoom({ run, controller }: MissionChangesRoomProps) {
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
  const ensureGitState = controller.ensureGitState;
  const ensureSubmoduleGitState = controller.ensureSubmoduleGitState;

  useEffect(() => {
    for (const entry of displayedRepoEntries) {
      if (entry.error === null && entry.gitState?.hasDiff) {
        void ensureGitState(entry.repoRelativePath);
      }
    }
    for (const entry of displayedSubmoduleEntries) {
      if (entry.error === null && entry.gitState?.hasDiff) {
        void ensureSubmoduleGitState(entry.canonicalUrl);
      }
    }
  }, [displayedRepoEntries, displayedSubmoduleEntries, ensureGitState, ensureSubmoduleGitState]);

  return (
    <section className={projectStyles.section}>
      {run.submodules.length > 0 ? (
        <article className={projectStyles.detailCard}>
          <div className={projectStyles.sectionHeader}>
            <div>
              <div className={projectStyles.sectionLabel}>Managed submodule diff</div>
              <div className={projectStyles.sectionCaption}>
                Shared submodule changes, shown once per managed submodule instead of duplicated across parent repos.
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
                ? "Loading managed submodule diff..."
                : "Mission review is waiting to load."}
            </div>
          ) : displayedSubmoduleEntries.length > 0 ? (
            <div className={projectStyles.serviceGroupList}>
              {displayedSubmoduleEntries.map((entry) => {
                const canonicalUrl = entry.canonicalUrl;
                const summaryState = entry.gitState;
                const gitState = controller.submoduleGitStatesByUrl[canonicalUrl] ?? null;
                const gitError = entry.error ?? controller.submoduleGitErrorsByUrl[canonicalUrl];
                const submodule = run.submodules.find((candidate) => candidate.canonicalUrl === canonicalUrl);

                return (
                  <div key={`${run.runId}:${canonicalUrl}`} className={projectStyles.serviceGroup}>
                    <div className={projectStyles.serviceGroupHeader}>
                      <span className={projectStyles.pathBadge}>
                        {summaryState?.name ?? gitState?.name ?? submodule?.name ?? canonicalUrl}
                      </span>
                      <span className={projectStyles.repoTabMeta}>
                        {summaryState?.branchName ??
                          gitState?.branchName ??
                          submodule?.branchName ??
                          "Managed submodule"}
                      </span>
                    </div>
                    {gitError ? <div className={projectStyles.error}>{gitError}</div> : null}
                    {gitState ? (
                      gitState.files.length > 0 ? (
                        <>
                          {gitState.reconcileRequired ? (
                            <div className={projectStyles.blockedState}>
                              {gitState.reconcileReason ?? "This managed submodule needs reconciliation."}
                            </div>
                          ) : null}
                          <div className={projectStyles.diffList}>
                            {gitState.files.map((file) => {
                              const expandedKey = `${canonicalUrl}\u0000${file.path}`;
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
                        </>
                      ) : (
                        <div className={projectStyles.emptyState}>
                          {summaryState?.hasDiff
                            ? "This managed submodule only has git metadata or pointer changes to reconcile."
                            : "No tracked diff remains in this managed submodule."}
                        </div>
                      )
                    ) : gitError ? null : summaryState && !summaryState.hasDiff ? (
                      <div className={projectStyles.emptyState}>No tracked diff remains in this managed submodule.</div>
                    ) : (
                      <div className={projectStyles.emptyState}>Loading managed submodule diff...</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={projectStyles.emptyState}>
              {showAll
                ? "No managed submodule changes are attached to this mission."
                : "No changed managed submodules to show."}
            </div>
          )}
        </article>
      ) : null}

      <article className={projectStyles.detailCard}>
        <div className={projectStyles.sectionHeader}>
          <div>
            <div className={projectStyles.sectionLabel}>Worktree diff</div>
            <div className={projectStyles.sectionCaption}>
              Every managed repo gets its own card. No tabs, no hide-and-seek, just the actual change surface.
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
            {controller.isReviewSnapshotLoading ? "Loading mission diff..." : "Mission review is waiting to load."}
          </div>
        ) : displayedRepoEntries.length > 0 ? (
          <div className={projectStyles.serviceGroupList}>
            {displayedRepoEntries.map((entry) => {
              const worktree = run.worktrees.find((candidate) => candidate.repoRelativePath === entry.repoRelativePath);
              const summaryState = entry.gitState;
              const gitState = controller.gitStatesByRepo[entry.repoRelativePath] ?? null;
              const gitError = entry.error ?? controller.gitErrorsByRepo[entry.repoRelativePath];

              return (
                <div key={`${run.runId}:${entry.repoRelativePath}`} className={projectStyles.serviceGroup}>
                  <div className={projectStyles.serviceGroupHeader}>
                    <span className={projectStyles.pathBadge}>{entry.repoRelativePath}</span>
                    <span className={projectStyles.repoTabMeta}>
                      {worktree?.branchName ?? summaryState?.branchName ?? gitState?.branchName ?? "Repo"}
                    </span>
                  </div>
                  {gitError ? <div className={projectStyles.error}>{gitError}</div> : null}
                  {gitState && gitState.files.length > 0 ? (
                    <div className={projectStyles.diffList}>
                      {gitState.files.map((file) => {
                        const expandedKey = `${gitState.repoRelativePath}:${file.path}`;
                        const expanded = controller.expandedDiffPaths[expandedKey] ?? false;
                        const diffStatusTone = getDiffStatusTone(file.status);
                        return (
                          <div
                            key={`${gitState.repoRelativePath}:${file.path}-${file.status}`}
                            className={`${projectStyles.diffFileCard} ${diffStatusTone}`}
                          >
                            <button
                              type="button"
                              className={`${projectStyles.diffFileButton} ${diffStatusTone}`}
                              onClick={() => controller.toggleDiffPath(gitState.repoRelativePath, file.path)}
                            >
                              <span className={`${projectStyles.statusBadge} ${diffStatusTone}`}>{file.status}</span>
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
                                    key={`${file.path}-${file.status}-${index}`}
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
                  ) : gitState && summaryState?.hasDiff ? (
                    <div className={projectStyles.emptyState}>
                      This managed repo only has git metadata or submodule pointer changes to reconcile.
                    </div>
                  ) : gitState || (summaryState && !summaryState.hasDiff) ? (
                    <div className={projectStyles.emptyState}>No tracked diff remains in this managed repo.</div>
                  ) : gitError ? null : (
                    <div className={projectStyles.emptyState}>Loading mission diff...</div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={projectStyles.emptyState}>
            {showAll ? "No managed repo changes are attached to this mission." : "No changed repos to show."}
          </div>
        )}
      </article>
    </section>
  );
}
