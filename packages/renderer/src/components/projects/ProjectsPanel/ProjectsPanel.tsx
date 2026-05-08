import {
  DEFAULT_YOUTRACK_STATE_MAPPING,
  type MissionServiceProcessSummary,
  type MissionServiceProfileSummary,
  type MissionServiceSnapshot,
  type MissionUiRoom,
  type ProjectRepoMappingsSnapshot,
  type TicketRunGitState,
  type TicketRunReviewSnapshot,
  type TicketRunSubmoduleGitState,
  type TicketRunSummary,
  type YouTrackProjectSummary,
  type YouTrackStateMapping,
  type YouTrackStatusSummary,
  type YouTrackTicketSummary,
} from "@spira/shared";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMissionRunsStore } from "../../../stores/mission-runs-store.js";
import { useNavigationStore } from "../../../stores/navigation-store.js";
import { useSettingsStore } from "../../../stores/settings-store.js";
import { useStationStore } from "../../../stores/station-store.js";
import { type MissionLaneTabId, buildRunByTicketId, resolveRunTab, splitMissionCollections } from "../mission-utils.js";
import { normalizeProjectKey } from "../project-utils.js";
import { assessYouTrackStateMappingDraft, haveYouTrackStateMappingsChanged } from "../youtrack-state-mapping-utils.js";
import styles from "./ProjectsPanel.module.css";
import {
  EMPTY_SNAPSHOT,
  MISSIONS_TAB_ORDER,
  type MissionSelection,
  type MissionsTabId,
  NEW_MAPPING_SENTINEL,
  YOUTRACK_TICKET_LIST_LIMIT,
  buildManagedSubmoduleKey,
  cloneYouTrackStateMapping,
  describeMissionTab,
  getTicketStartBlocker,
  isMissionServiceProcessActive,
} from "./ProjectsPanel.utils.js";
import { ProjectsPanelMissionDetail } from "./ProjectsPanelMissionDetail.js";
import { ProjectsPanelMissionLanes } from "./ProjectsPanelMissionLanes.js";
import { ProjectsPanelQuarterdeck } from "./ProjectsPanelQuarterdeck.js";

