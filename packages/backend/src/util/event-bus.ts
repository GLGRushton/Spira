import { EventEmitter } from "node:events";
import type { AssistantState, ClientMessage, McpServerStatus, VoicePipelineState } from "@spira/shared";

export interface EventMap {
  "voice:pipeline": [{ state: VoicePipelineState }];
  "voice:muted": [{ muted: boolean }];
  "state:change": [previous: AssistantState, current: AssistantState];
  "audio:level": [{ level: number }];
  "tts:amplitude": [{ amplitude: number }];
  "tts:audio": [{ audioBase64: string; mimeType: "audio/wav" }];
  "voice:transcript": [{ text: string }];
  "copilot:response-start": [messageId: string];
  "copilot:delta": [messageId: string, delta: string];
  "copilot:response-end": [{ text: string; messageId: string }];
  "copilot:error": [code: string, message: string, details?: string, source?: string];
  "copilot:tool-call": [callId: string, toolName: string, args: Record<string, unknown>];
  "copilot:tool-result": [callId: string, result: unknown];
  "mcp:server-crashed": [serverId: string];
  "mcp:servers-changed": [statuses: McpServerStatus[]];
  "transport:client-message": [message: ClientMessage];
  "transport:client-connected": [];
  "transport:client-disconnected": [reason: string];
}

export class SpiraEventBus extends EventEmitter {
  override emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  override once<K extends keyof EventMap>(event: K, listener: (...args: EventMap[K]) => void): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }
}
