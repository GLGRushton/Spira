import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { ConversationSearchMatch, StoredConversation, StoredConversationSummary } from "./conversation-types.js";
import type { McpServerConfig, McpServerUpdateConfig } from "./mcp-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type { ProjectRepoMappingsSnapshot } from "./project-repo-types.js";
import type {
  ClientMessage,
  ErrorPayload,
  PermissionRequestPayload,
  ServerMessage,
  StationId,
  UserSettings,
} from "./protocol.js";
import type { RuntimeConfigApplyResult, RuntimeConfigSummary, RuntimeConfigUpdate } from "./runtime-config.js";
import type { SubagentCreateConfig } from "./subagent-types.js";
import type { SubagentDomain } from "./subagent-types.js";
import type {
  CancelTicketRunWorkResult,
  CommitTicketRunResult,
  CompleteTicketRunResult,
  ContinueTicketRunWorkResult,
  CreateTicketRunPullRequestResult,
  GenerateTicketRunCommitDraftResult,
  RetryTicketRunSyncResult,
  SetTicketRunCommitDraftResult,
  StartTicketRunRequest,
  StartTicketRunResult,
  StartTicketRunWorkResult,
  SyncTicketRunRemoteResult,
  TicketRunGitStateResult,
  TicketRunSnapshot,
} from "./ticket-run-types.js";
import type { UpgradeProposal, UpgradeStatus } from "./upgrade.js";
import type { YouTrackProjectSummary, YouTrackStatusSummary, YouTrackTicketSummary } from "./youtrack-types.js";

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
  getProjectRepoMappings(): Promise<ProjectRepoMappingsSnapshot>;
  setProjectWorkspaceRoot(workspaceRoot: string | null): Promise<ProjectRepoMappingsSnapshot>;
  setProjectRepoMapping(projectKey: string, repoRelativePaths: string[]): Promise<ProjectRepoMappingsSnapshot>;
  getTicketRuns(): Promise<TicketRunSnapshot>;
  startTicketRun(ticket: StartTicketRunRequest): Promise<StartTicketRunResult>;
  retryTicketRunSync(runId: string): Promise<RetryTicketRunSyncResult>;
  startTicketRunWork(runId: string): Promise<StartTicketRunWorkResult>;
  continueTicketRunWork(runId: string, prompt?: string): Promise<ContinueTicketRunWorkResult>;
  cancelTicketRunWork(runId: string): Promise<CancelTicketRunWorkResult>;
  completeTicketRun(runId: string): Promise<CompleteTicketRunResult>;
  getTicketRunGitState(runId: string): Promise<TicketRunGitStateResult>;
  generateTicketRunCommitDraft(runId: string): Promise<GenerateTicketRunCommitDraftResult>;
  setTicketRunCommitDraft(runId: string, message: string): Promise<SetTicketRunCommitDraftResult>;
  commitTicketRun(runId: string, message: string): Promise<CommitTicketRunResult>;
  publishTicketRun(runId: string): Promise<SyncTicketRunRemoteResult>;
  pushTicketRun(runId: string): Promise<SyncTicketRunRemoteResult>;
  createTicketRunPullRequest(runId: string): Promise<CreateTicketRunPullRequestResult>;
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
