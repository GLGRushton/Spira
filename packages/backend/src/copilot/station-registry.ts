import { randomUUID } from "node:crypto";
import type { SpiraMemoryDatabase, UpsertToolCallInput } from "@spira/memory-db";
import type {
  AssistantState,
  Env,
  ITransport,
  McpServerStatus,
  StationId,
  StationSummary,
  SubagentDelegationArgs,
  SubagentDomain,
  SubagentRunSnapshot,
  UpgradeProposal,
} from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { SubagentLockManager } from "../subagent/lock-manager.js";
import type { SubagentRegistry } from "../subagent/registry.js";
import { SpiraError } from "../util/errors.js";
import { type EventMap, SpiraEventBus } from "../util/event-bus.js";
import { setUnrefTimeout } from "../util/timers.js";
import { buildContinuityPreamble, buildConversationMemoryContent } from "./continuity.js";
import { CopilotSessionManager, type SessionPersistence } from "./session-manager.js";

export const DEFAULT_STATION_ID = "primary";
const DEFAULT_STATION_RESPONSE_TIMEOUT_MS = 30 * 60 * 1000;

const LEGACY_SESSION_STATE_SESSION_ID_KEY = "copilot-session-id";
const LEGACY_SESSION_STATE_CONVERSATION_ID_KEY = "active-conversation-id";
const CONVERSATION_MEMORY_PREFIX = "conversation-summary:";

interface StationContext {
  stationId: StationId;
  label: string;
  bus: SpiraEventBus;
  manager: CopilotSessionManager;
  pendingToolCalls: Map<string, Omit<UpsertToolCallInput, "messageId">>;
  activeConversationId: string | null;
  createdAt: number;
  updatedAt: number;
  state: AssistantState;
  disposeHandlers: Array<() => void>;
}

interface CreateStationOptions {
  stationId?: StationId;
  label?: string;
  additionalInstructions?: string;
  workingDirectory?: string;
  allowUpgradeTools?: boolean;
}

export interface AwaitStationResponseResult {
  text: string;
  messageId: string;
  timestamp: number;
  autoSpeak?: boolean;
}

interface EmitAssistantMessageOptions {
  autoSpeak?: boolean;
  persist?: boolean;
  timestamp?: number;
  messageId?: string;
}

interface StationRegistryOptions {
  rootBus: SpiraEventBus;
  env: Env;
  toolAggregator: McpToolAggregator;
  transport: ITransport;
  memoryDb: SpiraMemoryDatabase | null;
  subagentRegistry?: SubagentRegistry | null;
  requestUpgradeProposal?: (proposal: UpgradeProposal) => Promise<void> | void;
  applyHotCapabilityUpgrade?: () => Promise<void> | void;
  createSessionManager?: (
    stationId: StationId,
    bus: SpiraEventBus,
    options: {
      sessionPersistence: SessionPersistence | null;
      subagentLockManager: SubagentLockManager;
      subagentRegistry: SubagentRegistry | null;
      additionalInstructions?: string | null;
      workingDirectory?: string | null;
      allowUpgradeTools?: boolean;
    },
  ) => CopilotSessionManager;
}

const getStationSessionKey = (stationId: StationId, key: string, legacyKey: string): string =>
  stationId === DEFAULT_STATION_ID ? legacyKey : `station:${stationId}:${key}`;

export class StationRegistry {
  private readonly stations = new Map<StationId, StationContext>();
  private readonly subagentLockManager = new SubagentLockManager();
  private readonly rootBusDisposers: Array<() => void>;

