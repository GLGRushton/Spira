import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { McpServerConfig } from "./mcp-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type { UpgradeProposal, UpgradeStatus } from "./upgrade.js";

export interface ErrorPayload {
  code: string;
  message: string;
  source?: string;
  details?: string;
}

export interface PermissionRequestPayload {
  requestId: string;
  kind: "mcp";
  toolCallId?: string;
  serverName: string;
  toolName: string;
  toolTitle: string;
  args?: Record<string, unknown>;
  readOnly: boolean;
}

export const PROTOCOL_VERSION = 2;

export const TTS_PROVIDERS = ["elevenlabs", "kokoro"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export const normalizeTtsProvider = (provider: string | null | undefined): TtsProvider =>
  provider === "elevenlabs" ? "elevenlabs" : "kokoro";
export const WAKE_WORD_PROVIDERS = ["openwakeword", "porcupine", "none"] as const;
export type WakeWordProviderSetting = (typeof WAKE_WORD_PROVIDERS)[number];
export const normalizeWakeWordProvider = (
  provider: string | null | undefined,
): WakeWordProviderSetting =>
  provider === "porcupine" || provider === "none" ? provider : "openwakeword";

export type ClientMessage =
  | { type: "chat:send"; text: string; conversationId?: string }
  | { type: "chat:abort" }
  | { type: "chat:reset" }
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
  | { type: "upgrade:proposal"; proposal: UpgradeProposal; message: string }
  | ({ type: "upgrade:status" } & UpgradeStatus)
  | { type: "state:change"; state: AssistantState }
  | { type: "voice:muted"; muted: boolean }
  | { type: "chat:token"; token: string; conversationId: string }
  | { type: "chat:complete"; conversationId: string; messageId: string }
  | { type: "chat:abort-complete" }
  | { type: "chat:reset-complete" }
  | { type: "chat:message"; message: ChatMessage }
  | { type: "tool:call"; callId: string; name: string; status: ToolCallStatus; args?: unknown; details?: string }
  | { type: "permission:request"; request: PermissionRequestPayload }
  | { type: "permission:complete"; requestId: string; result: "approved" | "denied" | "expired" }
  | { type: "mcp:status"; servers: McpServerStatus[] }
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
