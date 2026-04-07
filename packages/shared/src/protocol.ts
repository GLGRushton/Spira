import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { McpServerStatus } from "./mcp-types.js";

export interface ErrorPayload {
  code: string;
  message: string;
  source?: string;
  details?: string;
}

export type ClientMessage =
  | { type: "chat:send"; text: string; conversationId?: string }
  | { type: "chat:clear" }
  | { type: "tts:speak"; text: string }
  | { type: "tts:stop" }
  | { type: "voice:toggle" }
  | { type: "voice:push-to-talk"; active: boolean }
  | { type: "voice:mute" }
  | { type: "voice:unmute" }
  | { type: "settings:update"; settings: Partial<UserSettings> }
  | { type: "ping" };

export type ServerMessage =
  | { type: "pong" }
  | { type: "state:change"; state: AssistantState }
  | { type: "voice:muted"; muted: boolean }
  | { type: "chat:token"; token: string; conversationId: string }
  | { type: "chat:complete"; conversationId: string; messageId: string }
  | { type: "chat:message"; message: ChatMessage }
  | { type: "tool:call"; callId: string; name: string; status: ToolCallStatus; args?: unknown; details?: string }
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
  ttsProvider: "elevenlabs" | "piper";
  whisperModel: "tiny.en" | "base.en" | "small.en";
  elevenLabsVoiceId: string;
  theme: "ffx";
}