  constructor(private readonly options: StationRegistryOptions) {
    const handleMcpServersChanged = (statuses: McpServerStatus[]) => {
      for (const station of this.stations.values()) {
        station.bus.emit("mcp:servers-changed", statuses);
      }
    };
    const handleSubagentCatalogChanged = (agents: SubagentDomain[]) => {
      for (const station of this.stations.values()) {
        station.bus.emit("subagent:catalog-changed", agents);
      }
    };

    this.options.rootBus.on("mcp:servers-changed", handleMcpServersChanged);
    this.options.rootBus.on("subagent:catalog-changed", handleSubagentCatalogChanged);
    this.rootBusDisposers = [
      () => {
        this.options.rootBus.off("mcp:servers-changed", handleMcpServersChanged);
      },
      () => {
        this.options.rootBus.off("subagent:catalog-changed", handleSubagentCatalogChanged);
      },
    ];
  }

  createStation(createOptions: CreateStationOptions = {}): StationSummary {
    const stationId = createOptions.stationId ?? randomUUID();
    const existing = this.stations.get(stationId);
    if (existing) {
      return this.toStationSummary(existing);
    }

    const bus = new SpiraEventBus();
    const createdAt = Date.now();
    const label =
      createOptions.label?.trim() ||
      (stationId === DEFAULT_STATION_ID ? "Primary" : `Station ${this.stations.size + 1}`);
    const sessionPersistence: SessionPersistence | null = this.options.memoryDb
      ? {
          load: () =>
            this.options.memoryDb?.getSessionState(
              getStationSessionKey(stationId, "copilot-session-id", LEGACY_SESSION_STATE_SESSION_ID_KEY),
            ) ?? null,
          save: (sessionId) => {
            this.options.memoryDb?.setSessionState(
              getStationSessionKey(stationId, "copilot-session-id", LEGACY_SESSION_STATE_SESSION_ID_KEY),
              sessionId,
            );
          },
        }
      : null;
    const manager = this.options.createSessionManager
      ? this.options.createSessionManager(stationId, bus, {
          sessionPersistence,
          subagentLockManager: this.subagentLockManager,
          subagentRegistry: this.options.subagentRegistry ?? null,
          additionalInstructions: createOptions.additionalInstructions ?? null,
          workingDirectory: createOptions.workingDirectory ?? null,
          allowUpgradeTools: createOptions.allowUpgradeTools,
        })
      : new CopilotSessionManager(
          bus,
          this.options.env,
          this.options.toolAggregator,
          this.options.requestUpgradeProposal,
          this.options.applyHotCapabilityUpgrade,
          {
            sessionPersistence,
            subagentLockManager: this.subagentLockManager,
            subagentRegistry: this.options.subagentRegistry ?? null,
            additionalInstructions: createOptions.additionalInstructions ?? null,
            workingDirectory: createOptions.workingDirectory ?? null,
            allowUpgradeTools: createOptions.allowUpgradeTools,
          },
        );
    const station: StationContext = {
      stationId,
      label,
      bus,
      manager,
      pendingToolCalls: new Map(),
      activeConversationId:
        this.options.memoryDb?.getSessionState(
          getStationSessionKey(stationId, "active-conversation-id", LEGACY_SESSION_STATE_CONVERSATION_ID_KEY),
        ) ?? null,
      createdAt,
      updatedAt: createdAt,
      state: "idle",
      disposeHandlers: [],
    };

    station.disposeHandlers = this.attachStationListeners(station);
    this.stations.set(stationId, station);
    return this.toStationSummary(station);
  }

  listStations(): StationSummary[] {
    return [...this.stations.values()]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((station) => this.toStationSummary(station));
  }

  async closeStation(stationId: StationId): Promise<boolean> {
    if (stationId === DEFAULT_STATION_ID) {
      return false;
    }

    const station = this.stations.get(stationId);
    if (!station) {
      return false;
    }

    await station.manager.shutdown();
    station.pendingToolCalls.clear();
    this.persistStationConversation(station, null);
    this.options.memoryDb?.setSessionState(
      getStationSessionKey(station.stationId, "copilot-session-id", LEGACY_SESSION_STATE_SESSION_ID_KEY),
      null,
    );

    for (const dispose of station.disposeHandlers) {
      dispose();
    }

    this.stations.delete(stationId);
    return true;
  }

