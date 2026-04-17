import type {
  MissionServiceProcessSummary,
  MissionServiceProfileSummary,
  MissionServiceSnapshot,
  TicketRunGitState,
  TicketRunSummary,
} from "@spira/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMissionRunsStore } from "../../stores/mission-runs-store.js";
import { useNavigationStore } from "../../stores/navigation-store.js";

export interface MissionRunController {
  runNotice: string | null;
  runError: string | null;
  gitNotice: string | null;
  gitError: string | null;
  serviceNotice: string | null;
  serviceError: string | null;
  continueDraft: string;
  setContinueDraft: (value: string) => void;
  isRetryingSync: boolean;
  isStartingWork: boolean;
  isContinuingWork: boolean;
  isCancellingWork: boolean;
  isCompletingRun: boolean;
  retryTicketRunSync: () => Promise<void>;
  startRunWork: () => Promise<void>;
  continueRunWork: () => Promise<void>;
  cancelRunWork: () => Promise<void>;
  completeRun: () => Promise<void>;
  services: MissionServiceSnapshot | null;
  serviceProfilesByRepo: Array<[string, MissionServiceProfileSummary[]]>;
  serviceProcesses: MissionServiceProcessSummary[];
  activeServiceProfileIds: Set<string>;
  isServicesLoading: boolean;
  startingServiceProfileId: string | null;
  stoppingServiceId: string | null;
  refreshMissionServices: () => Promise<void>;
  startMissionService: (profile: MissionServiceProfileSummary) => Promise<void>;
  stopMissionService: (service: MissionServiceProcessSummary) => Promise<void>;
  gitStatesByRepo: Record<string, TicketRunGitState | null>;
  gitErrorsByRepo: Record<string, string | null>;
  commitDrafts: Record<string, string>;
  dirtyCommitDrafts: Record<string, boolean>;
  expandedDiffPaths: Record<string, boolean>;
  isRefreshingAnyGit: boolean;
  loadingGitRepoPaths: Record<string, boolean>;
  generatingCommitDraftRepo: string | null;
  savingCommitDraftRepo: string | null;
  committingRepo: string | null;
  syncingRemoteRepo: string | null;
  creatingPullRequestRepo: string | null;
  ensureAllGitStateLoaded: () => Promise<void>;
  refreshAllGitState: () => Promise<void>;
  refreshGitState: (repoRelativePath: string) => Promise<void>;
  setCommitDraft: (repoRelativePath: string, draft: string) => void;
  persistCommitDraft: (repoRelativePath: string) => Promise<void>;
  generateCommitDraft: (repoRelativePath: string) => Promise<void>;
  commitMissionRun: (repoRelativePath: string) => Promise<void>;
  syncMissionRemote: (repoRelativePath: string, action: "publish" | "push") => Promise<void>;
  openMissionPullRequest: (repoRelativePath: string) => Promise<void>;
  toggleDiffPath: (repoRelativePath: string, filePath: string) => void;
}

const groupProfilesByRepo = (
  profiles: MissionServiceProfileSummary[],
): Array<[string, MissionServiceProfileSummary[]]> => {
  const groups = new Map<string, MissionServiceProfileSummary[]>();

  for (const profile of profiles) {
    const current = groups.get(profile.repoRelativePath) ?? [];
    current.push(profile);
    groups.set(profile.repoRelativePath, current);
  }

  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
};

const pruneRecord = <TValue>(record: Record<string, TValue>, allowedKeys: Set<string>): Record<string, TValue> => {
  const next: Record<string, TValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (allowedKeys.has(key)) {
      next[key] = value;
    }
  }
  return next;
};