export function ProjectsPanel() {
  const youTrackEnabled = useSettingsStore((store) => store.youTrackEnabled);
  const setYouTrackEnabled = useSettingsStore((store) => store.setYouTrackEnabled);
  const openMission = useNavigationStore((store) => store.openMission);
  const setMissionFlash = useNavigationStore((store) => store.setMissionFlash);
  const setView = useNavigationStore((store) => store.setView);
  const runSnapshot = useMissionRunsStore((store) => store.snapshot);
  const setRunSnapshot = useMissionRunsStore((store) => store.setSnapshot);
  const setActiveStation = useStationStore((store) => store.setActiveStation);
  const stationMap = useStationStore((store) => store.stations);
  const [snapshot, setSnapshot] = useState<ProjectRepoMappingsSnapshot>(EMPTY_SNAPSHOT);
  const [youTrackStatus, setYouTrackStatus] = useState<YouTrackStatusSummary | null>(null);
  const [youTrackTickets, setYouTrackTickets] = useState<YouTrackTicketSummary[]>([]);
  const [youTrackStateMappingDraft, setYouTrackStateMappingDraft] = useState<YouTrackStateMapping>(
    cloneYouTrackStateMapping(),
  );
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
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [isSavingWorkflow, setIsSavingWorkflow] = useState(false);
  const [mappingNotice, setMappingNotice] = useState<string | null>(null);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [serviceNotice, setServiceNotice] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [startingTicketId, setStartingTicketId] = useState<string | null>(null);
  const [syncingRunId, setSyncingRunId] = useState<string | null>(null);
  const [startingWorkRunId, setStartingWorkRunId] = useState<string | null>(null);
  const [continuingRunId, setContinuingRunId] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);
  const [completingRunId, setCompletingRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [loadingGitRunId, setLoadingGitRunId] = useState<string | null>(null);
  const [loadingSubmoduleKey, setLoadingSubmoduleKey] = useState<string | null>(null);
  const [loadingServicesRunId, setLoadingServicesRunId] = useState<string | null>(null);
  const [loadingReviewRunId, setLoadingReviewRunId] = useState<string | null>(null);
  const [generatingCommitDraftRunId, setGeneratingCommitDraftRunId] = useState<string | null>(null);
  const [generatingSubmoduleCommitDraftKey, setGeneratingSubmoduleCommitDraftKey] = useState<string | null>(null);
  const [savingCommitDraftRunId, setSavingCommitDraftRunId] = useState<string | null>(null);
  const [savingSubmoduleCommitDraftKey, setSavingSubmoduleCommitDraftKey] = useState<string | null>(null);
  const [committingGitRunId, setCommittingGitRunId] = useState<string | null>(null);
  const [committingSubmoduleKey, setCommittingSubmoduleKey] = useState<string | null>(null);
  const [syncingRemoteRunId, setSyncingRemoteRunId] = useState<string | null>(null);
  const [syncingSubmoduleKey, setSyncingSubmoduleKey] = useState<string | null>(null);
  const [creatingPullRequestRunId, setCreatingPullRequestRunId] = useState<string | null>(null);
  const [creatingSubmodulePullRequestKey, setCreatingSubmodulePullRequestKey] = useState<string | null>(null);
  const [startingServiceProfileId, setStartingServiceProfileId] = useState<string | null>(null);
  const [stoppingServiceId, setStoppingServiceId] = useState<string | null>(null);
  const [selectedMission, setSelectedMission] = useState<MissionSelection | null>(null);
  const [selectedMissionServices, setSelectedMissionServices] = useState<MissionServiceSnapshot | null>(null);
  const [selectedMissionReviewSnapshot, setSelectedMissionReviewSnapshot] = useState<TicketRunReviewSnapshot | null>(
    null,
  );
  const [continueDrafts, setContinueDrafts] = useState<Record<string, string>>({});
  const [commitDraft, setCommitDraft] = useState("");
  const [commitDraftDirty, setCommitDraftDirty] = useState(false);
  const [submoduleCommitDraft, setSubmoduleCommitDraft] = useState("");
  const [submoduleCommitDraftDirty, setSubmoduleCommitDraftDirty] = useState(false);
  const [selectedRepoRelativePath, setSelectedRepoRelativePath] = useState<string | null>(null);
  const [selectedSubmoduleCanonicalUrl, setSelectedSubmoduleCanonicalUrl] = useState<string | null>(null);
  const [selectedGitState, setSelectedGitState] = useState<TicketRunGitState | null>(null);
  const [selectedSubmoduleGitState, setSelectedSubmoduleGitState] = useState<TicketRunSubmoduleGitState | null>(null);
  const [expandedDiffPaths, setExpandedDiffPaths] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<MissionsTabId>("quarterdeck");
  const editorRef = useRef<HTMLElement | null>(null);
  const tabButtonRefs = useRef(new Map<MissionsTabId, HTMLButtonElement>());
  const autoDraftedRunIdsRef = useRef(new Set<string>());
  const autoDraftedSubmoduleKeysRef = useRef(new Set<string>());
  const selectedMissionRunIdRef = useRef<string | null>(null);
  const selectedRepoRelativePathRef = useRef<string | null>(null);
  const selectedSubmoduleCanonicalUrlRef = useRef<string | null>(null);

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
          setYouTrackTickets(await window.electronAPI.listYouTrackTickets(YOUTRACK_TICKET_LIST_LIMIT));
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
  }, [setRunSnapshot]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    setWorkspaceRootDraft(snapshot.workspaceRoot ?? "");
  }, [snapshot.workspaceRoot]);

  const persistedTodoKey =
    youTrackStatus?.stateMapping?.todo?.join("\u0000") ?? DEFAULT_YOUTRACK_STATE_MAPPING.todo.join("\u0000");
  const persistedInProgressKey =
    youTrackStatus?.stateMapping?.inProgress?.join("\u0000") ??
    DEFAULT_YOUTRACK_STATE_MAPPING.inProgress.join("\u0000");
  const persistedYouTrackStateMapping = useMemo(
    () =>
      cloneYouTrackStateMapping({
        todo: persistedTodoKey.split("\u0000"),
        inProgress: persistedInProgressKey.split("\u0000"),
      }),
    [persistedInProgressKey, persistedTodoKey],
  );

  useEffect(() => {
    setYouTrackStateMappingDraft(persistedYouTrackStateMapping);
  }, [persistedYouTrackStateMapping]);

  useEffect(() => {
    setSelectedRepoPaths((current) =>
      current.filter((repoPath) => snapshot.repos.some((repo) => repo.relativePath === repoPath)),
    );
  }, [snapshot.repos]);

  useEffect(() => {
    return window.electronAPI.onTicketRunServicesUpdated((services) => {
      if (selectedMissionRunIdRef.current === services.runId) {
        setSelectedMissionServices(services);
      }
    });
  }, []);

  const canSearchProjects = youTrackStatus?.state === "connected";
  const workflowBlocker = useMemo(() => {
    if (!youTrackStatus) {
      return "Checking YouTrack status...";
    }

    if (youTrackStatus.state !== "connected") {
      return `${youTrackStatus.message} Missions needs an active YouTrack connection before workflow states can be edited.`;
    }

    if (youTrackStatus.availableStates.length === 0) {
      return "YouTrack did not expose any live workflow states for this account.";
    }

    return null;
  }, [youTrackStatus]);
  const workflowValidation = useMemo(
    () => assessYouTrackStateMappingDraft(youTrackStateMappingDraft, youTrackStatus?.availableStates ?? []),
    [youTrackStateMappingDraft, youTrackStatus?.availableStates],
  );
  const hasWorkflowChanges = useMemo(
    () => haveYouTrackStateMappingsChanged(youTrackStateMappingDraft, persistedYouTrackStateMapping),
    [persistedYouTrackStateMapping, youTrackStateMappingDraft],
  );
  const canSaveWorkflow = workflowBlocker === null && hasWorkflowChanges && workflowValidation.errors.length === 0;
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
  const isSelectedMissionReviewLoading = selectedMissionRunId !== null && loadingReviewRunId === selectedMissionRunId;
  const hasSelectedMissionReviewCloseBlockers = selectedMissionReviewSnapshot?.canClose === false;
  const canDeleteSelectedMission = selectedMissionReviewSnapshot?.canDelete ?? false;
  const selectedMissionDeleteBlockers =
    selectedMissionReviewSnapshot?.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.reason}`).join("; ") ??
    null;
  const selectedMissionWorktree =
    selectedMissionRun?.worktrees.find((worktree) => worktree.repoRelativePath === selectedRepoRelativePath) ??
    selectedMissionRun?.worktrees[0] ??
    null;
  const selectedMissionSubmodule =
    selectedMissionRun?.submodules.find((submodule) => submodule.canonicalUrl === selectedSubmoduleCanonicalUrl) ??
    selectedMissionRun?.submodules[0] ??
    null;
  const selectedMissionRunCommitDraft =
    selectedMissionWorktree?.commitMessageDraft ?? selectedMissionRun?.commitMessageDraft ?? null;
  const selectedMissionRunWorktreeCount = selectedMissionRun?.worktrees.length ?? 0;
  const selectedMissionLatestAttempt = selectedMissionRun?.attempts[selectedMissionRun.attempts.length - 1] ?? null;
  const selectedMissionStation = selectedMissionRun?.stationId ? stationMap[selectedMissionRun.stationId] : null;
  const selectedMissionUrl = selectedMissionTicket?.url ?? selectedMissionRun?.ticketUrl ?? null;
  const selectedMissionGitRepoLabel =
    selectedGitState?.repoRelativePath ?? selectedMissionWorktree?.repoRelativePath ?? null;
  const selectedMissionSubmoduleLabel = selectedSubmoduleGitState?.name ?? selectedMissionSubmodule?.name ?? null;
  const selectedMissionServicesSnapshot =
    selectedMissionServices?.runId === selectedMissionRunId ? selectedMissionServices : null;
  const selectedMissionServiceProfiles = selectedMissionServicesSnapshot?.profiles ?? [];
  const selectedMissionServiceProcesses = selectedMissionServicesSnapshot?.processes ?? [];
  const visibleMissionServiceProfiles = selectedMissionWorktree
    ? selectedMissionServiceProfiles.filter(
        (profile) => profile.repoRelativePath === selectedMissionWorktree.repoRelativePath,
      )
    : selectedMissionServiceProfiles;
  const missionServiceProfilesByRepo = useMemo(() => {
    const groups = new Map<string, MissionServiceProfileSummary[]>();
    for (const profile of visibleMissionServiceProfiles) {
      const current = groups.get(profile.repoRelativePath) ?? [];
      current.push(profile);
      groups.set(profile.repoRelativePath, current);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [visibleMissionServiceProfiles]);
  const activeMissionServiceProfileIds = useMemo(
    () =>
      new Set(
        selectedMissionServiceProcesses
          .filter((process) => isMissionServiceProcessActive(process))
          .map((process) => process.profileId),
      ),
    [selectedMissionServiceProcesses],
  );
  const selectedMissionBlockingSubmoduleNames = useMemo(
    () =>
      (selectedGitState?.blockedBySubmoduleCanonicalUrls ?? []).map(
        (canonicalUrl) =>
          selectedMissionRun?.submodules.find((submodule) => submodule.canonicalUrl === canonicalUrl)?.name ??
          canonicalUrl,
      ),
    [selectedGitState?.blockedBySubmoduleCanonicalUrls, selectedMissionRun?.submodules],
  );
  const selectedSubmoduleKey =
    selectedMissionRunId && selectedMissionSubmodule
      ? buildManagedSubmoduleKey(selectedMissionRunId, selectedMissionSubmodule.canonicalUrl)
      : null;
  const selectedSubmoduleNeedsAlignment =
    selectedSubmoduleGitState?.parents.some((parent) => !parent.isAligned) ?? false;
  const selectedSubmoduleCanSync =
    selectedSubmoduleGitState !== null &&
    (selectedSubmoduleGitState.pushAction !== "none" || selectedSubmoduleNeedsAlignment);
  const selectedSubmoduleSyncLabel =
    selectedSubmoduleGitState?.pushAction === "publish"
      ? "Publish"
      : selectedSubmoduleGitState?.pushAction === "push"
        ? "Push"
        : selectedSubmoduleNeedsAlignment
          ? "Align parents"
          : "Push";
  const showRepoPullRequestActions =
    selectedMissionRun?.status === "awaiting-review" &&
    selectedGitState !== null &&
    selectedGitState.blockedBySubmoduleCanonicalUrls.length === 0 &&
    !selectedGitState.hasDiff &&
    selectedGitState.pushAction === "none" &&
    selectedGitState.pullRequestUrls.open !== null &&
    selectedGitState.pullRequestUrls.draft !== null;
  const showSubmodulePullRequestActions =
    selectedMissionRun?.status === "awaiting-review" &&
    selectedSubmoduleGitState !== null &&
    !selectedSubmoduleGitState.reconcileRequired &&
    !selectedSubmoduleNeedsAlignment &&
    !selectedSubmoduleGitState.hasDiff &&
    selectedSubmoduleGitState.pushAction === "none" &&
    selectedSubmoduleGitState.pullRequestUrls.open !== null &&
    selectedSubmoduleGitState.pullRequestUrls.draft !== null;
  useEffect(() => {
    selectedMissionRunIdRef.current = selectedMissionRunId;
  }, [selectedMissionRunId]);

  useEffect(() => {
    selectedRepoRelativePathRef.current = selectedRepoRelativePath;
  }, [selectedRepoRelativePath]);

  useEffect(() => {
    selectedSubmoduleCanonicalUrlRef.current = selectedSubmoduleCanonicalUrl;
  }, [selectedSubmoduleCanonicalUrl]);

  const isSelectedMissionRepo = useCallback((runId: string, repoRelativePath: string) => {
    return selectedMissionRunIdRef.current === runId && selectedRepoRelativePathRef.current === repoRelativePath;
  }, []);

  const isSelectedMissionSubmodule = useCallback((runId: string, canonicalUrl: string) => {
    return selectedMissionRunIdRef.current === runId && selectedSubmoduleCanonicalUrlRef.current === canonicalUrl;
  }, []);

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

  const updateWorkflowStateList = useCallback((lane: keyof YouTrackStateMapping, nextStates: string[]) => {
    setYouTrackStateMappingDraft((current) => ({
      ...current,
      [lane]: nextStates,
    }));
    setWorkflowNotice(null);
    setWorkflowError(null);
  }, []);

  const resetWorkflowMappingDraft = useCallback(() => {
    setYouTrackStateMappingDraft(persistedYouTrackStateMapping);
    setWorkflowNotice(null);
    setWorkflowError(null);
  }, [persistedYouTrackStateMapping]);

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

  const saveWorkflowMapping = async () => {
    if (workflowBlocker) {
      setWorkflowError(workflowBlocker);
      return;
    }

    if (!hasWorkflowChanges) {
      setWorkflowError("No workflow state changes to save.");
      return;
    }

    if (workflowValidation.errors.length > 0) {
      setWorkflowError(workflowValidation.errors[0] ?? "Fix the workflow state mapping before saving.");
      return;
    }

    setIsSavingWorkflow(true);
    setWorkflowNotice(null);
    setWorkflowError(null);
    try {
      const nextStatus = await window.electronAPI.setYouTrackStateMapping(workflowValidation.mapping);
      setYouTrackStatus(nextStatus);
      setYouTrackStateMappingDraft(cloneYouTrackStateMapping(nextStatus.stateMapping));
      if (nextStatus.state === "connected") {
        try {
          setYouTrackTickets(await window.electronAPI.listYouTrackTickets(YOUTRACK_TICKET_LIST_LIMIT));
          setTicketError(null);
        } catch (ticketsLoadError) {
          console.error("Failed to refresh assigned YouTrack tickets", ticketsLoadError);
          setYouTrackTickets([]);
          setTicketError("Workflow states were saved, but assigned tickets could not be refreshed.");
        }
      } else {
        setYouTrackTickets([]);
      }
      setWorkflowNotice("Mission workflow states updated.");
    } catch (saveError) {
      console.error("Failed to update YouTrack workflow states", saveError);
      setWorkflowError(saveError instanceof Error ? saveError.message : "Failed to update YouTrack workflow states.");
    } finally {
      setIsSavingWorkflow(false);
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
    (runId: string, room?: MissionUiRoom) => {
      const run = runSnapshot.runs.find((candidate) => candidate.runId === runId) ?? null;
      if (run?.stationId) {
        setActiveStation(run.stationId);
      }
      setSelectedMission(null);
      openMission(runId, room);
    },
    [openMission, runSnapshot.runs, setActiveStation],
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
      openMission(run.runId, "bridge");
    },
    [openMission, setActiveStation],
  );

  const refreshMissionServices = useCallback(async (runId: string) => {
    setLoadingServicesRunId(runId);
    setServiceError(null);
    try {
      const services = await window.electronAPI.getTicketRunServices(runId);
      if (selectedMissionRunIdRef.current === runId) {
        setSelectedMissionServices(services);
      }
    } catch (error) {
      console.error("Failed to load mission services", error);
      if (selectedMissionRunIdRef.current === runId) {
        setServiceError(error instanceof Error ? error.message : "Failed to load mission services.");
      }
    } finally {
      setLoadingServicesRunId((current) => (current === runId ? null : current));
    }
  }, []);

  const refreshSelectedMissionReviewSnapshot = useCallback(
    async (runId: string): Promise<TicketRunReviewSnapshot | null> => {
      setLoadingReviewRunId(runId);

      try {
        const result = await window.electronAPI.getTicketRunReviewSnapshot(runId);
        if (selectedMissionRunIdRef.current === runId) {
          setRunSnapshot(result.snapshot);
          setSelectedMissionReviewSnapshot(result.reviewSnapshot);
        }
        return result.reviewSnapshot;
      } catch (error) {
        if (selectedMissionRunIdRef.current === runId) {
          console.error("Failed to load mission review snapshot", error);
          setRunError(error instanceof Error ? error.message : "Failed to load the mission review snapshot.");
          setSelectedMissionReviewSnapshot(null);
        }
        return null;
      } finally {
        if (selectedMissionRunIdRef.current === runId) {
          setLoadingReviewRunId((current) => (current === runId ? null : current));
        }
      }
    },
    [setRunSnapshot],
  );

  const startMissionService = useCallback(async (runId: string, profile: MissionServiceProfileSummary) => {
    setStartingServiceProfileId(profile.profileId);
    setServiceNotice(null);
    setServiceError(null);
    try {
      const services = await window.electronAPI.startTicketRunService(runId, profile.profileId);
      setSelectedMissionServices(services);
      setServiceNotice(`${profile.profileName} is launching for ${profile.repoRelativePath}.`);
    } catch (error) {
      console.error("Failed to start mission service", error);
      setServiceError(error instanceof Error ? error.message : "Failed to start the mission service.");
    } finally {
      setStartingServiceProfileId(null);
    }
  }, []);

  const stopMissionService = useCallback(async (runId: string, service: MissionServiceProcessSummary) => {
    setStoppingServiceId(service.serviceId);
    setServiceNotice(null);
    setServiceError(null);
    try {
      const services = await window.electronAPI.stopTicketRunService(runId, service.serviceId);
      setSelectedMissionServices(services);
      setServiceNotice(`${service.profileName} is stopping for ${service.repoRelativePath}.`);
    } catch (error) {
      console.error("Failed to stop mission service", error);
      setServiceError(error instanceof Error ? error.message : "Failed to stop the mission service.");
    } finally {
      setStoppingServiceId(null);
    }
  }, []);

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
    if (!selectedMissionRun) {
      setSelectedRepoRelativePath(null);
      return;
    }

    setSelectedRepoRelativePath((current) =>
      selectedMissionRun.worktrees.some((worktree) => worktree.repoRelativePath === current)
        ? current
        : (selectedMissionRun.worktrees[0]?.repoRelativePath ?? null),
    );
  }, [selectedMissionRun]);

  useEffect(() => {
    if (!selectedMissionRun) {
      setSelectedSubmoduleCanonicalUrl(null);
      return;
    }

    setSelectedSubmoduleCanonicalUrl((current) =>
      selectedMissionRun.submodules.some((submodule) => submodule.canonicalUrl === current)
        ? current
        : (selectedMissionRun.submodules[0]?.canonicalUrl ?? null),
    );
  }, [selectedMissionRun]);

  useEffect(() => {
    if (!selectedMissionRunId) {
      setSelectedMissionServices(null);
      setSelectedMissionReviewSnapshot(null);
      setLoadingServicesRunId(null);
      setLoadingReviewRunId(null);
      setServiceNotice(null);
      setServiceError(null);
      setSelectedGitState(null);
      setSelectedSubmoduleGitState(null);
      setCommitDraft("");
      setCommitDraftDirty(false);
      setSubmoduleCommitDraft("");
      setSubmoduleCommitDraftDirty(false);
      setSelectedRepoRelativePath(null);
      setSelectedSubmoduleCanonicalUrl(null);
      setExpandedDiffPaths({});
      setGitNotice(null);
      setGitError(null);
      return;
    }

    setSelectedGitState(null);
    setSelectedSubmoduleGitState(null);
    setExpandedDiffPaths({});
    setGitNotice(null);
    setGitError(null);
  }, [selectedMissionRunId]);

  useEffect(() => {
    if (!selectedMissionRunId) {
      return;
    }

    void refreshMissionServices(selectedMissionRunId);
  }, [refreshMissionServices, selectedMissionRunId]);

  useEffect(() => {
    if (!selectedMissionRunId) {
      setSelectedMissionReviewSnapshot(null);
      setLoadingReviewRunId(null);
      return;
    }
    if (!selectedMissionRunStatus) {
      return;
    }

    void refreshSelectedMissionReviewSnapshot(selectedMissionRunId);
  }, [refreshSelectedMissionReviewSnapshot, selectedMissionRunId, selectedMissionRunStatus]);

  useEffect(() => {
    if (!selectedMissionRunId || !selectedRepoRelativePath) {
      return;
    }

    setSelectedGitState(null);
    setExpandedDiffPaths({});
    setGitNotice(null);
    setGitError(null);
  }, [selectedMissionRunId, selectedRepoRelativePath]);

  useEffect(() => {
    if (!selectedMissionRunId || !selectedSubmoduleCanonicalUrl) {
      return;
    }

    setSelectedSubmoduleGitState(null);
    setSubmoduleCommitDraft("");
    setSubmoduleCommitDraftDirty(false);
    setExpandedDiffPaths({});
    setGitNotice(null);
    setGitError(null);
  }, [selectedMissionRunId, selectedSubmoduleCanonicalUrl]);

  useEffect(() => {
    if (!selectedMissionRunId) {
      return;
    }

    setCommitDraft(selectedMissionRunCommitDraft ?? "");
    setCommitDraftDirty(false);
  }, [selectedMissionRunCommitDraft, selectedMissionRunId]);

  useEffect(() => {
    if (!selectedMissionRunId) {
      return;
    }

    setSubmoduleCommitDraft(selectedSubmoduleGitState?.commitMessageDraft ?? "");
    setSubmoduleCommitDraftDirty(false);
  }, [selectedMissionRunId, selectedSubmoduleGitState?.commitMessageDraft]);

  useEffect(() => {
    if (!selectedMissionRunId || selectedMissionRunWorktreeCount === 0 || !selectedRepoRelativePath) {
      return;
    }

    const runId = selectedMissionRunId;
    const repoRelativePath = selectedRepoRelativePath;
    let cancelled = false;
    const loadGitState = async () => {
      setLoadingGitRunId(runId);
      setGitError(null);
      try {
        const result = await window.electronAPI.getTicketRunGitState(runId, repoRelativePath);
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
  }, [selectedMissionRunId, selectedMissionRunWorktreeCount, selectedRepoRelativePath, setRunSnapshot]);

  useEffect(() => {
    if (!selectedMissionRunId || !selectedSubmoduleCanonicalUrl) {
      return;
    }

    const runId = selectedMissionRunId;
    const canonicalUrl = selectedSubmoduleCanonicalUrl;
    const submoduleKey = buildManagedSubmoduleKey(runId, canonicalUrl);
    let cancelled = false;
    const loadSubmoduleGitState = async () => {
      setLoadingSubmoduleKey(submoduleKey);
      setGitError(null);
      try {
        const result = await window.electronAPI.getTicketRunSubmoduleGitState(runId, canonicalUrl);
        if (cancelled) {
          return;
        }
        setRunSnapshot(result.snapshot);
        setSelectedSubmoduleGitState(result.gitState);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load managed submodule git state", error);
        setGitError(error instanceof Error ? error.message : "Failed to load managed submodule git state.");
      } finally {
        if (!cancelled) {
          setLoadingSubmoduleKey((current) => (current === submoduleKey ? null : current));
        }
      }
    };

    void loadSubmoduleGitState();
    return () => {
      cancelled = true;
    };
  }, [selectedMissionRunId, selectedSubmoduleCanonicalUrl, setRunSnapshot]);

  const refreshMissionGitState = async (runId: string, repoRelativePath = selectedRepoRelativePath) => {
    if (!repoRelativePath) {
      return;
    }

    setLoadingGitRunId(runId);
    setGitError(null);
    try {
      const result = await window.electronAPI.getTicketRunGitState(runId, repoRelativePath);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionRepo(runId, repoRelativePath)) {
        setSelectedGitState(result.gitState);
      }
    } catch (error) {
      console.error("Failed to refresh mission git state", error);
      setGitError(error instanceof Error ? error.message : "Failed to refresh mission git state.");
    } finally {
      setLoadingGitRunId(null);
    }
  };

  const refreshSelectedSubmoduleGitState = async (
    runId: string,
    canonicalUrl = selectedSubmoduleCanonicalUrl,
  ): Promise<void> => {
    if (!canonicalUrl) {
      return;
    }

    const submoduleKey = buildManagedSubmoduleKey(runId, canonicalUrl);
    setLoadingSubmoduleKey(submoduleKey);
    setGitError(null);
    try {
      const result = await window.electronAPI.getTicketRunSubmoduleGitState(runId, canonicalUrl);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionSubmodule(runId, canonicalUrl)) {
        setSelectedSubmoduleGitState(result.gitState);
      }
    } catch (error) {
      console.error("Failed to refresh managed submodule git state", error);
      setGitError(error instanceof Error ? error.message : "Failed to refresh managed submodule git state.");
    } finally {
      setLoadingSubmoduleKey((current) => (current === submoduleKey ? null : current));
    }
  };

  const refreshSelectedRepoAfterSubmoduleAction = async (runId: string): Promise<void> => {
    const repoRelativePath = selectedRepoRelativePathRef.current;
    if (!repoRelativePath) {
      return;
    }

    await refreshMissionGitState(runId, repoRelativePath);
  };

  const generateCommitDraft = useCallback(
    async (runId: string, repoRelativePath = selectedRepoRelativePath) => {
      if (!repoRelativePath) {
        return;
      }

      setGeneratingCommitDraftRunId(runId);
      setGitNotice(null);
      setGitError(null);
      try {
        const result = await window.electronAPI.generateTicketRunCommitDraft(runId, repoRelativePath);
        setRunSnapshot(result.snapshot);
        if (isSelectedMissionRepo(runId, repoRelativePath)) {
          setSelectedGitState(result.gitState);
          setCommitDraft(result.gitState.commitMessageDraft ?? "");
          setCommitDraftDirty(false);
        }
        setGitNotice(`${result.run.ticketId} commit draft refreshed for ${result.gitState.repoRelativePath}.`);
      } catch (error) {
        console.error("Failed to generate mission commit draft", error);
        setGitError(error instanceof Error ? error.message : "Failed to generate the mission commit draft.");
      } finally {
        setGeneratingCommitDraftRunId(null);
      }
    },
    [isSelectedMissionRepo, selectedRepoRelativePath, setRunSnapshot],
  );

  useEffect(() => {
    if (
      !selectedMissionRunId ||
      !selectedRepoRelativePath ||
      selectedMissionRunStatus !== "awaiting-review" ||
      selectedMissionRunCommitDraft
    ) {
      return;
    }
    const autoDraftKey = `${selectedMissionRunId}:${selectedRepoRelativePath}`;
    if (autoDraftedRunIdsRef.current.has(autoDraftKey)) {
      return;
    }
    autoDraftedRunIdsRef.current.add(autoDraftKey);
    void generateCommitDraft(selectedMissionRunId, selectedRepoRelativePath);
  }, [
    generateCommitDraft,
    selectedMissionRunCommitDraft,
    selectedMissionRunId,
    selectedMissionRunStatus,
    selectedRepoRelativePath,
  ]);

  useEffect(() => {
    if (
      !selectedMissionRunId ||
      !selectedMissionSubmodule ||
      !selectedSubmoduleGitState?.hasDiff ||
      selectedMissionRunStatus !== "awaiting-review" ||
      selectedSubmoduleGitState.commitMessageDraft
    ) {
      return;
    }
    const autoDraftKey = buildManagedSubmoduleKey(selectedMissionRunId, selectedMissionSubmodule.canonicalUrl);
    if (autoDraftedSubmoduleKeysRef.current.has(autoDraftKey)) {
      return;
    }
    autoDraftedSubmoduleKeysRef.current.add(autoDraftKey);
    void (async () => {
      const result = await window.electronAPI.generateTicketRunSubmoduleCommitDraft(
        selectedMissionRunId,
        selectedMissionSubmodule.canonicalUrl,
      );
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionSubmodule(selectedMissionRunId, selectedMissionSubmodule.canonicalUrl)) {
        setSelectedSubmoduleGitState(result.gitState);
        setSubmoduleCommitDraft(result.gitState.commitMessageDraft ?? "");
        setSubmoduleCommitDraftDirty(false);
      }
    })().catch((error) => {
      console.error("Failed to generate managed submodule commit draft", error);
      setGitError(error instanceof Error ? error.message : "Failed to generate the managed submodule commit draft.");
    });
  }, [
    isSelectedMissionSubmodule,
    selectedMissionRunId,
    selectedMissionRunStatus,
    selectedMissionSubmodule,
    selectedSubmoduleGitState?.commitMessageDraft,
    selectedSubmoduleGitState?.hasDiff,
    setRunSnapshot,
  ]);

  const persistCommitDraft = async (runId: string, repoRelativePath = selectedRepoRelativePath) => {
    if (!repoRelativePath) {
      return;
    }

    setSavingCommitDraftRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.setTicketRunCommitDraft(runId, commitDraft, repoRelativePath);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionRepo(runId, repoRelativePath)) {
        setSelectedGitState(result.gitState);
        setCommitDraft(result.gitState.commitMessageDraft ?? "");
        setCommitDraftDirty(false);
      }
    } catch (error) {
      console.error("Failed to save mission commit draft", error);
      setGitError(error instanceof Error ? error.message : "Failed to save the mission commit draft.");
    } finally {
      setSavingCommitDraftRunId(null);
    }
  };

  const commitMissionRun = async (runId: string, repoRelativePath = selectedRepoRelativePath) => {
    if (!repoRelativePath) {
      return;
    }

    setCommittingGitRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.commitTicketRun(runId, commitDraft, repoRelativePath);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionRepo(runId, repoRelativePath)) {
        setSelectedGitState(result.gitState);
        setCommitDraft("");
        setCommitDraftDirty(false);
      }
      setGitNotice(
        `${result.run.ticketId} committed in ${result.gitState.repoRelativePath} on ${result.gitState.branchName}.`,
      );
      await refreshSelectedMissionReviewSnapshot(runId);
    } catch (error) {
      console.error("Failed to commit mission run", error);
      setGitError(error instanceof Error ? error.message : "Failed to commit the mission worktree.");
    } finally {
      setCommittingGitRunId(null);
    }
  };

  const syncMissionRemote = async (
    runId: string,
    action: "publish" | "push",
    repoRelativePath = selectedRepoRelativePath,
  ) => {
    if (!repoRelativePath) {
      return;
    }

    setSyncingRemoteRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result =
        action === "publish"
          ? await window.electronAPI.publishTicketRun(runId, repoRelativePath)
          : await window.electronAPI.pushTicketRun(runId, repoRelativePath);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionRepo(runId, repoRelativePath)) {
        setSelectedGitState(result.gitState);
      }
      setGitNotice(
        result.action === "publish"
          ? `${result.run.ticketId} published ${result.gitState.repoRelativePath} to origin/${result.gitState.branchName}.`
          : `${result.run.ticketId} pushed ${result.gitState.repoRelativePath} to origin/${result.gitState.branchName}.`,
      );
      await refreshSelectedMissionReviewSnapshot(runId);
    } catch (error) {
      console.error("Failed to sync mission remote", error);
      setGitError(error instanceof Error ? error.message : "Failed to sync the mission branch.");
    } finally {
      setSyncingRemoteRunId(null);
    }
  };

  const openMissionPullRequest = async (runId: string, repoRelativePath = selectedRepoRelativePath) => {
    if (!repoRelativePath) {
      return;
    }

    setCreatingPullRequestRunId(runId);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.createTicketRunPullRequest(runId, repoRelativePath);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionRepo(runId, repoRelativePath)) {
        setSelectedGitState(result.gitState);
      }
      await window.electronAPI.openExternal(result.pullRequestUrl);
      setGitNotice(`${result.run.ticketId} pull request opened for ${result.gitState.repoRelativePath}.`);
      await refreshSelectedMissionReviewSnapshot(runId);
    } catch (error) {
      console.error("Failed to open mission pull request", error);
      setGitError(error instanceof Error ? error.message : "Failed to open the mission pull request.");
    } finally {
      setCreatingPullRequestRunId(null);
    }
  };

  const generateSubmoduleCommitDraft = async (
    runId: string,
    canonicalUrl = selectedSubmoduleCanonicalUrl,
  ): Promise<void> => {
    if (!canonicalUrl) {
      return;
    }

    const submoduleKey = buildManagedSubmoduleKey(runId, canonicalUrl);
    setGeneratingSubmoduleCommitDraftKey(submoduleKey);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.generateTicketRunSubmoduleCommitDraft(runId, canonicalUrl);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionSubmodule(runId, canonicalUrl)) {
        setSelectedSubmoduleGitState(result.gitState);
        setSubmoduleCommitDraft(result.gitState.commitMessageDraft ?? "");
        setSubmoduleCommitDraftDirty(false);
      }
      setGitNotice(`${result.run.ticketId} commit draft refreshed for submodule ${result.gitState.name}.`);
    } catch (error) {
      console.error("Failed to generate managed submodule commit draft", error);
      setGitError(error instanceof Error ? error.message : "Failed to generate the managed submodule commit draft.");
    } finally {
      setGeneratingSubmoduleCommitDraftKey((current) => (current === submoduleKey ? null : current));
    }
  };

  const persistSubmoduleCommitDraft = async (
    runId: string,
    canonicalUrl = selectedSubmoduleCanonicalUrl,
  ): Promise<void> => {
    if (!canonicalUrl) {
      return;
    }

    const submoduleKey = buildManagedSubmoduleKey(runId, canonicalUrl);
    setSavingSubmoduleCommitDraftKey(submoduleKey);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.setTicketRunSubmoduleCommitDraft(
        runId,
        canonicalUrl,
        submoduleCommitDraft,
      );
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionSubmodule(runId, canonicalUrl)) {
        setSelectedSubmoduleGitState(result.gitState);
        setSubmoduleCommitDraft(result.gitState.commitMessageDraft ?? "");
        setSubmoduleCommitDraftDirty(false);
      }
    } catch (error) {
      console.error("Failed to save managed submodule commit draft", error);
      setGitError(error instanceof Error ? error.message : "Failed to save the managed submodule commit draft.");
    } finally {
      setSavingSubmoduleCommitDraftKey((current) => (current === submoduleKey ? null : current));
    }
  };

  const commitMissionSubmodule = async (runId: string, canonicalUrl = selectedSubmoduleCanonicalUrl): Promise<void> => {
    if (!canonicalUrl) {
      return;
    }

    const submoduleKey = buildManagedSubmoduleKey(runId, canonicalUrl);
    setCommittingSubmoduleKey(submoduleKey);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.commitTicketRunSubmodule(runId, canonicalUrl, submoduleCommitDraft);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionSubmodule(runId, canonicalUrl)) {
        setSelectedSubmoduleGitState(result.gitState);
        setSubmoduleCommitDraft("");
        setSubmoduleCommitDraftDirty(false);
      }
      await refreshSelectedRepoAfterSubmoduleAction(runId);
      setGitNotice(`${result.run.ticketId} committed managed submodule ${result.gitState.name}.`);
      await refreshSelectedMissionReviewSnapshot(runId);
    } catch (error) {
      console.error("Failed to commit managed submodule", error);
      setGitError(error instanceof Error ? error.message : "Failed to commit the managed submodule.");
    } finally {
      setCommittingSubmoduleKey((current) => (current === submoduleKey ? null : current));
    }
  };

  const syncSubmoduleRemote = async (
    runId: string,
    action: "publish" | "push",
    canonicalUrl = selectedSubmoduleCanonicalUrl,
  ): Promise<void> => {
    if (!canonicalUrl) {
      return;
    }

    const submoduleKey = buildManagedSubmoduleKey(runId, canonicalUrl);
    const alignmentOnly =
      action === "push" && selectedSubmoduleGitState?.pushAction === "none" && selectedSubmoduleNeedsAlignment;
    setSyncingSubmoduleKey(submoduleKey);
    setGitNotice(null);
    setGitError(null);
    try {
      const result =
        action === "publish"
          ? await window.electronAPI.publishTicketRunSubmodule(runId, canonicalUrl)
          : await window.electronAPI.pushTicketRunSubmodule(runId, canonicalUrl);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionSubmodule(runId, canonicalUrl)) {
        setSelectedSubmoduleGitState(result.gitState);
      }
      await refreshSelectedRepoAfterSubmoduleAction(runId);
      setGitNotice(
        alignmentOnly
          ? `${result.run.ticketId} aligned every parent repo to managed submodule ${result.gitState.name}.`
          : result.action === "publish"
            ? `${result.run.ticketId} published managed submodule ${result.gitState.name} to origin/${result.gitState.branchName}.`
            : `${result.run.ticketId} pushed managed submodule ${result.gitState.name} to origin/${result.gitState.branchName}.`,
      );
      await refreshSelectedMissionReviewSnapshot(runId);
    } catch (error) {
      console.error("Failed to sync managed submodule remote", error);
      setGitError(error instanceof Error ? error.message : "Failed to sync the managed submodule branch.");
    } finally {
      setSyncingSubmoduleKey((current) => (current === submoduleKey ? null : current));
    }
  };

  const openSubmodulePullRequest = async (
    runId: string,
    canonicalUrl = selectedSubmoduleCanonicalUrl,
  ): Promise<void> => {
    if (!canonicalUrl) {
      return;
    }

    const submoduleKey = buildManagedSubmoduleKey(runId, canonicalUrl);
    setCreatingSubmodulePullRequestKey(submoduleKey);
    setGitNotice(null);
    setGitError(null);
    try {
      const result = await window.electronAPI.createTicketRunSubmodulePullRequest(runId, canonicalUrl);
      setRunSnapshot(result.snapshot);
      if (isSelectedMissionSubmodule(runId, canonicalUrl)) {
        setSelectedSubmoduleGitState(result.gitState);
      }
      await window.electronAPI.openExternal(result.pullRequestUrl);
      setGitNotice(`${result.run.ticketId} pull request opened for managed submodule ${result.gitState.name}.`);
      await refreshSelectedMissionReviewSnapshot(runId);
    } catch (error) {
      console.error("Failed to open managed submodule pull request", error);
      setGitError(error instanceof Error ? error.message : "Failed to open the managed submodule pull request.");
    } finally {
      setCreatingSubmodulePullRequestKey((current) => (current === submoduleKey ? null : current));
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
      if (result.run.status === "error" || result.run.status === "blocked") {
        setMissionFlash(result.run.runId, {
          tone: "error",
          message: result.run.statusMessage ?? `Missions could not fully start ${ticket.id}.`,
        });
      } else {
        setMissionFlash(result.run.runId, {
          tone: "notice",
          message: result.reusedExistingRun
            ? `${ticket.id} already had a managed run, so Missions reused it.`
            : `${ticket.id} is now active across ${result.run.worktrees.length} managed worktree${
                result.run.worktrees.length === 1 ? "" : "s"
              }.`,
        });
      }
      openRunMissionDetail(result.run.runId, "details");
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
      if (result.run.status === "blocked") {
        setMissionFlash(result.run.runId, {
          tone: "error",
          message: result.run.statusMessage ?? `Missions still could not sync ${result.run.ticketId}.`,
        });
      } else {
        setMissionFlash(result.run.runId, {
          tone: "notice",
          message: `${result.run.ticketId} is now synced with YouTrack.`,
        });
      }
      openRunMissionDetail(result.run.runId, "details");
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
      const result = await window.electronAPI.startTicketRunWork(runId, continueDrafts[runId]?.trim() || undefined);
      setRunSnapshot(result.snapshot);
      setContinueDrafts((current) => ({ ...current, [runId]: "" }));
      setMissionFlash(result.run.runId, {
        tone: "notice",
        message: `${result.run.ticketId} is now actively working.`,
      });
      openRunMissionDetail(result.run.runId, "bridge");
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
      setContinueDrafts((current) => ({ ...current, [runId]: "" }));
      setMissionFlash(result.run.runId, {
        tone: "notice",
        message: result.reusedLiveAttempt
          ? `${result.run.ticketId} resumed in its existing mission station.`
          : `${result.run.ticketId} started a fresh follow-up pass.`,
      });
      openRunMissionDetail(result.run.runId, "bridge");
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
      setMissionFlash(result.run.runId, {
        tone: "notice",
        message: `${result.run.ticketId} stopped its active pass and is ready for review.`,
      });
      openRunMissionDetail(result.run.runId, "details");
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
      setSelectedMissionReviewSnapshot(null);
      setMissionFlash(result.run.runId, {
        tone: "notice",
        message: `${result.run.ticketId} was closed.`,
      });
      openRunMissionDetail(result.run.runId, "details");
    } catch (completeError) {
      console.error("Failed to close mission", completeError);
      setRunError(completeError instanceof Error ? completeError.message : "Failed to close the mission.");
    } finally {
      setCompletingRunId(null);
    }
  };

  const deleteRun = async (runId: string) => {
    setDeletingRunId(runId);
    setRunNotice(null);
    setRunError(null);
    try {
      const reviewSnapshot = await refreshSelectedMissionReviewSnapshot(runId);
      if (!reviewSnapshot) {
        return;
      }
      if (!reviewSnapshot.canDelete) {
        setRunError(
          `Delete is disabled because published branches were found: ${
            reviewSnapshot.deleteBlockers.map((blocker) => `${blocker.label}: ${blocker.reason}`).join("; ") ||
            "state is unresolved"
          }.`,
        );
        return;
      }
      const result = await window.electronAPI.deleteTicketRun(runId);
      setRunSnapshot(result.snapshot);
      setSelectedMissionReviewSnapshot(null);
      setSelectedMissionServices(null);
      setSelectedMission(null);
      setSelectedGitState(null);
      setSelectedSubmoduleGitState(null);
      setRunNotice(`${result.ticketId} was deleted locally.`);
    } catch (deleteError) {
      console.error("Failed to delete mission", deleteError);
      setRunError(deleteError instanceof Error ? deleteError.message : "Failed to delete the mission.");
    } finally {
      setDeletingRunId(null);
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
          <ProjectsPanelMissionDetail
            missionDetailBackLabel={missionDetailBackLabel}
            missionSectionLabel={activeTab === "quarterdeck" ? "Mission" : missionDetailBackLabel}
            selectedMissionUrl={selectedMissionUrl}
            selectedMissionRun={selectedMissionRun}
            selectedMissionTicket={selectedMissionTicket}
            selectedMissionProjectKey={selectedMissionProjectKey}
            selectedMissionIsMapped={selectedMissionIsMapped}
            selectedMissionRepoCount={selectedMissionRepoCount}
            selectedMissionStation={selectedMissionStation}
            runNotice={runNotice}
            runError={runError}
            selectedMissionBlocker={selectedMissionBlocker}
            startingTicketId={startingTicketId}
            syncingRunId={syncingRunId}
            startingWorkRunId={startingWorkRunId}
            continuingRunId={continuingRunId}
            cancellingRunId={cancellingRunId}
            completingRunId={completingRunId}
            deletingRunId={deletingRunId}
            isSelectedMissionReviewLoading={isSelectedMissionReviewLoading}
            canDeleteSelectedMission={canDeleteSelectedMission}
            selectedMissionDeleteBlockers={selectedMissionDeleteBlockers}
            hasSelectedMissionReviewCloseBlockers={hasSelectedMissionReviewCloseBlockers}
            currentContinueDraft={selectedMissionRun ? (continueDrafts[selectedMissionRun.runId] ?? "") : ""}
            selectedMissionLatestAttempt={selectedMissionLatestAttempt}
            selectedMissionGitRepoLabel={selectedMissionGitRepoLabel}
            gitNotice={gitNotice}
            gitError={gitError}
            selectedMissionBlockingSubmoduleNames={selectedMissionBlockingSubmoduleNames}
            showRepoPullRequestActions={showRepoPullRequestActions}
            creatingPullRequestRunId={creatingPullRequestRunId}
            selectedGitState={selectedGitState}
            commitDraft={commitDraft}
            generatingCommitDraftRunId={generatingCommitDraftRunId}
            savingCommitDraftRunId={savingCommitDraftRunId}
            committingGitRunId={committingGitRunId}
            syncingRemoteRunId={syncingRemoteRunId}
            selectedMissionSubmodule={selectedMissionSubmodule}
            selectedMissionSubmoduleLabel={selectedMissionSubmoduleLabel}
            selectedSubmoduleGitState={selectedSubmoduleGitState}
            selectedSubmoduleKey={selectedSubmoduleKey}
            loadingSubmoduleKey={loadingSubmoduleKey}
            showSubmodulePullRequestActions={showSubmodulePullRequestActions}
            creatingSubmodulePullRequestKey={creatingSubmodulePullRequestKey}
            submoduleCommitDraft={submoduleCommitDraft}
            savingSubmoduleCommitDraftKey={savingSubmoduleCommitDraftKey}
            generatingSubmoduleCommitDraftKey={generatingSubmoduleCommitDraftKey}
            committingSubmoduleKey={committingSubmoduleKey}
            syncingSubmoduleKey={syncingSubmoduleKey}
            selectedSubmoduleCanSync={selectedSubmoduleCanSync}
            selectedSubmoduleSyncLabel={selectedSubmoduleSyncLabel}
            selectedSubmoduleNeedsAlignment={selectedSubmoduleNeedsAlignment}
            expandedDiffPaths={expandedDiffPaths}
            selectedMissionWorktree={selectedMissionWorktree}
            selectedMissionRunWorktreeCount={selectedMissionRunWorktreeCount}
            loadingServicesRunId={loadingServicesRunId}
            serviceNotice={serviceNotice}
            serviceError={serviceError}
            selectedMissionServicesSnapshot={selectedMissionServicesSnapshot}
            missionServiceProfilesByRepo={missionServiceProfilesByRepo}
            activeMissionServiceProfileIds={activeMissionServiceProfileIds}
            startingServiceProfileId={startingServiceProfileId}
            selectedMissionServiceProcesses={selectedMissionServiceProcesses}
            stoppingServiceId={stoppingServiceId}
            loadingGitRunId={loadingGitRunId}
            onCloseMissionDetail={closeMissionDetail}
            onFocusRunStation={selectedMissionRun?.stationId ? () => focusRunStation(selectedMissionRun) : null}
            onStartTicketRun={selectedMissionTicket ? () => startTicketRun(selectedMissionTicket) : null}
            onRetryTicketRunSync={selectedMissionRun ? () => retryTicketRunSync(selectedMissionRun.runId) : null}
            onStartRunWork={selectedMissionRun ? () => startRunWork(selectedMissionRun.runId) : null}
            onContinueDraftChange={(value: string) => {
              if (!selectedMissionRun) {
                return;
              }
              setContinueDrafts((current) => ({ ...current, [selectedMissionRun.runId]: value }));
            }}
            onCancelRunWork={selectedMissionRun ? () => cancelRunWork(selectedMissionRun.runId) : null}
            onContinueRunWork={selectedMissionRun ? () => continueRunWork(selectedMissionRun.runId) : null}
            onCompleteRun={selectedMissionRun ? () => completeRun(selectedMissionRun.runId) : null}
            onDeleteRun={selectedMissionRun ? () => deleteRun(selectedMissionRun.runId) : null}
            onOpenMissionPullRequest={
              selectedMissionRun ? () => openMissionPullRequest(selectedMissionRun.runId) : null
            }
            onCommitDraftChange={(value: string) => {
              setCommitDraft(value);
              setCommitDraftDirty(true);
            }}
            onPersistCommitDraft={
              selectedMissionRun
                ? () => {
                    if (!commitDraftDirty) {
                      return Promise.resolve();
                    }
                    return persistCommitDraft(selectedMissionRun.runId);
                  }
                : null
            }
            onGenerateCommitDraft={selectedMissionRun ? () => generateCommitDraft(selectedMissionRun.runId) : null}
            onCommitMissionRun={selectedMissionRun ? () => commitMissionRun(selectedMissionRun.runId) : null}
            onSyncMissionRemote={(action: "publish" | "push") =>
              selectedMissionRun ? syncMissionRemote(selectedMissionRun.runId, action) : Promise.resolve()
            }
            onRefreshSelectedSubmoduleGitState={refreshSelectedSubmoduleGitState}
            onSelectSubmodule={(canonicalUrl: string) => {
              setSelectedSubmoduleCanonicalUrl(canonicalUrl);
              setSelectedSubmoduleGitState(null);
            }}
            onOpenSubmodulePullRequest={openSubmodulePullRequest}
            onSubmoduleCommitDraftChange={(value: string) => {
              setSubmoduleCommitDraft(value);
              setSubmoduleCommitDraftDirty(true);
            }}
            onPersistSubmoduleCommitDraft={(runId: string) => {
              if (!submoduleCommitDraftDirty) {
                return Promise.resolve();
              }
              return persistSubmoduleCommitDraft(runId);
            }}
            onGenerateSubmoduleCommitDraft={generateSubmoduleCommitDraft}
            onCommitMissionSubmodule={commitMissionSubmodule}
            onSyncSubmoduleRemote={syncSubmoduleRemote}
            onToggleExpandedDiff={(expandedKey: string) =>
              setExpandedDiffPaths((current) => ({ ...current, [expandedKey]: !current[expandedKey] }))
            }
            onSelectRepo={(repoRelativePath: string) => {
              setSelectedRepoRelativePath(repoRelativePath);
              setSelectedGitState(null);
            }}
            onRefreshMissionServices={
              selectedMissionRun ? () => refreshMissionServices(selectedMissionRun.runId) : null
            }
            onStartMissionService={(profile: MissionServiceProfileSummary) =>
              selectedMissionRun ? startMissionService(selectedMissionRun.runId, profile) : Promise.resolve()
            }
            onStopMissionService={(process: MissionServiceProcessSummary) =>
              selectedMissionRun ? stopMissionService(selectedMissionRun.runId, process) : Promise.resolve()
            }
            onRefreshMissionGitState={
              selectedMissionRun ? () => refreshMissionGitState(selectedMissionRun.runId) : null
            }
          />
        ) : null}

        <ProjectsPanelQuarterdeck
          hidden={activeTab !== "quarterdeck" || selectedMission !== null}
          editorRef={editorRef}
          youTrackEnabled={youTrackEnabled}
          isRefreshing={isRefreshing}
          youTrackStatus={youTrackStatus}
          hasWorkflowChanges={hasWorkflowChanges}
          workflowBlocker={workflowBlocker}
          youTrackStateMappingDraft={youTrackStateMappingDraft}
          workflowValidation={workflowValidation}
          isSavingWorkflow={isSavingWorkflow}
          workflowNotice={workflowNotice}
          workflowError={workflowError}
          canSaveWorkflow={canSaveWorkflow}
          workspaceRootDraft={workspaceRootDraft}
          isBrowsingWorkspace={isBrowsingWorkspace}
          isSavingWorkspace={isSavingWorkspace}
          workspaceNotice={workspaceNotice}
          workspaceError={workspaceError}
          setupSummary={setupSummary}
          isEditorOpen={isEditorOpen}
          mappingBlocker={mappingBlocker}
          canSearchProjects={canSearchProjects}
          projectKeyDraft={projectKeyDraft}
          isSavingMapping={isSavingMapping}
          snapshot={snapshot}
          selectedRepoPaths={selectedRepoPaths}
          activeProjectKey={activeProjectKey}
          canSaveMapping={canSaveMapping}
          mappingNotice={mappingNotice}
          mappingError={mappingError}
          canManageMappings={canManageMappings}
          onToggleYouTrackIntegration={toggleYouTrackIntegration}
          onOpenSettings={() => setView("settings")}
          onUpdateWorkflowStateList={updateWorkflowStateList}
          onResetWorkflowMappingDraft={resetWorkflowMappingDraft}
          onSaveWorkflowMapping={saveWorkflowMapping}
          onRefreshData={refreshData}
          onWorkspaceRootDraftChange={setWorkspaceRootDraft}
          onBrowseForWorkspace={browseForWorkspace}
          onResetWorkspaceRoot={() => setWorkspaceRootDraft("")}
          onSaveWorkspaceRoot={saveWorkspaceRoot}
          onProjectKeyDraftChange={setProjectKeyDraft}
          onResolvedProjectChange={setVerifiedProject}
          onToggleRepoSelection={toggleRepoSelection}
          onResetEditor={resetEditor}
          onSaveMapping={saveMapping}
          onCreateMapping={openNewMapping}
          onEditMapping={editMapping}
        />

        <ProjectsPanelMissionLanes
          activeTab={activeTab}
          isMissionDetailOpen={selectedMission !== null}
          isRefreshing={isRefreshing}
          runNotice={runNotice}
          runError={runError}
          ticketError={ticketError}
          youTrackConnected={youTrackStatus?.state === "connected"}
          pendingTickets={pendingTickets}
          activeRuns={activeRuns}
          completedRuns={completedRuns}
          mappedProjectKeySet={mappedProjectKeySet}
          mappedRepoCountByProject={mappedRepoCountByProject}
          runByTicketId={runByTicketId}
          ticketById={ticketById}
          stationMap={stationMap}
          startingTicketId={startingTicketId}
          syncingRunId={syncingRunId}
          startingWorkRunId={startingWorkRunId}
          cancellingRunId={cancellingRunId}
          onRefreshData={refreshData}
          onOpenRunMissionDetail={openRunMissionDetail}
          onOpenTicketMissionDetail={(ticketId) => openTicketMissionDetail(ticketId, "launch-bay")}
          onStartTicketRun={startTicketRun}
          onRetryTicketRunSync={retryTicketRunSync}
          onStartRunWork={startRunWork}
          onCancelRunWork={cancelRunWork}
          onFocusRunStation={focusRunStation}
        />
      </div>
    </div>
  );
}
