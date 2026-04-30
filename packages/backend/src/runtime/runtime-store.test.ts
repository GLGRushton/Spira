import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { parseEnv } from "@spira/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import * as clientFactory from "../provider/client-factory.js";
import { createRuntimeSessionContract } from "./runtime-contract.js";
import { RuntimeStore } from "./runtime-store.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const openRuntimeStore = () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-runtime-store-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return {
    database,
    runtimeStore: new RuntimeStore(database, "primary"),
  };
};

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("RuntimeStore", () => {
  it("journals restart-time host resource degradation into the runtime ledger", async () => {
    const { database, runtimeStore } = openRuntimeStore();
    const runtimeSessionId = "station:primary";
    runtimeStore.persistRuntimeSession({
      runtimeSessionId,
      stationId: "primary",
      runId: null,
      kind: "station",
      contract: createRuntimeSessionContract({
        runtimeSessionId,
        kind: "station",
        scope: { stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "copilot",
        providerCapabilities: getDefaultProviderCapabilities("copilot"),
        providerSessionId: null,
        model: null,
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "idle", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [],
      }),
    });
    runtimeStore.upsertRuntimeHostResource({
      resourceId: "shell-restart",
      runtimeSessionId,
      stationId: "primary",
      kind: "powershell",
      status: "running",
      state: {
        shellId: "shell-restart",
        command: "Write-Output hello",
        description: "Restart test",
        mode: "async",
        detached: false,
        status: "running",
        pid: 1234,
        exitCode: null,
        output: "hello",
        outputCursor: 5,
        hasUnreadOutput: false,
        recoveryPolicy: "unrecoverable-after-restart",
        startedAt: 1000,
        updatedAt: 1001,
      },
      createdAt: 1000,
      updatedAt: 1001,
    });

    await RuntimeStore.recoverInterruptedState(database, parseEnv({}), 2000);

    expect(runtimeStore.listRuntimeLedgerEvents(runtimeSessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "host.resource_recorded",
          payload: expect.objectContaining({
            resourceId: "shell-restart",
            status: "unrecoverable",
          }),
        }),
      ]),
    );
  });

  it("deletes orphaned provider-managed sessions during restart recovery", async () => {
    const { database, runtimeStore } = openRuntimeStore();
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const stop = vi.fn().mockResolvedValue([]);
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockResolvedValue({
      client: {
        providerId: "copilot",
        capabilities: getDefaultProviderCapabilities("copilot"),
        createSession: vi.fn(),
        resumeSession: vi.fn(),
        deleteSession,
        getAuthStatus: vi.fn(),
        stop,
      } as never,
      strategy: {} as never,
    });

    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "subagent:run-restart",
      stationId: "primary",
      runId: "run-restart",
      kind: "subagent",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "subagent:run-restart",
        kind: "subagent",
        scope: { runId: "run-restart", stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "copilot",
        providerCapabilities: getDefaultProviderCapabilities("copilot"),
        providerSessionId: "orphaned-subagent-session",
        model: null,
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "thinking", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [],
      }),
    });
    runtimeStore.persistStationRuntimeState({
      state: "thinking",
      promptInFlight: true,
      providerId: "copilot",
      activeSessionId: "orphaned-station-session",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1000,
      updatedAt: 1000,
    });
    database.upsertRuntimeSubagentRun({
      runId: "run-restart",
      stationId: "primary",
      snapshot: {
        agent_id: "run-restart",
        runId: "run-restart",
        roomId: "agent:run-restart",
        domain: "spira",
        task: "Recovered task",
        status: "running",
        providerSessionId: "orphaned-subagent-session",
        startedAt: 1000,
        updatedAt: 1000,
      },
      createdAt: 1000,
    });

    await RuntimeStore.recoverInterruptedState(database, parseEnv({}), 2000);

    expect(deleteSession).toHaveBeenCalledWith("orphaned-station-session");
    expect(deleteSession).toHaveBeenCalledWith("orphaned-subagent-session");
    expect(stop).toHaveBeenCalled();
  });

  it("falls back to the runtime contract binding when a running subagent snapshot missed provider-session sync", async () => {
    const { database, runtimeStore } = openRuntimeStore();
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockResolvedValue({
      client: {
        providerId: "copilot",
        capabilities: getDefaultProviderCapabilities("copilot"),
        createSession: vi.fn(),
        resumeSession: vi.fn(),
        deleteSession,
        getAuthStatus: vi.fn(),
        stop: vi.fn().mockResolvedValue([]),
      } as never,
      strategy: {} as never,
    });

    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "subagent:run-contract-fallback",
      stationId: "primary",
      runId: "run-contract-fallback",
      kind: "subagent",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "subagent:run-contract-fallback",
        kind: "subagent",
        scope: { runId: "run-contract-fallback", stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "copilot",
        providerCapabilities: getDefaultProviderCapabilities("copilot"),
        providerSessionId: "contract-only-session",
        model: null,
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "thinking", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [],
      }),
    });
    database.upsertRuntimeSubagentRun({
      runId: "run-contract-fallback",
      stationId: "primary",
      snapshot: {
        agent_id: "run-contract-fallback",
        runId: "run-contract-fallback",
        roomId: "agent:run-contract-fallback",
        domain: "spira",
        task: "Recovered task",
        status: "running",
        startedAt: 1000,
        updatedAt: 1000,
      },
      createdAt: 1000,
    });

    await RuntimeStore.recoverInterruptedState(database, parseEnv({}), 2000);

    expect(deleteSession).toHaveBeenCalledWith("contract-only-session");
  });

  it("uses the runtime contract binding atomically when a running subagent snapshot is stale after a provider switch", async () => {
    const { database, runtimeStore } = openRuntimeStore();
    const deleteAzureSession = vi.fn().mockResolvedValue(undefined);
    const deleteCopilotSession = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockImplementation(async (_env, providerId) => ({
      client: {
        providerId,
        capabilities: getDefaultProviderCapabilities(providerId),
        createSession: vi.fn(),
        resumeSession: vi.fn(),
        deleteSession: providerId === "azure-openai" ? deleteAzureSession : deleteCopilotSession,
        getAuthStatus: vi.fn(),
        stop: vi.fn().mockResolvedValue([]),
      } as never,
      strategy: {} as never,
    }));

    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "subagent:run-atomic-contract-fallback",
      stationId: "primary",
      runId: "run-atomic-contract-fallback",
      kind: "subagent",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "subagent:run-atomic-contract-fallback",
        kind: "subagent",
        scope: { runId: "run-atomic-contract-fallback", stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "azure-openai",
        providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
        providerSessionId: "fresh-azure-session",
        model: null,
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "thinking", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [
          {
            switchId: "switch-atomic-contract-fallback",
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
            switchedAt: 1050,
            reason: "user-requested",
            hostManifestHash: "host-hash",
            projectionHash: "projection-hash",
          },
        ],
      }),
    });
    database.upsertRuntimeSubagentRun({
      runId: "run-atomic-contract-fallback",
      stationId: "primary",
      snapshot: {
        agent_id: "run-atomic-contract-fallback",
        runId: "run-atomic-contract-fallback",
        roomId: "agent:run-atomic-contract-fallback",
        domain: "spira",
        task: "Recovered task",
        status: "running",
        providerId: "copilot",
        providerSessionId: "stale-copilot-session",
        startedAt: 1000,
        updatedAt: 1000,
      },
      createdAt: 1000,
    });

    await RuntimeStore.recoverInterruptedState(database, parseEnv({}), 2000);

    expect(deleteAzureSession).toHaveBeenCalledWith("fresh-azure-session");
    expect(deleteCopilotSession).not.toHaveBeenCalledWith("stale-copilot-session");
  });

  it("uses station provider switch history to clean up legacy session-only running subagents", async () => {
    const { database, runtimeStore } = openRuntimeStore();
    const deleteAzureSession = vi.fn().mockResolvedValue(undefined);
    const deleteCopilotSession = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockImplementation(async (_env, providerId) => ({
      client: {
        providerId,
        capabilities: getDefaultProviderCapabilities(providerId),
        createSession: vi.fn(),
        resumeSession: vi.fn(),
        deleteSession: providerId === "azure-openai" ? deleteAzureSession : deleteCopilotSession,
        getAuthStatus: vi.fn(),
        stop: vi.fn().mockResolvedValue([]),
      } as never,
      strategy: {} as never,
    }));

    runtimeStore.persistRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      runId: null,
      kind: "station",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "station:primary",
        kind: "station",
        scope: { stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "station-host-hash",
        providerProjectionHash: "station-projection-hash",
        providerId: "azure-openai",
        providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
        providerSessionId: "active-azure-station-session",
        model: null,
        boundAt: 1000,
        artifactRefs: [],
        checkpointRef: null,
        turnState: { state: "idle", activeToolCallIds: [] },
        permissionState: { status: "idle", pendingRequestIds: [] },
        cancellationState: { status: "idle" },
        usageSummary: { model: null, totalTokens: null, lastObservedAt: null, source: "unknown" },
        providerSwitches: [
          {
            switchId: "switch-legacy-running",
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
            switchedAt: 2000,
            reason: "user-requested",
            hostManifestHash: "station-host-hash",
            projectionHash: "station-projection-hash",
          },
        ],
      }),
    });
    database.upsertRuntimeSubagentRun({
      runId: "run-legacy-running-fallback",
      stationId: "primary",
      snapshot: {
        agent_id: "run-legacy-running-fallback",
        runId: "run-legacy-running-fallback",
        roomId: "agent:run-legacy-running-fallback",
        domain: "spira",
        task: "Recovered task",
        status: "running",
        providerSessionId: "legacy-copilot-session",
        startedAt: 1000,
        updatedAt: 1500,
      },
      createdAt: 1000,
    });

    await RuntimeStore.recoverInterruptedState(database, parseEnv({}), 2000);

    expect(deleteCopilotSession).toHaveBeenCalledWith("legacy-copilot-session");
    expect(deleteAzureSession).not.toHaveBeenCalledWith("legacy-copilot-session");
  });

  it("continues local recovery when provider cleanup cannot initialize", async () => {
    const { database, runtimeStore } = openRuntimeStore();
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockRejectedValue(new Error("auth unavailable"));

    runtimeStore.persistStationRuntimeState({
      state: "thinking",
      promptInFlight: true,
      providerId: "copilot",
      activeSessionId: "orphaned-station-session",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1000,
      updatedAt: 1000,
    });

    await expect(RuntimeStore.recoverInterruptedState(database, parseEnv({}), 2000)).resolves.toMatchObject({
      recoveredStationIds: ["primary"],
    });
    expect(runtimeStore.getStationRuntimeState()).toMatchObject({
      state: "error",
      activeSessionId: null,
    });
  });

  it("drops pending cleanup entries when the provider session is already gone", async () => {
    const { database } = openRuntimeStore();
    database.setSessionState(
      "runtime.provider-session-cleanup",
      JSON.stringify([{ providerId: "copilot", sessionId: "already-gone-session" }]),
    );
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockResolvedValue({
      client: {
        providerId: "copilot",
        capabilities: getDefaultProviderCapabilities("copilot"),
        createSession: vi.fn(),
        resumeSession: vi.fn(),
        deleteSession: vi.fn().mockRejectedValue(new Error("Session not found: already-gone-session")),
        getAuthStatus: vi.fn(),
        stop: vi.fn().mockResolvedValue([]),
      } as never,
      strategy: {} as never,
    });

    await RuntimeStore.recoverInterruptedState(database, parseEnv({}), 2000);

    expect(database.getSessionState("runtime.provider-session-cleanup")).toBeNull();
  });

  it("preserves cleanup entries queued during an active drain", async () => {
    const { database, runtimeStore } = openRuntimeStore();
    let releaseFirstSessionDelete: (() => void) | null = null;
    const deleteSession = vi.fn((sessionId: string) => {
      if (sessionId === "first-session") {
        return new Promise<void>((resolve) => {
          releaseFirstSessionDelete = resolve;
        });
      }
      if (sessionId === "second-session") {
        return Promise.reject(new Error("delete failed"));
      }
      return Promise.resolve();
    });
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockResolvedValue({
      client: {
        providerId: "copilot",
        capabilities: getDefaultProviderCapabilities("copilot"),
        createSession: vi.fn(),
        resumeSession: vi.fn(),
        deleteSession,
        getAuthStatus: vi.fn(),
        stop: vi.fn().mockResolvedValue([]),
      } as never,
      strategy: {} as never,
    });

    runtimeStore.queueProviderSessionCleanup("copilot", "first-session");
    const drainPromise = runtimeStore.drainPendingProviderSessionCleanup(parseEnv({}));
    await vi.waitFor(() => expect(deleteSession).toHaveBeenCalledWith("first-session"));

    runtimeStore.queueProviderSessionCleanup("copilot", "second-session");
    expect(releaseFirstSessionDelete).not.toBeNull();
    releaseFirstSessionDelete!();
    await drainPromise;

    expect(database.getSessionState("runtime.provider-session-cleanup")).toBe(
      JSON.stringify([{ providerId: "copilot", sessionId: "second-session" }]),
    );
  });
});
