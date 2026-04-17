import type { TicketRunSummary } from "@spira/shared";
import { useEffect } from "react";
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
  useEffect(() => {
    void controller.ensureAllGitStateLoaded();
  }, [controller.ensureAllGitStateLoaded]);

  return (
    <section className={projectStyles.section}>
      <article className={projectStyles.detailCard}>
        <div className={projectStyles.sectionHeader}>
          <div>
            <div className={projectStyles.sectionLabel}>Worktree diff</div>
            <div className={projectStyles.sectionCaption}>
              Every managed repo gets its own card. No tabs, no hide-and-seek, just the actual change surface.
            </div>
          </div>
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => void controller.refreshAllGitState()}
            disabled={controller.isRefreshingAnyGit}
          >
            {controller.isRefreshingAnyGit ? "Refreshing..." : "Refresh diff"}
          </button>
        </div>
        {controller.gitNotice ? <div className={projectStyles.notice}>{controller.gitNotice}</div> : null}
        {controller.gitError ? <div className={projectStyles.error}>{controller.gitError}</div> : null}
        <div className={projectStyles.serviceGroupList}>
          {run.worktrees.map((worktree) => {
            const gitState = controller.gitStatesByRepo[worktree.repoRelativePath] ?? null;
            const repoError = controller.gitErrorsByRepo[worktree.repoRelativePath] ?? null;
            const repoLoading = controller.loadingGitRepoPaths[worktree.repoRelativePath] ?? false;

            return (
              <div key={`${run.runId}:${worktree.repoRelativePath}`} className={projectStyles.serviceGroup}>
                <div className={projectStyles.serviceGroupHeader}>
                  <span className={projectStyles.pathBadge}>{worktree.repoRelativePath}</span>
                  <span className={projectStyles.repoTabMeta}>{worktree.branchName}</span>
                </div>
                {repoError ? <div className={projectStyles.error}>{repoError}</div> : null}
                {repoLoading && !gitState ? (
                  <div className={projectStyles.emptyState}>Loading mission diff...</div>
                ) : gitState && gitState.files.length > 0 ? (
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
                ) : gitState ? (
                  <div className={projectStyles.emptyState}>No tracked diff remains in this managed repo.</div>
                ) : (
                  <div className={projectStyles.emptyState}>Mission diff is waiting to load.</div>
                )}
              </div>
            );
          })}
        </div>
      </article>
    </section>
  );
}
