import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type { ClientMessage, ErrorPayload, ServerMessage, UserSettings } from "./protocol.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface ToolCallPayload {
  callId: string;
  name: string;
  status: ToolCallStatus;
  args?: unknown;
  details?: string;
}

export interface ElectronApi {
  send(message: ClientMessage): void;
  sendMessage(text: string): void;
  clearChat(): void;
  toggleVoice(): void;
  updateSettings(settings: Partial<UserSettings>): void;
  getSettings(): Promise<Partial<UserSettings>>;
  getConnectionStatus(): Promise<ConnectionStatus>;
  setSettings(data: Partial<UserSettings>): Promise<void>;
  minimize(): void;
  maximize(): void;
  close(): void;
  onMessage(handler: (message: ServerMessage) => void): () => void;
  onStateChange(handler: (state: AssistantState) => void): () => void;
  onChatDelta(handler: (payload: { conversationId: string; token: string }) => void): () => void;
  onChatMessage(handler: (message: ChatMessage) => void): () => void;
  onChatComplete(handler: (payload: { conversationId: string; messageId: string }) => void): () => void;
  onToolCall(handler: (payload: ToolCallPayload) => void): () => void;
  onMcpStatus(handler: (servers: McpServerStatus[]) => void): () => void;
  onAudioLevel(handler: (level: number) => void): () => void;
  onTtsAmplitude(handler: (amplitude: number) => void): () => void;
  onVoiceTranscript(handler: (text: string) => void): () => void;
  onError(handler: (payload: ErrorPayload) => void): () => void;
  onSettingsCurrent(handler: (settings: UserSettings) => void): () => void;
  onConnectionStatus(handler: (status: ConnectionStatus) => void): () => void;
  onUpdateAvailable(callback: (info: unknown) => void): void;
  onUpdateDownloaded(callback: (info: unknown) => void): void;
}
