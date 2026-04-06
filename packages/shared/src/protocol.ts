import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { McpServerStatus } from "./mcp-types.js";

export type ClientMessage =
  | { type: "chat:send"; text: string; conversationId?: string }
  | { type: "chat:clear" }
  | { type: "voice:toggle" }
  | { type: "voice:push-to-talk"; active: boolean }
  | { type: "voice:mute" }
  | { type: "voice:unmute" }
  | { type: "settings:update"; settings: Partial<UserSettings> }
  | { type: "ping" };

export type ServerMessage =
  | { type: "pong" }
  | { type: "state:change"; state: AssistantState }
  | { type: "chat:token"; token: string; conversationId: string }
  | { type: "chat:complete"; conversationId: string; messageId: string }
  | { type: "chat:message"; message: ChatMessage }
  | { type: "tool:call"; callId: string; name: string; status: ToolCallStatus; details?: string }
  | { type: "mcp:status"; servers: McpServerStatus[] }
  | { type: "voice:transcript"; text: string }
  | { type: "audio:level"; level: number }
  | { type: "tts:amplitude"; amplitude: number }
  | { type: "error"; code: string; message: string }
  | { type: "settings:current"; settings: UserSettings };

export interface UserSettings {
  voiceEnabled: boolean;
  wakeWordEnabled: boolean;
  ttsProvider: "elevenlabs" | "piper";
  whisperModel: "tiny.en" | "base.en" | "small.en";
  elevenLabsVoiceId: string;
  theme: "dark";
}
