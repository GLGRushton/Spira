import { EventEmitter } from "node:events";
import type { ServerMessage, UpgradeProposal } from "@spira/shared";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { BackendLifecycle } from "./backend-lifecycle.js";
import { UpgradeOrchestrator } from "./upgrade-orchestrator.js";

class FakeWebContents extends EventEmitter {
  readonly send = vi.fn<(channel: string, message: ServerMessage) => void>();
  readonly reloadIgnoringCache = vi.fn<() => void>();
}

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, resolve, reject };
};

const createUiRefreshProposal = (): UpgradeProposal => ({
  proposalId: "proposal-1",
  scope: "ui-refresh",
  summary: "Refresh renderer",
  requestedAt: 1,
  changedFiles: ["packages/renderer/src/main.tsx"],
});

const createHarness = (options?: {
  rendererReadySequence?: number;
  waitForNextRendererReady?: (afterSequence: number, timeoutMs: number) => Promise<void>;
}) => {
  const messages: ServerMessage[] = [];
  const webContents = new FakeWebContents();
  webContents.send.mockImplementation((_channel, message) => {
    messages.push(message);
  });

  const window = {
    isDestroyed: () => false,
    webContents,
  } as unknown as BrowserWindow;

  const getRendererReadySequence = vi.fn(() => options?.rendererReadySequence ?? 0);
  const waitForNextRendererReady = vi.fn(options?.waitForNextRendererReady ?? (() => Promise.resolve()));

  const orchestrator = new UpgradeOrchestrator({
    lifecycle: {} as BackendLifecycle,
    getWindow: () => window,
    emitConnectionStatus: vi.fn(),
    getRendererReadySequence,
    waitForNextRendererReady,
    relaunchApp: vi.fn(async () => {}),
  });

  const proposal = createUiRefreshProposal();
  expect(orchestrator.handleProposal(proposal)).toEqual({ accepted: true });

  return {
    messages,
    orchestrator,
    proposal,
    waitForNextRendererReady,
    webContents,
  };
};

describe("UpgradeOrchestrator", () => {
  it("waits for a new renderer-ready signal before completing a UI refresh", async () => {
    const deferred = createDeferred<void>();
    const { messages, orchestrator, proposal, waitForNextRendererReady, webContents } = createHarness({
      rendererReadySequence: 4,
      waitForNextRendererReady: () => deferred.promise,
    });

    let settled = false;
    const refreshPromise = orchestrator.respondToProposal(proposal.proposalId, true).then(() => {
      settled = true;
    });

    expect(waitForNextRendererReady).toHaveBeenCalledWith(4, 15_000);
    expect(webContents.reloadIgnoringCache).toHaveBeenCalledTimes(1);

    webContents.emit("did-finish-load");
    await Promise.resolve();
    expect(settled).toBe(false);

    deferred.resolve();
    await refreshPromise;

    expect(messages).toEqual([
      {
        type: "upgrade:proposal",
        proposal,
        message:
          "This change needs a UI refresh to take effect. Refresh when you're ready; the chat history will be restored.",
      },
      {
        type: "upgrade:status",
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        status: "applying",
        message: "Refreshing the UI to apply the update...",
      },
      {
        type: "upgrade:status",
        proposalId: proposal.proposalId,
        scope: proposal.scope,
        status: "completed",
        message: "Upgrade applied.",
      },
    ]);
  });

  it("fails the upgrade when the main frame fails to reload", async () => {
    const deferred = createDeferred<void>();
    const { messages, orchestrator, proposal, webContents } = createHarness({
      waitForNextRendererReady: () => deferred.promise,
    });

    const refreshPromise = orchestrator.respondToProposal(proposal.proposalId, true);
    webContents.emit("did-fail-load", {}, -1, "failure", "file://renderer", true);

    await expect(refreshPromise).rejects.toThrow("UI refresh failed. Please try again.");
    expect(messages.at(-1)).toEqual({
      type: "upgrade:status",
      proposalId: proposal.proposalId,
      scope: proposal.scope,
      status: "failed",
      message: "UI refresh failed. Please try again.",
    });
  });

  it("fails the upgrade when the refreshed renderer reports a fatal error", async () => {
    const { messages, orchestrator, proposal } = createHarness({
      waitForNextRendererReady: () => Promise.reject(new Error("Spira failed to load the refreshed UI.")),
    });

    await expect(orchestrator.respondToProposal(proposal.proposalId, true)).rejects.toThrow(
      "Spira failed to load the refreshed UI.",
    );
    expect(messages.at(-1)).toEqual({
      type: "upgrade:status",
      proposalId: proposal.proposalId,
      scope: proposal.scope,
      status: "failed",
      message: "Spira failed to load the refreshed UI.",
    });
  });
});