  async shutdown(): Promise<void> {
    for (const station of [...this.stations.values()]) {
      await station.manager.shutdown();
      for (const dispose of station.disposeHandlers) {
        dispose();
      }
    }
    this.stations.clear();
    for (const dispose of this.rootBusDisposers) {
      dispose();
    }
  }

  cancelPendingPermissionRequests(): void {
    for (const station of this.stations.values()) {
      station.manager.cancelPendingPermissionRequests();
    }
  }

  handleClientDisconnected(): void {
    for (const station of this.stations.values()) {
      station.manager.cancelPendingPermissionRequests();
      station.pendingToolCalls.clear();
    }
  }

  resolvePermissionRequest(requestId: string, approved: boolean): boolean {
    for (const station of this.stations.values()) {
      if (station.manager.resolvePermissionRequest(requestId, approved)) {
        return true;
      }
    }
    return false;
  }

  async sendMessage(text: string, options: { stationId?: StationId; conversationId?: string } = {}): Promise<void> {
    const station = this.ensureStation(options.stationId);
    if (options.conversationId && options.conversationId !== station.activeConversationId) {
      this.persistStationConversation(station, options.conversationId);
      await station.manager.clearSession();
      station.pendingToolCalls.clear();
    }

    const continuityPreamble = this.getContinuityPreamble(station, text, options.conversationId);
    this.persistUserMessage(station, text, Date.now(), options.conversationId);
    station.updatedAt = Date.now();
    await station.manager.sendMessage(text, { continuityPreamble });
  }

