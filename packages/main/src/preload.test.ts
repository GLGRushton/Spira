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

  it("passes an initial mission prompt when starting mission work", async () => {
    const api = await loadPreloadApi();

    await api.startTicketRunWork("run-1", "Use the seeded test account.");

    expect(invoke).toHaveBeenCalledWith("missions:ticket-run:work:start", {
      runId: "run-1",
      prompt: "Use the seeded test account.",
    });
  });

  it("requests mission timeline data over the dedicated ipc channel", async () => {
    const api = await loadPreloadApi();

    await api.getTicketRunMissionTimeline("run-42");

    expect(invoke).toHaveBeenCalledWith("missions:ticket-run:timeline:get", {
      runId: "run-42",
    });
  });

  it("requests repo intelligence candidates and approvals over dedicated ipc channels", async () => {
    const api = await loadPreloadApi();

    await api.getTicketRunRepoIntelligence("run-42");
    await api.approveTicketRunRepoIntelligence("run-42", "learned-run-42-packages-renderer");

    expect(invoke).toHaveBeenNthCalledWith(1, "missions:ticket-run:repo-intelligence:get", {
      runId: "run-42",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "missions:ticket-run:repo-intelligence:approve", {
      runId: "run-42",
      entryId: "learned-run-42-packages-renderer",
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

  it("replays cached station state independently for each station", async () => {
    const api = await loadPreloadApi();
    const received: Array<{ state: string; stationId?: string }> = [];

    emitIpc("spira:from-backend", { type: "state:change", state: "thinking", stationId: "station-alpha" });
    emitIpc("spira:from-backend", { type: "state:change", state: "idle", stationId: "station-bravo" });

    api.onStateChange((payload) => {
      received.push(payload);
    });

    expect(received).toEqual([
      { state: "thinking", stationId: "station-alpha" },
      { state: "idle", stationId: "station-bravo" },
    ]);
  });

  it("drops cached station messages after a station closes", async () => {
    const api = await loadPreloadApi();
    const received: Array<{ state: string; stationId?: string }> = [];

    emitIpc("spira:from-backend", { type: "state:change", state: "thinking", stationId: "station-alpha" });
    emitIpc("spira:from-backend", { type: "station:closed", stationId: "station-alpha" });

    api.onStateChange((payload) => {
      received.push(payload);
    });

    expect(received).toEqual([]);
  });

  it("replays cached permission requests using nested station ids", async () => {
    const api = await loadPreloadApi();
    const received: Array<{ requestId: string; stationId?: string }> = [];

    emitIpc("spira:from-backend", {
      type: "permission:request",
      request: {
        requestId: "request-alpha",
        stationId: "station-alpha",
        kind: "mcp",
        serverName: "Spira Vision",
        toolName: "vision_capture_screen",
        toolTitle: "Capture screen",
        readOnly: true,
      },
    });
    emitIpc("spira:from-backend", {
      type: "permission:request",
      request: {
        requestId: "request-bravo",
        stationId: "station-bravo",
        kind: "mcp",
        serverName: "Spira Vision",
        toolName: "vision_read_screen",
        toolTitle: "Read screen",
        readOnly: true,
      },
    });

    api.onPermissionRequest((payload) => {
      received.push({ requestId: payload.requestId, stationId: payload.stationId });
    });

    expect(received).toEqual([
      { requestId: "request-alpha", stationId: "station-alpha" },
      { requestId: "request-bravo", stationId: "station-bravo" },
    ]);
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
