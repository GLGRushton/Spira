import { EventEmitter } from "node:events";
import type { AssistantState, McpServerStatus, VoicePipelineEvent } from "@spira/shared";

export interface EventMap {
  "voice:pipeline": [VoicePipelineEvent];
  "state:change": [previous: AssistantState, current: AssistantState];
  "audio:level": [level: number];
  "tts:amplitude": [amplitude: number];
  "copilot:response-start": [messageId: string];
  "copilot:delta": [messageId: string, delta: string];
  "copilot:response-end": [messageId: string, fullText: string];
  "copilot:tool-call": [callId: string, toolName: string, args: Record<string, unknown>];
  "copilot:tool-result": [callId: string, result: unknown];
  "mcp:servers-changed": [statuses: McpServerStatus[]];
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
