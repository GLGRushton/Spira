import type {
  ProjectRepoMappingsSnapshot,
  TicketRunGitState,
  TicketRunSnapshot,
  TicketRunSummary,
  YouTrackProjectSummary,
  YouTrackStatusSummary,
  YouTrackTicketSummary,
} from "@spira/shared";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigationStore } from "../../stores/navigation-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";
import { useStationStore } from "../../stores/station-store.js";
import { ProjectTypeahead } from "./ProjectTypeahead.js";
import { ProjectsMappingsList } from "./ProjectsMappingsList.js";
import styles from "./ProjectsPanel.module.css";
import { ProjectsRepoChecklist } from "./ProjectsRepoChecklist.js";
import { type MissionLaneTabId, buildRunByTicketId, resolveRunTab, splitMissionCollections } from "./mission-utils.js";
import { normalizeProjectKey } from "./project-utils.js";

const EMPTY_SNAPSHOT: ProjectRepoMappingsSnapshot = {
  workspaceRoot: null,
  repos: [],
  mappings: [],
};

const EMPTY_RUN_SNAPSHOT: TicketRunSnapshot = {
  runs: [],
};

const NEW_MAPPING_SENTINEL = "__new__";
type MissionsTabId = "quarterdeck" | MissionLaneTabId;
type MissionSelection = { kind: "ticket"; ticketId: string } | { kind: "run"; runId: string };
const MISSIONS_TAB_ORDER: MissionsTabId[] = ["quarterdeck", "launch-bay", "flight-deck", "dry-dock"];

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

const formatDiffDelta = (additions: number | null, deletions: number | null): string => {
  if (additions === null && deletions === null) {
    return "Binary or metadata change";
  }
  return `+${additions ?? 0} / -${deletions ?? 0}`;
};

const getDiffStatusTone = (status: string): string => {
  switch (status) {
    case "A":
      return styles.diffStatusAdded;
    case "D":
      return styles.diffStatusDeleted;
    default:
      return styles.diffStatusModified;
  }
};

const getDiffLineTone = (line: string): string => {
  if (line.startsWith("@@")) {
    return styles.diffLineModified;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return styles.diffLineAdded;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return styles.diffLineDeleted;
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
    return styles.diffLineMeta;
  }
  return "";
};

const describeRunStatus = (run: TicketRunSummary): string => {
  switch (run.status) {
    case "starting":
      return "Starting";
    case "ready":
      return "Ready";
    case "blocked":
      return "Blocked";
    case "working":
      return "Working";
    case "awaiting-review":
      return "Awaiting review";
    case "error":
      return "Error";
    case "done":
      return "Done";
  }
};

const describeAttemptStatus = (status: TicketRunSummary["attempts"][number]["status"]): string => {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Needs review";
    case "cancelled":
      return "Cancelled";
  }
};

const describeMissionTab = (tabId: MissionLaneTabId): string => {
  switch (tabId) {
    case "launch-bay":
      return "Launch bay";
    case "flight-deck":
      return "Flight deck";
    case "dry-dock":
      return "Dry dock";
  }
};

const getTicketStartBlocker = (
  isMapped: boolean,
  repoCount: number,
  existingRun: TicketRunSummary | null,
): string | null => {
  if (existingRun) {
    return null;
  }

  if (!isMapped) {
    return "Map a repo first";
  }

  if (repoCount !== 1) {
    return "Single-repo only";
  }

  return null;
};

