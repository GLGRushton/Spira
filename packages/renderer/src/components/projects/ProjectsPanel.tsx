import type {
  ProjectRepoMappingsSnapshot,
  YouTrackProjectSummary,
  YouTrackStatusSummary,
  YouTrackTicketSummary,
} from "@spira/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigationStore } from "../../stores/navigation-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";
import { ProjectTypeahead } from "./ProjectTypeahead.js";
import { ProjectsMappingsList } from "./ProjectsMappingsList.js";
import styles from "./ProjectsPanel.module.css";
import { ProjectsRepoChecklist } from "./ProjectsRepoChecklist.js";
import { normalizeProjectKey } from "./project-utils.js";

const EMPTY_SNAPSHOT: ProjectRepoMappingsSnapshot = {
  workspaceRoot: null,
  repos: [],
  mappings: [],
};

const NEW_MAPPING_SENTINEL = "__new__";

const describeStatusTone = (status: YouTrackStatusSummary | null): string => {
  if (!status || status.state === "missing-config" || status.state === "disabled") {
    return styles.statusWarning;
  }

  if (status.state === "connected") {
    return styles.statusConnected;
  }

  return styles.statusError;
};

const describeStatusLabel = (status: YouTrackStatusSummary | null): string => {
  if (!status) {
    return "Checking";
  }

  switch (status.state) {
    case "connected":
      return "Connected";
    case "disabled":
      return "Disabled";
    case "missing-config":
      return "Needs setup";
    case "error":
      return "Error";
  }
};

const formatTicketUpdatedAt = (updatedAt: number | null): string =>
  updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : "Update time unavailable";

const formatStateList = (states: string[] | undefined): string =>
  states && states.length > 0 ? states.join(", ") : "None";

