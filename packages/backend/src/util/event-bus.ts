import { EventEmitter } from "node:events";
import type {
  AssistantState,
  ClientMessage,
  McpServerStatus,
  MissionServiceSnapshot,
  PermissionRequestPayload,
  SubagentCompletedEvent,
  SubagentDeltaEvent,
  SubagentDomain,
  SubagentErrorEvent,
  SubagentLockAcquiredEvent,
  SubagentLockDeniedEvent,
  SubagentLockReleasedEvent,
  SubagentStartedEvent,
  SubagentStatusEvent,
  SubagentToolCallEvent,
  SubagentToolResultEvent,
  TicketRunSnapshot,
  VoicePipelineState,
} from "@spira/shared";

export interface EventMap {
  "chat:assistant-message": [
    message: { id: string; text: string; timestamp: number; autoSpeak?: boolean; persist?: boolean },
  ];
  "copilot:state": [state: AssistantState];
  "voice:pipeline": [{ state: VoicePipelineState }];
  "voice:muted": [{ muted: boolean }];
  "state:change": [previous: AssistantState, current: AssistantState];
  "audio:level": [{ level: number }];
  "tts:amplitude": [{ amplitude: number }];
  "tts:audio": [{ audioBase64: string; mimeType: "audio/wav" }];
  "voice:transcript": [{ text: string }];
  "copilot:response-start": [messageId: string];
  "copilot:delta": [messageId: string, delta: string];
  "copilot:response-end": [{ text: string; messageId: string; timestamp: number; autoSpeak?: boolean }];
  "copilot:error": [code: string, message: string, details?: string, source?: string];
  "copilot:tool-call": [callId: string, toolName: string, args: Record<string, unknown>];
  "copilot:tool-result": [callId: string, result: unknown];
  "copilot:permission-request": [request: PermissionRequestPayload];
  "copilot:permission-complete": [requestId: string, result: "approved" | "denied" | "expired"];
  "mcp:server-crashed": [serverId: string];
  "mcp:server-stderr": [serverId: string, line: string];
  "mcp:servers-changed": [statuses: McpServerStatus[]];
  "missions:runs-changed": [snapshot: TicketRunSnapshot];
  "missions:ticket-run:services-changed": [snapshot: MissionServiceSnapshot];
  "subagent:catalog-changed": [agents: SubagentDomain[]];
  "subagent:started": [event: SubagentStartedEvent];
  "subagent:tool-call": [event: SubagentToolCallEvent];
  "subagent:tool-result": [event: SubagentToolResultEvent];
  "subagent:delta": [event: SubagentDeltaEvent];
  "subagent:status": [event: SubagentStatusEvent];
  "subagent:completed": [event: SubagentCompletedEvent];
  "subagent:error": [event: SubagentErrorEvent];
  "subagent:lock-acquired": [event: SubagentLockAcquiredEvent];
  "subagent:lock-denied": [event: SubagentLockDeniedEvent];
  "subagent:lock-released": [event: SubagentLockReleasedEvent];
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
