import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { McpServerStatus } from "./mcp-types.js";

export type ClientMessage =
  | { type: "chat:send"; text: string }
  | { type: "chat:cancel" }
  | { type: "voice:toggle"; enabled: boolean }
  | { type: "voice:push-to-talk"; active: boolean }
  | { type: "settings:update"; settings: Partial<UserSettings> }
  | { type: "mcp:refresh" };

export type ServerMessage =
  | { type: "state:change"; previous: AssistantState; current: AssistantState }
  | { type: "chat:delta"; messageId: string; delta: string; done: boolean }
  | { type: "chat:message"; message: ChatMessage }
  | {
      type: "chat:tool-call";
      callId: string;
      toolName: string;
      args: Record<string, unknown>;
      status: ToolCallStatus;
      result?: unknown;
    }
  | { type: "audio:level"; level: number }
  | { type: "tts:amplitude"; amplitude: number }
  | { type: "voice:transcript"; text: string; confidence: number }
  | { type: "mcp:status"; servers: McpServerStatus[] }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export interface UserSettings {
  voiceEnabled: boolean;
  wakeWordEnabled: boolean;
  ttsProvider: "elevenlabs" | "piper";
  whisperModel: "tiny.en" | "base.en" | "small.en";
  elevenLabsVoiceId: string;
  theme: "dark";
}
