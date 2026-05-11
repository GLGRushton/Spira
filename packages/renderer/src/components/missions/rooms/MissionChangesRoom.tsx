import type {
  TicketRunDiffFileSummary,
  TicketRunGitState,
  TicketRunSubmoduleGitState,
  TicketRunSummary,
} from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import type { MissionRunController } from "../useMissionRunController.js";
import styles from "./MissionChangesRoom.module.css";
import { countHunks, parsePatch, type PatchLine } from "./parse-patch.js";

interface MissionChangesRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

type FileSource = "repo" | "submodule";

interface FileSelection {
  source: FileSource;
  sourceId: string;
  path: string;
}

interface GroupSummary {
  kind: FileSource;
  id: string;
  title: string;
  branch: string;
  additions: number;
  deletions: number;
  files: TicketRunDiffFileSummary[];
  fileCount: number;
  hasDiff: boolean;
  reconcileReason: string | null;
  loaded: boolean;
  error: string | null;
}

function getDiffStatusClass(status: string): string {
  switch (status) {
    case "A":
      return styles.diffStatusAdded;
    case "D":
      return styles.diffStatusDeleted;
    default:
      return styles.diffStatusModified;
  }
}

function getPatchLineClass(kind: PatchLine["kind"]): string {
  switch (kind) {
    case "add":
      return styles.patchLineAdd;
    case "del":
      return styles.patchLineDel;
    case "hunk":
      return styles.patchLineHunk;
    case "meta":
      return styles.patchLineMeta;
    default:
      return styles.patchLineCtx;
  }
}

function patchLineGlyph(kind: PatchLine["kind"]): string {
  if (kind === "add") return "+";
  if (kind === "del") return "−";
  if (kind === "hunk") return "@";
  if (kind === "meta") return "·";
  return " ";
}

interface DeltaProps {
  additions: number | null;
  deletions: number | null;
  compact?: boolean;
}

function Delta({ additions, deletions, compact }: DeltaProps) {
  const add = additions ?? 0;
  const del = deletions ?? 0;
  const total = add + del || 1;
  const addRatio = add / total;
  return (
    <span className={styles.delta}>
      <span className={styles.deltaAdd}>+{add}</span>
      <span className={styles.deltaDel}>−{del}</span>
      {!compact && (add > 0 || del > 0) ? (
        <span className={styles.deltaBars} aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => {
            const filledAdds = Math.round(addRatio * 5);
            const filledTotal = 5;
            const barClass = i < filledAdds ? styles.deltaBarAdd : i < filledTotal ? styles.deltaBarDel : styles.deltaBarEmpty;
            return <span key={i} className={[styles.deltaBar, barClass].join(" ")} />;
          })}
        </span>
      ) : null}
    </span>
  );
}

function reviewRepoState(
  controller: MissionRunController,
  repoRelativePath: string,
): TicketRunGitState | null {
  return controller.gitStatesByRepo[repoRelativePath] ?? null;
}

function reviewSubmoduleState(
  controller: MissionRunController,
  canonicalUrl: string,
): TicketRunSubmoduleGitState | null {
  return controller.submoduleGitStatesByUrl[canonicalUrl] ?? null;
}

