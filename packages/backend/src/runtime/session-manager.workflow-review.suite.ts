import { describe, expect, it, vi } from "vitest";
import {
  type SpiraEventBus,
  createManager,
  createRuntimeMemoryDb,
  createRuntimeSessionContract,
  getDefaultProviderCapabilities,
} from "./session-manager.test-support.js";
import type { SessionManagerInternals, SubagentDomain } from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
  it("exposes the manual escalation tool only for the primary escalation station", () => {
    const escalationManager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
    });
    const normalManager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai" },
      stationId: "primary",
    });
    const secondaryStationManager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "bravo",
    });
    const missionStationManager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      missionRunId: "run-1",
    });
    const escalationInternals = escalationManager as unknown as SessionManagerInternals;
    const normalInternals = normalManager as unknown as SessionManagerInternals;
    const secondaryStationInternals = secondaryStationManager as unknown as SessionManagerInternals;
    const missionStationInternals = missionStationManager as unknown as SessionManagerInternals;

    expect(escalationInternals.getSessionConfig().tools.map((tool) => tool.name)).toContain("spira_escalate_session");
    expect(normalInternals.getSessionConfig().tools.map((tool) => tool.name)).not.toContain("spira_escalate_session");
    expect(secondaryStationInternals.getSessionConfig().tools.map((tool) => tool.name)).not.toContain(
      "spira_escalate_session",
    );
    expect(missionStationInternals.getSessionConfig().tools.map((tool) => tool.name)).not.toContain(
      "spira_escalate_session",
    );
  });

  it("routes the manual escalation tool through the active session", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const escalate = vi.fn().mockResolvedValue({
      status: "escalated",
      providerId: "openai-escalation",
      fromModel: "gpt-5.4-mini",
      toModel: "gpt-5.4",
    });
    internals.session = {
      sessionId: "escalation-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate,
    };

    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");

    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected spira_escalate_session to be available.");
    }
    await expect(tool.handler({})).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm:
        '{"status":"escalated","providerId":"openai-escalation","fromModel":"gpt-5.4-mini","toModel":"gpt-5.4"}',
    });
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it("persists an escalate-and-continue handoff for the active workflow phase", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const escalate = vi.fn().mockResolvedValue({
      status: "escalated",
      providerId: "openai-escalation",
      fromModel: "gpt-5.4-mini",
      toModel: "gpt-5.4",
    });
    internals.currentState = "thinking";
    internals.session = {
      sessionId: "escalation-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate,
    };

    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");

    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected spira_escalate_session to be available.");
    }

    await tool.handler({});

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        usageSummary: {
          model: "gpt-5.4",
          source: "estimated",
        },
        providerBinding: {
          model: "gpt-5.4",
        },
        workflowState: {
          phase: "implement",
          status: "active",
          summary: "Escalated from gpt-5.4-mini to gpt-5.4; continuing implement.",
          handoffs: [
            expect.objectContaining({
              kind: "model-escalation",
              phase: "implement",
              continuationMode: "continue-current-phase",
              fromModel: "gpt-5.4-mini",
              toModel: "gpt-5.4",
            }),
          ],
        },
      },
    });
  });

  it("preserves the current workflow phase when persisting a manual escalation handoff", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "station:primary",
        kind: "station",
        scope: { stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "openai-escalation",
        providerCapabilities: getDefaultProviderCapabilities("openai-escalation"),
        providerSessionId: "escalation-session",
        model: "gpt-5.4-mini",
        workflowState: {
          phase: "review",
          status: "active",
          summary: "Review is underway.",
          updatedAt: 100,
          phaseHistory: [],
          handoffs: [],
          blockedBy: null,
          review: {
            status: "running",
            attempt: 1,
            runId: "agent:review-1",
            summary: "Review launched.",
            failureReason: null,
            lastUpdatedAt: 100,
          },
        },
      }),
    });
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "escalation-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate: vi.fn().mockResolvedValue({
        status: "escalated",
        providerId: "openai-escalation",
        fromModel: "gpt-5.4-mini",
        toModel: "gpt-5.4",
      }),
    };

    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");

    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected spira_escalate_session to be available.");
    }

    await tool.handler({});

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "review",
          status: "active",
          handoffs: [
            expect.objectContaining({
              kind: "model-escalation",
              phase: "review",
              toModel: "gpt-5.4",
            }),
          ],
          review: {
            status: "running",
            attempt: 1,
            runId: "agent:review-1",
          },
        },
      },
    });
  });

  it("preserves non-approval workflow blocks during manual escalation", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    runtimeMemory.db.upsertRuntimePermissionRequest({
      requestId: "perm-1",
      stationId: "primary",
      payload: {
        requestId: "perm-1",
        stationId: "primary",
        kind: "custom-tool",
        toolName: "apply_patch",
        args: {},
        readOnly: false,
      },
      createdAt: 95,
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "station:primary",
        kind: "station",
        scope: { stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "openai-escalation",
        providerCapabilities: getDefaultProviderCapabilities("openai-escalation"),
        providerSessionId: "escalation-session",
        model: "gpt-5.4-mini",
        workflowState: {
          phase: "review",
          status: "blocked",
          summary: "Waiting for review feedback.",
          updatedAt: 100,
          phaseHistory: [
            {
              phase: "review",
              status: "blocked",
              summary: "Waiting for review feedback.",
              providerId: "openai-escalation",
              model: "gpt-5.4-mini",
              startedAt: 90,
              updatedAt: 100,
              completedAt: null,
              blockedBy: {
                kind: "review",
                reason: "Awaiting reviewer results.",
                pendingRequestIds: [],
                blockedAt: 100,
              },
            },
          ],
          handoffs: [],
          blockedBy: null,
          review: {
            status: "running",
            attempt: 1,
            runId: "agent:review-1",
            summary: "Review launched.",
            failureReason: null,
            lastUpdatedAt: 100,
          },
        },
      }),
    });
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "escalation-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate: vi.fn().mockResolvedValue({
        status: "escalated",
        providerId: "openai-escalation",
        fromModel: "gpt-5.4-mini",
        toModel: "gpt-5.4",
      }),
    };

    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");

    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected spira_escalate_session to be available.");
    }

    await tool.handler({});

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "review",
          status: "blocked",
          summary: "Escalated from gpt-5.4-mini to gpt-5.4; review remains blocked by review.",
          blockedBy: {
            kind: "review",
            reason: "Awaiting reviewer results.",
            pendingRequestIds: [],
          },
          phaseHistory: [
            expect.objectContaining({
              phase: "review",
              status: "blocked",
              blockedBy: {
                kind: "review",
                reason: "Awaiting reviewer results.",
                pendingRequestIds: [],
                blockedAt: 100,
              },
            }),
          ],
        },
      },
    });
  });

  it("preserves persisted approval blocking across restart-time syncs while requests remain pending", () => {
    const runtimeMemory = createRuntimeMemoryDb();
    runtimeMemory.db.upsertRuntimePermissionRequest({
      requestId: "perm-approval",
      stationId: "primary",
      payload: {
        requestId: "perm-approval",
        stationId: "primary",
        kind: "custom-tool",
        toolName: "apply_patch",
        args: {},
        readOnly: false,
      },
      createdAt: 95,
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "station:primary",
        kind: "station",
        scope: { stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "openai-escalation",
        providerCapabilities: getDefaultProviderCapabilities("openai-escalation"),
        providerSessionId: "escalation-session",
        model: "gpt-5.4",
        workflowState: {
          phase: "implement",
          status: "blocked",
          summary: "Waiting on approval.",
          updatedAt: 100,
          phaseHistory: [
            {
              phase: "implement",
              status: "blocked",
              summary: "Waiting on approval.",
              providerId: "openai-escalation",
              model: "gpt-5.4",
              startedAt: 90,
              updatedAt: 100,
              completedAt: null,
              blockedBy: {
                kind: "approval",
                reason: "Waiting for approval.",
                pendingRequestIds: ["perm-approval"],
                blockedAt: 100,
              },
            },
          ],
          handoffs: [],
          blockedBy: {
            kind: "approval",
            reason: "Waiting for approval.",
            pendingRequestIds: ["perm-approval"],
            blockedAt: 100,
          },
          review: {
            status: "idle",
            attempt: 0,
            runId: null,
            summary: null,
            failureReason: null,
            lastUpdatedAt: null,
          },
        },
      }),
    });

    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals & { syncRuntimeState: () => void };

    internals.syncRuntimeState();

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "blocked",
          blockedBy: {
            kind: "approval",
            pendingRequestIds: ["perm-approval"],
          },
        },
      },
    });
  });

  it("derives the active blocked phase from open phase history when legacy root workflow fields are incomplete", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "openai-escalation",
      providerCapabilities: getDefaultProviderCapabilities("openai-escalation"),
      providerSessionId: "escalation-session",
      model: "gpt-5.4-mini",
      boundAt: 100,
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: {
        ...runtimeSession,
        workflowState: {
          status: "blocked",
          summary: "Legacy blocked review state.",
          updatedAt: 100,
          phaseHistory: [
            {
              phase: "review",
              status: "blocked",
              summary: "Legacy blocked review state.",
              providerId: "openai-escalation",
              model: "gpt-5.4-mini",
              startedAt: 90,
              updatedAt: 100,
              completedAt: null,
              blockedBy: {
                kind: "review",
                reason: "Awaiting reviewer results.",
                pendingRequestIds: [],
                blockedAt: 100,
              },
            },
          ],
          handoffs: [],
          blockedBy: null,
          review: runtimeSession.workflowState.review,
        },
      },
    });
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "escalation-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate: vi.fn().mockResolvedValue({
        status: "escalated",
        providerId: "openai-escalation",
        fromModel: "gpt-5.4-mini",
        toModel: "gpt-5.4",
      }),
    };

    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");

    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected spira_escalate_session to be available.");
    }

    await tool.handler({});

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "review",
          status: "blocked",
          blockedBy: {
            kind: "review",
            reason: "Awaiting reviewer results.",
          },
        },
      },
    });
  });

  it("persists review lifecycle state when launching a code-review subagent", () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: (
        domain: SubagentDomain,
        workingDirectory?: string,
      ) => {
        launch: () => Record<string, unknown>;
      };
    };
    const reviewDomain: SubagentDomain = {
      id: "code-review",
      label: "Code Review",
      serverIds: [],
      allowWrites: false,
      delegationToolName: "delegate_to_code_review",
      systemPrompt: "",
    };
    internals.createSubagentRunner = vi.fn(() => ({
      launch: () => ({
        runId: "review-run-1",
        roomId: "agent:review-run-1",
        allowWrites: false,
        startedAt: 100,
        resultPromise: new Promise<never>(() => {}),
        write: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    }));

    manager.launchManagedSubagent(reviewDomain, { task: "Review the current diff", mode: "background" });

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "review",
          status: "active",
          review: {
            status: "running",
            attempt: 1,
            runId: "review-run-1",
          },
        },
      },
    });
  });

  it("updates review lifecycle state from code-review subagent status events", () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const internals = manager as unknown as SessionManagerInternals & {
      setWorkflowReviewState: (input: {
        status: "running";
        runId: string;
        attempt: number;
        summary: string;
      }) => void;
      syncRuntimeState: () => void;
    };

    internals.setWorkflowReviewState({
      status: "running",
      runId: "review-run-1",
      attempt: 1,
      summary: "Review running.",
    });
    internals.syncRuntimeState();

    bus.emit("subagent:status", {
      runId: "review-run-1",
      roomId: "agent:review-run-1",
      domain: "code-review",
      label: "code-review",
      status: "failed",
      occurredAt: 200,
      summary: "Reviewer crashed.",
    });

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "review",
          status: "blocked",
          blockedBy: {
            kind: "review",
          },
          review: {
            status: "failed",
            runId: "review-run-1",
            failureReason: "Reviewer crashed.",
          },
        },
      },
    });
  });

  it("marks persisted running reviews as missing after restart when the tracked run is gone", () => {
    const runtimeMemory = createRuntimeMemoryDb();
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: createRuntimeSessionContract({
        runtimeSessionId: "station:primary",
        kind: "station",
        scope: { stationId: "primary" },
        workingDirectory: "C:\\GitHub\\Spira",
        hostManifestHash: "host-hash",
        providerProjectionHash: "projection-hash",
        providerId: "openai-escalation",
        providerCapabilities: getDefaultProviderCapabilities("openai-escalation"),
        providerSessionId: "station-session",
        model: "gpt-5.4",
        workflowState: {
          phase: "review",
          status: "active",
          summary: "Running review: Review the diff",
          updatedAt: 100,
          phaseHistory: [],
          handoffs: [],
          blockedBy: null,
          review: {
            status: "running",
            attempt: 1,
            runId: "review-run-1",
            origin: "managed-subagent",
            summary: "Running review: Review the diff",
            failureReason: null,
            lastUpdatedAt: 100,
          },
        },
      }),
    });

    const manager = createManager([], {
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals & { syncRuntimeState: () => void };

    internals.syncRuntimeState();

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "review",
          status: "blocked",
          blockedBy: {
            kind: "review",
          },
          review: {
            status: "missing",
            runId: "review-run-1",
          },
        },
      },
    });
  });

  it("clears approval blocking after a pending permission resolves post-escalation", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.currentState = "thinking";
    internals.session = {
      sessionId: "escalation-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate: vi.fn().mockResolvedValue({
        status: "escalated",
        providerId: "openai-escalation",
        fromModel: "gpt-5.4-mini",
        toModel: "gpt-5.4",
      }),
    };

    const permissionResponse = internals.handlePermissionRequest({
      kind: "custom-tool",
      toolName: "apply_patch",
      toolCallId: "call-1",
      args: { patch: "*** Begin Patch\n*** End Patch\n" },
    });
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;
    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");

    expect(typeof requestId).toBe("string");
    expect(tool).toBeDefined();
    if (!tool || typeof requestId !== "string") {
      throw new Error("Expected escalation tool and pending permission request.");
    }

    await tool.handler({});

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "blocked",
          blockedBy: {
            kind: "approval",
            pendingRequestIds: [requestId],
          },
        },
      },
    });

    expect(manager.resolvePermissionRequest(requestId, true)).toBe(true);
    await expect(permissionResponse).resolves.toEqual({ kind: "approve-once" });

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
          phaseHistory: [
            expect.objectContaining({
              phase: "implement",
              status: "active",
              blockedBy: null,
            }),
          ],
        },
      },
    });
  });
});
