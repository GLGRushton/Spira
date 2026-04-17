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

  it("requests YouTrack project suggestions through the backend bridge", async () => {
    const { setupIpcBridge } = await loadBridge();
    const webContents = new FakeWebContents();
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;

    const bridge = setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "backend:hello",
      generation: 7,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: "backend-test",
    });

    const pendingProjects = bridge.searchYouTrackProjects(true, "spi", 5);
    const projectSearchRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(projectSearchRequest).toMatchObject({
      type: "youtrack:projects:search",
      enabled: true,
      query: "spi",
      limit: 5,
    });

    socket?.receive({
      type: "youtrack:projects:search:result",
      requestId: String(projectSearchRequest.requestId),
      projects: [
        {
          id: "0-13",
          shortName: "SPI",
          name: "Spira",
        },
      ],
    });

    await expect(pendingProjects).resolves.toEqual([
      {
        id: "0-13",
        shortName: "SPI",
        name: "Spira",
      },
    ]);
  });

  it("saves the YouTrack workflow state mapping through the backend bridge", async () => {
    const { setupIpcBridge } = await loadBridge();
    const webContents = new FakeWebContents();
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;

    const bridge = setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "backend:hello",
      generation: 7,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: "backend-test",
    });

    const pendingStatus = bridge.setYouTrackStateMapping(true, {
      todo: ["Submitted", "Open"],
      inProgress: ["In Progress"],
    });
    const request = getLastSentPayload(socket as FakeWebSocket);
    expect(request).toMatchObject({
      type: "youtrack:state-mapping:set",
      enabled: true,
      mapping: {
        todo: ["Submitted", "Open"],
        inProgress: ["In Progress"],
      },
    });

    socket?.receive({
      type: "youtrack:state-mapping:set:result",
      requestId: String(request.requestId),
      status: {
        enabled: true,
        configured: true,
        state: "connected",
        baseUrl: "https://example.youtrack.cloud",
        account: {
          login: "shinra",
          name: "Shinra",
          fullName: "Shinra",
        },
        stateMapping: {
          todo: ["Submitted", "Open"],
          inProgress: ["In Progress"],
        },
        availableStates: ["Submitted", "Open", "In Progress", "Review"],
        message: "Authenticated as Shinra.",
      },
    });

    await expect(pendingStatus).resolves.toMatchObject({
      stateMapping: {
        todo: ["Submitted", "Open"],
        inProgress: ["In Progress"],
      },
      availableStates: ["Submitted", "Open", "In Progress", "Review"],
    });
  });

  it("starts Missions ticket runs through the backend bridge", async () => {
    const { setupIpcBridge } = await loadBridge();
    const webContents = new FakeWebContents();
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;

    const bridge = setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "backend:hello",
      generation: 7,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: "backend-test",
    });

    const pendingStart = bridge.startTicketRun({
      ticketId: "SPI-101",
      ticketSummary: "Start Missions pickup",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
      projectKey: "SPI",
    });
    const startRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(startRequest).toMatchObject({
      type: "missions:ticket-run:start",
      ticket: {
        ticketId: "SPI-101",
        ticketSummary: "Start Missions pickup",
        ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
        projectKey: "SPI",
      },
    });

    socket?.receive({
      type: "missions:ticket-run:start:result",
      requestId: String(startRequest.requestId),
      result: {
        reusedExistingRun: false,
        snapshot: {
          runs: [],
        },
        run: {
          runId: "run-1",
          stationId: null,
          ticketId: "SPI-101",
          ticketSummary: "Start Missions pickup",
          ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
          projectKey: "SPI",
          status: "ready",
          statusMessage: "Worktree ready.",
          commitMessageDraft: null,
          createdAt: 1,
          updatedAt: 2,
          startedAt: 1,
          worktrees: [],
          attempts: [],
        },
      },
    });

    await expect(pendingStart).resolves.toMatchObject({
      run: {
        runId: "run-1",
        ticketId: "SPI-101",
        status: "ready",
      },
      reusedExistingRun: false,
    });
  });

  it("retries Missions ticket sync through the backend bridge", async () => {
    const { setupIpcBridge } = await loadBridge();
    const webContents = new FakeWebContents();
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;

    const bridge = setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "backend:hello",
      generation: 7,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: "backend-test",
    });

    const pendingSync = bridge.retryTicketRunSync("run-1");
    const syncRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(syncRequest).toMatchObject({
      type: "missions:ticket-run:sync",
      runId: "run-1",
    });

    socket?.receive({
      type: "missions:ticket-run:sync:result",
      requestId: String(syncRequest.requestId),
      result: {
        snapshot: { runs: [] },
        run: {
          runId: "run-1",
          stationId: null,
          ticketId: "SPI-101",
          ticketSummary: "Start Missions pickup",
          ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
          projectKey: "SPI",
          status: "ready",
          statusMessage: "Synced",
          commitMessageDraft: null,
          createdAt: 1,
          updatedAt: 2,
          startedAt: 1,
          worktrees: [],
          attempts: [],
        },
      },
    });

    await expect(pendingSync).resolves.toMatchObject({
      run: {
        runId: "run-1",
        status: "ready",
      },
    });
  });

  it("passes repo-targeted mission git requests through the backend bridge", async () => {
    const { setupIpcBridge } = await loadBridge();
    const webContents = new FakeWebContents();
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;

    const bridge = setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.receive({
      type: "backend:hello",
      generation: 7,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: "backend-test",
    });

    const pendingGitState = bridge.getTicketRunGitState("run-1", "web-app");
    const gitStateRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(gitStateRequest).toMatchObject({
      type: "missions:ticket-run:git-state:get",
      runId: "run-1",
      repoRelativePath: "web-app",
    });

    socket?.receive({
      type: "missions:ticket-run:git-state:result",
      requestId: String(gitStateRequest.requestId),
      result: {
        snapshot: { runs: [] },
        run: {
          runId: "run-1",
          stationId: null,
          ticketId: "SPI-101",
          ticketSummary: "Start Missions pickup",
          ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
          projectKey: "SPI",
          status: "done",
          statusMessage: "Ready to ship.",
          commitMessageDraft: null,
          createdAt: 1,
          updatedAt: 2,
          startedAt: 1,
          worktrees: [],
          attempts: [],
        },
        gitState: {
          runId: "run-1",
          repoRelativePath: "web-app",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101\\web-app",
          branchName: "feat/spi-101-start-missions-pickup",
          upstreamBranch: null,
          aheadCount: 0,
          behindCount: 0,
          hasDiff: true,
          pushAction: "none",
          commitMessageDraft: "feat(SPI-101): adjust web app",
          pullRequestUrls: {
            open: null,
            draft: null,
          },
          files: [],
        },
      },
    });

    await expect(pendingGitState).resolves.toMatchObject({
      gitState: {
        repoRelativePath: "web-app",
        commitMessageDraft: "feat(SPI-101): adjust web app",
      },
    });

    const pendingCommit = bridge.commitTicketRun("run-1", "feat(SPI-101): adjust web app", "web-app");
    const commitRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(commitRequest).toMatchObject({
      type: "missions:ticket-run:commit",
      runId: "run-1",
      message: "feat(SPI-101): adjust web app",
      repoRelativePath: "web-app",
    });

    socket?.receive({
      type: "missions:ticket-run:commit:result",
      requestId: String(commitRequest.requestId),
      result: {
        snapshot: { runs: [] },
        run: {
          runId: "run-1",
          stationId: null,
          ticketId: "SPI-101",
          ticketSummary: "Start Missions pickup",
          ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
          projectKey: "SPI",
          status: "done",
          statusMessage: "Ready to ship.",
          commitMessageDraft: null,
          createdAt: 1,
          updatedAt: 2,
          startedAt: 1,
          worktrees: [],
          attempts: [],
        },
        gitState: {
          runId: "run-1",
          repoRelativePath: "web-app",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101\\web-app",
          branchName: "feat/spi-101-start-missions-pickup",
          upstreamBranch: null,
          aheadCount: 0,
          behindCount: 0,
          hasDiff: false,
          pushAction: "publish",
          commitMessageDraft: null,
          pullRequestUrls: {
            open: null,
            draft: null,
          },
          files: [],
        },
        commitSha: "1234567",
      },
    });

    await expect(pendingCommit).resolves.toMatchObject({
      gitState: {
        repoRelativePath: "web-app",
        pushAction: "publish",
      },
      commitSha: "1234567",
    });
  });
});
