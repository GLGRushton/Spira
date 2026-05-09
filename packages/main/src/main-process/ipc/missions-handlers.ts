import type {
  ApproveTicketRunRepoIntelligenceResult,
  CancelTicketRunWorkResult,
  CommitTicketRunResult,
  CommitTicketRunSubmoduleResult,
  CompleteTicketRunResult,
  ContinueTicketRunWorkResult,
  CreateTicketRunPullRequestResult,
  CreateTicketRunSubmodulePullRequestResult,
  DeleteTicketRunResult,
  GenerateTicketRunCommitDraftResult,
  GenerateTicketRunSubmoduleCommitDraftResult,
  MissionServiceSnapshot,
  ProjectRepoMappingsSnapshot,
  RetryTicketRunSyncResult,
  RunTicketRunProofResult,
  SetTicketRunCommitDraftResult,
  SetTicketRunSubmoduleCommitDraftResult,
  StartTicketRunResult,
  StartTicketRunWorkResult,
  SyncTicketRunRemoteResult,
  SyncTicketRunSubmoduleRemoteResult,
  TicketRunGitStateResult,
  TicketRunMissionTimelineResult,
  TicketRunProofSnapshotResult,
  TicketRunRepoIntelligenceCandidatesResult,
  TicketRunReviewSnapshotResult,
  TicketRunSnapshot,
  TicketRunSubmoduleGitStateResult,
} from "@spira/shared";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcBridgeHandle } from "../../ipc-bridge.js";
import { IPC_CHANNELS } from "./channels.js";
import type { IpcInvokeHandlerMap } from "./registration.js";

const buildLocalProjectRepoMappingsSnapshot = (): ProjectRepoMappingsSnapshot => ({
  workspaceRoot: null,
  repos: [],
  mappings: [],
});

const buildLocalTicketRunSnapshot = (): TicketRunSnapshot => ({
  runs: [],
});

const buildLocalMissionServiceSnapshot = (runId: string): MissionServiceSnapshot => ({
  runId,
  profiles: [],
  processes: [],
  updatedAt: Date.now(),
});

const requireBridge = (bridge: IpcBridgeHandle | null): IpcBridgeHandle => {
  if (!bridge) {
    throw new Error("Backend bridge is unavailable.");
  }

  return bridge;
};

const requireField = (value: string | undefined, message: string): string => {
  if (!value) {
    throw new Error(message);
  }

  return value;
};

const requireRunId = (runId: string | undefined): string => requireField(runId, "Run id is required.");

