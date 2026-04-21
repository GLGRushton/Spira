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
  normalizeYouTrackStateMapping,
} from "@spira/shared";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMissionRunsStore } from "../../stores/mission-runs-store.js";
import { useNavigationStore } from "../../stores/navigation-store.js";
import { useSettingsStore } from "../../stores/settings-store.js";
import { useStationStore } from "../../stores/station-store.js";
import { ProjectTypeahead } from "./ProjectTypeahead.js";
import { ProjectsMappingsList } from "./ProjectsMappingsList.js";
import styles from "./ProjectsPanel.module.css";
import { ProjectsRepoChecklist } from "./ProjectsRepoChecklist.js";
import { YouTrackStateListEditor } from "./YouTrackStateListEditor.js";
import { type MissionLaneTabId, buildRunByTicketId, resolveRunTab, splitMissionCollections } from "./mission-utils.js";
import { normalizeProjectKey } from "./project-utils.js";
import { assessYouTrackStateMappingDraft, haveYouTrackStateMappingsChanged } from "./youtrack-state-mapping-utils.js";

const EMPTY_SNAPSHOT: ProjectRepoMappingsSnapshot = {
  workspaceRoot: null,
  repos: [],
  mappings: [],
};

const NEW_MAPPING_SENTINEL = "__new__";
const YOUTRACK_TICKET_LIST_LIMIT = 50;
type MissionsTabId = "quarterdeck" | MissionLaneTabId;
type MissionSelection = { kind: "ticket"; ticketId: string } | { kind: "run"; runId: string };
const MISSIONS_TAB_ORDER: MissionsTabId[] = ["quarterdeck", "launch-bay", "flight-deck", "dry-dock"];
const buildManagedSubmoduleKey = (runId: string, canonicalUrl: string): string => `${runId}:${canonicalUrl}`;
const ACTIVE_MISSION_SERVICE_STATES = new Set<MissionServiceProcessSummary["state"]>([
  "starting",
  "running",
  "stopping",
]);

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

const cloneYouTrackStateMapping = (
  mapping: YouTrackStateMapping | null | undefined = DEFAULT_YOUTRACK_STATE_MAPPING,
): YouTrackStateMapping => normalizeYouTrackStateMapping(mapping);

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

const isMissionServiceProcessActive = (process: MissionServiceProcessSummary): boolean =>
  ACTIVE_MISSION_SERVICE_STATES.has(process.state);

const describeMissionServiceLauncher = (
  profile: MissionServiceProfileSummary | MissionServiceProcessSummary,
): string => {
  switch (profile.launcher) {
    case "translated-iisexpress":
      return "IIS Express profile (translated)";
    default:
      return "Project profile";
  }
};

const describeMissionServiceState = (state: MissionServiceProcessSummary["state"]): string => {
  switch (state) {
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
  }
};

const getMissionServiceStateTone = (state: MissionServiceProcessSummary["state"]): string => {
  switch (state) {
    case "starting":
      return styles.serviceStateStarting;
    case "running":
      return styles.serviceStateRunning;
    case "stopping":
      return styles.serviceStateStopping;
    case "error":
      return styles.serviceStateError;
    default:
      return styles.serviceStateStopped;
  }
};

