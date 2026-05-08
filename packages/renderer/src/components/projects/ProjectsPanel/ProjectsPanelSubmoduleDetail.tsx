import type { TicketRunSubmoduleGitState, TicketRunSummary } from "@spira/shared";
import styles from "./ProjectsPanel.module.css";
import { formatDiffDelta, getDiffLineTone, getDiffStatusTone } from "./ProjectsPanel.utils.js";

type ProjectsPanelSubmoduleDetailProps = {
  run: TicketRunSummary;
  selectedMissionSubmodule: TicketRunSummary["submodules"][number] | null;
  selectedSubmoduleGitState: TicketRunSubmoduleGitState | null;
  selectedMissionSubmoduleLabel: string | null;
  selectedSubmoduleKey: string | null;
  loadingSubmoduleKey: string | null;
  showSubmodulePullRequestActions: boolean;
  creatingSubmodulePullRequestKey: string | null;
  submoduleCommitDraft: string;
  savingSubmoduleCommitDraftKey: string | null;
  generatingSubmoduleCommitDraftKey: string | null;
  committingSubmoduleKey: string | null;
  syncingSubmoduleKey: string | null;
  selectedSubmoduleCanSync: boolean;
  selectedSubmoduleSyncLabel: string;
  selectedSubmoduleNeedsAlignment: boolean;
  expandedDiffPaths: Record<string, boolean>;
  gitError: string | null;
  onRefreshSelectedSubmoduleGitState: (runId: string) => Promise<void>;
  onSelectSubmodule: (canonicalUrl: string) => void;
  onOpenSubmodulePullRequest: (runId: string) => Promise<void>;
  onSubmoduleCommitDraftChange: (value: string) => void;
  onPersistSubmoduleCommitDraft: (runId: string) => Promise<void>;
  onGenerateSubmoduleCommitDraft: (runId: string) => Promise<void>;
  onCommitMissionSubmodule: (runId: string) => Promise<void>;
  onSyncSubmoduleRemote: (runId: string, action: "publish" | "push") => Promise<void>;
  onToggleExpandedDiff: (expandedKey: string) => void;
};