export const createMissionIpcHandlers = (getBridge: () => IpcBridgeHandle | null): IpcInvokeHandlerMap => ({
  [IPC_CHANNELS.projects.repoMappingsGet]: async (_event: IpcMainInvokeEvent): Promise<ProjectRepoMappingsSnapshot> =>
    (await getBridge()?.getProjectRepoMappings()) ?? buildLocalProjectRepoMappingsSnapshot(),

  [IPC_CHANNELS.projects.workspaceRootSet]: async (
    _event: IpcMainInvokeEvent,
    input?: { workspaceRoot?: string | null },
  ): Promise<ProjectRepoMappingsSnapshot> =>
    (await getBridge()?.setProjectWorkspaceRoot(input?.workspaceRoot ?? null)) ??
    buildLocalProjectRepoMappingsSnapshot(),

  [IPC_CHANNELS.projects.repoMappingSet]: async (
    _event: IpcMainInvokeEvent,
    input?: { projectKey?: string; repoRelativePaths?: string[] },
  ): Promise<ProjectRepoMappingsSnapshot> => {
    const projectKey = requireField(input?.projectKey, "Project key is required.");
    return (
      (await getBridge()?.setProjectRepoMapping(projectKey, input?.repoRelativePaths ?? [])) ??
      buildLocalProjectRepoMappingsSnapshot()
    );
  },

  [IPC_CHANNELS.missions.runsGet]: async (_event: IpcMainInvokeEvent): Promise<TicketRunSnapshot> =>
    (await getBridge()?.getTicketRuns()) ?? buildLocalTicketRunSnapshot(),

  [IPC_CHANNELS.missions.servicesGet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<MissionServiceSnapshot> => {
    const runId = requireRunId(input?.runId);
    return (await getBridge()?.getTicketRunServices(runId)) ?? buildLocalMissionServiceSnapshot(runId);
  },

  [IPC_CHANNELS.missions.serviceStart]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; profileId?: string },
  ): Promise<MissionServiceSnapshot> =>
    requireBridge(getBridge()).startTicketRunService(
      requireRunId(input?.runId),
      requireField(input?.profileId, "Profile id is required."),
    ),

  [IPC_CHANNELS.missions.serviceStop]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; serviceId?: string },
  ): Promise<MissionServiceSnapshot> =>
    requireBridge(getBridge()).stopTicketRunService(
      requireRunId(input?.runId),
      requireField(input?.serviceId, "Service id is required."),
    ),

  [IPC_CHANNELS.missions.start]: async (
    _event: IpcMainInvokeEvent,
    input?: { ticket?: { ticketId?: string; ticketSummary?: string; ticketUrl?: string; projectKey?: string } },
  ): Promise<StartTicketRunResult> => {
    const ticket = input?.ticket;
    if (!ticket?.ticketId || !ticket.ticketSummary || !ticket.ticketUrl || !ticket.projectKey) {
      throw new Error("Ticket id, summary, URL, and project key are required.");
    }

    return requireBridge(getBridge()).startTicketRun({
      ticketId: ticket.ticketId,
      ticketSummary: ticket.ticketSummary,
      ticketUrl: ticket.ticketUrl,
      projectKey: ticket.projectKey,
    });
  },

  [IPC_CHANNELS.missions.sync]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<RetryTicketRunSyncResult> => requireBridge(getBridge()).retryTicketRunSync(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.workStart]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; prompt?: string },
  ): Promise<StartTicketRunWorkResult> =>
    requireBridge(getBridge()).startTicketRunWork(requireRunId(input?.runId), input?.prompt),

  [IPC_CHANNELS.missions.workContinue]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; prompt?: string },
  ): Promise<ContinueTicketRunWorkResult> =>
    requireBridge(getBridge()).continueTicketRunWork(requireRunId(input?.runId), input?.prompt),

  [IPC_CHANNELS.missions.workCancel]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<CancelTicketRunWorkResult> => requireBridge(getBridge()).cancelTicketRunWork(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.complete]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<CompleteTicketRunResult> => requireBridge(getBridge()).completeTicketRun(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.proofsGet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<TicketRunProofSnapshotResult> =>
    requireBridge(getBridge()).getTicketRunProofSnapshot(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.timelineGet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<TicketRunMissionTimelineResult> =>
    requireBridge(getBridge()).getTicketRunMissionTimeline(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.repoIntelligenceGet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<TicketRunRepoIntelligenceCandidatesResult> =>
    requireBridge(getBridge()).getTicketRunRepoIntelligence(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.repoIntelligenceApprove]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; entryId?: string },
  ): Promise<ApproveTicketRunRepoIntelligenceResult> =>
    requireBridge(getBridge()).approveTicketRunRepoIntelligence(
      requireRunId(input?.runId),
      requireField(input?.entryId, "Repo intelligence entry id is required."),
    ),

  [IPC_CHANNELS.missions.proofRun]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; profileId?: string },
  ): Promise<RunTicketRunProofResult> =>
    requireBridge(getBridge()).runTicketRunProof(
      requireRunId(input?.runId),
      requireField(input?.profileId, "Profile id is required."),
    ),

  [IPC_CHANNELS.missions.proofArtifactRead]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; proofRunId?: string; artifactId?: string; maxBytes?: number },
  ) =>
    requireBridge(getBridge()).readTicketRunProofArtifact(
      requireRunId(input?.runId),
      requireField(input?.proofRunId, "Proof run id is required."),
      requireField(input?.artifactId, "Artifact id is required."),
      typeof input?.maxBytes === "number" ? { maxBytes: input.maxBytes } : undefined,
    ),

  [IPC_CHANNELS.missions.delete]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<DeleteTicketRunResult> => requireBridge(getBridge()).deleteTicketRun(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.reviewSnapshotGet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string },
  ): Promise<TicketRunReviewSnapshotResult> =>
    requireBridge(getBridge()).getTicketRunReviewSnapshot(requireRunId(input?.runId)),

  [IPC_CHANNELS.missions.gitStateGet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; repoRelativePath?: string },
  ): Promise<TicketRunGitStateResult> =>
    requireBridge(getBridge()).getTicketRunGitState(requireRunId(input?.runId), input?.repoRelativePath),

  [IPC_CHANNELS.missions.submoduleGitStateGet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; canonicalUrl?: string },
  ): Promise<TicketRunSubmoduleGitStateResult> =>
    requireBridge(getBridge()).getTicketRunSubmoduleGitState(
      requireRunId(input?.runId),
      requireField(input?.canonicalUrl, "Submodule URL is required."),
    ),

  [IPC_CHANNELS.missions.commitDraftGenerate]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; repoRelativePath?: string },
  ): Promise<GenerateTicketRunCommitDraftResult> =>
    requireBridge(getBridge()).generateTicketRunCommitDraft(requireRunId(input?.runId), input?.repoRelativePath),

  [IPC_CHANNELS.missions.submoduleCommitDraftGenerate]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; canonicalUrl?: string },
  ): Promise<GenerateTicketRunSubmoduleCommitDraftResult> =>
    requireBridge(getBridge()).generateTicketRunSubmoduleCommitDraft(
      requireRunId(input?.runId),
      requireField(input?.canonicalUrl, "Submodule URL is required."),
    ),

  [IPC_CHANNELS.missions.commitDraftSet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; message?: string; repoRelativePath?: string },
  ): Promise<SetTicketRunCommitDraftResult> =>
    requireBridge(getBridge()).setTicketRunCommitDraft(
      requireRunId(input?.runId),
      requireField(typeof input?.message === "string" ? input.message : undefined, "Commit message draft is required."),
      input?.repoRelativePath,
    ),

  [IPC_CHANNELS.missions.submoduleCommitDraftSet]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; canonicalUrl?: string; message?: string },
  ): Promise<SetTicketRunSubmoduleCommitDraftResult> =>
    requireBridge(getBridge()).setTicketRunSubmoduleCommitDraft(
      requireRunId(input?.runId),
      requireField(input?.canonicalUrl, "Submodule URL is required."),
      requireField(typeof input?.message === "string" ? input.message : undefined, "Commit message draft is required."),
    ),

  [IPC_CHANNELS.missions.commit]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; message?: string; repoRelativePath?: string },
  ): Promise<CommitTicketRunResult> =>
    requireBridge(getBridge()).commitTicketRun(
      requireRunId(input?.runId),
      requireField(typeof input?.message === "string" ? input.message : undefined, "Commit message is required."),
      input?.repoRelativePath,
    ),

  [IPC_CHANNELS.missions.submoduleCommit]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; canonicalUrl?: string; message?: string },
  ): Promise<CommitTicketRunSubmoduleResult> =>
    requireBridge(getBridge()).commitTicketRunSubmodule(
      requireRunId(input?.runId),
      requireField(input?.canonicalUrl, "Submodule URL is required."),
      requireField(typeof input?.message === "string" ? input.message : undefined, "Commit message is required."),
    ),

  [IPC_CHANNELS.missions.publish]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; repoRelativePath?: string },
  ): Promise<SyncTicketRunRemoteResult> =>
    requireBridge(getBridge()).publishTicketRun(requireRunId(input?.runId), input?.repoRelativePath),

  [IPC_CHANNELS.missions.submodulePublish]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; canonicalUrl?: string },
  ): Promise<SyncTicketRunSubmoduleRemoteResult> =>
    requireBridge(getBridge()).publishTicketRunSubmodule(
      requireRunId(input?.runId),
      requireField(input?.canonicalUrl, "Submodule URL is required."),
    ),

  [IPC_CHANNELS.missions.push]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; repoRelativePath?: string },
  ): Promise<SyncTicketRunRemoteResult> =>
    requireBridge(getBridge()).pushTicketRun(requireRunId(input?.runId), input?.repoRelativePath),

  [IPC_CHANNELS.missions.submodulePush]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; canonicalUrl?: string },
  ): Promise<SyncTicketRunSubmoduleRemoteResult> =>
    requireBridge(getBridge()).pushTicketRunSubmodule(
      requireRunId(input?.runId),
      requireField(input?.canonicalUrl, "Submodule URL is required."),
    ),

  [IPC_CHANNELS.missions.pullRequestCreate]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; repoRelativePath?: string },
  ): Promise<CreateTicketRunPullRequestResult> =>
    requireBridge(getBridge()).createTicketRunPullRequest(requireRunId(input?.runId), input?.repoRelativePath),

  [IPC_CHANNELS.missions.submodulePullRequestCreate]: async (
    _event: IpcMainInvokeEvent,
    input?: { runId?: string; canonicalUrl?: string },
  ): Promise<CreateTicketRunSubmodulePullRequestResult> =>
    requireBridge(getBridge()).createTicketRunSubmodulePullRequest(
      requireRunId(input?.runId),
      requireField(input?.canonicalUrl, "Submodule URL is required."),
    ),
});