export function ProjectsPanel() {
  const youTrackEnabled = useSettingsStore((store) => store.youTrackEnabled);
  const setYouTrackEnabled = useSettingsStore((store) => store.setYouTrackEnabled);
  const setView = useNavigationStore((store) => store.setView);
  const [snapshot, setSnapshot] = useState<ProjectRepoMappingsSnapshot>(EMPTY_SNAPSHOT);
  const [youTrackStatus, setYouTrackStatus] = useState<YouTrackStatusSummary | null>(null);
  const [youTrackTickets, setYouTrackTickets] = useState<YouTrackTicketSummary[]>([]);
  const [workspaceRootDraft, setWorkspaceRootDraft] = useState("");
  const [projectKeyDraft, setProjectKeyDraft] = useState("");
  const [verifiedProject, setVerifiedProject] = useState<YouTrackProjectSummary | null>(null);
  const [selectedRepoPaths, setSelectedRepoPaths] = useState<string[]>([]);
  const [editingProjectKey, setEditingProjectKey] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isSavingMapping, setIsSavingMapping] = useState(false);
  const [isBrowsingWorkspace, setIsBrowsingWorkspace] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [mappingNotice, setMappingNotice] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    setWorkspaceError(null);
    setTicketError(null);

    const [snapshotResult, statusResult] = await Promise.allSettled([
      window.electronAPI.getProjectRepoMappings(),
      window.electronAPI.getYouTrackStatus(),
    ]);

    if (snapshotResult.status === "fulfilled") {
      setSnapshot(snapshotResult.value);
    } else {
      console.error("Failed to load project mappings", snapshotResult.reason);
      setWorkspaceError("Failed to load project mappings.");
    }

    if (statusResult.status === "fulfilled") {
      setYouTrackStatus(statusResult.value);
      if (statusResult.value.state === "connected") {
        try {
          setYouTrackTickets(await window.electronAPI.listYouTrackTickets(20));
        } catch (ticketsLoadError) {
          console.error("Failed to load assigned YouTrack tickets", ticketsLoadError);
          setYouTrackTickets([]);
          setTicketError("Failed to load assigned tickets.");
        }
      } else {
        setYouTrackTickets([]);
      }
    } else {
      console.error("Failed to load YouTrack status", statusResult.reason);
      setWorkspaceError((current) => current ?? "Failed to load YouTrack status.");
      setYouTrackTickets([]);
    }

    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    setWorkspaceRootDraft(snapshot.workspaceRoot ?? "");
  }, [snapshot.workspaceRoot]);

  useEffect(() => {
    setSelectedRepoPaths((current) =>
      current.filter((repoPath) => snapshot.repos.some((repo) => repo.relativePath === repoPath)),
    );
  }, [snapshot.repos]);

  const canSearchProjects = youTrackStatus?.state === "connected";
  const mappingBlocker = useMemo(() => {
    if (!youTrackStatus) {
      return "Checking YouTrack status...";
    }

    if (youTrackStatus.state !== "connected") {
      return `${youTrackStatus.message} Missions needs an active YouTrack connection before you can edit project mappings. Credentials stay in Settings.`;
    }

    if (!snapshot.workspaceRoot) {
      return "Choose a workspace folder before assigning repositories to projects.";
    }

    if (snapshot.repos.length === 0) {
      return "This workspace does not expose any git repositories yet.";
    }

    return null;
  }, [snapshot.repos.length, snapshot.workspaceRoot, youTrackStatus]);

  const canManageMappings = mappingBlocker === null;
  const mappedProjectKeySet = useMemo(
    () => new Set(snapshot.mappings.map((mapping) => normalizeProjectKey(mapping.projectKey))),
    [snapshot.mappings],
  );
  const sortedTickets = useMemo(
    () =>
      [...youTrackTickets].sort((left, right) => {
        const leftMapped = mappedProjectKeySet.has(normalizeProjectKey(left.projectKey)) ? 1 : 0;
        const rightMapped = mappedProjectKeySet.has(normalizeProjectKey(right.projectKey)) ? 1 : 0;
        if (leftMapped !== rightMapped) {
          return rightMapped - leftMapped;
        }

        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
      }),
    [mappedProjectKeySet, youTrackTickets],
  );
  const activeProjectKey =
    editingProjectKey === null
      ? null
      : editingProjectKey === NEW_MAPPING_SENTINEL
        ? normalizeProjectKey(projectKeyDraft)
        : editingProjectKey;
  const isEditorOpen = editingProjectKey !== null;
  const canSaveExistingMapping =
    editingProjectKey !== null &&
    editingProjectKey !== NEW_MAPPING_SENTINEL &&
    normalizeProjectKey(editingProjectKey) === normalizeProjectKey(projectKeyDraft);
  const isProjectVerified =
    verifiedProject !== null && normalizeProjectKey(verifiedProject.shortName) === normalizeProjectKey(projectKeyDraft);
  const canSaveMapping = isProjectVerified || canSaveExistingMapping;
  const setupSummary = snapshot.workspaceRoot
    ? `${snapshot.workspaceRoot} - ${snapshot.repos.length} repos discovered`
    : "No workspace selected yet.";

  const resetEditor = useCallback(() => {
    setEditingProjectKey(null);
    setProjectKeyDraft("");
    setVerifiedProject(null);
    setSelectedRepoPaths([]);
  }, []);

  const scrollEditorIntoView = useCallback(() => {
    window.setTimeout(() => {
      editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 0);
  }, []);

  const toggleRepoSelection = (repoRelativePath: string) => {
    setSelectedRepoPaths((current) =>
      current.includes(repoRelativePath)
        ? current.filter((entry) => entry !== repoRelativePath)
        : [...current, repoRelativePath].sort((left, right) => left.localeCompare(right)),
    );
  };

  const openNewMapping = () => {
    if (!canManageMappings) {
      setMappingError(mappingBlocker);
      return;
    }

    setEditingProjectKey(NEW_MAPPING_SENTINEL);
    setProjectKeyDraft("");
    setVerifiedProject(null);
    setSelectedRepoPaths([]);
    setMappingNotice(null);
    setMappingError(null);
    scrollEditorIntoView();
  };

  const editMapping = (projectKey: string) => {
    const mapping = snapshot.mappings.find((entry) => entry.projectKey === projectKey);
    setEditingProjectKey(projectKey);
    setProjectKeyDraft(projectKey);
    setVerifiedProject(null);
    setSelectedRepoPaths(mapping ? [...mapping.repoRelativePaths] : []);
    setMappingNotice(null);
    setMappingError(null);
    scrollEditorIntoView();
  };

  const browseForWorkspace = async () => {
    setIsBrowsingWorkspace(true);
    try {
      const selectedDirectory = await window.electronAPI.pickDirectory("Select workspace root");
      if (selectedDirectory) {
        setWorkspaceRootDraft(selectedDirectory);
      }
    } catch (browseError) {
      console.error("Failed to browse for a workspace root", browseError);
      setWorkspaceError("Failed to open the folder picker.");
    } finally {
      setIsBrowsingWorkspace(false);
    }
  };

  const saveWorkspaceRoot = async () => {
    setIsSavingWorkspace(true);
    setWorkspaceNotice(null);
    setWorkspaceError(null);
    try {
      const nextSnapshot = await window.electronAPI.setProjectWorkspaceRoot(
        workspaceRootDraft.trim() ? workspaceRootDraft : null,
      );
      setSnapshot(nextSnapshot);
      setWorkspaceNotice(nextSnapshot.workspaceRoot ? "Workspace updated." : "Workspace cleared.");
    } catch (saveError) {
      console.error("Failed to update workspace root", saveError);
      setWorkspaceError(saveError instanceof Error ? saveError.message : "Failed to update workspace root.");
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const saveMapping = async () => {
    if (!canManageMappings) {
      setMappingError(mappingBlocker);
      return;
    }

    const projectKey = normalizeProjectKey(projectKeyDraft);
    if (!projectKey) {
      setMappingError("Project key cannot be empty.");
      return;
    }

    if (!canSaveMapping) {
      setMappingError("Choose a verified YouTrack project before saving.");
      return;
    }

    setIsSavingMapping(true);
    setMappingNotice(null);
    setMappingError(null);
    try {
      const nextSnapshot = await window.electronAPI.setProjectRepoMapping(projectKey, selectedRepoPaths);
      setSnapshot(nextSnapshot);
      setMappingNotice(
        selectedRepoPaths.length > 0
          ? `Mapped ${selectedRepoPaths.length} repos to ${projectKey}.`
          : `Removed repo access for ${projectKey}.`,
      );
      resetEditor();
    } catch (saveError) {
      console.error("Failed to update project repo mapping", saveError);
      setMappingError(saveError instanceof Error ? saveError.message : "Failed to update project repo mapping.");
    } finally {
      setIsSavingMapping(false);
    }
  };

  const toggleYouTrackIntegration = () => {
    const nextEnabled = !youTrackEnabled;
    setYouTrackEnabled(nextEnabled);
    window.electronAPI.updateSettings({ youTrackEnabled: nextEnabled });
    window.setTimeout(() => {
      void refreshData();
    }, 0);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Missions</div>
          <h2 className={styles.title}>Ticket intake and scope</h2>
        </div>
        <div className={styles.headerActions}>
          <p className={styles.caption}>Keep native YouTrack intake, repo boundaries, and project scope in one room.</p>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Connection</div>
            <div className={styles.sectionCaption}>
              Missions owns the workflow now. Settings only keeps the YouTrack URL and token.
            </div>
          </div>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={youTrackEnabled ? styles.actionButton : styles.secondaryButton}
              onClick={toggleYouTrackIntegration}
              disabled={isRefreshing}
            >
              {youTrackEnabled ? "Disable intake" : "Enable intake"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => setView("settings")}>
              Open settings
            </button>
          </div>
        </div>
        <article className={`${styles.statusCard} ${describeStatusTone(youTrackStatus)}`}>
          <div className={styles.statusTopline}>
            <span className={styles.sectionLabel}>YouTrack</span>
            <span className={styles.statusBadge}>{describeStatusLabel(youTrackStatus)}</span>
          </div>
          <strong className={styles.statusTitle}>
            {youTrackStatus?.account
              ? (youTrackStatus.account.fullName ?? youTrackStatus.account.login)
              : "Mission intake"}
          </strong>
          <p className={styles.sectionCaption}>{youTrackStatus?.message ?? "Loading YouTrack status..."}</p>
          <div className={styles.statusFacts}>
            <div className={styles.statusFact}>
              <span className={styles.sectionLabel}>Native intake</span>
              <span className={styles.statusFactValue}>{youTrackEnabled ? "Enabled" : "Disabled"}</span>
            </div>
            <div className={styles.statusFact}>
              <span className={styles.sectionLabel}>Instance</span>
              <span className={styles.statusFactValue}>{youTrackStatus?.baseUrl ?? "Not configured"}</span>
            </div>
            <div className={styles.statusFact}>
              <span className={styles.sectionLabel}>To-do states</span>
              <span className={styles.statusFactValue}>{formatStateList(youTrackStatus?.stateMapping.todo)}</span>
            </div>
            <div className={styles.statusFact}>
              <span className={styles.sectionLabel}>In-progress states</span>
              <span className={styles.statusFactValue}>{formatStateList(youTrackStatus?.stateMapping.inProgress)}</span>
            </div>
          </div>
        </article>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Assigned work</div>
            <div className={styles.sectionCaption}>
              Tickets visible to the native intake appear here first, with mapping status beside them.
            </div>
          </div>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void refreshData()}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh workflow"}
          </button>
        </div>
        {youTrackStatus?.state !== "connected" ? (
          <div className={styles.blockedState}>
            Connect YouTrack and enable native intake here before Missions can show assigned work.
          </div>
        ) : ticketError ? (
          <div className={styles.error}>{ticketError}</div>
        ) : sortedTickets.length === 0 ? (
          <div className={styles.emptyState}>
            No assigned tickets are currently visible for the configured working states.
          </div>
        ) : (
          <div className={styles.workList}>
            {sortedTickets.map((ticket) => {
              const isMapped = mappedProjectKeySet.has(normalizeProjectKey(ticket.projectKey));
              return (
                <a key={ticket.id} className={styles.workCard} href={ticket.url} target="_blank" rel="noreferrer">
                  <div className={styles.workHeader}>
                    <div className={styles.workHeaderCopy}>
                      <span className={styles.ticketId}>{ticket.id}</span>
                      <strong>{ticket.summary}</strong>
                    </div>
                    <div className={styles.workBadges}>
                      <span className={styles.statusBadge}>{ticket.state ?? "Unknown state"}</span>
                      <span
                        className={`${styles.ticketScopeBadge} ${
                          isMapped ? styles.ticketScopeMapped : styles.ticketScopeUnmapped
                        }`}
                      >
                        {isMapped ? "Mapped scope" : "No repo mapping"}
                      </span>
                    </div>
                  </div>
                  <div className={styles.workMetaRow}>
                    <span className={styles.workMeta}>
                      {ticket.projectKey} - {ticket.projectName}
                    </span>
                    <span className={styles.workMeta}>
                      {ticket.assignee ?? "Unassigned"} - {formatTicketUpdatedAt(ticket.updatedAt)}
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Project scope</div>
            <div className={styles.sectionCaption}>
              Pick the workspace root and keep repo discovery inside the same workflow that consumes tickets.
            </div>
          </div>
        </div>
        <article className={styles.workspaceCard}>
          <div className={styles.sectionLabel}>Workspace</div>
          <div className={styles.sectionCaption}>
            Pick the parent folder that holds the repositories this room is allowed to map.
          </div>
          <label className={styles.field}>
            <span>Absolute path</span>
            <input
              className={styles.input}
              value={workspaceRootDraft}
              onChange={(event) => setWorkspaceRootDraft(event.target.value)}
              placeholder="C:\\Users\\username\\source\\repos"
            />
          </label>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void browseForWorkspace()}
              disabled={isBrowsingWorkspace || isSavingWorkspace}
            >
              {isBrowsingWorkspace ? "Browsing..." : "Browse"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setWorkspaceRootDraft("")}
              disabled={isSavingWorkspace}
            >
              Reset path
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => void saveWorkspaceRoot()}
              disabled={isSavingWorkspace}
            >
              {isSavingWorkspace ? "Saving..." : "Set workspace"}
            </button>
          </div>
          <div className={styles.activePath}>{setupSummary}</div>
          {workspaceNotice ? <div className={styles.notice}>{workspaceNotice}</div> : null}
          {workspaceError ? <div className={styles.error}>{workspaceError}</div> : null}
        </article>
      </section>

      <section ref={editorRef} className={`${styles.section} ${isEditorOpen ? styles.sectionEmphasis : ""}`}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Mapping editor</div>
            <div className={styles.sectionCaption}>
              Choose a verified YouTrack project and the repositories Spira may touch when that work arrives.
            </div>
          </div>
        </div>
        {mappingBlocker ? <div className={styles.blockedState}>{mappingBlocker}</div> : null}
        {!mappingBlocker && !isEditorOpen ? (
          <div className={styles.emptyState}>
            Pick a saved mapping below or start a new project mapping when you are ready.
          </div>
        ) : null}
        {!mappingBlocker && isEditorOpen ? (
          <>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="projects-typeahead-input">YouTrack project</label>
                <ProjectTypeahead
                  inputId="projects-typeahead-input"
                  value={projectKeyDraft}
                  canSearch={canSearchProjects}
                  disabled={isSavingMapping}
                  onChange={(value) => setProjectKeyDraft(value)}
                  onResolvedProjectChange={setVerifiedProject}
                />
              </div>
            </div>
            <ProjectsRepoChecklist
              repos={snapshot.repos}
              selectedRepoPaths={selectedRepoPaths}
              activeProjectKey={activeProjectKey ?? normalizeProjectKey(projectKeyDraft)}
              onToggleRepoSelection={toggleRepoSelection}
            />
            <div className={styles.editorFooter}>
              <div className={styles.selectionSummary}>
                {selectedRepoPaths.length} {selectedRepoPaths.length === 1 ? "repo" : "repos"} selected
              </div>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={resetEditor}
                  disabled={isSavingMapping}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => void saveMapping()}
                  disabled={isSavingMapping || !canSaveMapping}
                >
                  {isSavingMapping ? "Saving..." : "Save mapping"}
                </button>
              </div>
            </div>
            {mappingNotice ? <div className={styles.notice}>{mappingNotice}</div> : null}
            {mappingError ? <div className={styles.error}>{mappingError}</div> : null}
          </>
        ) : null}
      </section>

      <ProjectsMappingsList
        mappings={snapshot.mappings}
        activeProjectKey={activeProjectKey}
        canCreateMapping={canManageMappings}
        disabledReason={mappingBlocker}
        notice={!isEditorOpen ? mappingNotice : null}
        error={!isEditorOpen ? mappingError : null}
        onCreateMapping={openNewMapping}
        onEditMapping={editMapping}
      />
    </div>
  );
}
