import { parseEnv } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { SpiraEventBus } from "../util/event-bus.js";
import { DEFAULT_STATION_ID, StationRegistry } from "./station-registry.js";

type FakeConversation = {
  id: string;
  title: string | null;
  messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number }>;
};

class FakeMemoryDb {
  private readonly sessionState = new Map<string, string | null>();
  private readonly conversations = new Map<string, FakeConversation>();
  private readonly stations = new Map<
    string,
    {
      stationId: string;
      label: string;
      createdAt: number;
      updatedAt: number;
    }
  >();
  private readonly runtimeStates = new Map<
    string,
    {
      stationId: string;
      state: "idle" | "thinking" | "listening" | "transcribing" | "speaking" | "error";
      promptInFlight: boolean;
      activeSessionId: string | null;
      activeToolCalls: unknown[];
      abortRequestedAt: number | null;
      recoveryMessage: string | null;
      createdAt: number;
      updatedAt: number;
    }
  >();

  getSessionState(key: string): string | null {
    return this.sessionState.get(key) ?? null;
  }

  setSessionState(key: string, value: string | null): void {
    this.sessionState.set(key, value);
  }

  createConversation(input: { id?: string; title?: string | null; createdAt?: number } = {}): string {
    const id = input.id ?? `conversation-${this.conversations.size + 1}`;
    if (!this.conversations.has(id)) {
      this.conversations.set(id, {
        id,
        title: input.title ?? null,
        messages: [],
      });
    }
    return id;
  }

