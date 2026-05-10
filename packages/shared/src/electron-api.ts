import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { ConversationSearchMatch, StoredConversation, StoredConversationSummary } from "./conversation-types.js";
import type { McpServerConfig, McpServerUpdateConfig } from "./mcp-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type { ProjectRepoMappingsSnapshot } from "./project-repo-types.js";
import type {
  ClientMessage,
  ErrorPayload,
  IntelligenceAuditEvent,
  PermissionRequestPayload,
  ServerMessage,
  StationId,
  UserSettings,
} from "./protocol.js";
import type { WorkSessionEventSummary } from "./work-session-events.js";
import type { RuntimeConfigApplyResult, RuntimeConfigSummary, RuntimeConfigUpdate } from "./runtime-config.js";
import type { MissionServiceSnapshot } from "./service-profile-types.js";
import type { SubagentCreateConfig } from "./subagent-types.js";
import type { SubagentDomain } from "./subagent-types.js";
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
  RetryTicketRunSyncResult,
  RunTicketRunProofResult,
  SetTicketRunCommitDraftResult,
  SetTicketRunSubmoduleCommitDraftResult,
  StartTicketRunRequest,
  StartTicketRunResult,
  StartTicketRunWorkResult,
  SyncTicketRunRemoteResult,
  SyncTicketRunSubmoduleRemoteResult,
  TicketRunGitStateResult,
  TicketRunMissionTimelineResult,
  TicketRunProofSnapshotResult,
  TicketRunRepoIntelligenceCandidatesResult,
  TicketRunReviewSnapshotResult,
  MissionLearnedCandidatesSnapshot,
  MissionProofRulesSnapshot,
  MissionRepoProfilesSnapshot,
  MissionValidationProfilesSnapshot,
  RevokeMissionLearnedCandidateInput,
  TicketRunSnapshot,
  TicketRunSubmoduleGitStateResult,
  TicketRunSummary,
  UpsertMissionProofRuleInput,
  UpsertMissionRepoProfileInput,
  UpsertMissionValidationProfileInput,
} from "./ticket-run-types.js";
import type { UpgradeProposal, UpgradeStatus } from "./upgrade.js";
import type {
  YouTrackProjectSummary,
  YouTrackStateMapping,
  YouTrackStatusSummary,
  YouTrackTicketSummary,
} from "./youtrack-types.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "upgrading";

export type RendererFatalPhase = "bootstrap" | "runtime";

export interface RendererFatalPayload {
  phase: RendererFatalPhase;
  title: string;
  message: string;
  details?: string;
}

export interface ToolCallPayload {
  callId: string;
  name: string;
  status: ToolCallStatus;
  args?: unknown;
  details?: string;
  stationId?: StationId;
}