  async sendMessageAndAwaitResponse(
    text: string,
    options: { stationId?: StationId; conversationId?: string; timeoutMs?: number } = {},
  ): Promise<AwaitStationResponseResult> {
    const station = this.ensureStation(options.stationId);

    return await new Promise<AwaitStationResponseResult>((resolve, reject) => {
      let completedResponse: AwaitStationResponseResult | null = null;
      let settled = false;
      let sawActiveState = station.state !== "idle";
      const timeout = setUnrefTimeout(() => {
        fail(
          new SpiraError(
            "STATION_RESPONSE_TIMEOUT",
            `Station ${station.stationId} did not finish responding before the timeout elapsed.`,
          ),
        );
      }, options.timeoutMs ?? DEFAULT_STATION_RESPONSE_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        station.bus.off("copilot:response-end", handleResponseEnd);
        station.bus.off("state:change", handleStateChange);
        station.bus.off("copilot:error", handleError);
      };

      const finish = (result: AwaitStationResponseResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const maybeFinish = () => {
        if (completedResponse && station.state === "idle") {
          finish(completedResponse);
        }
      };

      const handleResponseEnd = (response: AwaitStationResponseResult) => {
        completedResponse = response;
        maybeFinish();
      };
      const handleStateChange = (_previous: AssistantState, current: AssistantState) => {
        if (current !== "idle") {
          sawActiveState = true;
          return;
        }

        if (current === "idle") {
          if (!completedResponse && sawActiveState) {
            fail(
              new SpiraError(
                "STATION_RESPONSE_ABORTED",
                `Station ${station.stationId} stopped responding before it produced a final assistant message.`,
              ),
            );
            return;
          }
          maybeFinish();
        }
      };
      const handleError = (code: string, message: string, details?: string, source?: string) => {
        fail(new SpiraError(code, message, { details, source }));
      };

      station.bus.on("copilot:response-end", handleResponseEnd);
      station.bus.on("state:change", handleStateChange);
      station.bus.on("copilot:error", handleError);

      void this.sendMessage(text, options).catch((error) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async sendVoiceMessage(stationId: StationId, text: string): Promise<void> {
    const station = this.ensureStation(stationId);
    const continuityPreamble = this.getContinuityPreamble(station, text);
    this.persistUserMessage(station, text, Date.now());
    station.updatedAt = Date.now();
    await station.manager.sendVoiceMessage(text, { continuityPreamble });
  }

  launchManagedSubagent(
    domain: SubagentDomain,
    args: SubagentDelegationArgs,
    options: { stationId?: StationId; workingDirectory?: string } = {},
  ) {
    const station = this.ensureStation(options.stationId);
    return station.manager.launchManagedSubagent(domain, args, {
      workingDirectory: options.workingDirectory,
    });
  }

  writeManagedSubagent(runId: string, input: string, stationId?: StationId): Promise<SubagentRunSnapshot | null> {
    const station = this.ensureStation(stationId);
    return station.manager.writeManagedSubagent(runId, input);
  }

  waitForManagedSubagent(
    runId: string,
    options: { stationId?: StationId; timeoutMs?: number } = {},
  ): Promise<SubagentRunSnapshot | null> {
    const station = this.ensureStation(options.stationId);
    return station.manager.waitForManagedSubagent(runId, options.timeoutMs);
  }

  stopManagedSubagent(runId: string, stationId?: StationId): Promise<SubagentRunSnapshot | null> {
    const station = this.ensureStation(stationId);
    return station.manager.stopManagedSubagent(runId);
  }

  async abortStation(stationId?: StationId): Promise<void> {
    const station = this.ensureStation(stationId);
    await station.manager.abortResponse();
    station.pendingToolCalls.clear();
    station.updatedAt = Date.now();
  }

  async resetStation(stationId?: StationId): Promise<void> {
    const station = this.ensureStation(stationId);
    await station.manager.clearSession();
    station.pendingToolCalls.clear();
    this.persistStationConversation(station, null);
    station.updatedAt = Date.now();
  }

  async startNewSession(stationId?: StationId, conversationId?: string): Promise<boolean> {
    const station = this.ensureStation(stationId);
    const previousConversationId = conversationId ?? station.activeConversationId;
    const preservedToMemory = this.rememberConversationContext(previousConversationId);
    await station.manager.clearSession();
    station.pendingToolCalls.clear();
    this.persistStationConversation(station, null);
    station.updatedAt = Date.now();
    return preservedToMemory;
  }

  emitAssistantMessage(stationId: StationId, text: string, options: EmitAssistantMessageOptions = {}): void {
    const station = this.ensureStation(stationId);
    station.bus.emit("chat:assistant-message", {
      id: options.messageId ?? `assistant-${randomUUID()}`,
      text,
      timestamp: options.timestamp ?? Date.now(),
      autoSpeak: options.autoSpeak,
      persist: options.persist,
    });
  }

  private ensureStation(stationId?: StationId): StationContext {
    const resolvedStationId = stationId ?? DEFAULT_STATION_ID;
    const existing = this.stations.get(resolvedStationId);
    if (existing) {
      return existing;
    }

    if (resolvedStationId === DEFAULT_STATION_ID) {
      this.createStation({ stationId: resolvedStationId });
      const created = this.stations.get(resolvedStationId);
      if (created) {
        return created;
      }
    }

    throw new SpiraError("STATION_NOT_FOUND", `Unknown station ${resolvedStationId}`);
  }

  private attachStationListeners(station: StationContext): Array<() => void> {
    const register = <T extends keyof EventMap>(event: T, listener: (...args: EventMap[T]) => void): (() => void) => {
      station.bus.on(event, listener);
      return () => {
        station.bus.off(event, listener);
      };
    };

    return [
      register("state:change", (_previous: AssistantState, current: AssistantState) => {
        station.state = current;
        station.updatedAt = Date.now();
        this.options.transport.send({ type: "state:change", state: current, stationId: station.stationId });
      }),
      register("copilot:delta", (messageId: string, delta: string) => {
        station.updatedAt = Date.now();
        this.options.transport.send({
          type: "chat:token",
          token: delta,
          conversationId: messageId,
          stationId: station.stationId,
        });
      }),
      register("copilot:response-end", ({ messageId, text, timestamp, autoSpeak }) => {
        this.persistAssistantMessage(station, messageId, text, timestamp, { autoSpeak });
        this.options.transport.send({
          type: "chat:message",
          stationId: station.stationId,
          message: {
            id: messageId,
            role: "assistant",
            content: text,
            timestamp,
            autoSpeak,
          },
        });
        this.options.transport.send({
          type: "chat:complete",
          conversationId: messageId,
          messageId,
          stationId: station.stationId,
        });
      }),
      register("chat:assistant-message", ({ id, text, timestamp, autoSpeak, persist }) => {
        if (persist !== false) {
          this.persistAssistantMessage(station, id, text, timestamp, { autoSpeak });
        }
        this.options.transport.send({
          type: "chat:message",
          stationId: station.stationId,
          message: {
            id,
            role: "assistant",
            content: text,
            timestamp,
            autoSpeak,
          },
        });
        this.options.transport.send({
          type: "chat:complete",
          conversationId: id,
          messageId: id,
          stationId: station.stationId,
        });
      }),
      register("copilot:tool-call", (callId: string, toolName: string, args: Record<string, unknown>) => {
        station.pendingToolCalls.set(callId, {
          callId,
          name: toolName,
          args,
          status: "running",
        });
        station.updatedAt = Date.now();
        this.options.transport.send({
          type: "tool:call",
          callId,
          name: toolName,
          status: "running",
          args,
          stationId: station.stationId,
        });
      }),
      register("copilot:tool-result", (callId: string, result: unknown) => {
        const existing = station.pendingToolCalls.get(callId) ?? {
          callId,
          name: "unknown",
          args: {},
          status: "running" as const,
        };
        station.pendingToolCalls.set(callId, {
          callId,
          name: existing.name,
          args: existing.args,
          result,
          status: "success",
          details: typeof result === "string" ? result : undefined,
        });
        station.updatedAt = Date.now();
        this.options.transport.send({
          type: "tool:call",
          callId,
          name: existing.name,
          status: "success",
          args: existing.args,
          details: typeof result === "string" ? result : JSON.stringify(result),
          stationId: station.stationId,
        });
      }),
      register("copilot:error", (code: string, message: string, details?: string, source?: string) => {
        station.pendingToolCalls.clear();
        this.options.transport.send({ type: "error", code, message, details, source, stationId: station.stationId });
      }),
      register("copilot:permission-request", (request) => {
        this.options.transport.send({
          type: "permission:request",
          request: {
            ...request,
            stationId: station.stationId,
          },
        });
      }),
      register("copilot:permission-complete", (requestId: string, result: "approved" | "denied" | "expired") => {
        this.options.transport.send({
          type: "permission:complete",
          requestId,
          result,
          stationId: station.stationId,
        });
      }),
      register("subagent:started", (event) => {
        this.options.transport.send({ type: "subagent:started", event, stationId: station.stationId });
      }),
      register("subagent:tool-call", (event) => {
        this.options.transport.send({ type: "subagent:tool-call", event, stationId: station.stationId });
      }),
      register("subagent:tool-result", (event) => {
        this.options.transport.send({ type: "subagent:tool-result", event, stationId: station.stationId });
      }),
      register("subagent:delta", (event) => {
        this.options.transport.send({ type: "subagent:delta", event, stationId: station.stationId });
      }),
      register("subagent:status", (event) => {
        this.options.transport.send({ type: "subagent:status", event, stationId: station.stationId });
      }),
      register("subagent:completed", (event) => {
        this.options.transport.send({ type: "subagent:completed", event, stationId: station.stationId });
      }),
      register("subagent:error", (event) => {
        this.options.transport.send({ type: "subagent:error", event, stationId: station.stationId });
      }),
      register("subagent:lock-acquired", (event) => {
        this.options.transport.send({ type: "subagent:lock-acquired", event, stationId: station.stationId });
      }),
      register("subagent:lock-denied", (event) => {
        this.options.transport.send({ type: "subagent:lock-denied", event, stationId: station.stationId });
      }),
      register("subagent:lock-released", (event) => {
        this.options.transport.send({ type: "subagent:lock-released", event, stationId: station.stationId });
      }),
    ];
  }

  private toStationSummary(station: StationContext): StationSummary {
    const conversation = station.activeConversationId
      ? (this.options.memoryDb?.getConversation(station.activeConversationId) ?? null)
      : null;
    return {
      stationId: station.stationId,
      conversationId: station.activeConversationId,
      label: station.label,
      title: conversation?.title ?? null,
      state: station.state,
      createdAt: station.createdAt,
      updatedAt: station.updatedAt,
      isStreaming: station.state === "thinking",
    };
  }

  private persistStationConversation(station: StationContext, conversationId: string | null): void {
    station.activeConversationId = conversationId;
    this.options.memoryDb?.setSessionState(
      getStationSessionKey(station.stationId, "active-conversation-id", LEGACY_SESSION_STATE_CONVERSATION_ID_KEY),
      conversationId,
    );
  }

  private ensureActiveConversation(
    station: StationContext,
    timestamp: number,
    preferredTitle?: string,
    preferredId?: string,
  ): string | null {
    if (!this.options.memoryDb) {
      return null;
    }

    if (preferredId) {
      this.persistStationConversation(station, preferredId);
      this.options.memoryDb.createConversation({
        id: preferredId,
        title: preferredTitle,
        createdAt: timestamp,
      });
    }

    if (!station.activeConversationId) {
      this.persistStationConversation(
        station,
        this.options.memoryDb.createConversation({
          id: preferredId,
          title: preferredTitle,
          createdAt: timestamp,
        }),
      );
    }

    return station.activeConversationId;
  }

  private rememberConversationContext(conversationId: string | null): boolean {
    if (!this.options.memoryDb || !conversationId) {
      return false;
    }

    const conversation = this.options.memoryDb.getConversation(conversationId);
    if (!conversation) {
      return false;
    }

    const content = buildConversationMemoryContent(conversation);
    if (!content) {
      return false;
    }

    this.options.memoryDb.remember({
      id: `${CONVERSATION_MEMORY_PREFIX}${conversationId}`,
      category: "task-context",
      content,
      sourceConversationId: conversationId,
      sourceMessageId: conversation.messages.at(-1)?.id ?? null,
    });
    return true;
  }

  private getContinuityPreamble(station: StationContext, text: string, conversationId?: string): string | null {
    return buildContinuityPreamble({
      database: this.options.memoryDb,
      query: text,
      conversationId: conversationId ?? station.activeConversationId,
    });
  }

  private persistUserMessage(station: StationContext, text: string, timestamp: number, conversationId?: string): void {
    const activeId = this.ensureActiveConversation(station, timestamp, undefined, conversationId);
    if (!this.options.memoryDb || !activeId) {
      return;
    }

    this.options.memoryDb.appendMessage({
      id: `user-${randomUUID()}`,
      conversationId: activeId,
      role: "user",
      content: text,
      timestamp,
    });
  }

  private persistPendingToolCalls(station: StationContext, messageId: string): void {
    if (!this.options.memoryDb) {
      return;
    }

    for (const toolCall of station.pendingToolCalls.values()) {
      this.options.memoryDb.upsertToolCall({
        messageId,
        ...toolCall,
      });
    }
    station.pendingToolCalls.clear();
  }

  private persistAssistantMessage(
    station: StationContext,
    id: string,
    text: string,
    timestamp: number,
    options: { autoSpeak?: boolean; wasAborted?: boolean } = {},
  ): void {
    const conversationId = this.ensureActiveConversation(station, timestamp);
    if (!this.options.memoryDb || !conversationId) {
      return;
    }

    this.options.memoryDb.appendMessage({
      id,
      conversationId,
      role: "assistant",
      content: text,
      timestamp,
      autoSpeak: options.autoSpeak,
      wasAborted: options.wasAborted,
    });
    this.persistPendingToolCalls(station, id);
  }
}