  appendMessage(input: {
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    autoSpeak?: boolean;
    wasAborted?: boolean;
  }): void {
    const conversationId = this.createConversation({ id: input.conversationId });
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} was not created`);
    }
    if (!conversation.title && input.role === "user") {
      conversation.title = input.content;
    }
    conversation.messages.push({
      id: input.id,
      role: input.role,
      content: input.content,
      timestamp: input.timestamp,
    });
  }

  getConversation(conversationId: string): FakeConversation | null {
    return this.conversations.get(conversationId) ?? null;
  }

  listMemoryEntries(): [] {
    return [];
  }

  searchMemoryEntries(): [] {
    return [];
  }

  remember(): void {}

  upsertToolCall(): void {}

  upsertPersistedStation(input: { stationId: string; label: string; createdAt?: number }) {
    const existing = this.stations.get(input.stationId);
    const record = {
      stationId: input.stationId,
      label: input.label,
      createdAt: existing?.createdAt ?? input.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    this.stations.set(input.stationId, record);
    return record;
  }

  listPersistedStations() {
    return [...this.stations.values()];
  }

  deletePersistedStation(stationId: string): boolean {
    return this.stations.delete(stationId);
  }

  getRuntimeStationState(stationId: string) {
    return this.runtimeStates.get(stationId) ?? null;
  }

  upsertRuntimeStationState(input: {
    stationId: string;
    state: "idle" | "thinking" | "listening" | "transcribing" | "speaking" | "error";
    promptInFlight: boolean;
    activeSessionId?: string | null;
    activeToolCalls?: unknown[];
    abortRequestedAt?: number | null;
    recoveryMessage?: string | null;
    createdAt?: number;
    updatedAt?: number;
  }) {
    const existing = this.runtimeStates.get(input.stationId);
    const record = {
      stationId: input.stationId,
      state: input.state,
      promptInFlight: input.promptInFlight,
      activeSessionId: input.activeSessionId ?? null,
      activeToolCalls: input.activeToolCalls ?? [],
      abortRequestedAt: input.abortRequestedAt ?? null,
      recoveryMessage: input.recoveryMessage ?? null,
      createdAt: existing?.createdAt ?? input.createdAt ?? Date.now(),
      updatedAt: input.updatedAt ?? Date.now(),
    };
    this.runtimeStates.set(input.stationId, record);
    return record;
  }

  deleteRuntimeStationState(stationId: string): boolean {
    return this.runtimeStates.delete(stationId);
  }
}

type FakeManager = {
  bus: SpiraEventBus;
  options: {
    additionalInstructions?: string | null;
    workingDirectory?: string | null;
    allowUpgradeTools?: boolean;
  };
  clearSession: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  sendVoiceMessage: ReturnType<typeof vi.fn>;
  abortResponse: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  cancelPendingPermissionRequests: ReturnType<typeof vi.fn>;
  resolvePermissionRequest: ReturnType<typeof vi.fn>;
  listManagedSubagents: ReturnType<typeof vi.fn>;
};

const createRegistry = () => {
  const rootBus = new SpiraEventBus();
  const memoryDb = new FakeMemoryDb();
  const transport = {
    send: vi.fn(),
    onMessage: vi.fn(() => () => {}),
    close: vi.fn(),
  };
  const managers = new Map<string, FakeManager>();

  const registry = new StationRegistry({
    rootBus,
    env: parseEnv({}),
    toolAggregator: { getTools: () => [] } as never,
    transport: transport as never,
    memoryDb: memoryDb as never,
    createSessionManager: (stationId, bus, options) => {
      const manager: FakeManager = {
        bus,
        options: {
          additionalInstructions: options.additionalInstructions ?? null,
          workingDirectory: options.workingDirectory ?? null,
          allowUpgradeTools: options.allowUpgradeTools ?? true,
        },
        clearSession: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendVoiceMessage: vi.fn().mockResolvedValue(undefined),
        abortResponse: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
        cancelPendingPermissionRequests: vi.fn(),
        resolvePermissionRequest: vi.fn().mockReturnValue(false),
        listManagedSubagents: vi.fn().mockReturnValue([]),
      };
      managers.set(stationId, manager);
      return manager as never;
    },
  });

  return { registry, transport, managers, memoryDb, rootBus };
};

describe("StationRegistry", () => {
  it("forwards station-scoped transport events with stationId", () => {
    const { registry, transport, managers } = createRegistry();
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });

    managers.get(DEFAULT_STATION_ID)?.bus.emit("copilot:delta", "message-1", "hello");
    managers.get(DEFAULT_STATION_ID)?.bus.emit("copilot:permission-complete", "perm-1", "approved");
    managers.get(DEFAULT_STATION_ID)?.bus.emit("copilot:error", "BROKEN", "Boom", "details", "copilot");

    expect(transport.send).toHaveBeenCalledWith({
      type: "chat:token",
      token: "hello",
      conversationId: "message-1",
      stationId: DEFAULT_STATION_ID,
    });
    expect(transport.send).toHaveBeenCalledWith({
      type: "permission:complete",
      requestId: "perm-1",
      result: "approved",
      stationId: DEFAULT_STATION_ID,
    });
    expect(transport.send).toHaveBeenCalledWith({
      type: "error",
      code: "BROKEN",
      message: "Boom",
      details: "details",
      source: "copilot",
      stationId: DEFAULT_STATION_ID,
    });
  });

  it("forwards station-scoped provider usage events to the root bus", () => {
    const { registry, managers, rootBus } = createRegistry();
    const providerUsage = vi.fn();
    rootBus.on("provider:usage", providerUsage);
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });

    managers.get(DEFAULT_STATION_ID)?.bus.emit("provider:usage", {
      provider: "copilot",
      model: "gpt-5.4",
      totalTokens: 42,
      observedAt: 1_000,
      source: "provider",
    });

    expect(providerUsage).toHaveBeenCalledWith({
      provider: "copilot",
      model: "gpt-5.4",
      totalTokens: 42,
      observedAt: 1_000,
      source: "provider",
      stationId: DEFAULT_STATION_ID,
    });
  });

  it("replays managed subagent state into transport", () => {
    const { registry, transport, managers } = createRegistry();
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });
    managers.get(DEFAULT_STATION_ID)?.listManagedSubagents.mockReturnValue([
      {
        runId: "run-1",
        agent_id: "run-1",
        roomId: "agent:run-1",
        domain: "code-review",
        status: "idle",
        startedAt: 1_000,
        updatedAt: 2_000,
        completedAt: 2_000,
        envelope: {
          status: "completed",
          summary: "Done.",
          payload: null,
          artifacts: [],
          stateChanges: [],
          errors: [],
          completedAt: 2_000,
          followupNeeded: false,
        },
      },
      {
        runId: "run-2",
        agent_id: "run-2",
        roomId: "agent:run-2",
        domain: "spira",
        status: "failed",
        startedAt: 1_500,
        updatedAt: 2_500,
        completedAt: 2_500,
        summary: "Bridge unavailable.",
        envelope: {
          status: "completed",
          summary: "Stale envelope",
          payload: null,
          artifacts: [],
          stateChanges: [],
          errors: [],
          completedAt: 2_000,
          followupNeeded: false,
          retryCount: 0,
          runId: "run-2",
          domain: "spira",
          task: "Recovered task",
          durationMs: 500,
          startedAt: 1_500,
          toolCalls: [],
        },
      },
    ]);

    registry.replayManagedSubagentState();

    expect(transport.send).toHaveBeenCalledWith({
      type: "subagent:completed",
      stationId: DEFAULT_STATION_ID,
      event: {
        runId: "run-1",
        roomId: "agent:run-1",
        domain: "code-review",
        label: "code-review",
        completedAt: 2_000,
        envelope: expect.objectContaining({
          status: "completed",
          summary: "Done.",
        }),
      },
    });
    expect(transport.send).toHaveBeenCalledWith({
      type: "subagent:status",
      stationId: DEFAULT_STATION_ID,
      event: {
        runId: "run-2",
        roomId: "agent:run-2",
        domain: "spira",
        label: "spira",
        status: "failed",
        occurredAt: 2_500,
        summary: "Bridge unavailable.",
      },
    });
  });

  it("keeps station session switching isolated", async () => {
    const { registry, managers } = createRegistry();
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });
    registry.createStation({ stationId: "bravo", label: "Bravo" });

    await registry.sendMessage("Primary task", { stationId: DEFAULT_STATION_ID, conversationId: "conv-primary-1" });
    await registry.sendMessage("Bravo task", { stationId: "bravo", conversationId: "conv-bravo-1" });
    await registry.sendMessage("Primary task 2", { stationId: DEFAULT_STATION_ID, conversationId: "conv-primary-2" });

    expect(managers.get(DEFAULT_STATION_ID)?.clearSession).toHaveBeenCalledTimes(2);
    expect(managers.get("bravo")?.clearSession).toHaveBeenCalledTimes(1);

    await expect(registry.closeStation(DEFAULT_STATION_ID)).resolves.toBe(false);
    await expect(registry.closeStation("bravo")).resolves.toBe(true);
    expect(managers.get("bravo")?.shutdown).toHaveBeenCalledTimes(1);
  });

  it("creates the preferred conversation before appending messages", async () => {
    const { registry, memoryDb } = createRegistry();
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });

    await registry.sendMessage("Primary task", {
      stationId: DEFAULT_STATION_ID,
      conversationId: "conv-primary-1",
    });

    expect(memoryDb.getConversation("conv-primary-1")).toMatchObject({
      id: "conv-primary-1",
      title: "Primary task",
    });
  });

  it("rejects unknown non-primary station ids", async () => {
    const { registry } = createRegistry();
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });

    await expect(registry.sendMessage("Ghost task", { stationId: "ghost-station" })).rejects.toMatchObject({
      code: "STATION_NOT_FOUND",
    });
  });

  it("passes station-specific session options into the session manager", () => {
    const { registry, managers } = createRegistry();

    registry.createStation({
      stationId: "mission:run-1",
      label: "Mission SPI-69",
      additionalInstructions: "Stay rooted in the managed worktree.",
      workingDirectory: "C:\\Repos\\.spira-worktrees\\spi-69-spira",
      allowUpgradeTools: false,
    });

    const manager = managers.get("mission:run-1");
    expect(manager?.options).toMatchObject({
      additionalInstructions: "Stay rooted in the managed worktree.",
      workingDirectory: "C:\\Repos\\.spira-worktrees\\spi-69-spira",
      allowUpgradeTools: false,
    });
  });

  it("persists ad-hoc station definitions and removes them when closed", async () => {
    const { registry, memoryDb } = createRegistry();

    registry.createStation({
      stationId: "bravo",
      label: "Bravo",
    });
    memoryDb.upsertRuntimeStationState({
      stationId: "bravo",
      state: "error",
      promptInFlight: false,
      recoveryMessage: "Interrupted during restart.",
    });

    expect(memoryDb.listPersistedStations()).toMatchObject([
      {
        stationId: "bravo",
        label: "Bravo",
      },
    ]);
    expect(memoryDb.getRuntimeStationState("bravo")).toMatchObject({
      stationId: "bravo",
      state: "error",
    });

    await expect(registry.closeStation("bravo")).resolves.toBe(true);
    expect(memoryDb.listPersistedStations()).toEqual([]);
    expect(memoryDb.getRuntimeStationState("bravo")).toBeNull();
  });

  it("clears durable session artifacts when a station is closed", async () => {
    const { registry, memoryDb } = createRegistry();

    registry.createStation({
      stationId: "bravo",
      label: "Bravo",
    });
    memoryDb.setSessionState("station:bravo:artifact:plan", "Keep parity work moving.");
    memoryDb.setSessionState("station:bravo:artifact:scratchpad", "Pending notes");
    memoryDb.setSessionState("station:bravo:artifact:context", "{\"mode\":\"review\"}");

    await expect(registry.closeStation("bravo")).resolves.toBe(true);
    expect(memoryDb.getSessionState("station:bravo:artifact:plan")).toBeNull();
    expect(memoryDb.getSessionState("station:bravo:artifact:scratchpad")).toBeNull();
    expect(memoryDb.getSessionState("station:bravo:artifact:context")).toBeNull();
  });

  it("hydrates recovered station error state from runtime persistence", () => {
    const { registry, memoryDb } = createRegistry();
    memoryDb.upsertRuntimeStationState({
      stationId: "bravo",
      state: "error",
      promptInFlight: false,
      recoveryMessage: "Interrupted during restart.",
      updatedAt: 2_000,
    });

    const station = registry.createStation({
      stationId: "bravo",
      label: "Bravo",
      createdAt: 1_000,
      updatedAt: 1_500,
    });

    expect(station).toMatchObject({
      stationId: "bravo",
      state: "error",
      updatedAt: 2_000,
    });
  });

  it("replays recovered station runtime issues once into transport", () => {
    const { registry, memoryDb, transport } = createRegistry();
    memoryDb.upsertRuntimeStationState({
      stationId: "bravo",
      state: "error",
      promptInFlight: false,
      recoveryMessage: "Interrupted during restart.",
      updatedAt: 2_000,
    });

    registry.createStation({
      stationId: "bravo",
      label: "Bravo",
      createdAt: 1_000,
      updatedAt: 1_500,
    });

    registry.replayRecoveredStationIssues();
    registry.replayRecoveredStationIssues();

    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith({
      type: "error",
      code: "RECOVERED_STATION_RUNTIME",
      message: "Interrupted during restart.",
      source: "backend",
      stationId: "bravo",
    });
  });

  it("waits for the station response to finish before resolving", async () => {
    const { registry, managers } = createRegistry();
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });

    const pending = registry.sendMessageAndAwaitResponse("Primary task", {
      stationId: DEFAULT_STATION_ID,
      conversationId: "conv-primary-1",
    });

    const manager = managers.get(DEFAULT_STATION_ID);
    await Promise.resolve();
    expect(manager?.sendMessage).toHaveBeenCalledWith("Primary task", {
      continuityPreamble: null,
    });

    manager?.bus.emit("copilot:response-end", {
      messageId: "assistant-1",
      text: "Done.",
      timestamp: 2_000,
    });
    manager?.bus.emit("state:change", "thinking", "idle");

    await expect(pending).resolves.toMatchObject({
      messageId: "assistant-1",
      text: "Done.",
    });
  });

  it("rejects if the station returns to idle without a final response", async () => {
    const { registry, managers } = createRegistry();
    registry.createStation({ stationId: DEFAULT_STATION_ID, label: "Primary" });

    const pending = registry.sendMessageAndAwaitResponse("Primary task", {
      stationId: DEFAULT_STATION_ID,
      timeoutMs: 50,
    });

    const manager = managers.get(DEFAULT_STATION_ID);
    await Promise.resolve();
    manager?.bus.emit("state:change", "idle", "thinking");
    manager?.bus.emit("state:change", "thinking", "idle");

    await expect(pending).rejects.toMatchObject({
      code: "STATION_RESPONSE_ABORTED",
    });
  });
});