export function ProjectsPanelSubmoduleDetail({
  run,
  selectedMissionSubmodule,
  selectedSubmoduleGitState,
  selectedMissionSubmoduleLabel,
  selectedSubmoduleKey,
  loadingSubmoduleKey,
  showSubmodulePullRequestActions,
  creatingSubmodulePullRequestKey,
  submoduleCommitDraft,
  savingSubmoduleCommitDraftKey,
  generatingSubmoduleCommitDraftKey,
  committingSubmoduleKey,
  syncingSubmoduleKey,
  selectedSubmoduleCanSync,
  selectedSubmoduleSyncLabel,
  selectedSubmoduleNeedsAlignment,
  expandedDiffPaths,
  gitError,
  onRefreshSelectedSubmoduleGitState,
  onSelectSubmodule,
  onOpenSubmodulePullRequest,
  onSubmoduleCommitDraftChange,
  onPersistSubmoduleCommitDraft,
  onGenerateSubmoduleCommitDraft,
  onCommitMissionSubmodule,
  onSyncSubmoduleRemote,
  onToggleExpandedDiff,
}: ProjectsPanelSubmoduleDetailProps) {
  if (run.submodules.length === 0) {
    return null;
  }

  return (
    <article className={styles.detailCard}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionLabel}>Managed submodules</div>
          <div className={styles.sectionCaption}>
            Shared submodule work is committed, published, and PR&apos;d once here before the parent repos take their
            turn.
          </div>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void onRefreshSelectedSubmoduleGitState(run.runId)}
          disabled={!selectedMissionSubmodule || loadingSubmoduleKey === selectedSubmoduleKey}
        >
          {loadingSubmoduleKey === selectedSubmoduleKey ? "Refreshing..." : "Refresh submodule"}
        </button>
      </div>

      <div className={styles.repoTabBar} role="tablist" aria-label="Managed submodules">
        {run.submodules.map((submodule) => {
          const isActive = selectedMissionSubmodule?.canonicalUrl === submodule.canonicalUrl;
          return (
            <button
              key={`${run.runId}-${submodule.canonicalUrl}-tab`}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${styles.repoTabButton} ${isActive ? styles.repoTabButtonActive : ""}`}
              onClick={() => onSelectSubmodule(submodule.canonicalUrl)}
            >
              <span>{submodule.name}</span>
              <span className={styles.repoTabMeta}>
                {submodule.parentRefs.length} parent{submodule.parentRefs.length === 1 ? "" : "s"}
              </span>
            </button>
          );
        })}
      </div>

      {selectedSubmoduleGitState ? (
        <>
          {selectedMissionSubmoduleLabel ? (
            <div className={styles.workHint}>Active submodule: {selectedMissionSubmoduleLabel}</div>
          ) : null}
          <div className={styles.inlineRunFacts}>
            <div className={styles.inlineRunFact}>
              <strong>Branch</strong>
              {selectedSubmoduleGitState.branchName}
            </div>
            <div className={styles.inlineRunFact}>
              <strong>Primary repo</strong>
              {selectedSubmoduleGitState.primaryParentRepoRelativePath ?? "Pending selection"}
            </div>
            <div className={styles.inlineRunFact}>
              <strong>Canonical commit</strong>
              {selectedSubmoduleGitState.committedSha?.slice(0, 12) ?? "Unknown"}
            </div>
            <div className={styles.inlineRunFact}>
              <strong>Source</strong>
              {selectedSubmoduleGitState.worktreePath}
            </div>
          </div>

          {selectedSubmoduleGitState.reconcileRequired ? (
            <>
              <div className={styles.blockedState}>
                {selectedSubmoduleGitState.reconcileReason ?? "This managed submodule needs reconciliation."}
              </div>
              <div className={styles.workHint}>
                Consolidate the wanted submodule edits into one parent copy, discard the conflicting duplicate edits in
                the others, then refresh the managed submodule state.
              </div>
            </>
          ) : null}

          <div className={styles.sectionLabel}>Parent repos</div>
          <div className={styles.runWorktrees}>
            {selectedSubmoduleGitState.parents.map((parent) => (
              <div
                key={`${selectedSubmoduleGitState.canonicalUrl}:${parent.parentRepoRelativePath}:${parent.submodulePath}`}
                className={styles.runWorktree}
              >
                <strong>{parent.parentRepoRelativePath}</strong>
                <span>{parent.submodulePath}</span>
                <span>
                  {parent.isPrimary
                    ? parent.isAligned
                      ? "Primary"
                      : parent.hasDiff
                        ? "Primary - dirty"
                        : "Primary - pending"
                    : parent.isAligned
                      ? "Aligned"
                      : parent.hasDiff
                        ? "Needs alignment"
                        : "Pending alignment"}
                </span>
              </div>
            ))}
          </div>

          {run.status !== "awaiting-review" ? (
            <div className={styles.workHint}>
              Finish the active mission pass before committing, publishing, or opening pull requests for managed
              submodules.
            </div>
          ) : showSubmodulePullRequestActions ? (
            <>
              <div className={styles.sectionLabel}>Pull request</div>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.actionLinkButton}
                  onClick={() => void onOpenSubmodulePullRequest(run.runId)}
                  disabled={creatingSubmodulePullRequestKey === selectedSubmoduleKey}
                >
                  {creatingSubmodulePullRequestKey === selectedSubmoduleKey ? "Opening PR..." : "Open PR"}
                </button>
                <a
                  className={styles.secondaryLinkButton}
                  href={selectedSubmoduleGitState.pullRequestUrls.draft ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open draft PR
                </a>
              </div>
              <div className={styles.workHint}>
                This managed submodule is published, aligned across every parent repo, and ready for review.
              </div>
            </>
          ) : (
            <>
              <label className={styles.field}>
                <span>
                  {selectedMissionSubmoduleLabel
                    ? `Commit draft - ${selectedMissionSubmoduleLabel}`
                    : "Submodule commit draft"}
                </span>
                <textarea
                  className={`${styles.input} ${styles.textarea}`}
                  value={submoduleCommitDraft}
                  disabled={run.status !== "awaiting-review" || savingSubmoduleCommitDraftKey === selectedSubmoduleKey}
                  onChange={(event) => onSubmoduleCommitDraftChange(event.target.value)}
                  onBlur={() => void onPersistSubmoduleCommitDraft(run.runId)}
                  placeholder={`feat(${run.ticketId}): summary`}
                />
              </label>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => void onGenerateSubmoduleCommitDraft(run.runId)}
                  disabled={
                    run.status !== "awaiting-review" ||
                    generatingSubmoduleCommitDraftKey === selectedSubmoduleKey ||
                    savingSubmoduleCommitDraftKey === selectedSubmoduleKey
                  }
                >
                  {generatingSubmoduleCommitDraftKey === selectedSubmoduleKey ? "Regenerating..." : "Regenerate"}
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => void onCommitMissionSubmodule(run.runId)}
                  disabled={
                    run.status !== "awaiting-review" ||
                    !submoduleCommitDraft.trim() ||
                    !selectedSubmoduleGitState.hasDiff ||
                    selectedSubmoduleGitState.reconcileRequired ||
                    committingSubmoduleKey === selectedSubmoduleKey ||
                    savingSubmoduleCommitDraftKey === selectedSubmoduleKey
                  }
                >
                  {committingSubmoduleKey === selectedSubmoduleKey ? "Committing..." : "Commit"}
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() =>
                    void onSyncSubmoduleRemote(
                      run.runId,
                      selectedSubmoduleGitState.pushAction === "publish" ? "publish" : "push",
                    )
                  }
                  disabled={
                    run.status !== "awaiting-review" ||
                    syncingSubmoduleKey === selectedSubmoduleKey ||
                    selectedSubmoduleGitState.reconcileRequired ||
                    !selectedSubmoduleCanSync
                  }
                >
                  {syncingSubmoduleKey === selectedSubmoduleKey ? "Syncing..." : selectedSubmoduleSyncLabel}
                </button>
              </div>
              <div className={styles.workHint}>
                {selectedSubmoduleGitState.reconcileRequired
                  ? (selectedSubmoduleGitState.reconcileReason ?? "This managed submodule needs reconciliation.")
                  : selectedSubmoduleGitState.hasDiff
                    ? "Submodule changes are still waiting to be committed."
                    : selectedSubmoduleGitState.pushAction === "publish"
                      ? "This submodule branch is ready to publish to origin."
                      : selectedSubmoduleGitState.pushAction === "push"
                        ? "This submodule branch has local commits ready to push."
                        : selectedSubmoduleNeedsAlignment
                          ? "Parent repos still need to align to the canonical submodule commit. Use Align parents to restage the shared pointer updates."
                          : "The submodule branch is currently up to date and aligned across parent repos."}
              </div>
            </>
          )}

          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionLabel}>Submodule diff</div>
              <div className={styles.sectionCaption}>Changes inside the selected managed submodule.</div>
            </div>
          </div>
          {selectedSubmoduleGitState.files.length > 0 ? (
            <div className={styles.diffList}>
              {selectedSubmoduleGitState.files.map((file) => {
                const expandedKey = `${selectedSubmoduleGitState.canonicalUrl}:${file.path}`;
                const expanded = expandedDiffPaths[expandedKey] ?? false;
                const diffStatusTone = getDiffStatusTone(file.status);
                return (
                  <div
                    key={`${selectedSubmoduleGitState.canonicalUrl}:${file.path}-${file.status}`}
                    className={`${styles.diffFileCard} ${diffStatusTone}`}
                  >
                    <button
                      type="button"
                      className={`${styles.diffFileButton} ${diffStatusTone}`}
                      onClick={() => onToggleExpandedDiff(expandedKey)}
                    >
                      <span className={`${styles.statusBadge} ${diffStatusTone}`}>{file.status}</span>
                      <span className={styles.diffFilePath}>
                        {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
                      </span>
                      <span className={styles.diffFileDelta}>{formatDiffDelta(file.additions, file.deletions)}</span>
                    </button>
                    {expanded ? (
                      <div className={styles.diffPatch}>
                        {file.patch.split(/\r?\n/u).map((line, index) => (
                          <div
                            key={`${selectedSubmoduleGitState.canonicalUrl}:${file.path}-${file.status}-${index}`}
                            className={`${styles.diffPatchLine} ${getDiffLineTone(line)}`}
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
          ) : (
            <div className={styles.emptyState}>No tracked diff remains in the selected managed submodule.</div>
          )}
        </>
      ) : loadingSubmoduleKey === selectedSubmoduleKey ? (
        <div className={styles.emptyState}>Loading managed submodule diff...</div>
      ) : gitError ? (
        <div className={styles.error}>{gitError}</div>
      ) : (
        <div className={styles.emptyState}>Managed submodule state is waiting to load.</div>
      )}
    </article>
  );
}