export function MissionChangesRoom({ run, controller }: MissionChangesRoomProps) {
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<FileSelection | null>(null);

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

  const groups: GroupSummary[] = useMemo(() => {
    const submoduleGroups: GroupSummary[] = displayedSubmoduleEntries.map((entry) => {
      const summaryState = entry.gitState;
      const fullState = reviewSubmoduleState(controller, entry.canonicalUrl);
      const submodule = run.submodules.find((candidate) => candidate.canonicalUrl === entry.canonicalUrl);
      const title = summaryState?.name ?? fullState?.name ?? submodule?.name ?? entry.canonicalUrl;
      const branch = summaryState?.branchName ?? fullState?.branchName ?? submodule?.branchName ?? "Managed submodule";
      return {
        kind: "submodule",
        id: entry.canonicalUrl,
        title,
        branch,
        additions: fullState?.files.reduce((sum, f) => sum + (f.additions ?? 0), 0) ?? 0,
        deletions: fullState?.files.reduce((sum, f) => sum + (f.deletions ?? 0), 0) ?? 0,
        files: fullState?.files ?? [],
        fileCount: fullState?.files.length ?? (summaryState?.hasDiff ? -1 : 0),
        hasDiff: summaryState?.hasDiff ?? false,
        reconcileReason: fullState?.reconcileRequired ? fullState?.reconcileReason ?? "Reconciliation required" : null,
        loaded: fullState !== null,
        error: entry.error ?? controller.submoduleGitErrorsByUrl[entry.canonicalUrl] ?? null,
      };
    });

    const repoGroups: GroupSummary[] = displayedRepoEntries.map((entry) => {
      const summaryState = entry.gitState;
      const fullState = reviewRepoState(controller, entry.repoRelativePath);
      const worktree = run.worktrees.find((candidate) => candidate.repoRelativePath === entry.repoRelativePath);
      const branch = worktree?.branchName ?? summaryState?.branchName ?? fullState?.branchName ?? "—";
      return {
        kind: "repo",
        id: entry.repoRelativePath,
        title: entry.repoRelativePath,
        branch,
        additions: fullState?.files.reduce((sum, f) => sum + (f.additions ?? 0), 0) ?? 0,
        deletions: fullState?.files.reduce((sum, f) => sum + (f.deletions ?? 0), 0) ?? 0,
        files: fullState?.files ?? [],
        fileCount: fullState?.files.length ?? (summaryState?.hasDiff ? -1 : 0),
        hasDiff: summaryState?.hasDiff ?? false,
        reconcileReason: null,
        loaded: fullState !== null,
        error: entry.error ?? controller.gitErrorsByRepo[entry.repoRelativePath] ?? null,
      };
    });

    return [...submoduleGroups, ...repoGroups];
  }, [
    controller,
    displayedRepoEntries,
    displayedSubmoduleEntries,
    run.submodules,
    run.worktrees,
  ]);

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    let files = 0;
    for (const group of groups) {
      additions += group.additions;
      deletions += group.deletions;
      files += group.files.length;
    }
    return { additions, deletions, files };
  }, [groups]);

  const normalizedFilter = filter.trim().toLowerCase();
  const filteredGroups = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        files:
          normalizedFilter.length === 0
            ? group.files
            : group.files.filter((file) => file.path.toLowerCase().includes(normalizedFilter)),
      })),
    [groups, normalizedFilter],
  );

  // Locate the currently-selected file (or null if it disappeared after a refresh).
  const selectedFile = useMemo(() => {
    if (selected === null) return null;
    const group = groups.find((candidate) => candidate.kind === selected.source && candidate.id === selected.sourceId);
    if (group === undefined) return null;
    const file = group.files.find((candidate) => candidate.path === selected.path);
    if (file === undefined) return null;
    return { group, file };
  }, [groups, selected]);

  // Auto-select the first available file if nothing is selected and one exists.
  useEffect(() => {
    if (selectedFile !== null) return;
    for (const group of groups) {
      const firstFile = group.files[0];
      if (firstFile !== undefined) {
        setSelected({ source: group.kind, sourceId: group.id, path: firstFile.path });
        return;
      }
    }
  }, [groups, selectedFile]);

  // Load the selected file's containing gitState if it's not yet loaded.
  useEffect(() => {
    if (selected === null) return;
    if (selected.source === "repo") {
      void ensureGitState(selected.sourceId);
    } else {
      void ensureSubmoduleGitState(selected.sourceId);
    }
  }, [selected, ensureGitState, ensureSubmoduleGitState]);

  const parsedSelectedPatch = useMemo(() => {
    if (selectedFile === null) return null;
    return parsePatch(selectedFile.file.patch);
  }, [selectedFile]);

  const isReviewLoaded = controller.reviewSnapshot !== null;

  return (
    <section className={styles.room}>
      <header className={styles.roomHeader}>
        <div className={styles.roomHeaderCopy}>
          <span className={styles.roomEyebrow}>Mission diff</span>
          <h2 className={styles.roomTitle}>Changes</h2>
          <p className={styles.roomCaption}>
            File tree on the left, focused diff on the right. Submodule changes appear once, framed by repos that depend on them.
          </p>
          <div className={styles.roomStats}>
            <span>{totals.files} file{totals.files === 1 ? "" : "s"}</span>
            <span className={styles.statAdd}>+{totals.additions}</span>
            <span className={styles.statDel}>−{totals.deletions}</span>
          </div>
        </div>
        <div className={styles.roomActions}>
          <button type="button" className={styles.secondaryButton} onClick={() => setShowAll((current) => !current)}>
            {showAll ? "Show changed only" : "Show all"}
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void controller.refreshReviewSnapshot()}
            disabled={controller.isReviewSnapshotLoading}
          >
            {controller.isReviewSnapshotLoading ? "Refreshing..." : "Refresh review"}
          </button>
        </div>
      </header>

      {controller.gitNotice ? <div className={styles.notice}>{controller.gitNotice}</div> : null}
      {controller.gitError ? <div className={styles.errorBanner}>{controller.gitError}</div> : null}

      <div className={styles.splitPane}>
        <aside className={styles.treePane}>
          <div className={styles.treeHeader}>
            <input
              type="search"
              value={filter}
              placeholder="Filter files"
              onChange={(event) => setFilter(event.target.value)}
              className={styles.filterInput}
              aria-label="Filter files by path"
            />
          </div>
          <div className={styles.treeBody}>
            {!isReviewLoaded ? (
              <div className={styles.emptyState}>
                {controller.isReviewSnapshotLoading ? "Loading mission diff…" : "Mission review is waiting to load."}
              </div>
            ) : groups.length === 0 ? (
              <div className={styles.emptyState}>
                {showAll
                  ? "No managed repos or submodules are attached to this mission."
                  : "No changed repos or submodules to show."}
              </div>
            ) : (
              filteredGroups.map((group) => (
                <div key={`${group.kind}:${group.id}`} className={styles.repoGroup}>
                  <div className={styles.repoHeader}>
                    {group.kind === "submodule" ? <span className={styles.repoBadge}>Sub</span> : null}
                    <div className={styles.repoHeaderCopy}>
                      <div
                        className={
                          group.kind === "submodule"
                            ? `${styles.repoHeaderTitle} ${styles.repoHeaderTitleBrand}`
                            : styles.repoHeaderTitle
                        }
                        title={group.title}
                      >
                        {group.title}
                      </div>
                      <div className={styles.repoHeaderSub}>{group.branch}</div>
                    </div>
                    {group.additions + group.deletions > 0 ? (
                      <Delta additions={group.additions} deletions={group.deletions} compact />
                    ) : (
                      <span className={styles.repoEmpty} style={{ padding: 0 }}>
                        clean
                      </span>
                    )}
                  </div>
                  {group.error ? <div className={styles.inlineError}>{group.error}</div> : null}
                  {group.reconcileReason ? <div className={styles.inlineError}>{group.reconcileReason}</div> : null}
                  {group.files.length === 0 ? (
                    !group.loaded && group.hasDiff ? (
                      <div className={styles.repoEmpty}>Loading…</div>
                    ) : group.hasDiff ? (
                      <div className={styles.repoEmpty}>Only git metadata or pointer changes.</div>
                    ) : (
                      <div className={styles.repoEmpty}>No tracked diff.</div>
                    )
                  ) : (
                    group.files.map((file) => {
                      const isSelected =
                        selected !== null &&
                        selected.source === group.kind &&
                        selected.sourceId === group.id &&
                        selected.path === file.path;
                      return (
                        <button
                          key={`${group.id}:${file.path}-${file.status}`}
                          type="button"
                          className={`${styles.fileRow} ${isSelected ? styles.fileRowSelected : ""}`}
                          onClick={() => setSelected({ source: group.kind, sourceId: group.id, path: file.path })}
                          title={file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                        >
                          <span className={`${styles.diffStatusChip} ${getDiffStatusClass(file.status)}`}>
                            {file.status}
                          </span>
                          <span className={styles.fileRowPath}>
                            {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
                          </span>
                          <Delta additions={file.additions} deletions={file.deletions} compact />
                        </button>
                      );
                    })
                  )}
                </div>
              ))
            )}
          </div>
        </aside>

        <div className={styles.viewerPane}>
          {selectedFile === null ? (
            <div className={styles.viewerEmpty}>
              {groups.length === 0
                ? "No diff to display."
                : "Select a file from the tree to view its diff."}
            </div>
          ) : (
            <>
              <div className={styles.viewerHeader}>
                <span className={`${styles.diffStatusChip} ${getDiffStatusClass(selectedFile.file.status)}`}>
                  {selectedFile.file.status}
                </span>
                <div className={styles.viewerHeaderCopy}>
                  <div className={styles.viewerHeaderPath} title={selectedFile.file.path}>
                    {selectedFile.file.previousPath
                      ? `${selectedFile.file.previousPath} → ${selectedFile.file.path}`
                      : selectedFile.file.path}
                  </div>
                  <div className={styles.viewerHeaderMeta}>
                    {selectedFile.group.title} · {countHunks(selectedFile.file.patch)} hunk
                    {countHunks(selectedFile.file.patch) === 1 ? "" : "s"}
                  </div>
                </div>
                <span className={styles.viewerHeaderSpacer} />
                <Delta additions={selectedFile.file.additions} deletions={selectedFile.file.deletions} />
              </div>
              <div className={styles.viewerBody}>
                {parsedSelectedPatch === null || parsedSelectedPatch.lines.length === 0 ? (
                  <div className={styles.viewerEmpty}>This file has no patch text to display.</div>
                ) : (
                  parsedSelectedPatch.lines.map((line, index) => (
                    <span
                      key={`${selectedFile.group.id}:${selectedFile.file.path}-${index}`}
                      className={`${styles.patchLine} ${getPatchLineClass(line.kind)}`}
                    >
                      <span className={styles.patchLineGutter}>{patchLineGlyph(line.kind)}</span>
                      <span className={styles.patchLineText}>{line.text || " "}</span>
                    </span>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
