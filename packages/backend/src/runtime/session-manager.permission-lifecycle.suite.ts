import { describe, expect, it, vi } from "vitest";
import {
  type SpiraEventBus,
  type WorkSessionSnapshot,
  createManager,
  createRuntimeMemoryDb,
} from "./session-manager.test-support.js";
import type { SessionManagerInternals } from "./session-manager.test-support.js";

const interactivePermissionRequest = {
  kind: "mcp",
  serverName: "Vision",
  toolName: "vision_read_screen",
  toolTitle: "Read screen",
  readOnly: true,
} as const;

describe("StationSessionManager permission lifecycle", () => {
  it("auto-approves permission requests when the setting is enabled", async () => {
    const manager = createManager([], {
      isAutoApprovePermissionsEnabled: () => true,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionComplete = vi.fn();
    bus.on("assistant:permission-complete", permissionComplete);
    internals.session = {
      sessionId: "auto-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await expect(internals.handlePermissionRequest(interactivePermissionRequest)).resolves.toEqual({
      kind: "approve-once",
    });
    expect(permissionComplete).toHaveBeenCalledWith(expect.any(String), "approved");
  });

  it("does not register a pending in-memory request when auto-approve is on", async () => {
    const manager = createManager([], {
      isAutoApprovePermissionsEnabled: () => true,
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "auto-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    await internals.handlePermissionRequest(interactivePermissionRequest);

    // After auto-approval the pending map should never have held an entry.
    expect(
      (manager as unknown as { pendingPermissionRequests: Map<string, unknown> }).pendingPermissionRequests.size,
    ).toBe(0);
  });

  it("falls back to interactive approval when auto-approve is off", async () => {
    const manager = createManager([], {
      isAutoApprovePermissionsEnabled: () => false,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "interactive-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest(interactivePermissionRequest);
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;
    expect(typeof requestId).toBe("string");

    expect(manager.resolvePermissionRequest(requestId, true)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "approve-once" });
  });

  it("resolves a late approval after the in-memory entry is gone", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    const permissionComplete = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    bus.on("assistant:permission-complete", permissionComplete);
    internals.session = {
      sessionId: "late-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    void internals.handlePermissionRequest(interactivePermissionRequest);
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;
    expect(typeof requestId).toBe("string");

    // Simulate the in-memory entry being lost (e.g. a backend restart) while
    // the DB row remains pending.
    (manager as unknown as { pendingPermissionRequests: Map<string, unknown> }).pendingPermissionRequests.clear();

    expect(manager.resolvePermissionRequest(requestId, true)).toBe(true);
    expect(permissionComplete).toHaveBeenCalledWith(requestId, "approved");
  });

  it("returns false when resolving a permission id that was never persisted", () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    expect(manager.resolvePermissionRequest("never-existed", true)).toBe(false);
  });

  it("lists persisted pending permission requests for transport replay", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "replay-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    void internals.handlePermissionRequest(interactivePermissionRequest);
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;
    expect(typeof requestId).toBe("string");

    const persisted = manager.listPersistedPendingPermissionRequests();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      requestId,
      toolName: "vision_read_screen",
      stationId: "primary",
    });
  });

  it("stalls an active implement WorkSession when an approval is denied", async () => {
    const manager = createManager([], {
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "stall-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const baseSnapshot: WorkSessionSnapshot = {
      sessionId: "ws-1",
      stationId: "primary",
      taskText: "Add a feature",
      currentPhase: "implement",
      classification: {
        intent: "edit",
        explicitWorkIntent: true,
        requiresRepoContext: true,
        confidence: "heuristic",
      },
      phaseHistory: [
        {
          phase: "implement",
          status: "active",
          summary: "Implementing change",
          startedAt: 100,
          updatedAt: 100,
          completedAt: null,
        },
      ],
      searchTerms: [],
      candidateFiles: [],
      summary: "Implementing change",
      planSummary: null,
      createdAt: 100,
      updatedAt: 100,
    };
    (manager as unknown as { activeWorkSession: WorkSessionSnapshot }).activeWorkSession = baseSnapshot;

    const response = internals.handlePermissionRequest({
      kind: "custom-tool",
      toolName: "apply_patch",
      toolCallId: "call-stall",
      args: { patch: "*** Begin Patch\n*** End Patch\n" },
    });
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;
    expect(typeof requestId).toBe("string");

    manager.resolvePermissionRequest(requestId, false);
    await expect(response).resolves.toEqual({ kind: "reject" });

    const stalled = (manager as unknown as { activeWorkSession: WorkSessionSnapshot | null }).activeWorkSession;
    expect(stalled?.stalledReason).toBeDefined();
    expect(stalled?.stalledReason).toMatch(/permission was denied/i);
    expect(stalled?.stalledAt).toEqual(expect.any(Number));
  });

  it("does not stall the WorkSession when the approval is granted", async () => {
    const manager = createManager([], {
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "approve-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const baseSnapshot: WorkSessionSnapshot = {
      sessionId: "ws-2",
      stationId: "primary",
      taskText: "Add a feature",
      currentPhase: "implement",
      classification: {
        intent: "edit",
        explicitWorkIntent: true,
        requiresRepoContext: true,
        confidence: "heuristic",
      },
      phaseHistory: [
        {
          phase: "implement",
          status: "active",
          summary: "Implementing change",
          startedAt: 200,
          updatedAt: 200,
          completedAt: null,
        },
      ],
      searchTerms: [],
      candidateFiles: [],
      summary: "Implementing change",
      planSummary: null,
      createdAt: 200,
      updatedAt: 200,
    };
    (manager as unknown as { activeWorkSession: WorkSessionSnapshot }).activeWorkSession = baseSnapshot;

    const response = internals.handlePermissionRequest({
      kind: "custom-tool",
      toolName: "apply_patch",
      toolCallId: "call-ok",
      args: { patch: "*** Begin Patch\n*** End Patch\n" },
    });
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;
    expect(typeof requestId).toBe("string");

    manager.resolvePermissionRequest(requestId, true);
    await expect(response).resolves.toEqual({ kind: "approve-once" });

    const snapshot = (manager as unknown as { activeWorkSession: WorkSessionSnapshot | null }).activeWorkSession;
    expect(snapshot?.stalledReason ?? null).toBeNull();
  });
});
