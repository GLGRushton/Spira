import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { ConversationSearchMatch, StoredConversation, StoredConversationSummary } from "./conversation-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type { ClientMessage, ErrorPayload, PermissionRequestPayload, ServerMessage, UserSettings } from "./protocol.js";
import type { RuntimeConfigApplyResult, RuntimeConfigSummary, RuntimeConfigUpdate } from "./runtime-config.js";
import type { UpgradeProposal, UpgradeStatus } from "./upgrade.js";

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
}

export interface ElectronApi {
  send(message: ClientMessage): void;
  sendMessage(text: string, conversationId?: string): void;
  abortChat(): void;
  resetChat(): void;
  startNewChat(conversationId?: string): void;
  toggleVoice(): void;
  updateSettings(settings: Partial<UserSettings>): void;
  setMcpServerEnabled(serverId: string, enabled: boolean): void;
  getSettings(): Promise<Partial<UserSettings>>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  getRecentConversation(): Promise<StoredConversation | null>;
  listConversations(limit?: number, offset?: number): Promise<StoredConversationSummary[]>;
  getConversation(conversationId: string): Promise<StoredConversation | null>;
  searchConversations(query: string, limit?: number): Promise<ConversationSearchMatch[]>;
  markConversationViewed(conversationId: string): Promise<void>;
  archiveConversation(conversationId: string): Promise<boolean>;
  getRuntimeConfig(): Promise<RuntimeConfigSummary>;
  setRuntimeConfig(update: RuntimeConfigUpdate): Promise<RuntimeConfigApplyResult>;
  setSettings(data: Partial<UserSettings>): Promise<void>;
  respondToUpgradeProposal(proposalId: string, approved: boolean): Promise<void>;
  reportRendererFatal(payload: RendererFatalPayload): void;
  minimize(): void;
  maximize(): void;
  close(): void;
  onMessage(handler: (message: ServerMessage) => void): () => void;
  onStateChange(handler: (state: AssistantState) => void): () => void;
  onChatDelta(handler: (payload: { conversationId: string; token: string }) => void): () => void;
  onChatMessage(handler: (message: ChatMessage) => void): () => void;
  onChatComplete(handler: (payload: { conversationId: string; messageId: string }) => void): () => void;
  onChatAbortComplete(handler: () => void): () => void;
  onChatResetComplete(handler: () => void): () => void;
  onChatNewSessionComplete(handler: (payload: { preservedToMemory: boolean }) => void): () => void;
  onToolCall(handler: (payload: ToolCallPayload) => void): () => void;
  onPermissionRequest(handler: (payload: PermissionRequestPayload) => void): () => void;
  onPermissionComplete(
    handler: (payload: { requestId: string; result: "approved" | "denied" | "expired" }) => void,
  ): () => void;
  onMcpStatus(handler: (servers: McpServerStatus[]) => void): () => void;
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
