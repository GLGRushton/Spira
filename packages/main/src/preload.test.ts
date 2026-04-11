import type { ElectronApi, McpServerStatus } from "@spira/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

type IpcListener = (event: unknown, payload: unknown) => void;

const listeners = new Map<string, Set<IpcListener>>();
const invoke = vi.fn(async (_channel: string, _payload?: unknown) => undefined);
const send = vi.fn((_channel: string, _payload?: unknown) => undefined);
const exposeInMainWorld = vi.fn((_name: string, _api: ElectronApi) => undefined);

const addListener = (channel: string, listener: IpcListener) => {
  const handlers = listeners.get(channel) ?? new Set<IpcListener>();
  handlers.add(listener);
  listeners.set(channel, handlers);
};

const removeListener = (channel: string, listener: IpcListener) => {
  listeners.get(channel)?.delete(listener);
};

const emitIpc = (channel: string, payload: unknown) => {
  for (const listener of listeners.get(channel) ?? []) {
    listener({}, payload);
  }
};

const loadPreloadApi = async (): Promise<ElectronApi> => {
  vi.resetModules();
  listeners.clear();
  invoke.mockClear();
  send.mockClear();
  exposeInMainWorld.mockClear();

  vi.doMock("electron", () => ({
    contextBridge: {
      exposeInMainWorld,
    },
    ipcRenderer: {
      on: addListener,
      off: removeListener,
      send,
      invoke,
    },
  }));

  await import("./preload.js");
  return exposeInMainWorld.mock.calls[0]?.[1] as ElectronApi;
};

describe("preload electron API", () => {
  beforeEach(() => {
    listeners.clear();
  });

  it("sends chat messages to the backend channel", async () => {
    const api = await loadPreloadApi();

    api.sendMessage("Hello, Spira", "conversation-1", "station-1");

    expect(send).toHaveBeenCalledWith("spira:to-backend", {
      type: "chat:send",
      text: "Hello, Spira",
      conversationId: "conversation-1",
      stationId: "station-1",
    });
  });

  it("replays the latest MCP status to new subscribers", async () => {
    const api = await loadPreloadApi();
    const received: McpServerStatus[][] = [];
    const firstStatuses: McpServerStatus[] = [
      {
        id: "vision",
        name: "Spira Vision",
        enabled: true,
        state: "connected",
        toolCount: 2,
        tools: ["capture", "inspect"],
        diagnostics: { failureCount: 0, recentStderr: [] },
      },
    ];

    emitIpc("spira:from-backend", { type: "mcp:status", servers: firstStatuses });

    const unsubscribe = api.onMcpStatus((servers) => {
      received.push(servers);
    });

    expect(received).toEqual([firstStatuses]);

    const secondStatuses: McpServerStatus[] = [
      {
        id: "vision",
        name: "Spira Vision",
        enabled: true,
        state: "connected",
        toolCount: 3,
        tools: ["capture", "inspect", "click"],
        diagnostics: { failureCount: 0, recentStderr: [] },
      },
    ];
    emitIpc("spira:from-backend", { type: "mcp:status", servers: secondStatuses });
    unsubscribe();
    emitIpc("spira:from-backend", { type: "mcp:status", servers: firstStatuses });

    expect(received).toEqual([firstStatuses, secondStatuses]);
  });

  it("does not replay non-replayable chat completion events", async () => {
    const api = await loadPreloadApi();
    const seen: Array<{ stationId?: string }> = [];

    emitIpc("spira:from-backend", { type: "chat:abort-complete", stationId: "station-7" });
    api.onChatAbortComplete((payload) => {
      seen.push(payload);
    });

    expect(seen).toEqual([]);
  });
});