export function useMissionRunController(run: TicketRunSummary): MissionRunController {
  const missionFlash = useNavigationStore((store) => store.missionFlashByRun[run.runId] ?? null);
  const clearMissionFlash = useNavigationStore((store) => store.clearMissionFlash);
  const setRunSnapshot = useMissionRunsStore((store) => store.setSnapshot);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [serviceNotice, setServiceNotice] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [continueDraft, setContinueDraft] = useState("");
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [isStartingWork, setIsStartingWork] = useState(false);
  const [isContinuingWork, setIsContinuingWork] = useState(false);
  const [isCancellingWork, setIsCancellingWork] = useState(false);
  const [isCompletingRun, setIsCompletingRun] = useState(false);
  const [services, setServices] = useState<MissionServiceSnapshot | null>(null);
  const [isServicesLoading, setIsServicesLoading] = useState(false);
  const [startingServiceProfileId, setStartingServiceProfileId] = useState<string | null>(null);
  const [stoppingServiceId, setStoppingServiceId] = useState<string | null>(null);
  const [gitStatesByRepo, setGitStatesByRepo] = useState<Record<string, TicketRunGitState | null>>({});
  const [gitErrorsByRepo, setGitErrorsByRepo] = useState<Record<string, string | null>>({});
  const [loadingGitRepoPaths, setLoadingGitRepoPaths] = useState<Record<string, boolean>>({});
  const [commitDrafts, setCommitDrafts] = useState<Record<string, string>>({});
  const [dirtyCommitDrafts, setDirtyCommitDrafts] = useState<Record<string, boolean>>({});
  const [expandedDiffPaths, setExpandedDiffPaths] = useState<Record<string, boolean>>({});
  const [generatingCommitDraftRepo, setGeneratingCommitDraftRepo] = useState<string | null>(null);
  const [savingCommitDraftRepo, setSavingCommitDraftRepo] = useState<string | null>(null);
  const [committingRepo, setCommittingRepo] = useState<string | null>(null);
  const [syncingRemoteRepo, setSyncingRemoteRepo] = useState<string | null>(null);
  const [creatingPullRequestRepo, setCreatingPullRequestRepo] = useState<string | null>(null);
  const dirtyCommitDraftsRef = useRef<Record<string, boolean>>({});
  const gitStatesByRepoRef = useRef<Record<string, TicketRunGitState | null>>({});
  const loadingGitRepoPathsRef = useRef<Record<string, boolean>>({});

  const repoKeys = useMemo(() => new Set(run.worktrees.map((worktree) => worktree.repoRelativePath)), [run.worktrees]);
  const isRefreshingAnyGit = useMemo(() => Object.values(loadingGitRepoPaths).some(Boolean), [loadingGitRepoPaths]);
  const serviceProfilesByRepo = useMemo(() => groupProfilesByRepo(services?.profiles ?? []), [services?.profiles]);
  const serviceProcesses = services?.processes ?? [];
  const activeServiceProfileIds = useMemo(
    () =>
      new Set(
        serviceProcesses
          .filter(
            (service) => service.state === "starting" || service.state === "running" || service.state === "stopping",
          )
          .map((service) => service.profileId),
      ),
    [serviceProcesses],
  );

  useEffect(() => {
    dirtyCommitDraftsRef.current = dirtyCommitDrafts;
  }, [dirtyCommitDrafts]);

  useEffect(() => {
    gitStatesByRepoRef.current = gitStatesByRepo;
  }, [gitStatesByRepo]);

  useEffect(() => {
    loadingGitRepoPathsRef.current = loadingGitRepoPaths;
  }, [loadingGitRepoPaths]);

  useEffect(() => {
    setGitStatesByRepo((current) => pruneRecord(current, repoKeys));
    setGitErrorsByRepo((current) => pruneRecord(current, repoKeys));
    setLoadingGitRepoPaths((current) => pruneRecord(current, repoKeys));
    setCommitDrafts((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const worktree of run.worktrees) {
        const repoRelativePath = worktree.repoRelativePath;
        const persistedDraft = worktree.commitMessageDraft ?? run.commitMessageDraft ?? "";
        const currentDraft = current[repoRelativePath];
        const nextDraft = dirtyCommitDrafts[repoRelativePath] ? (currentDraft ?? persistedDraft) : persistedDraft;
        next[repoRelativePath] = nextDraft;
        if (currentDraft !== nextDraft) {
          changed = true;
        }
      }

      if (!changed && Object.keys(current).length === Object.keys(next).length) {
        return current;
      }

      return next;
    });
    setDirtyCommitDrafts((current) => pruneRecord(current, repoKeys));
    setExpandedDiffPaths((current) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        const separatorIndex = key.indexOf(":");
        if (separatorIndex > 0 && repoKeys.has(key.slice(0, separatorIndex))) {
          next[key] = value;
        }
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [dirtyCommitDrafts, repoKeys, run.commitMessageDraft, run.worktrees]);

  useEffect(() => {
    const runId = run.runId;
    if (!runId) {
      return;
    }
    setContinueDraft("");
    setRunNotice(null);
    setRunError(null);
    setGitNotice(null);
    setGitError(null);
    setServiceNotice(null);
    setServiceError(null);
  }, [run.runId]);

  useEffect(() => {
    if (!missionFlash) {
      return;
    }

    if (missionFlash.tone === "error") {
      setRunNotice(null);
      setRunError(missionFlash.message);
    } else {
      setRunError(null);
      setRunNotice(missionFlash.message);
    }

    clearMissionFlash(run.runId);
  }, [clearMissionFlash, missionFlash, run.runId]);

  const refreshMissionServices = useCallback(async () => {
    setIsServicesLoading(true);
    setServiceError(null);

    try {
      const nextServices = await window.electronAPI.getTicketRunServices(run.runId);
      setServices(nextServices);
    } catch (error) {
      console.error("Failed to load mission services", error);
      setServiceError(error instanceof Error ? error.message : "Failed to load mission services.");
    } finally {
      setIsServicesLoading(false);
    }
  }, [run.runId]);

  useEffect(() => {
    setServices(null);
    void refreshMissionServices();
  }, [refreshMissionServices]);

  useEffect(() => {
    return window.electronAPI.onTicketRunServicesUpdated((nextServices) => {
      if (nextServices.runId === run.runId) {
        setServices(nextServices);
      }
    });
  }, [run.runId]);

  const refreshGitState = useCallback(
    async (repoRelativePath: string) => {
      if (!repoKeys.has(repoRelativePath)) {
        return;
      }

      setLoadingGitRepoPaths((current) => ({ ...current, [repoRelativePath]: true }));
      setGitErrorsByRepo((current) => ({ ...current, [repoRelativePath]: null }));
      setGitError(null);

      try {
        const result = await window.electronAPI.getTicketRunGitState(run.runId, repoRelativePath);
        setRunSnapshot(result.snapshot);
        setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: result.gitState }));
        setCommitDrafts((current) => ({
          ...current,
          [repoRelativePath]: dirtyCommitDraftsRef.current[repoRelativePath]
            ? (current[repoRelativePath] ?? result.gitState.commitMessageDraft ?? "")
            : (result.gitState.commitMessageDraft ?? current[repoRelativePath] ?? ""),
        }));
      } catch (error) {
        console.error("Failed to load mission git state", error);
        const message = error instanceof Error ? error.message : "Failed to load mission git state.";
        setGitErrorsByRepo((current) => ({ ...current, [repoRelativePath]: message }));
        setGitError(message);
      } finally {
        setLoadingGitRepoPaths((current) => {
          const next = { ...current };
          delete next[repoRelativePath];
          return next;
        });
      }
    },
    [repoKeys, run.runId, setRunSnapshot],
  );

  const refreshAllGitState = useCallback(async () => {
    for (const worktree of run.worktrees) {
      await refreshGitState(worktree.repoRelativePath);
    }
  }, [refreshGitState, run.worktrees]);

  const ensureAllGitStateLoaded = useCallback(async () => {
    for (const worktree of run.worktrees) {
      const repoRelativePath = worktree.repoRelativePath;
      if (gitStatesByRepoRef.current[repoRelativePath] || loadingGitRepoPathsRef.current[repoRelativePath]) {
        continue;
      }
      await refreshGitState(repoRelativePath);
    }
  }, [refreshGitState, run.worktrees]);

  useEffect(() => {
    const runId = run.runId;
    if (!runId) {
      return;
    }
    setGitStatesByRepo({});
    setGitErrorsByRepo({});
    setLoadingGitRepoPaths({});
    setExpandedDiffPaths({});
  }, [run.runId]);

  const setCommitDraft = useCallback((repoRelativePath: string, draft: string) => {
    setCommitDrafts((current) => ({ ...current, [repoRelativePath]: draft }));
    setDirtyCommitDrafts((current) => ({ ...current, [repoRelativePath]: true }));
  }, []);

  const generateCommitDraft = useCallback(
    async (repoRelativePath: string) => {
      if (!repoKeys.has(repoRelativePath)) {
        return;
      }

      setGeneratingCommitDraftRepo(repoRelativePath);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.generateTicketRunCommitDraft(run.runId, repoRelativePath);
        setRunSnapshot(result.snapshot);
        setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: result.gitState }));
        setCommitDrafts((current) => ({ ...current, [repoRelativePath]: result.gitState.commitMessageDraft ?? "" }));
        setDirtyCommitDrafts((current) => ({ ...current, [repoRelativePath]: false }));
        setGitNotice(`${result.run.ticketId} commit draft refreshed for ${result.gitState.repoRelativePath}.`);
      } catch (error) {
        console.error("Failed to generate mission commit draft", error);
        setGitError(error instanceof Error ? error.message : "Failed to generate the mission commit draft.");
      } finally {
        setGeneratingCommitDraftRepo(null);
      }
    },
    [repoKeys, run.runId, setRunSnapshot],
  );

  const persistCommitDraft = useCallback(
    async (repoRelativePath: string) => {
      if (!repoKeys.has(repoRelativePath)) {
        return;
      }

      setSavingCommitDraftRepo(repoRelativePath);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.setTicketRunCommitDraft(
          run.runId,
          commitDrafts[repoRelativePath] ?? "",
          repoRelativePath,
        );
        setRunSnapshot(result.snapshot);
        setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: result.gitState }));
        setCommitDrafts((current) => ({ ...current, [repoRelativePath]: result.gitState.commitMessageDraft ?? "" }));
        setDirtyCommitDrafts((current) => ({ ...current, [repoRelativePath]: false }));
      } catch (error) {
        console.error("Failed to save mission commit draft", error);
        setGitError(error instanceof Error ? error.message : "Failed to save the mission commit draft.");
      } finally {
        setSavingCommitDraftRepo(null);
      }
    },
    [commitDrafts, repoKeys, run.runId, setRunSnapshot],
  );

  const commitMissionRun = useCallback(
    async (repoRelativePath: string) => {
      if (!repoKeys.has(repoRelativePath)) {
        return;
      }

      setCommittingRepo(repoRelativePath);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.commitTicketRun(
          run.runId,
          commitDrafts[repoRelativePath] ?? "",
          repoRelativePath,
        );
        setRunSnapshot(result.snapshot);
        setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: result.gitState }));
        setCommitDrafts((current) => ({ ...current, [repoRelativePath]: "" }));
        setDirtyCommitDrafts((current) => ({ ...current, [repoRelativePath]: false }));
        setGitNotice(
          `${result.run.ticketId} committed in ${result.gitState.repoRelativePath} on ${result.gitState.branchName}.`,
        );
      } catch (error) {
        console.error("Failed to commit mission run", error);
        setGitError(error instanceof Error ? error.message : "Failed to commit the mission worktree.");
      } finally {
        setCommittingRepo(null);
      }
    },
    [commitDrafts, repoKeys, run.runId, setRunSnapshot],
  );

  const syncMissionRemote = useCallback(
    async (repoRelativePath: string, action: "publish" | "push") => {
      if (!repoKeys.has(repoRelativePath)) {
        return;
      }

      setSyncingRemoteRepo(repoRelativePath);
      setGitNotice(null);
      setGitError(null);

      try {
        const result =
          action === "publish"
            ? await window.electronAPI.publishTicketRun(run.runId, repoRelativePath)
            : await window.electronAPI.pushTicketRun(run.runId, repoRelativePath);
        setRunSnapshot(result.snapshot);
        setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: result.gitState }));
        setGitNotice(
          result.action === "publish"
            ? `${result.run.ticketId} published ${result.gitState.repoRelativePath} to origin/${result.gitState.branchName}.`
            : `${result.run.ticketId} pushed ${result.gitState.repoRelativePath} to origin/${result.gitState.branchName}.`,
        );
      } catch (error) {
        console.error("Failed to sync mission remote", error);
        setGitError(error instanceof Error ? error.message : "Failed to sync the mission branch.");
      } finally {
        setSyncingRemoteRepo(null);
      }
    },
    [repoKeys, run.runId, setRunSnapshot],
  );

  const openMissionPullRequest = useCallback(
    async (repoRelativePath: string) => {
      if (!repoKeys.has(repoRelativePath)) {
        return;
      }

      setCreatingPullRequestRepo(repoRelativePath);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.createTicketRunPullRequest(run.runId, repoRelativePath);
        setRunSnapshot(result.snapshot);
        setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: result.gitState }));
        await window.electronAPI.openExternal(result.pullRequestUrl);
        setGitNotice(`${result.run.ticketId} pull request opened for ${result.gitState.repoRelativePath}.`);
      } catch (error) {
        console.error("Failed to open mission pull request", error);
        setGitError(error instanceof Error ? error.message : "Failed to open the mission pull request.");
      } finally {
        setCreatingPullRequestRepo(null);
      }
    },
    [repoKeys, run.runId, setRunSnapshot],
  );

  const retryTicketRunSync = useCallback(async () => {
    setIsRetryingSync(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.retryTicketRunSync(run.runId);
      setRunSnapshot(result.snapshot);
      if (result.run.status === "blocked") {
        setRunError(result.run.statusMessage ?? `Missions still could not sync ${result.run.ticketId}.`);
      } else {
        setRunNotice(`${result.run.ticketId} is now synced with YouTrack.`);
      }
    } catch (error) {
      console.error("Failed to retry ticket run sync", error);
      setRunError(error instanceof Error ? error.message : "Failed to retry the ticket state sync.");
    } finally {
      setIsRetryingSync(false);
    }
  }, [run.runId, setRunSnapshot]);

  const startRunWork = useCallback(async () => {
    setIsStartingWork(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.startTicketRunWork(run.runId);
      setRunSnapshot(result.snapshot);
      setRunNotice(`${result.run.ticketId} is now actively working.`);
    } catch (error) {
      console.error("Failed to start mission work", error);
      setRunError(error instanceof Error ? error.message : "Failed to start mission work.");
    } finally {
      setIsStartingWork(false);
    }
  }, [run.runId, setRunSnapshot]);

  const continueRunWork = useCallback(async () => {
    setIsContinuingWork(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.continueTicketRunWork(run.runId, continueDraft.trim() || undefined);
      setRunSnapshot(result.snapshot);
      setContinueDraft("");
      setRunNotice(
        result.reusedLiveAttempt
          ? `${result.run.ticketId} resumed in its existing mission station.`
          : `${result.run.ticketId} started a fresh follow-up pass.`,
      );
    } catch (error) {
      console.error("Failed to continue mission work", error);
      setRunError(error instanceof Error ? error.message : "Failed to continue mission work.");
    } finally {
      setIsContinuingWork(false);
    }
  }, [continueDraft, run.runId, setRunSnapshot]);

  const cancelRunWork = useCallback(async () => {
    setIsCancellingWork(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.cancelTicketRunWork(run.runId);
      setRunSnapshot(result.snapshot);
      setRunNotice(`${result.run.ticketId} stopped its active pass and is ready for review.`);
    } catch (error) {
      console.error("Failed to cancel mission work", error);
      setRunError(error instanceof Error ? error.message : "Failed to cancel mission work.");
    } finally {
      setIsCancellingWork(false);
    }
  }, [run.runId, setRunSnapshot]);

  const completeRun = useCallback(async () => {
    setIsCompletingRun(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.completeTicketRun(run.runId);
      setRunSnapshot(result.snapshot);
      setRunNotice(`${result.run.ticketId} was marked complete.`);
    } catch (error) {
      console.error("Failed to complete mission", error);
      setRunError(error instanceof Error ? error.message : "Failed to complete the mission.");
    } finally {
      setIsCompletingRun(false);
    }
  }, [run.runId, setRunSnapshot]);

  const startMissionService = useCallback(
    async (profile: MissionServiceProfileSummary) => {
      setStartingServiceProfileId(profile.profileId);
      setServiceNotice(null);
      setServiceError(null);

      try {
        const nextServices = await window.electronAPI.startTicketRunService(run.runId, profile.profileId);
        setServices(nextServices);
        setServiceNotice(`${profile.profileName} is launching for ${profile.repoRelativePath}.`);
      } catch (error) {
        console.error("Failed to start mission service", error);
        setServiceError(error instanceof Error ? error.message : "Failed to start the mission service.");
      } finally {
        setStartingServiceProfileId(null);
      }
    },
    [run.runId],
  );

  const stopMissionService = useCallback(
    async (service: MissionServiceProcessSummary) => {
      setStoppingServiceId(service.serviceId);
      setServiceNotice(null);
      setServiceError(null);

      try {
        const nextServices = await window.electronAPI.stopTicketRunService(run.runId, service.serviceId);
        setServices(nextServices);
        setServiceNotice(`${service.profileName} is stopping for ${service.repoRelativePath}.`);
      } catch (error) {
        console.error("Failed to stop mission service", error);
        setServiceError(error instanceof Error ? error.message : "Failed to stop the mission service.");
      } finally {
        setStoppingServiceId(null);
      }
    },
    [run.runId],
  );

  const toggleDiffPath = useCallback((repoRelativePath: string, filePath: string) => {
    const key = `${repoRelativePath}:${filePath}`;
    setExpandedDiffPaths((current) => ({ ...current, [key]: !(current[key] ?? false) }));
  }, []);

  return {
    runNotice,
    runError,
    gitNotice,
    gitError,
    serviceNotice,
    serviceError,
    continueDraft,
    setContinueDraft,
    isRetryingSync,
    isStartingWork,
    isContinuingWork,
    isCancellingWork,
    isCompletingRun,
    retryTicketRunSync,
    startRunWork,
    continueRunWork,
    cancelRunWork,
    completeRun,
    services,
    serviceProfilesByRepo,
    serviceProcesses,
    activeServiceProfileIds,
    isServicesLoading,
    startingServiceProfileId,
    stoppingServiceId,
    refreshMissionServices,
    startMissionService,
    stopMissionService,
    gitStatesByRepo,
    gitErrorsByRepo,
    commitDrafts,
    dirtyCommitDrafts,
    expandedDiffPaths,
    isRefreshingAnyGit,
    loadingGitRepoPaths,
    generatingCommitDraftRepo,
    savingCommitDraftRepo,
    committingRepo,
    syncingRemoteRepo,
    creatingPullRequestRepo,
    ensureAllGitStateLoaded,
    refreshAllGitState,
    refreshGitState,
    setCommitDraft,
    persistCommitDraft,
    generateCommitDraft,
    commitMissionRun,
    syncMissionRemote,
    openMissionPullRequest,
    toggleDiffPath,
  };
}
