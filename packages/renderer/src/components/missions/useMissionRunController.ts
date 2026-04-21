import type {
  MissionServiceProcessSummary,
  MissionServiceProfileSummary,
  MissionServiceSnapshot,
  TicketRunGitState,
  TicketRunReviewRepoState,
  TicketRunReviewSnapshot,
  TicketRunReviewSubmoduleState,
  TicketRunSubmoduleGitState,
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
  reviewSnapshot: TicketRunReviewSnapshot | null;
  isReviewSnapshotLoading: boolean;
  continueDraft: string;
  setContinueDraft: (value: string) => void;
  isRetryingSync: boolean;
  isStartingWork: boolean;
  isContinuingWork: boolean;
  isCancellingWork: boolean;
  isCompletingRun: boolean;
  isDeletingRun: boolean;
  retryTicketRunSync: () => Promise<void>;
  startRunWork: () => Promise<void>;
  continueRunWork: () => Promise<void>;
  cancelRunWork: () => Promise<void>;
  completeRun: () => Promise<void>;
  deleteRun: () => Promise<void>;
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
  submoduleGitStatesByUrl: Record<string, TicketRunSubmoduleGitState | null>;
  submoduleGitErrorsByUrl: Record<string, string | null>;
  commitDrafts: Record<string, string>;
  submoduleCommitDrafts: Record<string, string>;
  dirtyCommitDrafts: Record<string, boolean>;
  dirtySubmoduleCommitDrafts: Record<string, boolean>;
  expandedDiffPaths: Record<string, boolean>;
  expandedSubmoduleDiffPaths: Record<string, boolean>;
  generatingCommitDraftRepo: string | null;
  generatingSubmoduleCommitDraftUrl: string | null;
  savingCommitDraftRepo: string | null;
  savingSubmoduleCommitDraftUrl: string | null;
  committingRepo: string | null;
  committingSubmoduleUrl: string | null;
  syncingRemoteRepo: string | null;
  syncingSubmoduleUrl: string | null;
  creatingPullRequestRepo: string | null;
  creatingSubmodulePullRequestUrl: string | null;
  refreshReviewSnapshot: () => Promise<void>;
  ensureGitState: (repoRelativePath: string) => Promise<void>;
  ensureSubmoduleGitState: (canonicalUrl: string) => Promise<void>;
  setCommitDraft: (repoRelativePath: string, draft: string) => void;
  setSubmoduleCommitDraft: (canonicalUrl: string, draft: string) => void;
  persistCommitDraft: (repoRelativePath: string) => Promise<void>;
  persistSubmoduleCommitDraft: (canonicalUrl: string) => Promise<void>;
  generateCommitDraft: (repoRelativePath: string) => Promise<void>;
  generateSubmoduleCommitDraft: (canonicalUrl: string) => Promise<void>;
  commitMissionRun: (repoRelativePath: string) => Promise<void>;
  commitMissionSubmodule: (canonicalUrl: string) => Promise<void>;
  syncMissionRemote: (repoRelativePath: string, action: "publish" | "push") => Promise<void>;
  syncSubmoduleRemote: (canonicalUrl: string, action: "publish" | "push") => Promise<void>;
  openMissionPullRequest: (repoRelativePath: string) => Promise<void>;
  openSubmodulePullRequest: (canonicalUrl: string) => Promise<void>;
  toggleDiffPath: (repoRelativePath: string, filePath: string) => void;
  toggleSubmoduleDiffPath: (canonicalUrl: string, filePath: string) => void;
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

const SUBMODULE_DIFF_KEY_SEPARATOR = "\u0000";

const buildSubmoduleDiffKey = (canonicalUrl: string, filePath: string): string =>
  `${canonicalUrl}${SUBMODULE_DIFF_KEY_SEPARATOR}${filePath}`;

const toReviewRepoState = ({ files: _files, ...gitState }: TicketRunGitState): TicketRunReviewRepoState => gitState;

const toReviewSubmoduleState = ({
  files: _files,
  ...gitState
}: TicketRunSubmoduleGitState): TicketRunReviewSubmoduleState => gitState;

export function useMissionRunController(run: TicketRunSummary): MissionRunController {
  const backToShip = useNavigationStore((store) => store.backToShip);
  const missionFlash = useNavigationStore((store) => store.missionFlashByRun[run.runId] ?? null);
  const clearMissionFlash = useNavigationStore((store) => store.clearMissionFlash);
  const setRunSnapshot = useMissionRunsStore((store) => store.setSnapshot);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [gitNotice, setGitNotice] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [serviceNotice, setServiceNotice] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<TicketRunReviewSnapshot | null>(null);
  const [isReviewSnapshotLoading, setIsReviewSnapshotLoading] = useState(false);
  const [continueDraft, setContinueDraft] = useState("");
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [isStartingWork, setIsStartingWork] = useState(false);
  const [isContinuingWork, setIsContinuingWork] = useState(false);
  const [isCancellingWork, setIsCancellingWork] = useState(false);
  const [isCompletingRun, setIsCompletingRun] = useState(false);
  const [isDeletingRun, setIsDeletingRun] = useState(false);
  const [services, setServices] = useState<MissionServiceSnapshot | null>(null);
  const [isServicesLoading, setIsServicesLoading] = useState(false);
  const [startingServiceProfileId, setStartingServiceProfileId] = useState<string | null>(null);
  const [stoppingServiceId, setStoppingServiceId] = useState<string | null>(null);
  const [commitDrafts, setCommitDrafts] = useState<Record<string, string>>({});
  const [submoduleCommitDrafts, setSubmoduleCommitDrafts] = useState<Record<string, string>>({});
  const [dirtyCommitDrafts, setDirtyCommitDrafts] = useState<Record<string, boolean>>({});
  const [dirtySubmoduleCommitDrafts, setDirtySubmoduleCommitDrafts] = useState<Record<string, boolean>>({});
  const [expandedDiffPaths, setExpandedDiffPaths] = useState<Record<string, boolean>>({});
  const [expandedSubmoduleDiffPaths, setExpandedSubmoduleDiffPaths] = useState<Record<string, boolean>>({});
  const [generatingCommitDraftRepo, setGeneratingCommitDraftRepo] = useState<string | null>(null);
  const [generatingSubmoduleCommitDraftUrl, setGeneratingSubmoduleCommitDraftUrl] = useState<string | null>(null);
  const [savingCommitDraftRepo, setSavingCommitDraftRepo] = useState<string | null>(null);
  const [savingSubmoduleCommitDraftUrl, setSavingSubmoduleCommitDraftUrl] = useState<string | null>(null);
  const [committingRepo, setCommittingRepo] = useState<string | null>(null);
  const [committingSubmoduleUrl, setCommittingSubmoduleUrl] = useState<string | null>(null);
  const [syncingRemoteRepo, setSyncingRemoteRepo] = useState<string | null>(null);
  const [syncingSubmoduleUrl, setSyncingSubmoduleUrl] = useState<string | null>(null);
  const [creatingPullRequestRepo, setCreatingPullRequestRepo] = useState<string | null>(null);
  const [creatingSubmodulePullRequestUrl, setCreatingSubmodulePullRequestUrl] = useState<string | null>(null);
  const [gitStatesByRepo, setGitStatesByRepo] = useState<Record<string, TicketRunGitState | null>>({});
  const [gitErrorsByRepo, setGitErrorsByRepo] = useState<Record<string, string | null>>({});
  const [submoduleGitStatesByUrl, setSubmoduleGitStatesByUrl] = useState<
    Record<string, TicketRunSubmoduleGitState | null>
  >({});
  const [submoduleGitErrorsByUrl, setSubmoduleGitErrorsByUrl] = useState<Record<string, string | null>>({});
  const dirtyCommitDraftsRef = useRef<Record<string, boolean>>({});
  const dirtySubmoduleCommitDraftsRef = useRef<Record<string, boolean>>({});
  const reviewSnapshotRequestIdRef = useRef(0);
  const detailRequestGenerationRef = useRef(0);
  const gitStatesByRepoRef = useRef<Record<string, TicketRunGitState | null>>({});
  const gitErrorsByRepoRef = useRef<Record<string, string | null>>({});
  const submoduleGitStatesByUrlRef = useRef<Record<string, TicketRunSubmoduleGitState | null>>({});
  const submoduleGitErrorsByUrlRef = useRef<Record<string, string | null>>({});
  const gitStateLoadingByRepoRef = useRef<Record<string, boolean>>({});
  const submoduleGitStateLoadingByUrlRef = useRef<Record<string, boolean>>({});

  const repoKeys = useMemo(() => new Set(run.worktrees.map((worktree) => worktree.repoRelativePath)), [run.worktrees]);
  const submoduleKeys = useMemo(
    () => new Set(run.submodules.map((submodule) => submodule.canonicalUrl)),
    [run.submodules],
  );
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
  const reviewRepoEntriesByPath = useMemo(
    () => new Map((reviewSnapshot?.repoEntries ?? []).map((entry) => [entry.repoRelativePath, entry] as const)),
    [reviewSnapshot?.repoEntries],
  );
  const reviewSubmoduleEntriesByUrl = useMemo(
    () => new Map((reviewSnapshot?.submoduleEntries ?? []).map((entry) => [entry.canonicalUrl, entry] as const)),
    [reviewSnapshot?.submoduleEntries],
  );

  useEffect(() => {
    dirtyCommitDraftsRef.current = dirtyCommitDrafts;
  }, [dirtyCommitDrafts]);

  useEffect(() => {
    dirtySubmoduleCommitDraftsRef.current = dirtySubmoduleCommitDrafts;
  }, [dirtySubmoduleCommitDrafts]);

  useEffect(() => {
    gitStatesByRepoRef.current = gitStatesByRepo;
  }, [gitStatesByRepo]);

  useEffect(() => {
    gitErrorsByRepoRef.current = gitErrorsByRepo;
  }, [gitErrorsByRepo]);

  useEffect(() => {
    submoduleGitStatesByUrlRef.current = submoduleGitStatesByUrl;
  }, [submoduleGitStatesByUrl]);

  useEffect(() => {
    submoduleGitErrorsByUrlRef.current = submoduleGitErrorsByUrl;
  }, [submoduleGitErrorsByUrl]);

  useEffect(() => {
    setCommitDrafts((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const worktree of run.worktrees) {
        const repoRelativePath = worktree.repoRelativePath;
        const persistedDraft =
          reviewRepoEntriesByPath.get(repoRelativePath)?.gitState?.commitMessageDraft ??
          worktree.commitMessageDraft ??
          run.commitMessageDraft ??
          "";
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
  }, [dirtyCommitDrafts, repoKeys, reviewRepoEntriesByPath, run.commitMessageDraft, run.worktrees]);

  useEffect(() => {
    setSubmoduleCommitDrafts((current) => {
      const next: Record<string, string> = {};
      let changed = false;

      for (const submodule of run.submodules) {
        const canonicalUrl = submodule.canonicalUrl;
        const persistedDraft =
          reviewSubmoduleEntriesByUrl.get(canonicalUrl)?.gitState?.commitMessageDraft ??
          submodule.commitMessageDraft ??
          "";
        const currentDraft = current[canonicalUrl];
        const nextDraft = dirtySubmoduleCommitDrafts[canonicalUrl] ? (currentDraft ?? persistedDraft) : persistedDraft;
        next[canonicalUrl] = nextDraft;
        if (currentDraft !== nextDraft) {
          changed = true;
        }
      }

      if (!changed && Object.keys(current).length === Object.keys(next).length) {
        return current;
      }

      return next;
    });
    setDirtySubmoduleCommitDrafts((current) => pruneRecord(current, submoduleKeys));
    setExpandedSubmoduleDiffPaths((current) => {
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        const separatorIndex = key.indexOf(SUBMODULE_DIFF_KEY_SEPARATOR);
        if (separatorIndex > 0 && submoduleKeys.has(key.slice(0, separatorIndex))) {
          next[key] = value;
        }
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [dirtySubmoduleCommitDrafts, reviewSubmoduleEntriesByUrl, run.submodules, submoduleKeys]);

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

  const resetDetailGitState = useCallback(() => {
    detailRequestGenerationRef.current += 1;
    gitStateLoadingByRepoRef.current = {};
    gitStatesByRepoRef.current = {};
    gitErrorsByRepoRef.current = {};
    submoduleGitStateLoadingByUrlRef.current = {};
    submoduleGitStatesByUrlRef.current = {};
    submoduleGitErrorsByUrlRef.current = {};
    setGitStatesByRepo({});
    setGitErrorsByRepo({});
    setSubmoduleGitStatesByUrl({});
    setSubmoduleGitErrorsByUrl({});
  }, []);

  const refreshReviewSnapshot = useCallback(async () => {
    const requestId = reviewSnapshotRequestIdRef.current + 1;
    reviewSnapshotRequestIdRef.current = requestId;
    setIsReviewSnapshotLoading(true);
    setGitError(null);

    try {
      const result = await window.electronAPI.getTicketRunReviewSnapshot(run.runId);
      if (reviewSnapshotRequestIdRef.current !== requestId) {
        return;
      }
      resetDetailGitState();
      setRunSnapshot(result.snapshot);
      setReviewSnapshot(result.reviewSnapshot);
    } catch (error) {
      if (reviewSnapshotRequestIdRef.current !== requestId) {
        return;
      }
      console.error("Failed to load mission review snapshot", error);
      setGitError(error instanceof Error ? error.message : "Failed to load the mission review snapshot.");
    } finally {
      if (reviewSnapshotRequestIdRef.current === requestId) {
        setIsReviewSnapshotLoading(false);
      }
    }
  }, [resetDetailGitState, run.runId, setRunSnapshot]);

  const updateRepoReviewEntry = useCallback(
    (repoRelativePath: string, gitState: TicketRunGitState) => {
      setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: gitState }));
      setGitErrorsByRepo((current) => ({ ...current, [repoRelativePath]: null }));
      setReviewSnapshot((current) => {
        if (!current || current.runId !== run.runId) {
          return current;
        }

        // Draft operations only update persisted message text. Visibility and close-readiness still come
        // from a full review snapshot refresh after any git mutation.
        return {
          ...current,
          repoEntries: current.repoEntries.map((entry) =>
            entry.repoRelativePath === repoRelativePath
              ? { repoRelativePath, gitState: toReviewRepoState(gitState), error: null }
              : entry,
          ),
        };
      });
    },
    [run.runId],
  );

  const updateSubmoduleReviewEntry = useCallback(
    (canonicalUrl: string, gitState: TicketRunSubmoduleGitState) => {
      setSubmoduleGitStatesByUrl((current) => ({ ...current, [canonicalUrl]: gitState }));
      setSubmoduleGitErrorsByUrl((current) => ({ ...current, [canonicalUrl]: null }));
      setReviewSnapshot((current) => {
        if (!current || current.runId !== run.runId) {
          return current;
        }

        // Draft operations only update persisted message text. Visibility and close-readiness still come
        // from a full review snapshot refresh after any git mutation.
        return {
          ...current,
          submoduleEntries: current.submoduleEntries.map((entry) =>
            entry.canonicalUrl === canonicalUrl
              ? { canonicalUrl, gitState: toReviewSubmoduleState(gitState), error: null }
              : entry,
          ),
        };
      });
    },
    [run.runId],
  );

  const ensureGitState = useCallback(
    async (repoRelativePath: string) => {
      if (!repoKeys.has(repoRelativePath)) {
        return;
      }
      if (
        gitStateLoadingByRepoRef.current[repoRelativePath] ||
        gitStatesByRepoRef.current[repoRelativePath] !== undefined ||
        gitErrorsByRepoRef.current[repoRelativePath]
      ) {
        return;
      }

      gitStateLoadingByRepoRef.current = { ...gitStateLoadingByRepoRef.current, [repoRelativePath]: true };
      const requestGeneration = detailRequestGenerationRef.current;
      setGitErrorsByRepo((current) => ({ ...current, [repoRelativePath]: null }));
      try {
        const result = await window.electronAPI.getTicketRunGitState(run.runId, repoRelativePath);
        if (detailRequestGenerationRef.current !== requestGeneration) {
          return;
        }
        setRunSnapshot(result.snapshot);
        updateRepoReviewEntry(repoRelativePath, result.gitState);
      } catch (error) {
        if (detailRequestGenerationRef.current !== requestGeneration) {
          return;
        }
        console.error("Failed to load mission git state", error);
        setGitStatesByRepo((current) => ({ ...current, [repoRelativePath]: null }));
        setGitErrorsByRepo((current) => ({
          ...current,
          [repoRelativePath]: error instanceof Error ? error.message : "Failed to load the mission git state.",
        }));
      } finally {
        if (detailRequestGenerationRef.current === requestGeneration) {
          gitStateLoadingByRepoRef.current = { ...gitStateLoadingByRepoRef.current, [repoRelativePath]: false };
        }
      }
    },
    [repoKeys, run.runId, setRunSnapshot, updateRepoReviewEntry],
  );

  const ensureSubmoduleGitState = useCallback(
    async (canonicalUrl: string) => {
      if (!submoduleKeys.has(canonicalUrl)) {
        return;
      }
      if (
        submoduleGitStateLoadingByUrlRef.current[canonicalUrl] ||
        submoduleGitStatesByUrlRef.current[canonicalUrl] !== undefined ||
        submoduleGitErrorsByUrlRef.current[canonicalUrl]
      ) {
        return;
      }

      submoduleGitStateLoadingByUrlRef.current = {
        ...submoduleGitStateLoadingByUrlRef.current,
        [canonicalUrl]: true,
      };
      const requestGeneration = detailRequestGenerationRef.current;
      setSubmoduleGitErrorsByUrl((current) => ({ ...current, [canonicalUrl]: null }));
      try {
        const result = await window.electronAPI.getTicketRunSubmoduleGitState(run.runId, canonicalUrl);
        if (detailRequestGenerationRef.current !== requestGeneration) {
          return;
        }
        setRunSnapshot(result.snapshot);
        updateSubmoduleReviewEntry(canonicalUrl, result.gitState);
      } catch (error) {
        if (detailRequestGenerationRef.current !== requestGeneration) {
          return;
        }
        console.error("Failed to load managed submodule state", error);
        setSubmoduleGitStatesByUrl((current) => ({ ...current, [canonicalUrl]: null }));
        setSubmoduleGitErrorsByUrl((current) => ({
          ...current,
          [canonicalUrl]: error instanceof Error ? error.message : "Failed to load the managed submodule state.",
        }));
      } finally {
        if (detailRequestGenerationRef.current === requestGeneration) {
          submoduleGitStateLoadingByUrlRef.current = {
            ...submoduleGitStateLoadingByUrlRef.current,
            [canonicalUrl]: false,
          };
        }
      }
    },
    [run.runId, setRunSnapshot, submoduleKeys, updateSubmoduleReviewEntry],
  );

  useEffect(() => {
    const runId = run.runId;
    if (!runId) {
      return;
    }
    reviewSnapshotRequestIdRef.current += 1;
    resetDetailGitState();
    setReviewSnapshot(null);
    setIsReviewSnapshotLoading(false);
    setExpandedDiffPaths({});
    setExpandedSubmoduleDiffPaths({});
  }, [resetDetailGitState, run.runId]);

  useEffect(() => {
    if (!run.status) {
      return;
    }
    void refreshReviewSnapshot();
  }, [refreshReviewSnapshot, run.status]);

  const setCommitDraft = useCallback((repoRelativePath: string, draft: string) => {
    setCommitDrafts((current) => ({ ...current, [repoRelativePath]: draft }));
    setDirtyCommitDrafts((current) => ({ ...current, [repoRelativePath]: true }));
  }, []);

  const setSubmoduleCommitDraft = useCallback((canonicalUrl: string, draft: string) => {
    setSubmoduleCommitDrafts((current) => ({ ...current, [canonicalUrl]: draft }));
    setDirtySubmoduleCommitDrafts((current) => ({ ...current, [canonicalUrl]: true }));
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
        updateRepoReviewEntry(repoRelativePath, result.gitState);
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
    [repoKeys, run.runId, setRunSnapshot, updateRepoReviewEntry],
  );

  const generateSubmoduleCommitDraft = useCallback(
    async (canonicalUrl: string) => {
      if (!submoduleKeys.has(canonicalUrl)) {
        return;
      }

      setGeneratingSubmoduleCommitDraftUrl(canonicalUrl);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.generateTicketRunSubmoduleCommitDraft(run.runId, canonicalUrl);
        setRunSnapshot(result.snapshot);
        updateSubmoduleReviewEntry(canonicalUrl, result.gitState);
        setSubmoduleCommitDrafts((current) => ({
          ...current,
          [canonicalUrl]: result.gitState.commitMessageDraft ?? "",
        }));
        setDirtySubmoduleCommitDrafts((current) => ({ ...current, [canonicalUrl]: false }));
        setGitNotice(`${result.run.ticketId} commit draft refreshed for ${result.gitState.name}.`);
      } catch (error) {
        console.error("Failed to generate submodule commit draft", error);
        setGitError(error instanceof Error ? error.message : "Failed to generate the submodule commit draft.");
      } finally {
        setGeneratingSubmoduleCommitDraftUrl(null);
      }
    },
    [run.runId, setRunSnapshot, submoduleKeys, updateSubmoduleReviewEntry],
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
        updateRepoReviewEntry(repoRelativePath, result.gitState);
        setCommitDrafts((current) => ({ ...current, [repoRelativePath]: result.gitState.commitMessageDraft ?? "" }));
        setDirtyCommitDrafts((current) => ({ ...current, [repoRelativePath]: false }));
      } catch (error) {
        console.error("Failed to save mission commit draft", error);
        setGitError(error instanceof Error ? error.message : "Failed to save the mission commit draft.");
      } finally {
        setSavingCommitDraftRepo(null);
      }
    },
    [commitDrafts, repoKeys, run.runId, setRunSnapshot, updateRepoReviewEntry],
  );

  const persistSubmoduleCommitDraft = useCallback(
    async (canonicalUrl: string) => {
      if (!submoduleKeys.has(canonicalUrl)) {
        return;
      }

      setSavingSubmoduleCommitDraftUrl(canonicalUrl);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.setTicketRunSubmoduleCommitDraft(
          run.runId,
          canonicalUrl,
          submoduleCommitDrafts[canonicalUrl] ?? "",
        );
        setRunSnapshot(result.snapshot);
        updateSubmoduleReviewEntry(canonicalUrl, result.gitState);
        setSubmoduleCommitDrafts((current) => ({
          ...current,
          [canonicalUrl]: result.gitState.commitMessageDraft ?? "",
        }));
        setDirtySubmoduleCommitDrafts((current) => ({ ...current, [canonicalUrl]: false }));
      } catch (error) {
        console.error("Failed to save submodule commit draft", error);
        setGitError(error instanceof Error ? error.message : "Failed to save the submodule commit draft.");
      } finally {
        setSavingSubmoduleCommitDraftUrl(null);
      }
    },
    [run.runId, setRunSnapshot, submoduleCommitDrafts, submoduleKeys, updateSubmoduleReviewEntry],
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
        setCommitDrafts((current) => ({ ...current, [repoRelativePath]: "" }));
        setDirtyCommitDrafts((current) => ({ ...current, [repoRelativePath]: false }));
        setGitNotice(
          `${result.run.ticketId} committed in ${result.gitState.repoRelativePath} on ${result.gitState.branchName}.`,
        );
        await refreshReviewSnapshot();
      } catch (error) {
        console.error("Failed to commit mission run", error);
        setGitError(error instanceof Error ? error.message : "Failed to commit the mission worktree.");
      } finally {
        setCommittingRepo(null);
      }
    },
    [commitDrafts, refreshReviewSnapshot, repoKeys, run.runId, setRunSnapshot],
  );

  const commitMissionSubmodule = useCallback(
    async (canonicalUrl: string) => {
      if (!submoduleKeys.has(canonicalUrl)) {
        return;
      }

      setCommittingSubmoduleUrl(canonicalUrl);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.commitTicketRunSubmodule(
          run.runId,
          canonicalUrl,
          submoduleCommitDrafts[canonicalUrl] ?? "",
        );
        setRunSnapshot(result.snapshot);
        setSubmoduleCommitDrafts((current) => ({ ...current, [canonicalUrl]: "" }));
        setDirtySubmoduleCommitDrafts((current) => ({ ...current, [canonicalUrl]: false }));
        setGitNotice(`${result.run.ticketId} committed shared submodule ${result.gitState.name}.`);
        await refreshReviewSnapshot();
      } catch (error) {
        console.error("Failed to commit submodule", error);
        setGitError(error instanceof Error ? error.message : "Failed to commit the shared submodule.");
      } finally {
        setCommittingSubmoduleUrl(null);
      }
    },
    [refreshReviewSnapshot, run.runId, setRunSnapshot, submoduleCommitDrafts, submoduleKeys],
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
        setGitNotice(
          result.action === "publish"
            ? `${result.run.ticketId} published ${result.gitState.repoRelativePath} to origin/${result.gitState.branchName}.`
            : `${result.run.ticketId} pushed ${result.gitState.repoRelativePath} to origin/${result.gitState.branchName}.`,
        );
        await refreshReviewSnapshot();
      } catch (error) {
        console.error("Failed to sync mission remote", error);
        setGitError(error instanceof Error ? error.message : "Failed to sync the mission branch.");
      } finally {
        setSyncingRemoteRepo(null);
      }
    },
    [refreshReviewSnapshot, repoKeys, run.runId, setRunSnapshot],
  );

  const syncSubmoduleRemote = useCallback(
    async (canonicalUrl: string, action: "publish" | "push") => {
      if (!submoduleKeys.has(canonicalUrl)) {
        return;
      }

      setSyncingSubmoduleUrl(canonicalUrl);
      setGitNotice(null);
      setGitError(null);

      try {
        const result =
          action === "publish"
            ? await window.electronAPI.publishTicketRunSubmodule(run.runId, canonicalUrl)
            : await window.electronAPI.pushTicketRunSubmodule(run.runId, canonicalUrl);
        setRunSnapshot(result.snapshot);
        setGitNotice(
          result.action === "publish"
            ? `${result.run.ticketId} published shared submodule ${result.gitState.name}.`
            : `${result.run.ticketId} pushed shared submodule ${result.gitState.name}.`,
        );
        await refreshReviewSnapshot();
      } catch (error) {
        console.error("Failed to sync submodule remote", error);
        setGitError(error instanceof Error ? error.message : "Failed to sync the shared submodule branch.");
      } finally {
        setSyncingSubmoduleUrl(null);
      }
    },
    [refreshReviewSnapshot, run.runId, setRunSnapshot, submoduleKeys],
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
        await window.electronAPI.openExternal(result.pullRequestUrl);
        setGitNotice(`${result.run.ticketId} pull request opened for ${result.gitState.repoRelativePath}.`);
        await refreshReviewSnapshot();
      } catch (error) {
        console.error("Failed to open mission pull request", error);
        setGitError(error instanceof Error ? error.message : "Failed to open the mission pull request.");
      } finally {
        setCreatingPullRequestRepo(null);
      }
    },
    [refreshReviewSnapshot, repoKeys, run.runId, setRunSnapshot],
  );

  const openSubmodulePullRequest = useCallback(
    async (canonicalUrl: string) => {
      if (!submoduleKeys.has(canonicalUrl)) {
        return;
      }

      setCreatingSubmodulePullRequestUrl(canonicalUrl);
      setGitNotice(null);
      setGitError(null);

      try {
        const result = await window.electronAPI.createTicketRunSubmodulePullRequest(run.runId, canonicalUrl);
        setRunSnapshot(result.snapshot);
        await window.electronAPI.openExternal(result.pullRequestUrl);
        setGitNotice(`${result.run.ticketId} pull request opened for shared submodule ${result.gitState.name}.`);
        await refreshReviewSnapshot();
      } catch (error) {
        console.error("Failed to open submodule pull request", error);
        setGitError(error instanceof Error ? error.message : "Failed to open the shared submodule pull request.");
      } finally {
        setCreatingSubmodulePullRequestUrl(null);
      }
    },
    [refreshReviewSnapshot, run.runId, setRunSnapshot, submoduleKeys],
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
      resetDetailGitState();
      setReviewSnapshot(null);
      setRunSnapshot(result.snapshot);
      setRunNotice(`${result.run.ticketId} is now actively working.`);
    } catch (error) {
      console.error("Failed to start mission work", error);
      setRunError(error instanceof Error ? error.message : "Failed to start mission work.");
    } finally {
      setIsStartingWork(false);
    }
  }, [resetDetailGitState, run.runId, setRunSnapshot]);

  const continueRunWork = useCallback(async () => {
    setIsContinuingWork(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.continueTicketRunWork(run.runId, continueDraft.trim() || undefined);
      resetDetailGitState();
      setReviewSnapshot(null);
      setRunSnapshot(result.snapshot);
      setContinueDraft("");
      setRunNotice(
        run.status === "error"
          ? result.reusedLiveAttempt
            ? `${result.run.ticketId} resumed after the failed launch without leaving its mission station.`
            : `${result.run.ticketId} started a fresh recovery pass.`
          : result.reusedLiveAttempt
            ? `${result.run.ticketId} resumed in its existing mission station.`
            : `${result.run.ticketId} started a fresh follow-up pass.`,
      );
    } catch (error) {
      console.error("Failed to continue mission work", error);
      setRunError(error instanceof Error ? error.message : "Failed to continue mission work.");
    } finally {
      setIsContinuingWork(false);
    }
  }, [continueDraft, resetDetailGitState, run.runId, run.status, setRunSnapshot]);

  const cancelRunWork = useCallback(async () => {
    setIsCancellingWork(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.cancelTicketRunWork(run.runId);
      resetDetailGitState();
      setReviewSnapshot(null);
      setRunSnapshot(result.snapshot);
      setRunNotice(`${result.run.ticketId} stopped its active pass and is ready for review.`);
    } catch (error) {
      console.error("Failed to cancel mission work", error);
      setRunError(error instanceof Error ? error.message : "Failed to cancel mission work.");
    } finally {
      setIsCancellingWork(false);
    }
  }, [resetDetailGitState, run.runId, setRunSnapshot]);

  const completeRun = useCallback(async () => {
    setIsCompletingRun(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.completeTicketRun(run.runId);
      resetDetailGitState();
      setReviewSnapshot(null);
      setRunSnapshot(result.snapshot);
      setRunNotice(`${result.run.ticketId} was closed.`);
    } catch (error) {
      console.error("Failed to close mission", error);
      setRunError(error instanceof Error ? error.message : "Failed to close the mission.");
    } finally {
      setIsCompletingRun(false);
    }
  }, [resetDetailGitState, run.runId, setRunSnapshot]);

  const deleteRun = useCallback(async () => {
    setIsDeletingRun(true);
    setRunNotice(null);
    setRunError(null);

    try {
      const result = await window.electronAPI.deleteTicketRun(run.runId);
      resetDetailGitState();
      setReviewSnapshot(null);
      setRunSnapshot(result.snapshot);
      backToShip();
    } catch (error) {
      console.error("Failed to delete mission", error);
      setRunError(error instanceof Error ? error.message : "Failed to delete the mission.");
    } finally {
      setIsDeletingRun(false);
    }
  }, [backToShip, resetDetailGitState, run.runId, setRunSnapshot]);

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

  const toggleSubmoduleDiffPath = useCallback((canonicalUrl: string, filePath: string) => {
    const key = buildSubmoduleDiffKey(canonicalUrl, filePath);
    setExpandedSubmoduleDiffPaths((current) => ({ ...current, [key]: !(current[key] ?? false) }));
  }, []);

  return {
    runNotice,
    runError,
    gitNotice,
    gitError,
    serviceNotice,
    serviceError,
    reviewSnapshot,
    isReviewSnapshotLoading,
    continueDraft,
    setContinueDraft,
    isRetryingSync,
    isStartingWork,
    isContinuingWork,
    isCancellingWork,
    isCompletingRun,
    isDeletingRun,
    retryTicketRunSync,
    startRunWork,
    continueRunWork,
    cancelRunWork,
    completeRun,
    deleteRun,
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
    submoduleGitStatesByUrl,
    submoduleGitErrorsByUrl,
    commitDrafts,
    submoduleCommitDrafts,
    dirtyCommitDrafts,
    dirtySubmoduleCommitDrafts,
    expandedDiffPaths,
    expandedSubmoduleDiffPaths,
    generatingCommitDraftRepo,
    generatingSubmoduleCommitDraftUrl,
    savingCommitDraftRepo,
    savingSubmoduleCommitDraftUrl,
    committingRepo,
    committingSubmoduleUrl,
    syncingRemoteRepo,
    syncingSubmoduleUrl,
    creatingPullRequestRepo,
    creatingSubmodulePullRequestUrl,
    refreshReviewSnapshot,
    ensureGitState,
    ensureSubmoduleGitState,
    setCommitDraft,
    setSubmoduleCommitDraft,
    persistCommitDraft,
    persistSubmoduleCommitDraft,
    generateCommitDraft,
    generateSubmoduleCommitDraft,
    commitMissionRun,
    commitMissionSubmodule,
    syncMissionRemote,
    syncSubmoduleRemote,
    openMissionPullRequest,
    openSubmodulePullRequest,
    toggleDiffPath,
    toggleSubmoduleDiffPath,
  };
}
