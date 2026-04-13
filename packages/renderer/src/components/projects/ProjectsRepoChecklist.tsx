import type { WorkspaceRepoSummary } from "@spira/shared";
import { useMemo } from "react";
import styles from "./ProjectsPanel.module.css";

interface ProjectsRepoChecklistProps {
  repos: WorkspaceRepoSummary[];
  selectedRepoPaths: string[];
  activeProjectKey: string;
  onToggleRepoSelection: (repoRelativePath: string) => void;
}

export function ProjectsRepoChecklist({
  repos,
  selectedRepoPaths,
  activeProjectKey,
  onToggleRepoSelection,
}: ProjectsRepoChecklistProps) {
  const selectedRepoPathSet = useMemo(() => new Set(selectedRepoPaths), [selectedRepoPaths]);

  if (repos.length === 0) {
    return <div className={styles.emptyState}>No repositories are available beneath the current workspace yet.</div>;
  }

  return (
    <div className={`${styles.repoList} ${styles.repoListScrollable}`}>
      {repos.map((repo) => (
        <label key={repo.relativePath} className={styles.repoRow}>
          <div className={styles.repoRowMain}>
            <input
              type="checkbox"
              checked={selectedRepoPathSet.has(repo.relativePath)}
              onChange={() => onToggleRepoSelection(repo.relativePath)}
            />
            <span className={styles.repoCopy}>
              <strong>{repo.name}</strong>
              <span>{repo.relativePath === "." ? repo.absolutePath : repo.relativePath}</span>
            </span>
          </div>
          <div className={styles.repoRowMeta}>
            <span className={styles.repoMeta}>{repo.hasSubmodules ? "Submodules" : "Direct repo"}</span>
            <div className={styles.repoBadges}>
              {repo.mappedProjectKeys.length > 0 ? (
                repo.mappedProjectKeys.map((projectKey) => (
                  <span
                    key={`${repo.relativePath}-${projectKey}`}
                    className={`${styles.repoBadge} ${projectKey === activeProjectKey ? styles.repoBadgeActive : ""}`}
                  >
                    {projectKey}
                  </span>
                ))
              ) : (
                <span className={styles.repoBadgeMuted}>Unmapped</span>
              )}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}
