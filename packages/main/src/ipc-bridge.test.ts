import { EventEmitter } from "node:events";
import type { ServerMessage, StoredConversation } from "@spira/shared";
import { PROTOCOL_VERSION } from "@spira/shared";
import type { BrowserWindow } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";

class FakeIpcMain extends EventEmitter {
  override on(event: string, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener);
  }

  override off(event: string, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener);
  }
}

const ipcMain = new FakeIpcMain();

class FakeWebSocket extends EventEmitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly send = vi.fn<(payload: string) => void>();
  readonly close = vi.fn<() => void>(() => {
    this.readyState = 3;
    this.emit("close");
  });

  readyState = FakeWebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open");
  }

  receive(message: ServerMessage): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
}

const updateTrayMuteState = vi.fn<(muted: boolean) => void>();

const loadBridge = async () => {
  vi.resetModules();
  vi.doMock("electron", () => ({
    ipcMain,
  }));
  vi.doMock("ws", () => ({
    default: FakeWebSocket,
  }));
  vi.doMock("./tray.js", () => ({
    updateTrayMuteState,
  }));

  return await import("./ipc-bridge.js");
};

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn<(channel: string, payload: unknown) => void>();
}

const getLastSentPayload = (socket: FakeWebSocket): Record<string, unknown> => {
  const payload = socket.send.mock.calls.at(-1)?.[0];
  if (typeof payload !== "string") {
    throw new Error("Expected a serialized payload.");
  }

  return JSON.parse(payload) as Record<string, unknown>;
};

describe("setupIpcBridge", () => {
  afterEach(() => {
    ipcMain.removeAllListeners();
    FakeWebSocket.instances.length = 0;
    updateTrayMuteState.mockReset();
    vi.clearAllMocks();
  });

  it("queues conversation archive requests until the backend handshake completes", async () => {
    const { setupIpcBridge } = await loadBridge();
    const webContents = new FakeWebContents();
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;

    const bridge = setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();

    socket?.open();
    expect(getLastSentPayload(socket as FakeWebSocket)).toEqual({
      type: "handshake",
      protocolVersion: PROTOCOL_VERSION,
      rendererBuildId: "test-renderer",
    });

    const restoredConversation: StoredConversation = {
      id: "conversation-1",
      title: "Recovered thread",
      createdAt: 1,
      updatedAt: 2,
      lastMessageAt: 2,
      lastViewedAt: 2,
      messageCount: 1,
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Restored from backend memory.",
          timestamp: 2,
        },
      ],
    };

    const pendingConversation = bridge.getRecentConversation();
    expect((socket as FakeWebSocket).send).toHaveBeenCalledTimes(1);

    socket?.receive({
      type: "backend:hello",
      generation: 7,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: "backend-test",
    });

    const queuedRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(queuedRequest.type).toBe("conversation:recent:get");
    expect(typeof queuedRequest.requestId).toBe("string");

    socket?.receive({
      type: "conversation:recent:result",
      requestId: String(queuedRequest.requestId),
      conversation: restoredConversation,
    });

    await expect(pendingConversation).resolves.toEqual(restoredConversation);

    const forwardedMessages = webContents.send.mock.calls
      .filter(([channel]) => channel === "spira:from-backend")
      .map(([, payload]) => (payload as { type: string }).type);

    expect(forwardedMessages).toContain("backend:hello");
    expect(forwardedMessages).not.toContain("conversation:recent:result");
  });
});