const formatMissionServiceUrls = (urls: string[]): string => (urls.length > 0 ? urls.join(" • ") : "No URL declared");

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

  if (repoCount === 0) {
    return "Map a repo first";
  }

  return null;
};

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
  const canCloseSelectedMission = selectedMissionReviewSnapshot?.canClose ?? false;
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
      const result = await window.electronAPI.startTicketRunWork(runId);
      setRunSnapshot(result.snapshot);
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
      const reviewSnapshot = await refreshSelectedMissionReviewSnapshot(runId);
      if (!reviewSnapshot) {
        return;
      }
      if (!reviewSnapshot.canClose) {
        setRunError("Finish the remaining repo and managed submodule review work before closing this mission.");
        return;
      }
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
                  <span className={styles.workMeta}>
                    The mission workspace is prepared. Spira has not started coding yet.
                  </span>
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
                      disabled={
                        completingRunId === selectedMissionRun.runId ||
                        isSelectedMissionReviewLoading ||
                        !canCloseSelectedMission
                      }
                    >
                      {completingRunId === selectedMissionRun.runId
                        ? "Closing..."
                        : isSelectedMissionReviewLoading
                          ? "Checking..."
                          : "Close mission"}
                    </button>
                  </div>
                  {selectedMissionReviewSnapshot !== null && !canCloseSelectedMission ? (
                    <div className={styles.workHint}>
                      Finish the remaining repo and managed submodule review work before closing this mission.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedMissionRun ? (
                <div className={styles.reviewPanel}>
                  <div className={styles.sectionLabel}>Local teardown</div>
                  <div className={styles.workHint}>
                    Delete removes local mission worktrees and unpublished mission branches, then forgets the run.
                  </div>
                  <div className={styles.inlineActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete mission ${selectedMissionRun.ticketId}? This removes local worktrees and unpublished mission branches.`,
                          )
                        ) {
                          void deleteRun(selectedMissionRun.runId);
                        }
                      }}
                      disabled={
                        deletingRunId === selectedMissionRun.runId ||
                        isSelectedMissionReviewLoading ||
                        !canDeleteSelectedMission
                      }
                    >
                      {deletingRunId === selectedMissionRun.runId
                        ? "Deleting..."
                        : isSelectedMissionReviewLoading
                          ? "Checking..."
                          : "Delete mission"}
                    </button>
                  </div>
                  {selectedMissionReviewSnapshot !== null && !canDeleteSelectedMission ? (
                    <div className={styles.workHint}>
                      Delete is disabled because published branches were found:{" "}
                      {selectedMissionDeleteBlockers ?? "state is unresolved"}.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedMissionRun?.status === "awaiting-review" ? (
                <div className={styles.reviewPanel}>
                  {gitNotice ? <div className={styles.notice}>{gitNotice}</div> : null}
                  {gitError ? <div className={styles.error}>{gitError}</div> : null}
                  {selectedMissionGitRepoLabel ? (
                    <div className={styles.workHint}>Active repo: {selectedMissionGitRepoLabel}</div>
                  ) : null}
                  {selectedMissionBlockingSubmoduleNames.length > 0 ? (
                    <div className={styles.blockedState}>
                      Finish the managed submodule workflow first: {selectedMissionBlockingSubmoduleNames.join(", ")}.
                    </div>
                  ) : null}
                  {showRepoPullRequestActions ? (
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
                        <span>
                          {selectedMissionGitRepoLabel
                            ? `Commit draft - ${selectedMissionGitRepoLabel}`
                            : "Commit draft"}
                        </span>
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
                            selectedMissionBlockingSubmoduleNames.length > 0 ||
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
                            selectedMissionBlockingSubmoduleNames.length > 0 ||
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
                        {selectedMissionBlockingSubmoduleNames.length > 0
                          ? "Managed submodules still need to be committed, published, or aligned before this repo can move."
                          : selectedGitState?.hasDiff
                            ? "Changes are still waiting to be committed."
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

            {selectedMissionRun?.submodules.length ? (
              <article className={styles.detailCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionLabel}>Managed submodules</div>
                    <div className={styles.sectionCaption}>
                      Shared submodule work is committed, published, and PR&apos;d once here before the parent repos
                      take their turn.
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void refreshSelectedSubmoduleGitState(selectedMissionRun.runId)}
                    disabled={!selectedMissionSubmodule || loadingSubmoduleKey === selectedSubmoduleKey}
                  >
                    {loadingSubmoduleKey === selectedSubmoduleKey ? "Refreshing..." : "Refresh submodule"}
                  </button>
                </div>

                <div className={styles.repoTabBar} role="tablist" aria-label="Managed submodules">
                  {selectedMissionRun.submodules.map((submodule) => {
                    const isActive = selectedMissionSubmodule?.canonicalUrl === submodule.canonicalUrl;
                    return (
                      <button
                        key={`${selectedMissionRun.runId}-${submodule.canonicalUrl}-tab`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`${styles.repoTabButton} ${isActive ? styles.repoTabButtonActive : ""}`}
                        onClick={() => {
                          setSelectedSubmoduleCanonicalUrl(submodule.canonicalUrl);
                          setSelectedSubmoduleGitState(null);
                        }}
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
                          Consolidate the wanted submodule edits into one parent copy, discard the conflicting duplicate
                          edits in the others, then refresh the managed submodule state.
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

                    {selectedMissionRun.status !== "awaiting-review" ? (
                      <div className={styles.workHint}>
                        Finish the active mission pass before committing, publishing, or opening pull requests for
                        managed submodules.
                      </div>
                    ) : showSubmodulePullRequestActions ? (
                      <>
                        <div className={styles.sectionLabel}>Pull request</div>
                        <div className={styles.inlineActions}>
                          <button
                            type="button"
                            className={styles.actionLinkButton}
                            onClick={() => void openSubmodulePullRequest(selectedMissionRun.runId)}
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
                            disabled={
                              selectedMissionRun.status !== "awaiting-review" ||
                              savingSubmoduleCommitDraftKey === selectedSubmoduleKey
                            }
                            onChange={(event) => {
                              setSubmoduleCommitDraft(event.target.value);
                              setSubmoduleCommitDraftDirty(true);
                            }}
                            onBlur={() => {
                              if (submoduleCommitDraftDirty) {
                                void persistSubmoduleCommitDraft(selectedMissionRun.runId);
                              }
                            }}
                            placeholder={`feat(${selectedMissionRun.ticketId}): summary`}
                          />
                        </label>
                        <div className={styles.inlineActions}>
                          <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => void generateSubmoduleCommitDraft(selectedMissionRun.runId)}
                            disabled={
                              selectedMissionRun.status !== "awaiting-review" ||
                              generatingSubmoduleCommitDraftKey === selectedSubmoduleKey ||
                              savingSubmoduleCommitDraftKey === selectedSubmoduleKey
                            }
                          >
                            {generatingSubmoduleCommitDraftKey === selectedSubmoduleKey
                              ? "Regenerating..."
                              : "Regenerate"}
                          </button>
                          <button
                            type="button"
                            className={styles.actionButton}
                            onClick={() => void commitMissionSubmodule(selectedMissionRun.runId)}
                            disabled={
                              selectedMissionRun.status !== "awaiting-review" ||
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
                              void syncSubmoduleRemote(
                                selectedMissionRun.runId,
                                selectedSubmoduleGitState.pushAction === "publish" ? "publish" : "push",
                              )
                            }
                            disabled={
                              selectedMissionRun.status !== "awaiting-review" ||
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
                            ? (selectedSubmoduleGitState.reconcileReason ??
                              "This managed submodule needs reconciliation.")
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
                                onClick={() =>
                                  setExpandedDiffPaths((current) => ({ ...current, [expandedKey]: !expanded }))
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
                      <div className={styles.emptyState}>
                        No tracked diff remains in the selected managed submodule.
                      </div>
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
            ) : null}

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

            {selectedMissionRun && selectedMissionRun.worktrees.length > 1 ? (
              <article className={styles.detailCard}>
                <div className={styles.sectionLabel}>Parent repos</div>
                <div className={styles.repoTabBar} role="tablist" aria-label="Mission repositories">
                  {selectedMissionRun.worktrees.map((worktree) => {
                    const isActive = selectedMissionWorktree?.repoRelativePath === worktree.repoRelativePath;
                    return (
                      <button
                        key={`${selectedMissionRun.runId}-${worktree.repoRelativePath}-tab`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`${styles.repoTabButton} ${isActive ? styles.repoTabButtonActive : ""}`}
                        onClick={() => {
                          setSelectedRepoRelativePath(worktree.repoRelativePath);
                          setSelectedGitState(null);
                        }}
                      >
                        <span>{worktree.repoRelativePath}</span>
                        <span className={styles.repoTabMeta}>{worktree.branchName}</span>
                      </button>
                    );
                  })}
                </div>
              </article>
            ) : null}

            {selectedMissionRun ? (
              <article className={styles.detailCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionLabel}>Services</div>
                    <div className={styles.sectionCaption}>
                      {selectedMissionWorktree && selectedMissionRunWorktreeCount > 1
                        ? `Launch profiles are filtered to ${selectedMissionWorktree.repoRelativePath}. `
                        : ""}
                      Active processes remain mission-wide, no matter which repo tab you are staring at.
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void refreshMissionServices(selectedMissionRun.runId)}
                    disabled={loadingServicesRunId === selectedMissionRun.runId}
                  >
                    {loadingServicesRunId === selectedMissionRun.runId ? "Refreshing..." : "Refresh services"}
                  </button>
                </div>

                {serviceNotice ? <div className={styles.notice}>{serviceNotice}</div> : null}
                {serviceError ? <div className={styles.error}>{serviceError}</div> : null}

                <div className={styles.serviceSection}>
                  <div className={styles.sectionLabel}>Launch profiles</div>
                  {selectedMissionServicesSnapshot ? (
                    missionServiceProfilesByRepo.length > 0 ? (
                      <div className={styles.serviceGroupList}>
                        {missionServiceProfilesByRepo.map(([repoRelativePath, profiles]) => (
                          <div key={`${selectedMissionRun.runId}:${repoRelativePath}`} className={styles.serviceGroup}>
                            <div className={styles.serviceGroupHeader}>
                              <span className={styles.pathBadge}>{repoRelativePath}</span>
                              <span className={styles.repoTabMeta}>
                                {profiles.length} profile{profiles.length === 1 ? "" : "s"}
                              </span>
                            </div>
                            <div className={styles.serviceCardList}>
                              {profiles.map((profile) => {
                                const profileUrl = profile.launchUrl ?? profile.urls[0] ?? null;
                                const isRunning = activeMissionServiceProfileIds.has(profile.profileId);
                                return (
                                  <div
                                    key={profile.profileId}
                                    className={`${styles.serviceCard} ${
                                      profile.isLaunchable ? "" : styles.serviceCardUnavailable
                                    }`}
                                  >
                                    <div className={styles.workHeader}>
                                      <div className={styles.workHeaderCopy}>
                                        <strong>{profile.profileName}</strong>
                                        <span className={styles.repoTabMeta}>
                                          {describeMissionServiceLauncher(profile)}
                                        </span>
                                      </div>
                                      <div className={styles.inlineActions}>
                                        {profileUrl ? (
                                          <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => void window.electronAPI.openExternal(profileUrl)}
                                          >
                                            Open URL
                                          </button>
                                        ) : null}
                                        <button
                                          type="button"
                                          className={
                                            profile.isLaunchable ? styles.actionButton : styles.secondaryButton
                                          }
                                          onClick={() => void startMissionService(selectedMissionRun.runId, profile)}
                                          disabled={
                                            !profile.isLaunchable ||
                                            isRunning ||
                                            startingServiceProfileId === profile.profileId
                                          }
                                        >
                                          {startingServiceProfileId === profile.profileId
                                            ? "Starting..."
                                            : isRunning
                                              ? "Running"
                                              : "Start"}
                                        </button>
                                      </div>
                                    </div>
                                    <div className={styles.inlineRunFacts}>
                                      <div className={styles.inlineRunFact}>
                                        <strong>Project</strong>
                                        {profile.projectRelativePath}
                                      </div>
                                      <div className={styles.inlineRunFact}>
                                        <strong>URLs</strong>
                                        {formatMissionServiceUrls(profile.urls)}
                                      </div>
                                      <div className={styles.inlineRunFact}>
                                        <strong>Environment</strong>
                                        {profile.environmentName ?? "Default"}
                                      </div>
                                      <div className={styles.inlineRunFact}>
                                        <strong>Launch settings</strong>
                                        {profile.launchSettingsRelativePath}
                                      </div>
                                    </div>
                                    {!profile.isLaunchable && profile.unavailableReason ? (
                                      <div className={styles.blockedState}>{profile.unavailableReason}</div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.emptyState}>
                        {selectedMissionWorktree && selectedMissionRunWorktreeCount > 1
                          ? `No runnable service profiles found in ${selectedMissionWorktree.repoRelativePath}.`
                          : "No runnable service profiles found."}
                      </div>
                    )
                  ) : loadingServicesRunId === selectedMissionRun.runId ? (
                    <div className={styles.emptyState}>Loading mission services...</div>
                  ) : (
                    <div className={styles.emptyState}>Mission services are waiting to load.</div>
                  )}
                </div>

                <div className={styles.serviceSection}>
                  <div className={styles.sectionLabel}>Tracked processes</div>
                  <div className={styles.sectionCaption}>Started services remain visible across all repo tabs.</div>
                  {selectedMissionServiceProcesses.length > 0 ? (
                    <div className={styles.serviceCardList}>
                      {selectedMissionServiceProcesses.map((process) => {
                        const processTone = getMissionServiceStateTone(process.state);
                        const processUrl = process.launchUrl ?? process.urls[0] ?? null;
                        const stdoutLogLines = process.recentLogLines.filter((line) => line.source === "stdout");
                        return (
                          <div key={process.serviceId} className={`${styles.serviceCard} ${processTone}`}>
                            <div className={styles.workHeader}>
                              <div className={styles.workHeaderCopy}>
                                <strong>{process.profileName}</strong>
                                <span className={styles.repoTabMeta}>
                                  {process.repoRelativePath} • {describeMissionServiceLauncher(process)}
                                </span>
                              </div>
                              <div className={styles.inlineActions}>
                                <span className={`${styles.statusBadge} ${processTone}`}>
                                  {describeMissionServiceState(process.state)}
                                </span>
                                {processUrl ? (
                                  <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => void window.electronAPI.openExternal(processUrl)}
                                  >
                                    Open URL
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={
                                    isMissionServiceProcessActive(process)
                                      ? styles.secondaryButton
                                      : styles.actionButton
                                  }
                                  onClick={() => void stopMissionService(selectedMissionRun.runId, process)}
                                  disabled={
                                    !isMissionServiceProcessActive(process) || stoppingServiceId === process.serviceId
                                  }
                                >
                                  {stoppingServiceId === process.serviceId
                                    ? "Stopping..."
                                    : isMissionServiceProcessActive(process)
                                      ? "Stop"
                                      : "Stopped"}
                                </button>
                              </div>
                            </div>
                            {process.errorMessage ? <div className={styles.error}>{process.errorMessage}</div> : null}
                            {stdoutLogLines.length > 0 ? (
                              <div className={styles.serviceLogTail}>
                                {stdoutLogLines.map((line, index) => (
                                  <div
                                    key={`${process.serviceId}:${line.timestamp}:${index}`}
                                    className={styles.serviceLogLine}
                                  >
                                    {line.line}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={styles.workHint}>No stdout yet.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className={styles.emptyState}>No mission services have been started yet.</div>
                  )}
                </div>
              </article>
            ) : null}

            {selectedMissionRun?.worktrees.length ? (
              <article className={styles.detailCard}>
                <div className={styles.sectionHeader}>
                  <div>
                    <div className={styles.sectionLabel}>Worktree diff</div>
                    <div className={styles.sectionCaption}>
                      {selectedMissionGitRepoLabel ? `Active repo: ${selectedMissionGitRepoLabel}. ` : ""}
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
                        const expandedKey = `${selectedGitState.repoRelativePath}:${file.path}`;
                        const expanded = expandedDiffPaths[expandedKey] ?? false;
                        const diffStatusTone = getDiffStatusTone(file.status);
                        return (
                          <div
                            key={`${selectedGitState.repoRelativePath}:${file.path}-${file.status}`}
                            className={`${styles.diffFileCard} ${diffStatusTone}`}
                          >
                            <button
                              type="button"
                              className={`${styles.diffFileButton} ${diffStatusTone}`}
                              onClick={() =>
                                setExpandedDiffPaths((current) => ({ ...current, [expandedKey]: !expanded }))
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
                    <div className={styles.emptyState}>No tracked diff remains in the selected managed repo.</div>
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
            <div className={styles.setupGrid}>
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
              <article className={styles.workspaceCard}>
                <div className={styles.statusTopline}>
                  <span className={styles.sectionLabel}>Workflow states</span>
                  <span className={styles.statusBadge}>{hasWorkflowChanges ? "Unsaved" : "Synced"}</span>
                </div>
                <strong className={styles.statusTitle}>Quarterdeck mapping</strong>
                <p className={styles.sectionCaption}>
                  Add or remove the live YouTrack states Missions should treat as To-do and In-progress.
                </p>
                {workflowBlocker ? (
                  <div className={styles.blockedState}>{workflowBlocker}</div>
                ) : (
                  <>
                    <div className={styles.setupGrid}>
                      <YouTrackStateListEditor
                        label="To-do"
                        description="Tickets in these states stay in Launch bay."
                        placeholder="Add a To-do state"
                        values={youTrackStateMappingDraft.todo}
                        availableStates={youTrackStatus?.availableStates ?? []}
                        invalidStates={workflowValidation.invalidTodoStates}
                        disabled={isSavingWorkflow}
                        onChange={(nextStates) => updateWorkflowStateList("todo", nextStates)}
                      />
                      <YouTrackStateListEditor
                        label="In-progress"
                        description="The first state in this list becomes the mission launch target."
                        placeholder="Add an In-progress state"
                        values={youTrackStateMappingDraft.inProgress}
                        availableStates={youTrackStatus?.availableStates ?? []}
                        invalidStates={workflowValidation.invalidInProgressStates}
                        disabled={isSavingWorkflow}
                        onChange={(nextStates) => updateWorkflowStateList("inProgress", nextStates)}
                      />
                    </div>
                    {workflowValidation.errors.map((error) => (
                      <div key={error} className={styles.error}>
                        {error}
                      </div>
                    ))}
                    {workflowNotice ? <div className={styles.notice}>{workflowNotice}</div> : null}
                    {workflowError ? <div className={styles.error}>{workflowError}</div> : null}
                    <div className={styles.editorFooter}>
                      <div className={styles.selectionSummary}>
                        {youTrackStatus?.availableStates.length ?? 0} live states available from the connected instance
                      </div>
                      <div className={styles.inlineActions}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={resetWorkflowMappingDraft}
                          disabled={isSavingWorkflow || !hasWorkflowChanges}
                        >
                          Reset states
                        </button>
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => void saveWorkflowMapping()}
                          disabled={isSavingWorkflow || !canSaveWorkflow}
                        >
                          {isSavingWorkflow ? "Saving..." : "Save states"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </article>
            </div>
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
                const firstWorktree = existingRun?.worktrees[0] ?? null;
                const existingRunRepoCount = existingRun?.worktrees.length ?? 0;
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
                              ? openRunMissionDetail(existingRun.runId)
                              : openTicketMissionDetail(ticket.id, "launch-bay")
                          }
                        >
                          {existingRun ? "Open mission" : "Mission details"}
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
                    {firstWorktree ? (
                      <div className={styles.inlineRunFacts}>
                        <span className={styles.inlineRunFact}>
                          <strong>Repos</strong> {existingRunRepoCount}
                        </span>
                        {existingRunRepoCount === 1 ? (
                          <>
                            <span className={styles.inlineRunFact}>
                              <strong>Branch</strong> {firstWorktree.branchName}
                            </span>
                            <span className={styles.inlineRunFact}>
                              <strong>Worktree</strong> {firstWorktree.worktreePath}
                            </span>
                          </>
                        ) : (
                          <span className={styles.inlineRunFact}>
                            <strong>Example worktree</strong> {firstWorktree.worktreePath}
                          </span>
                        )}
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
                    : run.status === "error"
                      ? "Recover mission"
                      : "Open mission";
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
                          ? "The mission workspace is prepared and waiting for launch."
                          : run.status === "blocked"
                            ? "YouTrack state sync needs attention."
                            : run.status === "error"
                              ? "This mission needs recovery attention."
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
                          onClick={() => openRunMissionDetail(run.runId)}
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
                        onClick={() => openRunMissionDetail(run.runId)}
                      >
                        Open mission
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
