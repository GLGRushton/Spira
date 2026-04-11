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
}

type FakeManager = {
  bus: SpiraEventBus;
  clearSession: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  sendVoiceMessage: ReturnType<typeof vi.fn>;
  abortResponse: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  cancelPendingPermissionRequests: ReturnType<typeof vi.fn>;
  resolvePermissionRequest: ReturnType<typeof vi.fn>;
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
    createSessionManager: (stationId, bus) => {
      const manager: FakeManager = {
        bus,
        clearSession: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue(undefined),
        sendVoiceMessage: vi.fn().mockResolvedValue(undefined),
        abortResponse: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
        cancelPendingPermissionRequests: vi.fn(),
        resolvePermissionRequest: vi.fn().mockReturnValue(false),
      };
      managers.set(stationId, manager);
      return manager as never;
    },
  });

  return { registry, transport, managers, memoryDb };
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
});
