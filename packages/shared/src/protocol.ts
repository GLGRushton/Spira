import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { ConversationSearchMatch, StoredConversation, StoredConversationSummary } from "./conversation-types.js";
import type { McpServerConfig } from "./mcp-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type {
  SubagentCompletedEvent,
  SubagentDeltaEvent,
  SubagentErrorEvent,
  SubagentLockAcquiredEvent,
  SubagentLockDeniedEvent,
  SubagentLockReleasedEvent,
  SubagentStartedEvent,
  SubagentStatusEvent,
  SubagentToolCallEvent,
  SubagentToolResultEvent,
} from "./subagent-types.js";
import type { UpgradeProposal, UpgradeStatus } from "./upgrade.js";

export interface ErrorPayload {
  code: string;
  message: string;
  source?: string;
  details?: string;
  stationId?: StationId;
}

export interface PermissionRequestPayload {
  requestId: string;
  stationId?: StationId;
  kind: "mcp";
  toolCallId?: string;
  serverName: string;
  toolName: string;
  toolTitle: string;
  args?: Record<string, unknown>;
  readOnly: boolean;
}

export type StationId = string;

export interface StationSummary {
  stationId: StationId;
  conversationId: string | null;
  label: string;
  title: string | null;
  state: AssistantState;
  createdAt: number;
  updatedAt: number;
  isStreaming: boolean;
}

export const PROTOCOL_VERSION = 5;

export const TTS_PROVIDERS = ["elevenlabs", "kokoro"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export const normalizeTtsProvider = (provider: string | null | undefined): TtsProvider =>
  provider === "elevenlabs" ? "elevenlabs" : "kokoro";
export const WAKE_WORD_PROVIDERS = ["openwakeword", "porcupine", "none"] as const;
export type WakeWordProviderSetting = (typeof WAKE_WORD_PROVIDERS)[number];
export const normalizeWakeWordProvider = (provider: string | null | undefined): WakeWordProviderSetting =>
  provider === "porcupine" || provider === "none" ? provider : "openwakeword";

export type ClientMessage =
  | { type: "station:create"; label?: string }
  | { type: "station:close"; stationId: StationId }
  | { type: "station:list"; requestId: string }
  | { type: "chat:send"; text: string; conversationId?: string; stationId?: StationId }
  | { type: "chat:abort"; stationId?: StationId }
  | { type: "chat:reset"; stationId?: StationId }
  | { type: "chat:new-session"; conversationId?: string; stationId?: StationId }
  | { type: "conversation:recent:get"; requestId: string }
  | { type: "conversation:list"; requestId: string; limit?: number; offset?: number }
  | { type: "conversation:get"; requestId: string; conversationId: string }
  | { type: "conversation:search"; requestId: string; query: string; limit?: number }
  | { type: "conversation:mark-viewed"; requestId: string; conversationId: string }
  | { type: "conversation:archive"; requestId: string; conversationId: string }
  | { type: "tts:speak"; text: string }
  | { type: "tts:stop" }
  | { type: "voice:toggle" }
  | { type: "voice:push-to-talk"; active: boolean }
  | { type: "voice:mute" }
  | { type: "voice:unmute" }
  | { type: "settings:update"; settings: Partial<UserSettings> }
  | { type: "permission:respond"; requestId: string; approved: boolean }
  | { type: "mcp:add-server"; config: McpServerConfig }
  | { type: "mcp:remove-server"; serverId: string }
  | { type: "mcp:set-enabled"; serverId: string; enabled: boolean }
  | { type: "handshake"; protocolVersion: number; rendererBuildId: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "pong"; protocolVersion: number; backendBuildId: string }
  | { type: "backend:hello"; generation: number; protocolVersion: number; backendBuildId: string }
  | { type: "station:created"; station: StationSummary }
  | { type: "station:closed"; stationId: StationId }
  | { type: "station:list:result"; requestId: string; stations: StationSummary[] }
  | { type: "upgrade:proposal"; proposal: UpgradeProposal; message: string }
  | ({ type: "upgrade:status" } & UpgradeStatus)
  | { type: "state:change"; state: AssistantState; stationId?: StationId }
  | { type: "voice:muted"; muted: boolean }
  | { type: "chat:token"; token: string; conversationId: string; stationId?: StationId }
  | { type: "chat:complete"; conversationId: string; messageId: string; stationId?: StationId }
  | { type: "chat:abort-complete"; stationId?: StationId }
  | { type: "chat:reset-complete"; stationId?: StationId }
  | { type: "chat:new-session-complete"; preservedToMemory: boolean; stationId?: StationId }
  | { type: "chat:message"; message: ChatMessage; stationId?: StationId }
  | { type: "conversation:recent:result"; requestId: string; conversation: StoredConversation | null }
  | { type: "conversation:list:result"; requestId: string; conversations: StoredConversationSummary[] }
  | { type: "conversation:get:result"; requestId: string; conversation: StoredConversation | null }
  | { type: "conversation:search:result"; requestId: string; matches: ConversationSearchMatch[] }
  | { type: "conversation:mark-viewed:result"; requestId: string; success: boolean }
  | { type: "conversation:archive:result"; requestId: string; success: boolean }
  | ({ type: "conversation:request-error"; requestId: string } & ErrorPayload)
  | {
      type: "tool:call";
      callId: string;
      name: string;
      status: ToolCallStatus;
      args?: unknown;
      details?: string;
      stationId?: StationId;
    }
  | { type: "permission:request"; request: PermissionRequestPayload }
  | { type: "permission:complete"; requestId: string; result: "approved" | "denied" | "expired"; stationId?: StationId }
  | { type: "mcp:status"; servers: McpServerStatus[] }
  | { type: "subagent:started"; event: SubagentStartedEvent; stationId?: StationId }
  | { type: "subagent:tool-call"; event: SubagentToolCallEvent; stationId?: StationId }
  | { type: "subagent:tool-result"; event: SubagentToolResultEvent; stationId?: StationId }
  | { type: "subagent:delta"; event: SubagentDeltaEvent; stationId?: StationId }
  | { type: "subagent:status"; event: SubagentStatusEvent; stationId?: StationId }
  | { type: "subagent:completed"; event: SubagentCompletedEvent; stationId?: StationId }
  | { type: "subagent:error"; event: SubagentErrorEvent; stationId?: StationId }
  | { type: "subagent:lock-acquired"; event: SubagentLockAcquiredEvent; stationId?: StationId }
  | { type: "subagent:lock-denied"; event: SubagentLockDeniedEvent; stationId?: StationId }
  | { type: "subagent:lock-released"; event: SubagentLockReleasedEvent; stationId?: StationId }
  | { type: "voice:transcript"; text: string }
  | { type: "audio:level"; level: number }
  | { type: "tts:amplitude"; amplitude: number }
  | { type: "tts:audio"; audioBase64: string; mimeType: "audio/wav" }
  | ({ type: "error" } & ErrorPayload)
  | { type: "settings:current"; settings: UserSettings };

export interface UserSettings {
  voiceEnabled: boolean;
  wakeWordEnabled: boolean;
  ttsProvider: TtsProvider;
  whisperModel: "tiny.en" | "base.en" | "small.en";
  wakeWordProvider: WakeWordProviderSetting;
  openWakeWordThreshold: number;
  elevenLabsVoiceId: string;
  theme: "ffx";
}