export function ProjectsPanel() {
  const youTrackEnabled = useSettingsStore((store) => store.youTrackEnabled);
  const setYouTrackEnabled = useSettingsStore((store) => store.setYouTrackEnabled);
  const setView = useNavigationStore((store) => store.setView);
  const setActiveStation = useStationStore((store) => store.setActiveStation);
  const stationMap = useStationStore((store) => store.stations);
  const [snapshot, setSnapshot] = useState<ProjectRepoMappingsSnapshot>(EMPTY_SNAPSHOT);
  const [youTrackStatus, setYouTrackStatus] = useState<YouTrackStatusSummary | null>(null);
  const [youTrackTickets, setYouTrackTickets] = useState<YouTrackTicketSummary[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<TicketRunSnapshot>(EMPTY_RUN_SNAPSHOT);
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
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [startingTicketId, setStartingTicketId] = useState<string | null>(null);
  const [syncingRunId, setSyncingRunId] = useState<string | null>(null);
  const [startingWorkRunId, setStartingWorkRunId] = useState<string | null>(null);
  const [continuingRunId, setContinuingRunId] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [completingRunId, setCompletingRunId] = useState<string | null>(null);
  const [loadingGitRunId, setLoadingGitRunId] = useState<string | null>(null);
  const [generatingCommitDraftRunId, setGeneratingCommitDraftRunId] = useState<string | null>(null);
  const [savingCommitDraftRunId, setSavingCommitDraftRunId] = useState<string | null>(null);
  const [committingGitRunId, setCommittingGitRunId] = useState<string | null>(null);
  const [syncingRemoteRunId, setSyncingRemoteRunId] = useState<string | null>(null);
  const [creatingPullRequestRunId, setCreatingPullRequestRunId] = useState<string | null>(null);
  const [selectedMission, setSelectedMission] = useState<MissionSelection | null>(null);
  const [continueDrafts, setContinueDrafts] = useState<Record<string, string>>({});
  const [commitDraft, setCommitDraft] = useState("");
  const [commitDraftDirty, setCommitDraftDirty] = useState(false);
  const [selectedGitState, setSelectedGitState] = useState<TicketRunGitState | null>(null);
  const [expandedDiffPaths, setExpandedDiffPaths] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<MissionsTabId>("quarterdeck");
  const editorRef = useRef<HTMLElement | null>(null);
  const tabButtonRefs = useRef(new Map<MissionsTabId, HTMLButtonElement>());
  const autoDraftedRunIdsRef = useRef(new Set<string>());

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    setWorkspaceError(null);
    setTicketError(null);
    setRunError(null);

    const [snapshotResult, statusResult, runsResult] = await Promise.allSettled([
      window.electronAPI.getProjectRepoMappings(),
      window.electronAPI.getYouTrackStatus(),
      window.electronAPI.getTicketRuns(),
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

    if (runsResult.status === "fulfilled") {
      setRunSnapshot(runsResult.value);
    } else {
      console.error("Failed to load ticket runs", runsResult.reason);
      setRunError("Failed to load existing ticket runs.");
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

  useEffect(() => {
    return window.electronAPI.onMessage((message) => {
      if (message.type === "missions:runs:updated") {
        setRunSnapshot(message.snapshot);
      }
    });
  }, []);

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
  const mappedRepoCountByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const repo of snapshot.repos) {
      for (const projectKey of repo.mappedProjectKeys) {
        const normalizedProjectKey = normalizeProjectKey(projectKey);
        counts.set(normalizedProjectKey, (counts.get(normalizedProjectKey) ?? 0) + 1);
      }
    }
    return counts;
  }, [snapshot.repos]);
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
  const ticketById = useMemo(() => new Map(sortedTickets.map((ticket) => [ticket.id, ticket])), [sortedTickets]);
  const sortedRuns = useMemo(
    () => [...runSnapshot.runs].sort((left, right) => right.updatedAt - left.updatedAt),
    [runSnapshot.runs],
  );
  const runByTicketId = useMemo(() => buildRunByTicketId(runSnapshot.runs), [runSnapshot.runs]);
  const { pendingTickets, activeRuns, completedRuns } = useMemo(
    () => splitMissionCollections(sortedTickets, sortedRuns),
    [sortedRuns, sortedTickets],
  );
  const missionTabs = useMemo(
    () => [
      {
        id: "quarterdeck" as const,
        label: "Quarterdeck",
        badge: "Cmd",
        accessibilityDetail: "Command lane",
      },
      {
        id: "launch-bay" as const,
        label: "Launch bay",
        badge: pendingTickets.length.toString(),
        accessibilityDetail: `${pendingTickets.length} pending`,
      },
      {
        id: "flight-deck" as const,
        label: "Flight deck",
        badge: activeRuns.length.toString(),
        accessibilityDetail: `${activeRuns.length} active`,
      },
      {
        id: "dry-dock" as const,
        label: "Dry dock",
        badge: completedRuns.length.toString(),
        accessibilityDetail: `${completedRuns.length} complete`,
      },
    ],
    [activeRuns.length, completedRuns.length, pendingTickets.length],
  );
  const selectedMissionRun = useMemo(
    () =>
      selectedMission?.kind === "run" ? (sortedRuns.find((run) => run.runId === selectedMission.runId) ?? null) : null,
    [selectedMission, sortedRuns],
  );
  const selectedMissionTicket = useMemo(() => {
    if (selectedMission?.kind === "ticket") {
      return ticketById.get(selectedMission.ticketId) ?? null;
    }

    if (selectedMission?.kind === "run" && selectedMissionRun) {
      return ticketById.get(selectedMissionRun.ticketId) ?? null;
    }

    return null;
  }, [selectedMission, selectedMissionRun, ticketById]);
  const selectedMissionProjectKey = selectedMissionRun?.projectKey ?? selectedMissionTicket?.projectKey ?? null;
  const selectedMissionIsMapped = selectedMissionProjectKey
    ? mappedProjectKeySet.has(normalizeProjectKey(selectedMissionProjectKey))
    : false;
  const selectedMissionRepoCount = selectedMissionProjectKey
    ? (mappedRepoCountByProject.get(normalizeProjectKey(selectedMissionProjectKey)) ?? 0)
    : 0;
  const selectedMissionBlocker = getTicketStartBlocker(
    selectedMissionIsMapped,
    selectedMissionRepoCount,
    selectedMissionRun,
  );
  const selectedMissionRunId = selectedMissionRun?.runId ?? null;
  const selectedMissionRunStatus = selectedMissionRun?.status ?? null;
  const selectedMissionRunCommitDraft = selectedMissionRun?.commitMessageDraft ?? null;
  const selectedMissionRunWorktreeCount = selectedMissionRun?.worktrees.length ?? 0;
  const selectedMissionLatestAttempt = selectedMissionRun?.attempts[selectedMissionRun.attempts.length - 1] ?? null;
  const selectedMissionStation = selectedMissionRun?.stationId ? stationMap[selectedMissionRun.stationId] : null;
  const selectedMissionUrl = selectedMissionTicket?.url ?? selectedMissionRun?.ticketUrl ?? null;
  const showPullRequestActions =
    selectedMissionRun?.status === "done" &&
    selectedGitState !== null &&
    !selectedGitState.hasDiff &&
    selectedGitState.pushAction === "none" &&
    selectedGitState.pullRequestUrls.open !== null &&
    selectedGitState.pullRequestUrls.draft !== null;
  const missionDetailBackLabel =
    activeTab === "quarterdeck" ? "Missions" : describeMissionTab(activeTab as MissionLaneTabId);
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

  const closeMissionDetail = useCallback(() => {
    setSelectedMission(null);
  }, []);

  const activateTab = useCallback((tabId: MissionsTabId) => {
    setSelectedMission(null);
    setRunNotice(null);
    setRunError(null);
    setActiveTab(tabId);
  }, []);

  const openTicketMissionDetail = useCallback((ticketId: string, tabId: MissionLaneTabId) => {
    setActiveTab(tabId);
    setSelectedMission({ kind: "ticket", ticketId });
  }, []);

  const openRunMissionDetail = useCallback(
    (runId: string, tabId?: MissionLaneTabId) => {
      const run = runSnapshot.runs.find((candidate) => candidate.runId === runId) ?? null;
      setActiveTab(tabId ?? (run ? resolveRunTab(run) : "flight-deck"));
      setSelectedMission({ kind: "run", runId });
    },
    [runSnapshot.runs],
  );

  const handleTabKeyDown = useCallback(
    (tabId: MissionsTabId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const currentIndex = MISSIONS_TAB_ORDER.indexOf(tabId);
      if (currentIndex < 0) {
        return;
      }

      let nextIndex: number | null = null;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (currentIndex + 1) % MISSIONS_TAB_ORDER.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (currentIndex - 1 + MISSIONS_TAB_ORDER.length) % MISSIONS_TAB_ORDER.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = MISSIONS_TAB_ORDER.length - 1;
          break;
        default:
          return;
      }

      event.preventDefault();
      const nextTab = MISSIONS_TAB_ORDER[nextIndex];
      activateTab(nextTab);
      window.setTimeout(() => {
        tabButtonRefs.current.get(nextTab)?.focus();
      }, 0);
    },
    [activateTab],
  );

  const focusRunStation = useCallback(
    (run: TicketRunSummary) => {
      if (!run.stationId) {
        return;
      }
      setActiveStation(run.stationId);
      setView("operations");
    },
    [setActiveStation, setView],
  );

  useEffect(() => {
    if (!selectedMission) {
      return;
    }

    if (selectedMission.kind === "run") {
      const run = sortedRuns.find((candidate) => candidate.runId === selectedMission.runId) ?? null;
      if (!run) {
        setSelectedMission(null);
        return;
      }

      const nextTab = resolveRunTab(run);
      setActiveTab((current) => (current === nextTab ? current : nextTab));
      return;
    }

    const promotedRun = runByTicketId.get(selectedMission.ticketId);
    if (promotedRun && resolveRunTab(promotedRun) !== "launch-bay") {
      setActiveTab(resolveRunTab(promotedRun));
      setSelectedMission({ kind: "run", runId: promotedRun.runId });
      return;
    }

    if (!sortedTickets.some((ticket) => ticket.id === selectedMission.ticketId)) {
      setSelectedMission(null);
    }
  }, [runByTicketId, selectedMission, sortedRuns, sortedTickets]);

  useEffect(() => {
    if (!selectedMissionRunId) {
      setSelectedGitState(null);
      setCommitDraft("");
      setCommitDraftDirty(false);
      setExpandedDiffPaths({});
      setGitNotice(null);
      setGitError(null);
      return;
    }

    setSelectedGitState(null);
    setExpandedDiffPaths({});
    setGitNotice(null);
    setGitError(null);
  }, [selectedMissionRunId]);

  useEffect(() => {
    if (!selectedMissionRunId) {
      return;
    }

    setCommitDraft(selectedMissionRunCommitDraft ?? "");
    setCommitDraftDirty(false);
  }, [selectedMissionRunCommitDraft, selectedMissionRunId]);

  useEffect(() => {
    if (!selectedMissionRunId || selectedMissionRunWorktreeCount === 0) {
      return;
    }

    const runId = selectedMissionRunId;
    let cancelled = false;
    const loadGitState = async () => {
      setLoadingGitRunId(runId);
      setGitError(null);
      try {
        const result = await window.electronAPI.getTicketRunGitState(runId);
        if (cancelled) {
          return;
        }
        setRunSnapshot(result.snapshot);
        setSelectedGitState(result.gitState);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load mission git state", error);
        setGitError(error instanceof Error ? error.message : "Failed to load mission git state.");
      } finally {
        if (!cancelled) {
          setLoadingGitRunId((current) => (current === runId ? null : current));
        }
      }
    };

    void loadGitState();
    return () => {
      cancelled = true;
    };
  }, [selectedMissionRunId, selectedMissionRunWorktreeCount]);

  const refreshMissionGitState = async (runId: string) => {
    setLoadingGitRunId(runId);
    setGitError(null);
    try {
      const result = await window.electronAPI.getTicketRunGitState(runId);
      setRunSnapshot(result.snapshot);
      setSelectedGitState(result.gitState);
    } catch (error) {
      console.error("Failed to refresh mission git state", error);
      setGitError(error instanceof Error ? error.message : "Failed to refresh mission git state.");
    } finally {
      setLoadingGitRunId(null);
    }
  };

  const generateCommitDraft = useCallback(async (runId: string) => {
    setGeneratingCommitDraftRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.generateTicketRunCommitDraft(runId);
      setRunSnapshot(result.snapshot);
      setSelectedGitState(result.gitState);
      setCommitDraft(result.run.commitMessageDraft ?? "");
      setCommitDraftDirty(false);
      setGitNotice(`${result.run.ticketId} commit draft refreshed.`);
    } catch (error) {
      console.error("Failed to generate mission commit draft", error);
      setGitError(error instanceof Error ? error.message : "Failed to generate the mission commit draft.");
    } finally {
      setGeneratingCommitDraftRunId(null);
    }
  }, []);

  useEffect(() => {
    if (!selectedMissionRunId || selectedMissionRunStatus !== "done" || selectedMissionRunCommitDraft) {
      return;
    }
    if (autoDraftedRunIdsRef.current.has(selectedMissionRunId)) {
      return;
    }
    autoDraftedRunIdsRef.current.add(selectedMissionRunId);
    void generateCommitDraft(selectedMissionRunId);
  }, [generateCommitDraft, selectedMissionRunCommitDraft, selectedMissionRunId, selectedMissionRunStatus]);

  const persistCommitDraft = async (runId: string) => {
    setSavingCommitDraftRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.setTicketRunCommitDraft(runId, commitDraft);
      setRunSnapshot(result.snapshot);
      setSelectedGitState(result.gitState);
      setCommitDraft(result.run.commitMessageDraft ?? "");
      setCommitDraftDirty(false);
    } catch (error) {
      console.error("Failed to save mission commit draft", error);
      setGitError(error instanceof Error ? error.message : "Failed to save the mission commit draft.");
    } finally {
      setSavingCommitDraftRunId(null);
    }
  };

  const commitMissionRun = async (runId: string) => {
    setCommittingGitRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.commitTicketRun(runId, commitDraft);
      setRunSnapshot(result.snapshot);
      setSelectedGitState(result.gitState);
      setCommitDraft("");
      setCommitDraftDirty(false);
      setGitNotice(`${result.run.ticketId} committed on ${result.gitState.branchName}.`);
    } catch (error) {
      console.error("Failed to commit mission run", error);
      setGitError(error instanceof Error ? error.message : "Failed to commit the mission worktree.");
    } finally {
      setCommittingGitRunId(null);
    }
  };

  const syncMissionRemote = async (runId: string, action: "publish" | "push") => {
    setSyncingRemoteRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result =
        action === "publish"
          ? await window.electronAPI.publishTicketRun(runId)
          : await window.electronAPI.pushTicketRun(runId);
      setRunSnapshot(result.snapshot);
      setSelectedGitState(result.gitState);
      setGitNotice(
        result.action === "publish"
          ? `${result.run.ticketId} published to origin/${result.gitState.branchName}.`
          : `${result.run.ticketId} pushed to origin/${result.gitState.branchName}.`,
      );
    } catch (error) {
      console.error("Failed to sync mission remote", error);
      setGitError(error instanceof Error ? error.message : "Failed to sync the mission branch.");
    } finally {
      setSyncingRemoteRunId(null);
    }
  };

  const openMissionPullRequest = async (runId: string) => {
    setCreatingPullRequestRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.createTicketRunPullRequest(runId);
      setRunSnapshot(result.snapshot);
      setSelectedGitState(result.gitState);
      await window.electronAPI.openExternal(result.pullRequestUrl);
      setGitNotice(`${result.run.ticketId} pull request opened.`);
    } catch (error) {
      console.error("Failed to open mission pull request", error);
      setGitError(error instanceof Error ? error.message : "Failed to open the mission pull request.");
    } finally {
      setCreatingPullRequestRunId(null);
    }
  };

  const startTicketRun = async (ticket: YouTrackTicketSummary) => {
    setStartingTicketId(ticket.id);
    setRunNotice(null);
    setRunError(null);
    try {
      const result = await window.electronAPI.startTicketRun({
        ticketId: ticket.id,
        ticketSummary: ticket.summary,
        ticketUrl: ticket.url,
        projectKey: ticket.projectKey,
      });
      setRunSnapshot(result.snapshot);
      openRunMissionDetail(result.run.runId, resolveRunTab(result.run));
      if (result.run.status === "error" || result.run.status === "blocked") {
        setRunError(result.run.statusMessage ?? `Missions could not fully start ${ticket.id}.`);
      } else {
        setRunNotice(
          result.reusedExistingRun
            ? `${ticket.id} already had a managed run, so Missions reused it.`
            : `${ticket.id} is now active in a managed worktree.`,
        );
      }
    } catch (startError) {
      console.error("Failed to start ticket run", startError);
      setRunError(startError instanceof Error ? startError.message : "Failed to start the ticket run.");
    } finally {
      setStartingTicketId(null);
    }
  };

  const retryTicketRunSync = async (runId: string) => {
    setSyncingRunId(runId);
    setRunNotice(null);
    setRunError(null);
    try {
      const result = await window.electronAPI.retryTicketRunSync(runId);
      setRunSnapshot(result.snapshot);
      openRunMissionDetail(result.run.runId, resolveRunTab(result.run));
      if (result.run.status === "blocked") {
        setRunError(result.run.statusMessage ?? `Missions still could not sync ${result.run.ticketId}.`);
      } else {
        setRunNotice(`${result.run.ticketId} is now synced with YouTrack.`);
      }
    } catch (syncError) {
      console.error("Failed to retry ticket run sync", syncError);
      setRunError(syncError instanceof Error ? syncError.message : "Failed to retry the ticket state sync.");
    } finally {
      setSyncingRunId(null);
    }
  };

  const startRunWork = async (runId: string) => {
    setStartingWorkRunId(runId);
    setRunNotice(null);
    setRunError(null);
    try {
      const result = await window.electronAPI.startTicketRunWork(runId);
      setRunSnapshot(result.snapshot);
      openRunMissionDetail(result.run.runId, resolveRunTab(result.run));
      setRunNotice(`${result.run.ticketId} is now actively working.`);
    } catch (startError) {
      console.error("Failed to start mission work", startError);
      setRunError(startError instanceof Error ? startError.message : "Failed to start mission work.");
    } finally {
      setStartingWorkRunId(null);
    }
  };

  const continueRunWork = async (runId: string) => {
    setContinuingRunId(runId);
    setRunNotice(null);
    setRunError(null);
    try {
      const result = await window.electronAPI.continueTicketRunWork(runId, continueDrafts[runId]?.trim() || undefined);
      setRunSnapshot(result.snapshot);
      openRunMissionDetail(result.run.runId, resolveRunTab(result.run));
      setContinueDrafts((current) => ({ ...current, [runId]: "" }));
      setRunNotice(
        result.reusedLiveAttempt
          ? `${result.run.ticketId} resumed in its existing mission station.`
          : `${result.run.ticketId} started a fresh follow-up pass.`,
      );
    } catch (continueError) {
      console.error("Failed to continue mission work", continueError);
      setRunError(continueError instanceof Error ? continueError.message : "Failed to continue mission work.");
    } finally {
      setContinuingRunId(null);
    }
  };

  const cancelRunWork = async (runId: string) => {
    setCancellingRunId(runId);
    setRunNotice(null);
    setRunError(null);
    try {
      const result = await window.electronAPI.cancelTicketRunWork(runId);
      setRunSnapshot(result.snapshot);
      openRunMissionDetail(result.run.runId, resolveRunTab(result.run));
      setRunNotice(`${result.run.ticketId} stopped its active pass and is ready for review.`);
    } catch (cancelError) {
      console.error("Failed to cancel mission work", cancelError);
      setRunError(cancelError instanceof Error ? cancelError.message : "Failed to cancel mission work.");
    } finally {
      setCancellingRunId(null);
    }
  };

  const completeRun = async (runId: string) => {
    setCompletingRunId(runId);
    setRunNotice(null);
    setRunError(null);
    try {
      const result = await window.electronAPI.completeTicketRun(runId);
      setRunSnapshot(result.snapshot);
      setActiveTab("dry-dock");
      setSelectedMission({ kind: "run", runId: result.run.runId });
      setRunNotice(`${result.run.ticketId} was marked complete.`);
    } catch (completeError) {
      console.error("Failed to complete mission", completeError);
      setRunError(completeError instanceof Error ? completeError.message : "Failed to complete the mission.");
    } finally {
      setCompletingRunId(null);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.topRail}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Missions</div>
            <h2 className={styles.title}>Mission control</h2>
          </div>
          <div className={styles.headerActions}>
            <p className={styles.caption}>Split intake, live missions, and command setup into cleaner lanes.</p>
          </div>
        </div>

        <div className={styles.tabBar} role="tablist" aria-label="Mission lanes">
          {missionTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                id={`missions-tab-${tab.id}`}
                ref={(element) => {
                  if (element) {
                    tabButtonRefs.current.set(tab.id, element);
                    return;
                  }
                  tabButtonRefs.current.delete(tab.id);
                }}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={`missions-panel-${tab.id}`}
                aria-label={`${tab.label}, ${tab.accessibilityDetail}`}
                tabIndex={isActive ? 0 : -1}
                className={`${styles.tabButton} ${isActive ? styles.tabButtonActive : ""}`}
                onClick={() => activateTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(tab.id, event)}
              >
                <span className={styles.tabLabel}>{tab.label}</span>
                <span className={styles.tabBadge}>{tab.badge}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.scrollBody}>
        {selectedMission ? (
          <section className={`${styles.section} ${styles.detailPage}`}>
            <div className={styles.detailTopline}>
              <button type="button" className={styles.secondaryButton} onClick={closeMissionDetail}>
                {`< Back to ${missionDetailBackLabel}`}
              </button>
              <div className={styles.detailLinks}>
                {selectedMissionUrl ? (
                  <a className={styles.inlineLink} href={selectedMissionUrl} target="_blank" rel="noreferrer">
                    Open in YouTrack
                  </a>
                ) : null}
                {selectedMissionRun?.stationId ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => focusRunStation(selectedMissionRun)}
                  >
                    Open station
                  </button>
                ) : null}
              </div>
            </div>

            <article className={styles.detailCard}>
              <div className={styles.detailHeader}>
                <div className={styles.detailHeaderCopy}>
                  <div className={styles.sectionLabel}>
                    {activeTab === "quarterdeck" ? "Mission" : missionDetailBackLabel}
                  </div>
                  <div className={styles.detailTitleRow}>
                    <span className={styles.ticketId}>
                      {selectedMissionRun?.ticketId ?? selectedMissionTicket?.id ?? "Mission"}
                    </span>
                    <h3 className={styles.detailTitle}>
                      {selectedMissionRun?.ticketSummary ?? selectedMissionTicket?.summary ?? "Mission detail"}
                    </h3>
                  </div>
                </div>
                <div className={styles.workBadges}>
                  {selectedMissionTicket?.state ? (
                    <span className={styles.statusBadge}>{selectedMissionTicket.state}</span>
                  ) : null}
                  {selectedMissionProjectKey ? (
                    <span
                      className={`${styles.ticketScopeBadge} ${
                        selectedMissionIsMapped ? styles.ticketScopeMapped : styles.ticketScopeUnmapped
                      }`}
                    >
                      {selectedMissionIsMapped ? "Mapped scope" : "No repo mapping"}
                    </span>
                  ) : null}
                  {selectedMissionRun ? (
                    <span className={styles.statusBadge}>{describeRunStatus(selectedMissionRun)}</span>
                  ) : null}
                </div>
              </div>

              {runNotice || runError ? (
                <>
                  {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
                  {runError ? <div className={styles.error}>{runError}</div> : null}
                </>
              ) : null}

              <div className={styles.statusFacts}>
                <div className={styles.statusFact}>
                  <span className={styles.sectionLabel}>Project</span>
                  <span className={styles.statusFactValue}>
                    {selectedMissionProjectKey ?? "Unknown project"}
                    {selectedMissionTicket?.projectName ? ` - ${selectedMissionTicket.projectName}` : ""}
                  </span>
                </div>
                <div className={styles.statusFact}>
                  <span className={styles.sectionLabel}>Updated</span>
                  <span className={styles.statusFactValue}>
                    {selectedMissionRun
                      ? new Date(selectedMissionRun.updatedAt).toLocaleString()
                      : selectedMissionTicket?.updatedAt
                        ? new Date(selectedMissionTicket.updatedAt).toLocaleString()
                        : "Unavailable"}
                  </span>
                </div>
                <div className={styles.statusFact}>
                  <span className={styles.sectionLabel}>Assignee</span>
                  <span className={styles.statusFactValue}>{selectedMissionTicket?.assignee ?? "Unassigned"}</span>
                </div>
                <div className={styles.statusFact}>
                  <span className={styles.sectionLabel}>Repo scope</span>
                  <span className={styles.statusFactValue}>
                    {selectedMissionRun
                      ? `${selectedMissionRun.worktrees.length} worktree${selectedMissionRun.worktrees.length === 1 ? "" : "s"}`
                      : `${selectedMissionRepoCount} mapped repo${selectedMissionRepoCount === 1 ? "" : "s"}`}
                  </span>
                </div>
                {selectedMissionRun?.stationId ? (
                  <div className={styles.statusFact}>
                    <span className={styles.sectionLabel}>Station</span>
                    <span className={styles.statusFactValue}>
                      {selectedMissionStation?.label ?? selectedMissionRun.stationId}
                      {selectedMissionStation ? ` - ${selectedMissionStation.state}` : ""}
                    </span>
                  </div>
                ) : null}
              </div>

              {selectedMissionRun?.statusMessage ? (
                <div className={styles.workHint}>{selectedMissionRun.statusMessage}</div>
              ) : null}
              {!selectedMissionRun && selectedMissionBlocker ? (
                <div className={styles.workHint}>{selectedMissionBlocker}</div>
              ) : null}

              {!selectedMissionRun && selectedMissionTicket ? (
                <div className={styles.workActions}>
                  <span className={styles.workMeta}>
                    {selectedMissionBlocker ?? "This ticket is ready for Missions to pick up."}
                  </span>
                  <button
                    type="button"
                    className={selectedMissionBlocker ? styles.secondaryButton : styles.actionButton}
                    onClick={() => void startTicketRun(selectedMissionTicket)}
                    disabled={Boolean(selectedMissionBlocker) || startingTicketId === selectedMissionTicket.id}
                  >
                    {startingTicketId === selectedMissionTicket.id ? "Starting..." : "Pick up ticket"}
                  </button>
                </div>
              ) : null}

              {selectedMissionRun?.status === "error" && selectedMissionTicket ? (
                <div className={styles.workActions}>
                  <span className={styles.workMeta}>The previous pickup failed. Missions can retry from here.</span>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => void startTicketRun(selectedMissionTicket)}
                    disabled={startingTicketId === selectedMissionTicket.id}
                  >
                    {startingTicketId === selectedMissionTicket.id ? "Starting..." : "Retry pickup"}
                  </button>
                </div>
              ) : null}

              {selectedMissionRun?.status === "blocked" ? (
                <div className={styles.workActions}>
                  <span className={styles.workMeta}>YouTrack state sync is retryable.</span>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => void retryTicketRunSync(selectedMissionRun.runId)}
                    disabled={syncingRunId === selectedMissionRun.runId}
                  >
                    {syncingRunId === selectedMissionRun.runId ? "Syncing..." : "Retry state sync"}
                  </button>
                </div>
              ) : null}

              {selectedMissionRun?.status === "ready" ? (
                <div className={styles.workActions}>
                  <span className={styles.workMeta}>The worktree is prepared. Spira has not started coding yet.</span>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => void startRunWork(selectedMissionRun.runId)}
                    disabled={startingWorkRunId === selectedMissionRun.runId}
                  >
                    {startingWorkRunId === selectedMissionRun.runId ? "Starting work..." : "Start work"}
                  </button>
                </div>
              ) : null}

              {selectedMissionRun?.status === "working" ? (
                <div className={styles.workActions}>
                  <span className={styles.workMeta}>
                    {selectedMissionLatestAttempt
                      ? `Attempt ${selectedMissionLatestAttempt.sequence} is active.`
                      : "Mission pass is active."}
                  </span>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void cancelRunWork(selectedMissionRun.runId)}
                    disabled={cancellingRunId === selectedMissionRun.runId}
                  >
                    {cancellingRunId === selectedMissionRun.runId ? "Cancelling..." : "Cancel pass"}
                  </button>
                </div>
              ) : null}

              {selectedMissionRun?.status === "awaiting-review" ? (
                <div className={styles.reviewPanel}>
                  <label className={styles.field}>
                    <span>Next prompt</span>
                    <textarea
                      className={`${styles.input} ${styles.textarea}`}
                      value={continueDrafts[selectedMissionRun.runId] ?? ""}
                      onChange={(event) =>
                        setContinueDrafts((current) => ({ ...current, [selectedMissionRun.runId]: event.target.value }))
                      }
                      placeholder="Tighten anything you want on the next pass."
                    />
                  </label>
                  <div className={styles.inlineActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => void continueRunWork(selectedMissionRun.runId)}
                      disabled={continuingRunId === selectedMissionRun.runId}
                    >
                      {continuingRunId === selectedMissionRun.runId ? "Continuing..." : "Continue work"}
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => void completeRun(selectedMissionRun.runId)}
                      disabled={completingRunId === selectedMissionRun.runId}
                    >
                      {completingRunId === selectedMissionRun.runId ? "Completing..." : "Mark complete"}
                    </button>
                  </div>
                </div>
              ) : null}

              {selectedMissionRun?.status === "done" ? (
                <div className={styles.reviewPanel}>
                  {gitNotice ? <div className={styles.notice}>{gitNotice}</div> : null}
                  {gitError ? <div className={styles.error}>{gitError}</div> : null}
                  {showPullRequestActions ? (
                    <>
                      <div className={styles.sectionLabel}>Pull request</div>
                      <div className={styles.inlineActions}>
                        <button
                          type="button"
                          className={styles.actionLinkButton}
                          onClick={() => void openMissionPullRequest(selectedMissionRun.runId)}
                          disabled={creatingPullRequestRunId === selectedMissionRun.runId}
                        >
                          {creatingPullRequestRunId === selectedMissionRun.runId ? "Opening PR..." : "Open PR"}
                        </button>
                        <a
                          className={styles.secondaryLinkButton}
                          href={selectedGitState.pullRequestUrls.draft ?? "#"}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open draft PR
                        </a>
                      </div>
                      <div className={styles.workHint}>
                        Everything in this mission has reached the remote branch. Open the pull request when you are
                        ready to send it up the chain.
                      </div>
                    </>
                  ) : (
                    <>
                      <label className={styles.field}>
                        <span>Commit draft</span>
                        <textarea
                          className={`${styles.input} ${styles.textarea}`}
                          value={commitDraft}
                          disabled={savingCommitDraftRunId === selectedMissionRun.runId}
                          onChange={(event) => {
                            setCommitDraft(event.target.value);
                            setCommitDraftDirty(true);
                          }}
                          onBlur={() => {
                            if (commitDraftDirty) {
                              void persistCommitDraft(selectedMissionRun.runId);
                            }
                          }}
                          placeholder={`feat(${selectedMissionRun.ticketId}): summary`}
                        />
                      </label>
                      <div className={styles.inlineActions}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void generateCommitDraft(selectedMissionRun.runId)}
                          disabled={
                            generatingCommitDraftRunId === selectedMissionRun.runId ||
                            savingCommitDraftRunId === selectedMissionRun.runId
                          }
                        >
                          {generatingCommitDraftRunId === selectedMissionRun.runId ? "Regenerating..." : "Regenerate"}
                        </button>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => void commitMissionRun(selectedMissionRun.runId)}
                          disabled={
                            !commitDraft.trim() ||
                            (selectedGitState !== null && !selectedGitState.hasDiff) ||
                            committingGitRunId === selectedMissionRun.runId ||
                            savingCommitDraftRunId === selectedMissionRun.runId
                          }
                        >
                          {committingGitRunId === selectedMissionRun.runId ? "Committing..." : "Commit"}
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() =>
                            void syncMissionRemote(
                              selectedMissionRun.runId,
                              selectedGitState?.pushAction === "publish" ? "publish" : "push",
                            )
                          }
                          disabled={
                            syncingRemoteRunId === selectedMissionRun.runId ||
                            !selectedGitState ||
                            selectedGitState.pushAction === "none"
                          }
                        >
                          {syncingRemoteRunId === selectedMissionRun.runId
                            ? "Syncing..."
                            : selectedGitState?.pushAction === "publish"
                              ? "Publish"
                              : "Push"}
                        </button>
                      </div>
                      <div className={styles.workHint}>
                        {selectedGitState?.hasDiff
                          ? "Tracked changes are still waiting to be committed."
                          : selectedGitState?.pushAction === "publish"
                            ? "This branch is ready to publish to origin."
                            : selectedGitState?.pushAction === "push"
                              ? "This branch has local commits ready to push."
                              : "The branch is currently up to date."}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
            </article>

            {selectedMissionRun?.attempts.length ? (
              <article className={styles.detailCard}>
                <div className={styles.sectionLabel}>Mission attempts</div>
                <div className={styles.attemptList}>
                  {[...selectedMissionRun.attempts].reverse().map((attempt) => (
                    <div key={attempt.attemptId} className={styles.attemptCard}>
                      <div className={styles.workHeader}>
                        <strong>Attempt {attempt.sequence}</strong>
                        <span className={styles.statusBadge}>{describeAttemptStatus(attempt.status)}</span>
                      </div>
                      {attempt.prompt ? <div className={styles.workHint}>Prompt: {attempt.prompt}</div> : null}
                      {attempt.summary ? <div className={styles.workHint}>{attempt.summary}</div> : null}
                    </div>
                  ))}
                </div>
              </article>
            ) : null}

            {selectedMissionRun?.worktrees.length ? (
              <article className={styles.detailCard}>
                <div className={styles.sectionLabel}>Managed worktrees</div>
                <div className={styles.runWorktrees}>
                  {selectedMissionRun.worktrees.map((worktree) => (
                    <div
                      key={`${selectedMissionRun.runId}-${worktree.repoRelativePath}`}
                      className={styles.runWorktree}
                    >
                      <strong>{worktree.repoRelativePath}</strong>
                      <span>{worktree.branchName}</span>
                      <span>{worktree.worktreePath}</span>
                    </div>
                  ))}
                </div>
              </article>
            ) : null}

            {selectedMissionRun?.worktrees.length ? (
              <article className={styles.detailCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionLabel}>Worktree diff</div>
                    <div className={styles.sectionCaption}>
                      Tracked worktree changes only. Untracked files stay out of the theatre.
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void refreshMissionGitState(selectedMissionRun.runId)}
                    disabled={loadingGitRunId === selectedMissionRun.runId}
                  >
                    {loadingGitRunId === selectedMissionRun.runId ? "Refreshing..." : "Refresh diff"}
                  </button>
                </div>
                {selectedGitState ? (
                  selectedGitState.files.length > 0 ? (
                    <div className={styles.diffList}>
                      {selectedGitState.files.map((file) => {
                        const expanded = expandedDiffPaths[file.path] ?? false;
                        const diffStatusTone = getDiffStatusTone(file.status);
                        return (
                          <div
                            key={`${file.path}-${file.status}`}
                            className={`${styles.diffFileCard} ${diffStatusTone}`}
                          >
                            <button
                              type="button"
                              className={`${styles.diffFileButton} ${diffStatusTone}`}
                              onClick={() =>
                                setExpandedDiffPaths((current) => ({ ...current, [file.path]: !expanded }))
                              }
                            >
                              <span className={`${styles.statusBadge} ${diffStatusTone}`}>{file.status}</span>
                              <span className={styles.diffFilePath}>
                                {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
                              </span>
                              <span className={styles.diffFileDelta}>
                                {formatDiffDelta(file.additions, file.deletions)}
                              </span>
                            </button>
                            {expanded ? (
                              <div className={styles.diffPatch}>
                                {file.patch.split(/\r?\n/u).map((line, index) => (
                                  <div
                                    key={`${file.path}-${file.status}-${index}`}
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
                    <div className={styles.emptyState}>No tracked diff remains in this managed worktree.</div>
                  )
                ) : loadingGitRunId === selectedMissionRun.runId ? (
                  <div className={styles.emptyState}>Loading mission diff…</div>
                ) : gitError ? (
                  <div className={styles.error}>{gitError}</div>
                ) : (
                  <div className={styles.emptyState}>Mission diff is waiting to load.</div>
                )}
              </article>
            ) : null}
          </section>
        ) : null}

        <div
          id="missions-panel-quarterdeck"
          role="tabpanel"
          aria-labelledby="missions-tab-quarterdeck"
          className={styles.tabPanel}
          hidden={activeTab !== "quarterdeck" || selectedMission !== null}
        >
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
                  <span className={styles.statusFactValue}>
                    {formatStateList(youTrackStatus?.stateMapping.inProgress)}
                  </span>
                </div>
              </div>
            </article>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <div className={styles.sectionLabel}>Project scope</div>
                <div className={styles.sectionCaption}>
                  Pick the workspace root and keep repo discovery inside the same workflow that consumes tickets.
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

        <section
          id="missions-panel-launch-bay"
          role="tabpanel"
          aria-labelledby="missions-tab-launch-bay"
          className={styles.section}
          hidden={activeTab !== "launch-bay" || selectedMission !== null}
        >
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionLabel}>Pending pickup</div>
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
          {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
          {runError ? <div className={styles.error}>{runError}</div> : null}
          {youTrackStatus?.state !== "connected" ? (
            <div className={styles.blockedState}>
              Connect YouTrack and enable native intake here before Missions can show assigned work.
            </div>
          ) : ticketError ? (
            <div className={styles.error}>{ticketError}</div>
          ) : pendingTickets.length === 0 ? (
            <div className={styles.emptyState}>
              No tickets are waiting for pickup. Active missions have moved to the flight deck and completed work rests
              in dry dock.
            </div>
          ) : (
            <div className={styles.workList}>
              {pendingTickets.map((ticket) => {
                const isMapped = mappedProjectKeySet.has(normalizeProjectKey(ticket.projectKey));
                const repoCount = mappedRepoCountByProject.get(normalizeProjectKey(ticket.projectKey)) ?? 0;
                const existingRun = runByTicketId.get(ticket.id) ?? null;
                const startBlockedReason = getTicketStartBlocker(isMapped, repoCount, existingRun);
                const primaryWorktree = existingRun?.worktrees[0] ?? null;
                return (
                  <article key={ticket.id} className={styles.workCard}>
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
                        {existingRun ? (
                          <span className={styles.statusBadge}>{describeRunStatus(existingRun)}</span>
                        ) : null}
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
                    <div className={styles.workActions}>
                      <div className={styles.detailLinks}>
                        <a className={styles.inlineLink} href={ticket.url} target="_blank" rel="noreferrer">
                          Open in YouTrack
                        </a>
                      </div>
                      <div className={styles.detailLinks}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() =>
                            existingRun
                              ? openRunMissionDetail(existingRun.runId, "launch-bay")
                              : openTicketMissionDetail(ticket.id, "launch-bay")
                          }
                        >
                          Mission details
                        </button>
                        <button
                          type="button"
                          className={existingRun || startBlockedReason ? styles.secondaryButton : styles.actionButton}
                          onClick={() => void startTicketRun(ticket)}
                          disabled={Boolean(startBlockedReason) || startingTicketId === ticket.id}
                        >
                          {startingTicketId === ticket.id
                            ? "Starting..."
                            : existingRun?.status === "error"
                              ? "Retry pickup"
                              : "Pick up ticket"}
                        </button>
                      </div>
                    </div>
                    {existingRun?.statusMessage ? (
                      <div className={styles.workHint}>{existingRun.statusMessage}</div>
                    ) : null}
                    {primaryWorktree ? (
                      <div className={styles.inlineRunFacts}>
                        <span className={styles.inlineRunFact}>
                          <strong>Branch</strong> {primaryWorktree.branchName}
                        </span>
                        <span className={styles.inlineRunFact}>
                          <strong>Worktree</strong> {primaryWorktree.worktreePath}
                        </span>
                      </div>
                    ) : null}
                    {startBlockedReason ? <div className={styles.workHint}>{startBlockedReason}</div> : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section
          id="missions-panel-flight-deck"
          role="tabpanel"
          aria-labelledby="missions-tab-flight-deck"
          className={styles.section}
          hidden={activeTab !== "flight-deck" || selectedMission !== null}
        >
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionLabel}>Active runs</div>
              <div className={styles.sectionCaption}>
                Managed worktrees stay visible here so you can see what Missions has already claimed.
              </div>
            </div>
          </div>
          {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
          {runError ? <div className={styles.error}>{runError}</div> : null}
          {activeRuns.length === 0 ? (
            <div className={styles.emptyState}>No active ticket runs are on the flight deck yet.</div>
          ) : (
            <div className={styles.runList}>
              {activeRuns.map((run) => {
                const latestAttempt = run.attempts[run.attempts.length - 1] ?? null;
                const boundStation = run.stationId ? stationMap[run.stationId] : null;
                const detailLabel =
                  run.status === "awaiting-review"
                    ? "Review mission"
                    : run.status === "starting"
                      ? "View starting run"
                      : "Mission details";
                return (
                  <article key={run.runId} className={styles.runCard}>
                    <div className={styles.workHeader}>
                      <div className={styles.workHeaderCopy}>
                        <span className={styles.ticketId}>{run.ticketId}</span>
                        <strong>{run.ticketSummary}</strong>
                      </div>
                      <span className={styles.statusBadge}>{describeRunStatus(run)}</span>
                    </div>
                    <div className={styles.workMetaRow}>
                      <span className={styles.workMeta}>
                        {run.projectKey}
                        {boundStation ? ` - Station ${boundStation.label ?? run.stationId}` : ""}
                      </span>
                      <span className={styles.workMeta}>Updated {new Date(run.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className={styles.workMeta}>
                      {run.status === "working"
                        ? latestAttempt
                          ? `Attempt ${latestAttempt.sequence} is active.`
                          : "Mission pass is active."
                        : run.status === "ready"
                          ? "The worktree is prepared and waiting for launch."
                          : run.status === "blocked"
                            ? "YouTrack state sync needs attention."
                            : run.status === "awaiting-review"
                              ? "This mission is waiting on your review."
                              : "Mission startup is still underway."}
                    </div>
                    {run.statusMessage ? <div className={styles.workHint}>{run.statusMessage}</div> : null}
                    <div className={styles.workActions}>
                      <div className={styles.detailLinks}>
                        {run.stationId ? (
                          <button type="button" className={styles.secondaryButton} onClick={() => focusRunStation(run)}>
                            Open station
                          </button>
                        ) : null}
                      </div>
                      <div className={styles.detailLinks}>
                        <button
                          type="button"
                          className={run.status === "awaiting-review" ? styles.actionButton : styles.secondaryButton}
                          onClick={() => openRunMissionDetail(run.runId, "flight-deck")}
                        >
                          {detailLabel}
                        </button>
                        {run.status === "blocked" ? (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => void retryTicketRunSync(run.runId)}
                            disabled={syncingRunId === run.runId}
                          >
                            {syncingRunId === run.runId ? "Syncing..." : "Retry state sync"}
                          </button>
                        ) : null}
                        {run.status === "ready" ? (
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => void startRunWork(run.runId)}
                            disabled={startingWorkRunId === run.runId}
                          >
                            {startingWorkRunId === run.runId ? "Starting work..." : "Start work"}
                          </button>
                        ) : null}
                        {run.status === "working" ? (
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => void cancelRunWork(run.runId)}
                            disabled={cancellingRunId === run.runId}
                          >
                            {cancellingRunId === run.runId ? "Cancelling..." : "Cancel pass"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section
          id="missions-panel-dry-dock"
          role="tabpanel"
          aria-labelledby="missions-tab-dry-dock"
          className={styles.section}
          hidden={activeTab !== "dry-dock" || selectedMission !== null}
        >
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionLabel}>Completed missions</div>
              <div className={styles.sectionCaption}>
                Finished runs move here so Launch Bay and Flight Deck only carry live work.
              </div>
            </div>
          </div>
          {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
          {runError ? <div className={styles.error}>{runError}</div> : null}
          {completedRuns.length === 0 ? (
            <div className={styles.emptyState}>No missions have reached dry dock yet.</div>
          ) : (
            <div className={styles.runList}>
              {completedRuns.map((run) => {
                const ticket = ticketById.get(run.ticketId) ?? null;
                const runUrl = ticket?.url ?? run.ticketUrl;
                return (
                  <article key={run.runId} className={styles.runCard}>
                    <div className={styles.workHeader}>
                      <div className={styles.workHeaderCopy}>
                        <span className={styles.ticketId}>{run.ticketId}</span>
                        <strong>{run.ticketSummary}</strong>
                      </div>
                      <span className={styles.statusBadge}>{describeRunStatus(run)}</span>
                    </div>
                    <div className={styles.workMetaRow}>
                      <span className={styles.workMeta}>{run.projectKey}</span>
                      <span className={styles.workMeta}>Completed {new Date(run.updatedAt).toLocaleString()}</span>
                    </div>
                    <div className={styles.workMeta}>
                      {run.attempts.length} attempt{run.attempts.length === 1 ? "" : "s"} across {run.worktrees.length}{" "}
                      worktree
                      {run.worktrees.length === 1 ? "" : "s"}.
                    </div>
                    <div className={styles.workActions}>
                      <div className={styles.detailLinks}>
                        {runUrl ? (
                          <a className={styles.inlineLink} href={runUrl} target="_blank" rel="noreferrer">
                            Open in YouTrack
                          </a>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => openRunMissionDetail(run.runId, "dry-dock")}
                      >
                        Mission details
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