export interface ElectronApi {
  send(message: ClientMessage): void;
  sendMessage(text: string, conversationId?: string, stationId?: StationId): void;
  abortChat(stationId?: StationId): void;
  resetChat(stationId?: StationId): void;
  startNewChat(conversationId?: string, stationId?: StationId): void;
  toggleVoice(): void;
  updateSettings(settings: Partial<UserSettings>): void;
  addMcpServer(config: McpServerConfig): void;
  updateMcpServer(serverId: string, patch: McpServerUpdateConfig): void;
  removeMcpServer(serverId: string): void;
  setMcpServerEnabled(serverId: string, enabled: boolean): void;
  createSubagent(config: SubagentCreateConfig): void;
  updateSubagent(agentId: string, patch: Partial<Omit<SubagentDomain, "id" | "source" | "delegationToolName">>): void;
  removeSubagent(agentId: string): void;
  setSubagentReady(agentId: string, ready: boolean): void;
  getSettings(): Promise<Partial<UserSettings>>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  getRecentConversation(): Promise<StoredConversation | null>;
  listConversations(limit?: number, offset?: number): Promise<StoredConversationSummary[]>;
  getConversation(conversationId: string): Promise<StoredConversation | null>;
  searchConversations(query: string, limit?: number): Promise<ConversationSearchMatch[]>;
  markConversationViewed(conversationId: string): Promise<void>;
  archiveConversation(conversationId: string): Promise<boolean>;
  getYouTrackStatus(): Promise<YouTrackStatusSummary>;
  listYouTrackTickets(limit?: number): Promise<YouTrackTicketSummary[]>;
  searchYouTrackProjects(query: string, limit?: number): Promise<YouTrackProjectSummary[]>;
  setYouTrackStateMapping(mapping: YouTrackStateMapping): Promise<YouTrackStatusSummary>;
  getProjectRepoMappings(): Promise<ProjectRepoMappingsSnapshot>;
  setProjectWorkspaceRoot(workspaceRoot: string | null): Promise<ProjectRepoMappingsSnapshot>;
  setProjectRepoMapping(projectKey: string, repoRelativePaths: string[]): Promise<ProjectRepoMappingsSnapshot>;
  getTicketRuns(): Promise<TicketRunSnapshot>;
  startTicketRun(ticket: StartTicketRunRequest): Promise<StartTicketRunResult>;
  retryTicketRunSync(runId: string): Promise<RetryTicketRunSyncResult>;
  startTicketRunWork(runId: string, prompt?: string): Promise<StartTicketRunWorkResult>;
  continueTicketRunWork(runId: string, prompt?: string): Promise<ContinueTicketRunWorkResult>;
  cancelTicketRunWork(runId: string): Promise<CancelTicketRunWorkResult>;
  completeTicketRun(runId: string): Promise<CompleteTicketRunResult>;
  getTicketRunProofSnapshot(runId: string): Promise<TicketRunProofSnapshotResult>;
  getTicketRunMissionTimeline(
    runId: string,
    options?: { beforeId?: number; limit?: number },
  ): Promise<TicketRunMissionTimelineResult>;
  getTicketRunRepoIntelligence(runId: string): Promise<TicketRunRepoIntelligenceCandidatesResult>;
  approveTicketRunRepoIntelligence(runId: string, entryId: string): Promise<ApproveTicketRunRepoIntelligenceResult>;
  runTicketRunProof(runId: string, profileId: string): Promise<RunTicketRunProofResult>;
  /** list every known proof rule (builtin + user) for the admin pane. */
  listMissionProofRules(): Promise<MissionProofRulesSnapshot>;
  /** create or update a user-authored proof rule; returns the fresh snapshot. */
  upsertMissionProofRule(rule: UpsertMissionProofRuleInput): Promise<MissionProofRulesSnapshot>;
  /** delete a user proof rule by id; returns the fresh snapshot. */
  deleteMissionProofRule(ruleId: string): Promise<MissionProofRulesSnapshot>;
  /** list every known repo profile (one per projectKey). */
  listMissionRepoProfiles(): Promise<MissionRepoProfilesSnapshot>;
  /** create or update a repo profile; returns the fresh snapshot. */
  upsertMissionRepoProfile(profile: UpsertMissionRepoProfileInput): Promise<MissionRepoProfilesSnapshot>;
  /** delete a repo profile by projectKey; returns the fresh snapshot. */
  deleteMissionRepoProfile(projectKey: string): Promise<MissionRepoProfilesSnapshot>;
  /** list every validation profile (builtin + user). */
  listMissionValidationProfiles(): Promise<MissionValidationProfilesSnapshot>;
  /** create/update a user validation profile; returns the fresh snapshot. */
  upsertMissionValidationProfile(
    profile: UpsertMissionValidationProfileInput,
  ): Promise<MissionValidationProfilesSnapshot>;
  /** delete a user validation profile by id; returns the fresh snapshot. */
  deleteMissionValidationProfile(profileId: string): Promise<MissionValidationProfilesSnapshot>;
  /** list every learned intelligence candidate (pending + promoted + revoked). */
  listMissionLearnedCandidates(): Promise<MissionLearnedCandidatesSnapshot>;
  /** revoke a learned candidate (operator override + audit). */
  revokeMissionLearnedCandidate(
    input: RevokeMissionLearnedCandidateInput,
  ): Promise<MissionLearnedCandidatesSnapshot>;
  /** Generate the weekly mission digest immediately and return the on-disk path (or null on skip). */
  generateMissionWeeklyDigest(): Promise<string | null>;
  /** Cross-mission audit feed of learned-candidate-promoted / -revoked events. */
  listMissionIntelligenceAudit(limit?: number): Promise<IntelligenceAuditEvent[]>;
  /** Fetch the most recent WorkSession events for a station (newest-first). */
  listWorkSessionEventsByStation(
    stationId: string,
    limit?: number,
  ): Promise<WorkSessionEventSummary[]>;
  /**
   * mark the proof gate as satisfied via manual review.
   * Justification is required and persisted on the run + as a mission event.
   */
  setTicketRunProofManualReview(
    runId: string,
    justification: string,
  ): Promise<{ run: TicketRunSummary; snapshot: TicketRunSnapshot }>;
  /** revert a prior manual-review choice; gate becomes unsatisfied again. */
  clearTicketRunProofManualReview(
    runId: string,
  ): Promise<{ run: TicketRunSummary; snapshot: TicketRunSnapshot }>;
  /** supersede earlier failed/pending validations of a kind via the latest passing one. */
  supersedeTicketRunValidations(
    runId: string,
    kind: string,
  ): Promise<{ run: TicketRunSummary; snapshot: TicketRunSnapshot }>;
  /** abort a mission with an operator reason. Closes the run with status="aborted". */
  abortTicketRun(
    runId: string,
    reason: string,
  ): Promise<{ run: TicketRunSummary; snapshot: TicketRunSnapshot }>;
  /**
   * read a proof artifact's text content (lazy-loaded inline log viewer).
   * Returns null content for binary or missing artifacts; size-capped to maxBytes (default ~256KB).
   */
  readTicketRunProofArtifact(
    runId: string,
    proofRunId: string,
    artifactId: string,
    options?: { maxBytes?: number },
  ): Promise<{
    content: string | null;
    truncated: boolean;
    totalBytes: number;
    mimeKind: "text" | "binary" | "missing";
    artifactPath: string | null;
  }>;
  deleteTicketRun(runId: string): Promise<DeleteTicketRunResult>;
  getTicketRunReviewSnapshot(runId: string): Promise<TicketRunReviewSnapshotResult>;
  getTicketRunGitState(runId: string, repoRelativePath?: string): Promise<TicketRunGitStateResult>;
  getTicketRunSubmoduleGitState(runId: string, canonicalUrl: string): Promise<TicketRunSubmoduleGitStateResult>;
  generateTicketRunCommitDraft(runId: string, repoRelativePath?: string): Promise<GenerateTicketRunCommitDraftResult>;
  generateTicketRunSubmoduleCommitDraft(
    runId: string,
    canonicalUrl: string,
  ): Promise<GenerateTicketRunSubmoduleCommitDraftResult>;
  setTicketRunCommitDraft(
    runId: string,
    message: string,
    repoRelativePath?: string,
  ): Promise<SetTicketRunCommitDraftResult>;
  setTicketRunSubmoduleCommitDraft(
    runId: string,
    canonicalUrl: string,
    message: string,
  ): Promise<SetTicketRunSubmoduleCommitDraftResult>;
  commitTicketRun(runId: string, message: string, repoRelativePath?: string): Promise<CommitTicketRunResult>;
  commitTicketRunSubmodule(
    runId: string,
    canonicalUrl: string,
    message: string,
  ): Promise<CommitTicketRunSubmoduleResult>;
  publishTicketRun(runId: string, repoRelativePath?: string): Promise<SyncTicketRunRemoteResult>;
  publishTicketRunSubmodule(runId: string, canonicalUrl: string): Promise<SyncTicketRunSubmoduleRemoteResult>;
  pushTicketRun(runId: string, repoRelativePath?: string): Promise<SyncTicketRunRemoteResult>;
  pushTicketRunSubmodule(runId: string, canonicalUrl: string): Promise<SyncTicketRunSubmoduleRemoteResult>;
  createTicketRunPullRequest(runId: string, repoRelativePath?: string): Promise<CreateTicketRunPullRequestResult>;
  createTicketRunSubmodulePullRequest(
    runId: string,
    canonicalUrl: string,
  ): Promise<CreateTicketRunSubmodulePullRequestResult>;
  getTicketRunServices(runId: string): Promise<MissionServiceSnapshot>;
  startTicketRunService(runId: string, profileId: string): Promise<MissionServiceSnapshot>;
  stopTicketRunService(runId: string, serviceId: string): Promise<MissionServiceSnapshot>;
  pickDirectory(title?: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  getRuntimeConfig(): Promise<RuntimeConfigSummary>;
  setRuntimeConfig(update: RuntimeConfigUpdate): Promise<RuntimeConfigApplyResult>;
  setSettings(data: Partial<UserSettings>): Promise<void>;
  respondToUpgradeProposal(proposalId: string, approved: boolean): Promise<void>;
  reportRendererFatal(payload: RendererFatalPayload): void;
  minimize(): void;
  maximize(): void;
  close(): void;
  onMessage(handler: (message: ServerMessage) => void): () => void;
  onStateChange(handler: (payload: { state: AssistantState; stationId?: StationId }) => void): () => void;
  onChatDelta(handler: (payload: { conversationId: string; token: string; stationId?: StationId }) => void): () => void;
  onChatMessage(handler: (payload: { message: ChatMessage; stationId?: StationId }) => void): () => void;
  onChatComplete(
    handler: (payload: { conversationId: string; messageId: string; stationId?: StationId }) => void,
  ): () => void;
  onChatAbortComplete(handler: (payload: { stationId?: StationId }) => void): () => void;
  onChatResetComplete(handler: (payload: { stationId?: StationId }) => void): () => void;
  onChatNewSessionComplete(
    handler: (payload: { preservedToMemory: boolean; stationId?: StationId }) => void,
  ): () => void;
  onToolCall(handler: (payload: ToolCallPayload) => void): () => void;
  onPermissionRequest(handler: (payload: PermissionRequestPayload) => void): () => void;
  onPermissionComplete(
    handler: (payload: { requestId: string; result: "approved" | "denied" | "expired"; stationId?: StationId }) => void,
  ): () => void;
  onTicketRunServicesUpdated(handler: (services: MissionServiceSnapshot) => void): () => void;
  onMcpStatus(handler: (servers: McpServerStatus[]) => void): () => void;
  onSubagentCatalog(handler: (agents: SubagentDomain[]) => void): () => void;
  onAudioLevel(handler: (level: number) => void): () => void;
  onTtsAmplitude(handler: (amplitude: number) => void): () => void;
  onVoiceTranscript(handler: (text: string) => void): () => void;
  onError(handler: (payload: ErrorPayload) => void): () => void;
  onSettingsCurrent(handler: (settings: UserSettings) => void): () => void;
  onUpgradeProposal(handler: (payload: { proposal: UpgradeProposal; message: string }) => void): () => void;
  onUpgradeStatus(handler: (status: UpgradeStatus) => void): () => void;
  onConnectionStatus(handler: (status: ConnectionStatus) => void): () => void;
  onUpdateAvailable(callback: (info: unknown) => void): void;
  onUpdateDownloaded(callback: (info: unknown) => void): void;
}
