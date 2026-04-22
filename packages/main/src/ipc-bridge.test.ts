import { EventEmitter } from "node:events";
import type { ServerMessage, StoredConversation, TicketRunSummary } from "@spira/shared";
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

const createTicketRunSummary = (overrides: Partial<TicketRunSummary> = {}): TicketRunSummary => ({
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
  submodules: [],
  attempts: [],
  proof: {
    status: "not-run",
    lastProofAt: null,
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofSummary: null,
    staleReason: null,
  },
  proofRuns: [],
  ...overrides,
});

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

  it("caps queued renderer messages while the backend handshake is pending", async () => {
    const { setupIpcBridge } = await loadBridge();
    const webContents = new FakeWebContents();
    const window = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow;

    setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
    const socket = FakeWebSocket.instances[0];
    socket?.open();
    expect(getLastSentPayload(socket as FakeWebSocket)).toEqual({
      type: "handshake",
      protocolVersion: PROTOCOL_VERSION,
      rendererBuildId: "test-renderer",
    });

    for (let index = 0; index < 205; index += 1) {
      ipcMain.emit("spira:to-backend", {}, { type: "ping" });
    }

    socket?.receive({
      type: "backend:hello",
      generation: 7,
      protocolVersion: PROTOCOL_VERSION,
      backendBuildId: "backend-test",
    });

    expect((socket as FakeWebSocket).send).toHaveBeenCalledTimes(201);
  });

  it("rejects queued requests when the backend generation changes before replay", async () => {
    vi.useFakeTimers();
    try {
      const { setupIpcBridge } = await loadBridge();
      const webContents = new FakeWebContents();
      const window = {
        isDestroyed: () => false,
        webContents,
      } as unknown as BrowserWindow;

      const bridge = setupIpcBridge(window, 9720, { rendererBuildId: "test-renderer" });
      const firstSocket = FakeWebSocket.instances[0];
      firstSocket?.open();
      firstSocket?.receive({
        type: "backend:hello",
        generation: 7,
        protocolVersion: PROTOCOL_VERSION,
        backendBuildId: "backend-test",
      });

      firstSocket?.close();

      const pendingConversation = bridge.getRecentConversation();
      await vi.advanceTimersByTimeAsync(250);

      const secondSocket = FakeWebSocket.instances[1];
      secondSocket?.open();
      secondSocket?.receive({
        type: "backend:hello",
        generation: 8,
        protocolVersion: PROTOCOL_VERSION,
        backendBuildId: "backend-test",
      });

      await expect(pendingConversation).rejects.toThrow("Backend restarted before the queued request could be sent.");
    } finally {
      vi.useRealTimers();
    }
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
        run: createTicketRunSummary(),
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

  it("gives Missions ticket startup a five-minute backend timeout budget", async () => {
    vi.useFakeTimers();
    try {
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
      const rejection = vi.fn<(error: unknown) => void>();
      void pendingStart.catch(rejection);

      await vi.advanceTimersByTimeAsync(299_999);
      expect(rejection).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(rejection).toHaveBeenCalledTimes(1);
      expect(rejection.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect((rejection.mock.calls[0]?.[0] as Error).message).toBe(
        "Timed out waiting for the backend response to missions:ticket-run:start after 300000ms.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives mission repo commit draft updates a five-minute backend timeout budget", async () => {
    vi.useFakeTimers();
    try {
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

      const pendingDraft = bridge.setTicketRunCommitDraft("run-1", "feat: stage mission changes", "service-api");
      const draftRequest = getLastSentPayload(socket as FakeWebSocket);
      expect(draftRequest).toMatchObject({
        type: "missions:ticket-run:commit-draft:set",
        runId: "run-1",
        message: "feat: stage mission changes",
        repoRelativePath: "service-api",
      });
      const rejection = vi.fn<(error: unknown) => void>();
      void pendingDraft.catch(rejection);

      await vi.advanceTimersByTimeAsync(299_999);
      expect(rejection).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(rejection).toHaveBeenCalledTimes(1);
      expect(rejection.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect((rejection.mock.calls[0]?.[0] as Error).message).toBe(
        "Timed out waiting for the backend response to missions:ticket-run:commit-draft:set after 300000ms.",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives mission submodule commit draft updates a five-minute backend timeout budget", async () => {
    vi.useFakeTimers();
    try {
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

      const pendingDraft = bridge.setTicketRunSubmoduleCommitDraft(
        "run-1",
        "github.com/example/legapp-common",
        "feat: align shared submodule",
      );
      const draftRequest = getLastSentPayload(socket as FakeWebSocket);
      expect(draftRequest).toMatchObject({
        type: "missions:ticket-run:submodule:commit-draft:set",
        runId: "run-1",
        canonicalUrl: "github.com/example/legapp-common",
        message: "feat: align shared submodule",
      });
      const rejection = vi.fn<(error: unknown) => void>();
      void pendingDraft.catch(rejection);

      await vi.advanceTimersByTimeAsync(299_999);
      expect(rejection).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(rejection).toHaveBeenCalledTimes(1);
      expect(rejection.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      expect((rejection.mock.calls[0]?.[0] as Error).message).toBe(
        "Timed out waiting for the backend response to missions:ticket-run:submodule:commit-draft:set after 300000ms.",
      );
    } finally {
      vi.useRealTimers();
    }
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
        run: createTicketRunSummary({
          statusMessage: "Synced",
        }),
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
        run: createTicketRunSummary({
          status: "done",
          statusMessage: "Ready to ship.",
        }),
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
          blockedBySubmoduleCanonicalUrls: [],
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
        run: createTicketRunSummary({
          status: "done",
          statusMessage: "Ready to ship.",
        }),
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
          blockedBySubmoduleCanonicalUrls: [],
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

  it("passes mission review snapshot requests through the backend bridge", async () => {
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

    const pendingReviewSnapshot = bridge.getTicketRunReviewSnapshot("run-1");
    const reviewRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(reviewRequest).toMatchObject({
      type: "missions:ticket-run:review-snapshot:get",
      runId: "run-1",
    });

    socket?.receive({
      type: "missions:ticket-run:review-snapshot:result",
      requestId: String(reviewRequest.requestId),
      result: {
        snapshot: { runs: [] },
        run: createTicketRunSummary({
          status: "awaiting-review",
          statusMessage: "Ready for review.",
        }),
        reviewSnapshot: {
          runId: "run-1",
          repoEntries: [
            {
              repoRelativePath: "web-app",
              error: null,
              gitState: {
                runId: "run-1",
                repoRelativePath: "web-app",
                worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101\\web-app",
                branchName: "feat/spi-101-start-missions-pickup",
                upstreamBranch: "origin/feat/spi-101-start-missions-pickup",
                aheadCount: 0,
                behindCount: 0,
                hasDiff: false,
                pushAction: "none",
                commitMessageDraft: null,
                pullRequestUrls: {
                  open: "https://github.com/example/web-app/pull/new/main...feat%2Fspi-101-start-missions-pickup",
                  draft:
                    "https://github.com/example/web-app/pull/new/main...feat%2Fspi-101-start-missions-pickup?draft=1",
                },
                blockedBySubmoduleCanonicalUrls: [],
              },
            },
          ],
          submoduleEntries: [],
          visibleRepoPaths: ["web-app"],
          visibleSubmoduleUrls: [],
          canClose: true,
          canDelete: true,
          deleteBlockers: [],
        },
      },
    });

    await expect(pendingReviewSnapshot).resolves.toMatchObject({
      reviewSnapshot: {
        visibleRepoPaths: ["web-app"],
        visibleSubmoduleUrls: [],
        canClose: true,
        canDelete: true,
        deleteBlockers: [],
      },
    });
  });

  it("passes managed submodule git requests through the backend bridge", async () => {
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

    const canonicalUrl = "github.com/example/legapp-common";
    const pendingGitState = bridge.getTicketRunSubmoduleGitState("run-1", canonicalUrl);
    const gitStateRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(gitStateRequest).toMatchObject({
      type: "missions:ticket-run:submodule-git-state:get",
      runId: "run-1",
      canonicalUrl,
    });

    socket?.receive({
      type: "missions:ticket-run:submodule-git-state:result",
      requestId: String(gitStateRequest.requestId),
      result: {
        snapshot: { runs: [] },
        run: createTicketRunSummary({
          status: "done",
          statusMessage: "Ready to ship.",
        }),
        gitState: {
          runId: "run-1",
          canonicalUrl,
          name: "LegAppCommon",
          branchName: "feat/spi-101-start-missions-pickup",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101\\service-api\\Submodules\\LegAppCommon",
          upstreamBranch: null,
          aheadCount: 0,
          behindCount: 0,
          hasDiff: true,
          pushAction: "none",
          commitMessageDraft: "feat(SPI-101): adjust shared common",
          pullRequestUrls: {
            open: null,
            draft: null,
          },
          files: [],
          parents: [],
          primaryParentRepoRelativePath: "service-api",
          committedSha: "1234567890abcdef",
          reconcileRequired: false,
          reconcileReason: null,
        },
      },
    });

    await expect(pendingGitState).resolves.toMatchObject({
      gitState: {
        canonicalUrl,
        commitMessageDraft: "feat(SPI-101): adjust shared common",
      },
    });

    const pendingCommit = bridge.commitTicketRunSubmodule("run-1", canonicalUrl, "feat(SPI-101): adjust shared common");
    const commitRequest = getLastSentPayload(socket as FakeWebSocket);
    expect(commitRequest).toMatchObject({
      type: "missions:ticket-run:submodule:commit",
      runId: "run-1",
      canonicalUrl,
      message: "feat(SPI-101): adjust shared common",
    });

    socket?.receive({
      type: "missions:ticket-run:submodule:commit:result",
      requestId: String(commitRequest.requestId),
      result: {
        snapshot: { runs: [] },
        run: createTicketRunSummary({
          status: "done",
          statusMessage: "Ready to ship.",
        }),
        gitState: {
          runId: "run-1",
          canonicalUrl,
          name: "LegAppCommon",
          branchName: "feat/spi-101-start-missions-pickup",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101\\service-api\\Submodules\\LegAppCommon",
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
          parents: [],
          primaryParentRepoRelativePath: "service-api",
          committedSha: "1234567890abcdef",
          reconcileRequired: false,
          reconcileReason: null,
        },
        commitSha: "1234567",
      },
    });

    await expect(pendingCommit).resolves.toMatchObject({
      gitState: {
        canonicalUrl,
        pushAction: "publish",
      },
      commitSha: "1234567",
    });
  });
});
