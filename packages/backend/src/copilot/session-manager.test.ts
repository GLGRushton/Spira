import {
  type McpTool,
  type SubagentDomain,
  type WorkSessionClassification,
  type WorkSessionSnapshot,
  parseEnv,
} from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { createWorkSessionStorage, isWorkSessionSnapshot } from "../coding/work-session-storage.js";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import * as clientFactory from "../provider/client-factory.js";
import type { ProviderHostContinuityState, ProviderSessionConfig } from "../provider/types.js";
import {
  type RuntimeWorkflowState,
  createRuntimeCheckpointPayload,
  createRuntimeSessionContract,
} from "../runtime/runtime-contract.js";
import { AssistantError } from "../util/errors.js";
import { SpiraEventBus } from "../util/event-bus.js";
import { StationSessionManager } from "./session-manager.js";

type SessionManagerInternals = {
  session: {
    sessionId: string;
    disconnect: () => Promise<void>;
    abort?: () => Promise<void>;
    send?: (payload: { prompt: string }) => Promise<void>;
    escalate?: () => Promise<Record<string, unknown>>;
  } | null;
  client: { providerId: string; stop?: () => Promise<unknown> } | null;
  activeSessionId: string | null;
  currentState: "idle" | "thinking" | "listening" | "transcribing" | "speaking" | "error";
  promptInFlight: boolean;
  sessionOrigin: "created" | "resumed" | null;
  registeredToolSignature: string | null;
  pendingToolRefreshSignature: string | null;
  refreshingSessionForToolChanges: Promise<void> | null;
  activeToolCalls: Map<string, unknown>;
  hostContinuityState: ProviderHostContinuityState | null;
  resumableHostContinuityState: ProviderHostContinuityState | null;
  resumableHostContinuityHostManifestHash: string | null;
  resumableHostContinuityProjectionHash: string | null;
  boundHostManifestHash: string | null;
  boundProviderProjectionHash: string | null;
  workflowState: RuntimeWorkflowState;
  sessionTeardownEpoch: number;
  abortResponse(): Promise<void>;
  stopTimedOutTurn(session: {
    sessionId: string;
    disconnect: () => Promise<void>;
    abort?: () => Promise<void>;
  }): Promise<void>;
  createSession(): Promise<{ sessionId: string; disconnect: () => Promise<void> }>;
  refreshSessionForToolChanges(): Promise<void>;
  handleSessionEvent(event: { type: string; data: Record<string, unknown> }): void;
  handlePermissionRequest(request: Record<string, unknown>): Promise<{ kind: string; feedback?: string }>;
  getCurrentToolSignature(): string;
  getSessionConfig(
    expectedSessionId?: string | null,
    provider?: {
      providerId: "copilot" | "azure-openai" | "azure-openai-escalation" | "openai" | "openai-escalation";
      capabilities: {
        persistentSessions: boolean;
        abortableTurns: boolean;
        sessionResumption: "provider-managed" | "host-managed";
        turnCancellation: "provider-abort" | "disconnect-and-reset";
        responseStreaming: "native" | "host-buffered";
        usageReporting: "full" | "partial" | "none";
        toolManifestMode: "literal" | "projected";
        modelSelection: "session-scoped" | "provider-default";
        toolCalling: "native" | "none";
      };
    },
  ): { tools: Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<Record<string, unknown>> }> };
};

const createManager = (
  tools: McpTool[],
  options?: {
    sessionPersistence?: {
      load(): string | null;
      save(sessionId: string | null): void;
    } | null;
    envInput?: Record<string, string | undefined>;
    allowUpgradeTools?: boolean;
    requestUpgradeProposal?: (() => Promise<void> | void) | undefined;
    applyHotCapabilityUpgrade?: (() => Promise<void> | void) | undefined;
    memoryDb?: Record<string, unknown> | null;
    stationId?: string;
    requestedModel?: string | null;
    missionRunId?: string | null;
  },
) => {
  const bus = new SpiraEventBus();
  const aggregator = {
    getTools: () => tools,
    getToolsForServerIds: (serverIds: readonly string[]) => tools.filter((tool) => serverIds.includes(tool.serverId)),
    getToolsExcludingServerIds: (serverIds: readonly string[]) =>
      tools.filter((tool) => !serverIds.includes(tool.serverId)),
  };
  const sessionOptions = options
    ? {
        sessionPersistence: options.sessionPersistence,
        allowUpgradeTools: options.allowUpgradeTools,
        memoryDb: options.memoryDb as never,
        stationId: options.stationId,
        requestedModel: options.requestedModel,
        missionRunId: options.missionRunId ?? undefined,
      }
    : undefined;

  return new StationSessionManager(
    bus,
    parseEnv(options?.envInput ?? {}),
    aggregator as never,
    options?.requestUpgradeProposal,
    options?.applyHotCapabilityUpgrade,
    sessionOptions,
  );
};

const createRuntimeMemoryDb = (initialState: Record<string, unknown> | null = null) => {
  const runtimeStates: Array<Record<string, unknown>> = [];
  const runtimeSessions = new Map<string, Record<string, unknown>>();
  const runtimeLedgerEvents: Array<Record<string, unknown>> = [];
  const runtimeCheckpoints = new Map<string, Record<string, unknown>>();
  const runtimePermissionRequests = new Map<string, Record<string, unknown>>();
  const runtimeSubagentRuns = new Map<string, Record<string, unknown>>();
  const sessionState = new Map<string, unknown>();
  return {
    runtimeStates,
    runtimeSessions,
    runtimeLedgerEvents,
    runtimeCheckpoints,
    sessionState,
    db: {
      listRuntimeSubagentRuns: () => [...runtimeSubagentRuns.values()],
      upsertRuntimeStationState: (input: Record<string, unknown>) => {
        runtimeStates.push(input);
        return input;
      },
      getRuntimeStationState: () => initialState,
      upsertRuntimeSession: (input: Record<string, unknown>) => {
        runtimeSessions.set(String(input.runtimeSessionId), input);
        return {
          runtimeSessionId: input.runtimeSessionId,
          stationId: input.stationId ?? null,
          runId: input.runId ?? null,
          kind: input.kind,
          contract: input.contract,
          createdAt: 1,
          updatedAt: 1,
        };
      },
      getRuntimeSession: (runtimeSessionId: string) => {
        const input = runtimeSessions.get(runtimeSessionId);
        return input
          ? {
              runtimeSessionId,
              stationId: input.stationId ?? null,
              runId: input.runId ?? null,
              kind: input.kind,
              contract: input.contract,
              createdAt: 1,
              updatedAt: 1,
            }
          : null;
      },
      listRuntimeSessions: () => [...runtimeSessions.values()],
      appendRuntimeLedgerEvent: (input: Record<string, unknown>) => {
        const record = {
          id: runtimeLedgerEvents.length + 1,
          eventId: input.eventId,
          runtimeSessionId: input.runtimeSessionId,
          stationId: input.stationId ?? null,
          runId: input.runId ?? null,
          type: input.type,
          payload: input.payload,
          occurredAt: input.occurredAt ?? 1,
        };
        runtimeLedgerEvents.push(record);
        return record;
      },
      listRuntimeLedgerEvents: (runtimeSessionId: string) =>
        runtimeLedgerEvents.filter((event) => event.runtimeSessionId === runtimeSessionId),
      upsertRuntimeCheckpoint: (input: Record<string, unknown>) => {
        runtimeCheckpoints.set(String(input.checkpointId), input);
        return {
          checkpointId: input.checkpointId,
          runtimeSessionId: input.runtimeSessionId,
          stationId: input.stationId ?? null,
          runId: input.runId ?? null,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          createdAt: input.createdAt ?? 1,
        };
      },
      getRuntimeCheckpoint: (checkpointId: string) => {
        const input = runtimeCheckpoints.get(checkpointId);
        return input
          ? {
              checkpointId,
              runtimeSessionId: input.runtimeSessionId,
              stationId: input.stationId ?? null,
              runId: input.runId ?? null,
              kind: input.kind,
              summary: input.summary,
              payload: input.payload,
              createdAt: input.createdAt ?? 1,
            }
          : null;
      },
      getLatestRuntimeCheckpoint: (runtimeSessionId: string) =>
        [...runtimeCheckpoints.values()]
          .filter((checkpoint) => checkpoint.runtimeSessionId === runtimeSessionId)
          .sort((left, right) => Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0))[0] ?? null,
      upsertRuntimePermissionRequest: vi.fn((input: Record<string, unknown>) => {
        const record = {
          requestId: input.requestId,
          stationId: input.stationId ?? null,
          payload: input.payload,
          status: "pending",
          createdAt: input.createdAt ?? 1,
          resolvedAt: null,
        };
        runtimePermissionRequests.set(String(input.requestId), record);
        return record;
      }),
      listPendingRuntimePermissionRequests: (stationId?: string | null) =>
        [...runtimePermissionRequests.values()].filter(
          (record) =>
            record.status === "pending" &&
            (stationId === undefined || stationId === null || record.stationId === stationId),
        ),
      resolveRuntimePermissionRequest: vi.fn((requestId: string, status: string, resolvedAt: number) => {
        const record = runtimePermissionRequests.get(requestId);
        if (!record) {
          return false;
        }
        runtimePermissionRequests.set(requestId, {
          ...record,
          status,
          resolvedAt,
        });
        return true;
      }),
      appendProviderUsageRecord: vi.fn(),
      deleteRuntimeSubagentRun: vi.fn((runId: string) => runtimeSubagentRuns.delete(runId)),
      upsertRuntimeSubagentRun: vi.fn((input: Record<string, unknown>) => {
        const record = {
          runId: input.runId,
          stationId: input.stationId ?? null,
          snapshot: input.snapshot,
          createdAt: input.createdAt ?? 1,
        };
        runtimeSubagentRuns.set(String(input.runId), record);
        return record;
      }),
      getSessionState: (key: string) => sessionState.get(key) ?? null,
      setSessionState: (key: string, value: unknown) => {
        if (value === null) {
          sessionState.delete(key);
          return;
        }
        sessionState.set(key, value);
      },
    },
  };
};

describe("work-session storage", () => {
  it("accepts legacy snapshots that do not include closure fields", () => {
    expect(
      isWorkSessionSnapshot({
        sessionId: "work-session",
        stationId: "station-alpha",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toBe(true);
  });

  it("round-trips snapshots that include closure fields", () => {
    const memory = createRuntimeMemoryDb();
    const storage = createWorkSessionStorage(memory.db as never, "station-alpha");
    const snapshot: WorkSessionSnapshot = {
      sessionId: "work-session",
      stationId: "station-alpha",
      taskText: "Implement the bridge UI badge in the renderer file",
      currentPhase: "validate",
      classification: {
        intent: "edit",
        explicitWorkIntent: true,
        requiresRepoContext: true,
        confidence: "heuristic",
      },
      phaseHistory: [],
      searchTerms: ["bridge", "renderer"],
      candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
      selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
      summary: "Validation passed; ready for review.",
      planSummary: "Plan ready.",
      patchAttempts: [],
      changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
      validationResults: [],
      pendingValidationShellId: null,
      pendingValidationCommand: null,
      fixIterationCount: 0,
      repeatFailureCount: 0,
      lastValidationFingerprint: null,
      readyForReview: true,
      reviewSummary: "Review completed.",
      completedAt: 10,
      stalledReason: null,
      stalledAt: null,
      createdAt: 1,
      updatedAt: 10,
    };

    storage.save(snapshot);

    expect(storage.load()).toEqual(snapshot);
  });
});

describe("StationSessionManager", () => {
  it("defers MCP session refresh until the active turn becomes idle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.currentState = "thinking";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(internals.pendingToolRefreshSignature).toBe(internals.getCurrentToolSignature());

    internals.handleSessionEvent({ type: "session.idle", data: {} });
    await Promise.resolve();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.session).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBeNull();
  });

  it("refreshes immediately when the assistant is already idle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    internals.session = session;
    internals.activeSessionId = "test-session";
    internals.currentState = "idle";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("test-session", "copilot");
    expect(internals.session).toBeNull();
    expect(internals.activeSessionId).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBeNull();
  });

  it("deletes the persisted provider session when tool drift is detected without a live handle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    internals.session = null;
    internals.activeSessionId = "stale-session";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("stale-session", "copilot");
    expect(internals.activeSessionId).toBeNull();
    expect(internals.registeredToolSignature).toBe(internals.getCurrentToolSignature());
  });

  it("clears stale binding state even if tool-drift session deletion fails", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    vi.spyOn(
      manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
      "deletePersistedSession",
    ).mockRejectedValue(new Error("delete failed"));

    internals.session = null;
    internals.activeSessionId = "stale-session";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(internals.activeSessionId).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBe(internals.getCurrentToolSignature());
  });

  it("re-checks for a newer tool signature after an in-flight refresh completes", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.currentState = "idle";
    internals.registeredToolSignature = JSON.stringify([]);
    internals.refreshingSessionForToolChanges = Promise.resolve().then(() => {
      internals.refreshingSessionForToolChanges = null;
    });

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.session).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
  });

  it("replaces delegated MCP tools with delegation tools when subagents are enabled", () => {
    const manager = createManager(
      [
        {
          serverId: "windows-system",
          serverName: "Windows System",
          name: "system_get_memory_info",
          description: "Read memory info.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          serverId: "memories",
          serverName: "Spira Memories",
          name: "spira_memory_list_entries",
          description: "List stored memories.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          serverId: "spira-ui",
          serverName: "Spira UI",
          name: "spira_ui_get_snapshot",
          description: "Read the current Spira snapshot.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      {
        envInput: { SPIRA_SUBAGENTS_ENABLED: "true" },
      },
    );
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "delegate_to_windows",
        "delegate_to_spira",
        "spira_memory_list_entries",
        "read_subagent",
        "list_subagents",
        "write_subagent",
        "stop_subagent",
      ]),
    );
    expect(toolNames).not.toContain("system_get_memory_info");
    expect(toolNames).not.toContain("delegate_to_nexus");
  });

  it("exposes host-only delegation domains when subagents are enabled", () => {
    const manager = createManager([], {
      envInput: { SPIRA_SUBAGENTS_ENABLED: "true" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toContain("delegate_to_code_review");
  });

  it("includes the upgrade tool for stations that allow upgrades", () => {
    const manager = createManager([], {
      requestUpgradeProposal: vi.fn(),
      applyHotCapabilityUpgrade: vi.fn(),
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toContain("spira_propose_upgrade");
  });

  it("omits the upgrade tool for stations that disable upgrades", () => {
    const manager = createManager([], {
      requestUpgradeProposal: vi.fn(),
      applyHotCapabilityUpgrade: vi.fn(),
      allowUpgradeTools: false,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("spira_propose_upgrade");
  });

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

  it("omits duplicated host tools when using the copilot provider", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals
      .getSessionConfig(undefined, {
        providerId: "copilot",
        capabilities: {
          persistentSessions: true,
          abortableTurns: true,
          sessionResumption: "provider-managed",
          turnCancellation: "provider-abort",
          responseStreaming: "native",
          usageReporting: "full",
          toolManifestMode: "projected",
          modelSelection: "session-scoped",
          toolCalling: "native",
        },
      })
      .tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("view");
    expect(toolNames).not.toContain("glob");
    expect(toolNames).not.toContain("rg");
  });

  it("keeps host tools for the azure-openai provider", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals
      .getSessionConfig(undefined, {
        providerId: "azure-openai",
        capabilities: {
          persistentSessions: false,
          abortableTurns: true,
          sessionResumption: "host-managed",
          turnCancellation: "provider-abort",
          responseStreaming: "native",
          usageReporting: "partial",
          toolManifestMode: "literal",
          modelSelection: "provider-default",
          toolCalling: "native",
        },
      })
      .tools.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining(["view", "glob", "rg"]));
  });

  it("includes the requested station model in the session config", () => {
    const manager = createManager([], {
      requestedModel: "gpt-5.5",
    });
    const internals = manager as unknown as SessionManagerInternals & { getSessionConfig(): { model?: string } };

    expect(internals.getSessionConfig()).toMatchObject({
      model: "gpt-5.5",
    });
  });

  it("recreates the session and retries when the SDK reports Session not found", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const staleSession = {
      sessionId: "stale-session",
      send: vi
        .fn()
        .mockRejectedValue(new Error("Request session.send failed with message: Session not found: stale-session")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = staleSession;
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
      .mockResolvedValueOnce(staleSession)
      .mockResolvedValueOnce(freshSession);

    await expect(manager.sendMessage("hello")).resolves.toBeUndefined();

    expect(staleSession.send).toHaveBeenCalledTimes(1);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(freshSession.send).toHaveBeenCalledTimes(1);
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("applies the requested model before sending a station prompt", async () => {
    const manager = createManager([], {
      requestedModel: "gpt-5.5",
    });
    const session = {
      sessionId: "model-session",
      send: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Use the requested model")).resolves.toBeUndefined();

    expect(session.setModel).toHaveBeenCalledWith("gpt-5.5");
    expect(session.setModel.mock.invocationCallOrder[0]).toBeLessThan(session.send.mock.invocationCallOrder[0] ?? 0);
  });

  it("activates a work session for explicit coding requests", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-alpha",
    });
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      active: true,
      phase: "discover",
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskText: "Implement the bridge UI badge in the renderer file",
          currentPhase: "discover",
        }),
      ]),
    );
  });

  it("preserves the original work-session scaffold across continuation prompts", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-gamma",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.handleSessionEvent({ type: "session.idle", data: {} });
    internals.currentState = "idle";
    await expect(manager.sendMessage("continue")).resolves.toBeUndefined();

    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskText: "Implement the bridge UI badge in the renderer file",
          classification: expect.objectContaining({
            explicitWorkIntent: true,
            intent: "edit",
          }),
          searchTerms: expect.arrayContaining(["implement", "bridge", "renderer", "file"]),
        }),
      ]),
    );
  });

  it("restarts the work-session scaffold for a new explicit task", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-lambda",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.handleSessionEvent({ type: "session.idle", data: {} });
    internals.currentState = "idle";
    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "blocked",
      blockedBy: {
        kind: "review",
        reason: "Previous review failed.",
        pendingRequestIds: [],
        blockedAt: 123,
      },
      review: {
        ...internals.workflowState.review,
        status: "failed",
        runId: "review-1",
        summary: "Previous review failed.",
        failureReason: "Missing coverage.",
        lastUpdatedAt: 123,
      },
    };

    await expect(
      manager.sendMessage("Review the current diff in packages/backend/src/copilot/station-registry.ts"),
    ).resolves.toBeUndefined();

    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskText: "Review the current diff in packages/backend/src/copilot/station-registry.ts",
          currentPhase: "discover",
          classification: expect.objectContaining({
            intent: "review",
            explicitWorkIntent: true,
          }),
          planSummary: null,
        }),
      ]),
    );
    expect(memory.runtimeSessions.get("station:station-lambda")).toMatchObject({
      contract: {
        workflowState: {
          phase: "discover",
          status: "active",
          blockedBy: null,
          review: expect.objectContaining({
            status: "idle",
            runId: null,
          }),
        },
      },
    });
  });

  it("advances the work-session spine through discover, summarise, and plan", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-zeta",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-1",
        toolName: "view",
        arguments: { path: "packages/backend/src/copilot/session-manager.ts" },
      },
    });
    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "discover",
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        success: true,
        result: { ok: true },
      },
    });
    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "summarise",
    });
    expect(memory.runtimeSessions.get("station:station-zeta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "summarise",
          status: "active",
          phaseHistory: expect.arrayContaining([expect.objectContaining({ phase: "summarise", status: "active" })]),
        },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "plan",
    });
    expect(memory.runtimeSessions.get("station:station-zeta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "plan",
          status: "active",
          phaseHistory: expect.arrayContaining([
            expect.objectContaining({ phase: "classify", status: "complete" }),
            expect.objectContaining({ phase: "discover", status: "complete" }),
            expect.objectContaining({ phase: "summarise", status: "complete" }),
            expect.objectContaining({ phase: "plan", status: "active" }),
          ]),
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "plan",
          planSummary: "Plan the bridge badge work and update the session manager flow.",
        }),
      ]),
    );
  });

  it("transitions from plan into implement and records patch attempts", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-alpha",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "implement",
    });

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: true,
        result: { ok: true },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-alpha")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
          patchAttempts: [
            expect.objectContaining({
              toolName: "apply_patch",
              changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
            }),
          ],
        }),
      ]),
    );
  });

  it("does not persist changed files when an implementation tool fails", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-alpha-fail",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: false,
        error: {
          message: "Patch failed.",
        },
      },
    });

    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          changedFiles: [],
          patchAttempts: [],
          selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        }),
      ]),
    );
  });

  it("transitions from implement into validate and marks ready-for-review after successful validation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-beta",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: true,
        result: { ok: true },
      },
    });

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-beta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "active",
        },
      },
    });

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate",
        success: true,
        result: { summary: "All tests passed." },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-beta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "complete",
          summary: "Validation passed; ready for review.",
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "validate",
          readyForReview: true,
          validationResults: [
            expect.objectContaining({
              toolName: "powershell",
              success: true,
              command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
            }),
          ],
        }),
      ]),
    );
  });

  it("waits for read_powershell follow-up before finalizing long-running validation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-beta-streaming",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate",
        success: true,
        result: {
          resultType: "success",
          textResultForLlm: JSON.stringify({
            shellId: "shell-1",
            status: "running",
            exitCode: null,
            output: "partial output",
          }),
        },
      },
    });

    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "validate",
          readyForReview: false,
          pendingValidationShellId: "shell-1",
          validationResults: [],
        }),
      ]),
    );

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-read",
        toolName: "read_powershell",
        arguments: {
          shellId: "shell-1",
          delay: 5,
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate-read",
        success: true,
        result: {
          resultType: "success",
          textResultForLlm: JSON.stringify({
            shellId: "shell-1",
            status: "running",
            exitCode: null,
            output: "still running",
          }),
        },
      },
    });

    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "validate",
          readyForReview: false,
          pendingValidationShellId: "shell-1",
          validationResults: [],
        }),
      ]),
    );

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-read-2",
        toolName: "read_powershell",
        arguments: {
          shellId: "shell-1",
          delay: 5,
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate-read-2",
        success: true,
        result: {
          resultType: "success",
          textResultForLlm: JSON.stringify({
            shellId: "shell-1",
            status: "completed",
            exitCode: 0,
            output: "All tests passed.",
          }),
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-beta-streaming")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "complete",
          blockedBy: null,
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "validate",
          readyForReview: true,
          pendingValidationShellId: null,
          validationResults: [
            expect.objectContaining({
              toolName: "read_powershell",
              command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
              success: true,
            }),
          ],
        }),
      ]),
    );
  });

  it("does not misclassify generic powershell file reads as validation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-beta-generic-powershell",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-generic-powershell",
        toolName: "powershell",
        arguments: {
          command: "Get-Content packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Read the session manager test file",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-beta-generic-powershell")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
        },
      },
    });
  });

  it("returns from validate to implement after a failed validation run", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-gamma",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
          description: "Run shared and backend type build",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate",
        success: false,
        error: {
          message: "TS2322: Type 'string' is not assignable to type 'number'.",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-gamma")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          fixIterationCount: 1,
          repeatFailureCount: 1,
          lastValidationFingerprint: expect.stringMatching(/^TS2322:/),
          readyForReview: false,
          validationResults: [
            expect.objectContaining({
              success: false,
              fingerprint: expect.stringMatching(/^TS2322:/),
            }),
          ],
        }),
      ]),
    );
  });

  it("resets the fix-iteration budget after a successful validation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-gamma-success-reset",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-1",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-1",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-1",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
          description: "Run shared and backend type build",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate-1",
        success: false,
        error: {
          message: "TS2322: Type 'string' is not assignable to type 'number'.",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-2",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ fixed\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-2",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-2",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate-2",
        success: true,
        result: { summary: "All tests passed." },
      },
    });

    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "validate",
          readyForReview: true,
          fixIterationCount: 0,
        }),
      ]),
    );
  });

  it("treats async powershell failures with different shell ids as the same repeated validation failure", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-gamma-async",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    for (const [index, shellId] of [
      [1, "shell-a"],
      [2, "shell-b"],
    ] as const) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-patch-${index}`,
          toolName: "apply_patch",
          arguments: {
            patch:
              "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `tool-patch-${index}`,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-validate-${index}`,
          toolName: "powershell",
          arguments: {
            command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
            description: "Run shared and backend type build",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `tool-validate-${index}`,
          success: true,
          result: {
            resultType: "success",
            textResultForLlm: JSON.stringify({
              shellId,
              status: "running",
              exitCode: null,
              output: "partial output",
            }),
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-validate-read-${index}`,
          toolName: "read_powershell",
          arguments: {
            shellId,
            delay: 5,
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `tool-validate-read-${index}`,
          success: true,
          result: {
            resultType: "success",
            textResultForLlm: JSON.stringify({
              shellId,
              status: "failed",
              exitCode: 1,
              output: "TS2322: Type 'string' is not assignable to type 'number'.",
            }),
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-gamma-async")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
        },
      },
    });
  });

  it("treats cancelled powershell validation sessions as failures instead of passes", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-gamma-cancelled",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate",
        success: true,
        result: {
          resultType: "success",
          textResultForLlm: JSON.stringify({
            shellId: "shell-cancelled",
            status: "cancelled",
            exitCode: 1,
            output: "Validation cancelled.",
          }),
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-gamma-cancelled")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          readyForReview: false,
          validationResults: [
            expect.objectContaining({
              success: false,
            }),
          ],
        }),
      ]),
    );
  });

  it("stalls the work session after the same validation failure repeats twice", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
          toolName: "apply_patch",
          arguments: {
            patch:
              "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
          toolName: "powershell",
          arguments: {
            command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
            description: "Run shared and backend type build",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-delta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
          blockedBy: expect.objectContaining({
            kind: "error",
          }),
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "validate",
          repeatFailureCount: 2,
          stalledReason: "Validation repeated the same failure twice; escalation or manual intervention is required.",
        }),
      ]),
    );
  });

  it("clears stalled workflow blocking after a corrective patch and successful validation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-recover",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
          toolName: "apply_patch",
          arguments: {
            patch:
              "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
          toolName: "powershell",
          arguments: {
            command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
            description: "Run shared and backend type build",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-delta-recover")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
        },
      },
    });

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ newer\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3-validate",
        success: true,
        result: { summary: "All tests passed." },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-recover")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "complete",
          blockedBy: null,
          summary: "Validation passed; ready for review.",
        },
      },
    });
  });

  it("does not clear a stalled validation state just by rerunning validation without a corrective patch", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-guard",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
          toolName: "apply_patch",
          arguments: {
            patch:
              "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
          toolName: "powershell",
          arguments: {
            command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
            description: "Run shared and backend type build",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-3",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate-3",
        success: false,
        error: {
          message: "Different validation failure.",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-guard")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
          blockedBy: expect.objectContaining({
            kind: "error",
          }),
        },
      },
    });
  });

  it("does not allow validation to restart from implement after a failed stalled-recovery write", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-failed-recovery",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
          toolName: "apply_patch",
          arguments: {
            patch:
              "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
          toolName: "powershell",
          arguments: {
            command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
            description: "Run shared and backend type build",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ newer\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3",
        success: false,
        error: {
          message: "Patch failed.",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-failed-recovery")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "stalled",
          blockedBy: expect.objectContaining({
            kind: "error",
          }),
        },
      },
    });
  });

  it("resets the repeat-failure budget after a stalled validation resumes with a corrective patch", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-budget",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
          toolName: "apply_patch",
          arguments: {
            patch:
              "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
          toolName: "powershell",
          arguments: {
            command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
            description: "Run shared and backend type build",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ newer\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
          description: "Run shared and backend type build",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3-validate",
        success: false,
        error: {
          message: "TS2322: Type 'string' is not assignable to type 'number'.",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-budget")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          repeatFailureCount: 1,
          lastValidationFingerprint: expect.stringMatching(/^TS2322:/),
          stalledReason: null,
        }),
      ]),
    );
  });

  it("resets the attempt-limit budget after recovering from a bounded fix-loop stall", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-attempt-budget",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });

    for (const [index, errorMessage] of [
      [1, "Failure one."],
      [2, "Failure two."],
      [3, "Failure three."],
      [4, "Failure four."],
      [5, "Failure five."],
    ] as const) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-patch-${index}`,
          toolName: "apply_patch",
          arguments: {
            patch:
              "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `tool-patch-${index}`,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-validate-${index}`,
          toolName: "powershell",
          arguments: {
            command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
            description: "Run shared and backend type build",
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `tool-validate-${index}`,
          success: false,
          error: {
            message: errorMessage,
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-delta-attempt-budget")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
        },
      },
    });

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-6",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ recovered\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-6",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-6",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec tsc -b packages\\shared packages\\backend --pretty false",
          description: "Run shared and backend type build",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-validate-6",
        success: false,
        error: {
          message: "Failure after recovery.",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-attempt-budget")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          fixIterationCount: 1,
          stalledReason: null,
        }),
      ]),
    );
  });

  it("preserves continue-current-phase escalation semantics during validate", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate: vi.fn().mockResolvedValue({
        status: "escalated",
        providerId: "openai-escalation",
        fromModel: "gpt-5.4-mini",
        toModel: "gpt-5.4",
      }),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-discover",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-1",
        content: "Plan the bridge badge work and update the session manager flow.",
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });

    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected spira_escalate_session to be available.");
    }

    await tool.handler({});

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "active",
          handoffs: [
            expect.objectContaining({
              kind: "model-escalation",
              phase: "validate",
              continuationMode: "continue-current-phase",
              toModel: "gpt-5.4",
            }),
          ],
        },
      },
    });
  });

  it("preserves approval blocks while syncing work-session workflow phases", async () => {
    const memory = createRuntimeMemoryDb();
    memory.db.upsertRuntimePermissionRequest({
      requestId: "perm-1",
      stationId: "station-kappa",
      payload: { kind: "custom-tool", toolName: "spira_escalate_session" },
      createdAt: 123,
    });
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-kappa",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.workflowState = {
      ...internals.workflowState,
      phase: "discover",
      status: "blocked",
      blockedBy: {
        kind: "approval",
        reason: "Awaiting approval.",
        pendingRequestIds: ["perm-1"],
        blockedAt: 123,
      },
    };

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        success: true,
        result: { ok: true },
      },
    });

    expect(memory.runtimeSessions.get("station:station-kappa")).toMatchObject({
      contract: {
        workflowState: {
          phase: "summarise",
          status: "blocked",
          blockedBy: {
            kind: "approval",
            pendingRequestIds: ["perm-1"],
          },
        },
      },
    });
    expect(memory.runtimeSessions.get("station:station-kappa")).toMatchObject({
      contract: {
        workflowState: {
          phaseHistory: expect.arrayContaining([expect.objectContaining({ phase: "summarise", status: "blocked" })]),
        },
      },
    });
  });

  it("resumes work-session workflow syncing after review completes", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-mu",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";
    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "complete",
      review: {
        ...internals.workflowState.review,
        status: "completed",
        summary: "Review completed.",
        lastUpdatedAt: 123,
      },
    };

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        success: true,
        result: { ok: true },
      },
    });

    expect(memory.runtimeSessions.get("station:station-mu")).toMatchObject({
      contract: {
        workflowState: {
          phase: "summarise",
          status: "active",
          phaseHistory: expect.arrayContaining([expect.objectContaining({ phase: "summarise", status: "active" })]),
          review: expect.objectContaining({
            status: "completed",
          }),
        },
      },
    });
  });

  it("seals a ready-for-review work session when review completes", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-mu-complete:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-mu-complete",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Validation passed; ready for review.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        reviewSummary: null,
        completedAt: null,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 6,
      }),
    );

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-mu-complete",
    });
    const internals = manager as unknown as SessionManagerInternals & {
      handleReviewSubagentStatus(
        runId: string,
        domain: string,
        status: string,
        occurredAt: number,
        summary: string | null,
      ): void;
    };

    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "active",
      summary: "Running review: Review the current diff",
      review: {
        ...internals.workflowState.review,
        status: "running",
        origin: "managed-subagent",
        runId: "review-run-1",
        attempt: 1,
        summary: "Running review: Review the current diff",
        failureReason: null,
        lastUpdatedAt: 11,
      },
    };

    internals.handleReviewSubagentStatus("review-run-1", "code-review", "completed", 12, "Review completed cleanly.");

    expect(memory.runtimeSessions.get("station:station-mu-complete")).toMatchObject({
      contract: {
        workflowState: {
          phase: "complete",
          status: "complete",
          summary: "Review completed cleanly.",
          review: {
            status: "completed",
            summary: "Review completed cleanly.",
          },
          phaseHistory: expect.arrayContaining([expect.objectContaining({ phase: "complete", status: "complete" })]),
        },
      },
    });
    expect(JSON.parse(String(memory.sessionState.get("station:station-mu-complete:work-session")))).toMatchObject({
      currentPhase: "validate",
      readyForReview: true,
      reviewSummary: "Review completed cleanly.",
      completedAt: 12,
      summary: "Review completed cleanly.",
    });

    internals.session = {
      sessionId: "work-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "work-session";
    const runtimeBeforeLateEvent = structuredClone(memory.runtimeSessions.get("station:station-mu-complete"));
    const ledgerCountBeforeLateEvent = memory.runtimeLedgerEvents.length;
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-late",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-mu-complete")).toEqual(runtimeBeforeLateEvent);
    expect(memory.runtimeLedgerEvents).toHaveLength(ledgerCountBeforeLateEvent);
    expect(
      (
        memory.runtimeSessions.get("station:station-mu-complete")?.contract as {
          workflowState?: { phaseHistory?: unknown[] };
        }
      ).workflowState?.phaseHistory?.filter((entry) =>
        Boolean(
          entry && typeof entry === "object" && "phase" in entry && (entry as { phase?: string }).phase === "complete",
        ),
      ),
    ).toHaveLength(1);
    expect(JSON.parse(String(memory.sessionState.get("station:station-mu-complete:work-session")))).toMatchObject({
      updatedAt: 12,
    });

    internals.handleReviewSubagentStatus("review-run-1", "code-review", "failed", 13, "Late failure.");

    expect(memory.runtimeSessions.get("station:station-mu-complete")).toMatchObject({
      contract: {
        workflowState: {
          phase: "complete",
          status: "complete",
          summary: "Review completed cleanly.",
          review: {
            status: "completed",
            summary: "Review completed cleanly.",
          },
        },
      },
    });
  });

  it("ignores tool events while review is running for a ready-for-review work session", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-mu-review-running:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-mu-review-running",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Validation passed; ready for review.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        reviewSummary: null,
        completedAt: null,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 6,
      }),
    );

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-mu-review-running",
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "work-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "work-session";
    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "active",
      review: {
        ...internals.workflowState.review,
        status: "running",
        origin: "managed-subagent",
        runId: "review-run-1",
        attempt: 1,
        summary: "Running review: Review the current diff",
        failureReason: null,
        lastUpdatedAt: 11,
      },
    };
    const runtimeBeforeLateTool = structuredClone(memory.runtimeSessions.get("station:station-mu-review-running"));

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-late-review",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-mu-review-running")).toEqual(runtimeBeforeLateTool);
    expect(JSON.parse(String(memory.sessionState.get("station:station-mu-review-running:work-session")))).toMatchObject(
      {
        currentPhase: "validate",
        readyForReview: true,
        completedAt: null,
      },
    );
  });

  it("keeps simple questions conversational", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-beta",
    });
    const session = {
      sessionId: "chat-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Can you explain the bridge UI?")).resolves.toBeUndefined();

    expect(manager.getWorkSessionSummary()).toBeNull();
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).not.toEqual(expect.arrayContaining([expect.objectContaining({ currentPhase: "classify" })]));
  });

  it("clears persisted work-session state when the station session is reset", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-delta",
    });
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    await expect(manager.clearSession()).resolves.toBeUndefined();

    expect(manager.getWorkSessionSummary()).toBeNull();
    expect([...memory.sessionState.values()]).not.toEqual(
      expect.arrayContaining([expect.stringContaining('"currentPhase":"classify"')]),
    );
    expect(memory.runtimeSessions.get("station:station-delta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "intake",
          status: "idle",
          summary: null,
        },
      },
    });
  });

  it("clears later review workflow state when resetting an active work session", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-rho",
    });
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const internals = manager as unknown as SessionManagerInternals;

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "blocked",
      summary: "Review failed.",
      blockedBy: {
        kind: "review",
        reason: "Review failed.",
        pendingRequestIds: [],
        blockedAt: 123,
      },
      review: {
        ...internals.workflowState.review,
        status: "failed",
        runId: "review-1",
        summary: "Review failed.",
        failureReason: "Review failed.",
        lastUpdatedAt: 123,
      },
    };

    await expect(manager.clearSession()).resolves.toBeUndefined();

    expect(memory.runtimeSessions.get("station:station-rho")).toMatchObject({
      contract: {
        workflowState: {
          phase: "intake",
          status: "idle",
          blockedBy: null,
          review: {
            status: "idle",
            runId: null,
            summary: null,
            failureReason: null,
          },
        },
      },
    });
  });

  it("starts a new work session without carrying prior review history", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-sigma",
    });
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const internals = manager as unknown as SessionManagerInternals;

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "blocked",
      summary: "Review failed.",
      blockedBy: {
        kind: "review",
        reason: "Review failed.",
        pendingRequestIds: [],
        blockedAt: 123,
      },
      phaseHistory: [
        ...internals.workflowState.phaseHistory,
        {
          phase: "review",
          status: "blocked",
          summary: "Review failed.",
          providerId: "copilot",
          model: "review",
          startedAt: 123,
          updatedAt: 123,
          completedAt: null,
          blockedBy: {
            kind: "review",
            reason: "Review failed.",
            pendingRequestIds: [],
            blockedAt: 123,
          },
        },
      ],
      review: {
        ...internals.workflowState.review,
        status: "failed",
        runId: "review-1",
        summary: "Review failed.",
        failureReason: "Review failed.",
        lastUpdatedAt: 123,
      },
    };
    internals.handleSessionEvent({ type: "session.idle", data: {} });
    internals.currentState = "idle";

    await expect(
      manager.sendMessage("Implement the station registry cleanup in the backend file"),
    ).resolves.toBeUndefined();

    const runtimeSession = memory.runtimeSessions.get("station:station-sigma");
    const persistedWorkflowState = runtimeSession?.contract as { workflowState: RuntimeWorkflowState } | undefined;
    expect(runtimeSession).toMatchObject({
      contract: {
        workflowState: {
          phase: "discover",
          status: "active",
          blockedBy: null,
          review: {
            status: "idle",
            runId: null,
            summary: null,
            failureReason: null,
          },
        },
      },
    });
    expect(
      persistedWorkflowState?.workflowState.phaseHistory.some(
        (entry) => entry.phase === "review" || entry.phase === "complete",
      ),
    ).toBe(false);
  });

  it("falls back to conversational mode and clears work-session state for non-work follow-ups", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-epsilon",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.handleSessionEvent({ type: "session.idle", data: {} });
    internals.currentState = "idle";

    await expect(manager.sendMessage("Can you explain what changed?")).resolves.toBeUndefined();

    expect(manager.getWorkSessionSummary()).toBeNull();
    expect([...memory.sessionState.values()]).not.toEqual(
      expect.arrayContaining([expect.stringContaining('"currentPhase":"classify"')]),
    );
    expect(memory.runtimeSessions.get("station:station-epsilon")).toMatchObject({
      contract: {
        workflowState: {
          phase: "intake",
          status: "idle",
        },
      },
    });
  });

  it("preserves persisted work-session state across manager shutdown", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-iota",
    });
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const internals = manager as unknown as SessionManagerInternals;

    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(manager.sendMessage("Implement the bridge UI badge in the renderer file")).resolves.toBeUndefined();
    internals.session = session;
    internals.activeSessionId = "work-session";

    await expect(manager.shutdown()).resolves.toBeUndefined();

    expect([...memory.sessionState.values()]).toEqual(
      expect.arrayContaining([expect.stringContaining('"stationId":"station-iota"')]),
    );
  });

  it("restores persisted work-session phase state on restart", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-theta:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-theta",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "plan",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "WorkSession activated from explicit coding intent.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 1,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "active",
            summary: "Plan ready.",
            startedAt: 1,
            updatedAt: 4,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: [],
        summary: "Plan ready.",
        planSummary: "Plan ready.",
        createdAt: 1,
        updatedAt: 4,
      }),
    );

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-theta",
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "plan",
      summary: "Plan ready.",
    });
    expect(memory.runtimeSessions.get("station:station-theta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "plan",
          status: "active",
        },
      },
    });
  });

  it("restores validate-complete work-session state on restart", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-xi:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-xi",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "WorkSession activated from explicit coding intent.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 1,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 1,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Validation passed; ready for review.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 6,
      }),
    );

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-xi",
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "validate",
      summary: "Validation passed; ready for review.",
    });
    expect(memory.runtimeSessions.get("station:station-xi")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "complete",
          summary: "Validation passed; ready for review.",
        },
      },
    });
  });

  it("restores a sealed work session as complete after restart", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-xi-complete:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-xi-complete",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Review completed cleanly.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        reviewSummary: "Review completed cleanly.",
        completedAt: 12,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 12,
      }),
    );
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-xi-complete",
      kind: "station",
      scope: { stationId: "station-xi-complete" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "manifest",
      providerProjectionHash: "projection",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      providerSessionId: "work-session",
      model: "gpt-5.4",
      boundAt: 100,
    });
    memory.db.upsertRuntimeSession({
      runtimeSessionId: "station:station-xi-complete",
      stationId: "station-xi-complete",
      kind: "station",
      contract: {
        ...runtimeSession,
        workflowState: {
          ...runtimeSession.workflowState,
          phase: "review",
          status: "active",
          summary: "Running review: Review the current diff",
          updatedAt: 11,
          phaseHistory: [
            {
              phase: "review",
              status: "active",
              summary: "Running review: Review the current diff",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 11,
              updatedAt: 11,
              completedAt: null,
              blockedBy: null,
            },
          ],
          blockedBy: null,
          review: {
            status: "running",
            attempt: 1,
            runId: "review-run-1",
            origin: "managed-subagent",
            summary: "Running review: Review the current diff",
            failureReason: null,
            lastUpdatedAt: 11,
          },
        },
      },
    });

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-xi-complete",
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "validate",
      summary: "Review completed cleanly.",
    });
    expect(memory.runtimeSessions.get("station:station-xi-complete")).toMatchObject({
      contract: {
        workflowState: {
          phase: "complete",
          status: "complete",
          summary: "Review completed cleanly.",
          review: {
            status: "completed",
            summary: "Review completed cleanly.",
          },
          phaseHistory: expect.arrayContaining([expect.objectContaining({ phase: "complete", status: "complete" })]),
        },
      },
    });
  });

  it("does not duplicate the complete phase when restarting an already sealed session", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-xi-complete-repeat:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-xi-complete-repeat",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Review completed cleanly.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        reviewSummary: "Review completed cleanly.",
        completedAt: 12,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 12,
      }),
    );
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-xi-complete-repeat",
      kind: "station",
      scope: { stationId: "station-xi-complete-repeat" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "manifest",
      providerProjectionHash: "projection",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      providerSessionId: "work-session",
      model: "gpt-5.4",
      boundAt: 100,
    });
    memory.db.upsertRuntimeSession({
      runtimeSessionId: "station:station-xi-complete-repeat",
      stationId: "station-xi-complete-repeat",
      kind: "station",
      contract: {
        ...runtimeSession,
        workflowState: {
          ...runtimeSession.workflowState,
          phase: "complete",
          status: "complete",
          summary: "Review completed cleanly.",
          updatedAt: 12,
          phaseHistory: [
            {
              phase: "review",
              status: "complete",
              summary: "Review completed cleanly.",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 11,
              updatedAt: 12,
              completedAt: 12,
              blockedBy: null,
            },
            {
              phase: "complete",
              status: "complete",
              summary: "Review completed cleanly.",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 12,
              updatedAt: 12,
              completedAt: 12,
              blockedBy: null,
            },
          ],
          blockedBy: null,
          review: {
            status: "completed",
            attempt: 1,
            runId: "review-run-1",
            origin: "managed-subagent",
            summary: "Review completed cleanly.",
            failureReason: null,
            lastUpdatedAt: 12,
          },
        },
      },
    });

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-xi-complete-repeat",
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "validate",
      summary: "Review completed cleanly.",
    });
    const phaseHistory = (
      memory.runtimeSessions.get("station:station-xi-complete-repeat")?.contract as {
        workflowState?: { phaseHistory?: Array<{ phase?: string }> };
      }
    ).workflowState?.phaseHistory;
    expect(phaseHistory?.filter((entry) => entry.phase === "complete")).toHaveLength(1);
  });

  it("seals a legacy validate-complete work session during restart when review already finished", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-xi-crash-window:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-xi-crash-window",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Validation passed; ready for review.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        reviewSummary: null,
        completedAt: null,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 6,
      }),
    );
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-xi-crash-window",
      kind: "station",
      scope: { stationId: "station-xi-crash-window" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "manifest",
      providerProjectionHash: "projection",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      providerSessionId: "work-session",
      model: "gpt-5.4",
      boundAt: 100,
    });
    memory.db.upsertRuntimeSession({
      runtimeSessionId: "station:station-xi-crash-window",
      stationId: "station-xi-crash-window",
      kind: "station",
      contract: {
        ...runtimeSession,
        workflowState: {
          ...runtimeSession.workflowState,
          phase: "review",
          status: "active",
          summary: "Running review: Review the current diff",
          updatedAt: 11,
          phaseHistory: [
            {
              phase: "review",
              status: "active",
              summary: "Running review: Review the current diff",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 11,
              updatedAt: 11,
              completedAt: null,
              blockedBy: null,
            },
          ],
          blockedBy: null,
          review: {
            status: "running",
            attempt: 1,
            runId: "review-run-1",
            origin: "managed-subagent",
            summary: "Running review: Review the current diff",
            failureReason: null,
            lastUpdatedAt: 11,
          },
        },
      },
    });
    memory.db.upsertRuntimeSubagentRun({
      runId: "review-run-1",
      stationId: "station-xi-crash-window",
      snapshot: {
        agent_id: "review-run-1",
        runId: "review-run-1",
        roomId: "agent:review-run-1",
        domain: "code-review",
        task: "Review the current diff",
        status: "completed",
        allowWrites: false,
        activeToolCalls: [],
        toolCalls: [],
        startedAt: 11,
        updatedAt: 12,
        summary: "Review completed after restart.",
      },
      createdAt: 11,
    });

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-xi-crash-window",
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "validate",
      summary: "Review completed after restart.",
    });
    expect(memory.runtimeSessions.get("station:station-xi-crash-window")).toMatchObject({
      contract: {
        workflowState: {
          phase: "complete",
          status: "complete",
          summary: "Review completed after restart.",
          review: {
            status: "completed",
            summary: "Review completed after restart.",
          },
        },
      },
    });
    expect(JSON.parse(String(memory.sessionState.get("station:station-xi-crash-window:work-session")))).toMatchObject({
      currentPhase: "validate",
      reviewSummary: "Review completed after restart.",
      completedAt: 12,
    });
  });

  it("clears closure markers when reopened work re-enters implementation", () => {
    const manager = createManager([]);
    const reopened = (
      manager as unknown as {
        startWorkSessionImplementation(
          snapshot: WorkSessionSnapshot,
          toolName: string,
          args: Record<string, unknown>,
          occurredAt: number,
        ): WorkSessionSnapshot;
      }
    ).startWorkSessionImplementation(
      {
        sessionId: "work-session",
        stationId: "station-xi-reopen",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Validation passed; ready for review.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        reviewSummary: "Review completed.",
        completedAt: 10,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 10,
      },
      "apply_patch",
      {
        patch:
          "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
      },
      11,
    );

    expect(reopened).toMatchObject({
      currentPhase: "implement",
      readyForReview: false,
      reviewSummary: null,
      completedAt: null,
    });
  });

  it("clears stale review workflow state when explicitly reopening a sealed work session", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-rho:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-rho",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Review completed cleanly.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        reviewSummary: "Review completed cleanly.",
        completedAt: 12,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 12,
      }),
    );
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-rho",
      kind: "station",
      scope: { stationId: "station-rho" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "manifest",
      providerProjectionHash: "projection",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      providerSessionId: "work-session",
      model: "gpt-5.4",
      boundAt: 100,
    });
    memory.db.upsertRuntimeSession({
      runtimeSessionId: "station:station-rho",
      stationId: "station-rho",
      kind: "station",
      contract: {
        ...runtimeSession,
        workflowState: {
          ...runtimeSession.workflowState,
          phase: "complete",
          status: "complete",
          summary: "Review completed cleanly.",
          updatedAt: 12,
          phaseHistory: [
            {
              phase: "review",
              status: "complete",
              summary: "Review completed cleanly.",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 11,
              updatedAt: 12,
              completedAt: 12,
              blockedBy: null,
            },
            {
              phase: "complete",
              status: "complete",
              summary: "Review completed cleanly.",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 12,
              updatedAt: 12,
              completedAt: 12,
              blockedBy: null,
            },
          ],
          blockedBy: null,
          review: {
            status: "completed",
            attempt: 1,
            runId: "review-run-1",
            origin: "managed-subagent",
            summary: "Review completed cleanly.",
            failureReason: null,
            lastUpdatedAt: 12,
          },
        },
      },
    });

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-rho",
    });
    const internals = manager as unknown as SessionManagerInternals & {
      activateWorkSession(
        taskText: string,
        classification: WorkSessionClassification,
        options?: { startsNewSession?: boolean },
      ): void;
      syncRuntimeState(): void;
    };
    internals.activateWorkSession("Refine the bridge badge spacing.", {
      intent: "edit",
      explicitWorkIntent: true,
      requiresRepoContext: true,
      confidence: "heuristic",
    });
    internals.syncRuntimeState();

    expect(internals.workflowState).toMatchObject({
      phase: "validate",
      review: {
        status: "idle",
        runId: null,
        summary: null,
      },
    });
    expect(internals.workflowState.phaseHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "review" })]),
    );
    expect(internals.workflowState.phaseHistory).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: "complete" })]),
    );

    expect(memory.runtimeSessions.get("station:station-rho")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          review: {
            status: "idle",
            runId: null,
            summary: null,
          },
        },
      },
    });
    expect(JSON.parse(String(memory.sessionState.get("station:station-rho:work-session")))).toMatchObject({
      completedAt: null,
      reviewSummary: null,
      readyForReview: false,
    });
  });

  it("restores reopened work-session state over a stale persisted complete phase after restart", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-rho-restart:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-rho-restart",
        taskText: "Refine the bridge badge spacing.",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "Coding task classified.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 2,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 3,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "active",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 13,
            completedAt: 6,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        summary: "Validation passed; ready for review.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: false,
        reviewSummary: null,
        completedAt: null,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 13,
      }),
    );
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-rho-restart",
      kind: "station",
      scope: { stationId: "station-rho-restart" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "manifest",
      providerProjectionHash: "projection",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      providerSessionId: "work-session",
      model: "gpt-5.4",
      boundAt: 100,
    });
    memory.db.upsertRuntimeSession({
      runtimeSessionId: "station:station-rho-restart",
      stationId: "station-rho-restart",
      kind: "station",
      contract: {
        ...runtimeSession,
        workflowState: {
          ...runtimeSession.workflowState,
          phase: "complete",
          status: "complete",
          summary: "Review completed cleanly.",
          updatedAt: 12,
          phaseHistory: [
            {
              phase: "review",
              status: "complete",
              summary: "Review completed cleanly.",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 11,
              updatedAt: 12,
              completedAt: 12,
              blockedBy: null,
            },
            {
              phase: "complete",
              status: "complete",
              summary: "Review completed cleanly.",
              providerId: "copilot",
              model: "gpt-5.4",
              startedAt: 12,
              updatedAt: 12,
              completedAt: 12,
              blockedBy: null,
            },
          ],
          blockedBy: null,
          review: {
            status: "idle",
            attempt: 1,
            runId: null,
            origin: "managed-subagent",
            summary: null,
            failureReason: null,
            lastUpdatedAt: 12,
          },
        },
      },
    });

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-rho-restart",
    });

    expect(manager.getWorkSessionSummary()).toMatchObject({
      mode: "work-session",
      phase: "validate",
      summary: "Validation passed; ready for review.",
    });
    expect(memory.runtimeSessions.get("station:station-rho-restart")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          review: {
            status: "idle",
            runId: null,
          },
        },
      },
    });
  });

  it("restores stalled work-session execution state as a stalled workflow", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-omicron:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-omicron",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "WorkSession activated from explicit coding intent.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 1,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 1,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "active",
            summary: "Validation failed repeatedly.",
            startedAt: 5,
            updatedAt: 6,
            completedAt: null,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: [],
        selectedFiles: [],
        summary: "Validation failed repeatedly.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 3,
        repeatFailureCount: 2,
        lastValidationFingerprint: "TS2322",
        readyForReview: false,
        stalledReason: "Validation exhausted the bounded fix loop.",
        stalledAt: 6,
        createdAt: 1,
        updatedAt: 6,
      }),
    );

    createManager([], {
      memoryDb: memory.db,
      stationId: "station-omicron",
    });

    expect(memory.runtimeSessions.get("station:station-omicron")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
          summary: "Validation failed repeatedly.",
          blockedBy: {
            kind: "error",
            reason: "Validation exhausted the bounded fix loop.",
            pendingRequestIds: [],
            blockedAt: 6,
          },
        },
      },
    });
  });

  it("preserves validate-complete status when clearing a stale approval block during restore", () => {
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-pi",
      kind: "station",
      scope: { stationId: "station-pi" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      workflowState: {
        phase: "validate",
        status: "blocked",
        summary: "Validation passed; ready for review.",
        updatedAt: 10,
        phaseHistory: [
          {
            phase: "validate",
            status: "blocked",
            summary: "Validation passed; ready for review.",
            providerId: "copilot",
            model: "work-session",
            startedAt: 5,
            updatedAt: 10,
            completedAt: 10,
            blockedBy: {
              kind: "approval",
              reason: "Awaiting approval.",
              pendingRequestIds: ["perm-stale"],
              blockedAt: 10,
            },
          },
        ],
        handoffs: [],
        blockedBy: {
          kind: "approval",
          reason: "Awaiting approval.",
          pendingRequestIds: ["perm-stale"],
          blockedAt: 10,
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
    });
    const memory = createRuntimeMemoryDb({
      stationId: "station-pi",
      state: "idle",
      promptInFlight: false,
      activeSessionId: null,
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    memory.runtimeSessions.set("station:station-pi", {
      runtimeSessionId: "station:station-pi",
      stationId: "station-pi",
      kind: "station",
      contract: runtimeSession,
    });
    memory.sessionState.set(
      "station:station-pi:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-pi",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "WorkSession activated from explicit coding intent.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 1,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 1,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "complete",
            summary: "Patch applied.",
            startedAt: 4,
            updatedAt: 5,
            completedAt: 5,
          },
          {
            phase: "validate",
            status: "complete",
            summary: "Validation passed; ready for review.",
            startedAt: 5,
            updatedAt: 10,
            completedAt: 10,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: [],
        selectedFiles: [],
        summary: "Validation passed; ready for review.",
        planSummary: "Plan ready.",
        changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: true,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 10,
      }),
    );

    createManager([], {
      memoryDb: memory.db,
      stationId: "station-pi",
    });

    expect(memory.runtimeSessions.get("station:station-pi")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "complete",
          blockedBy: null,
          summary: "Validation passed; ready for review.",
        },
      },
    });
  });

  it("clears stale approval blocking from an active restored work-session phase", () => {
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-tau",
      kind: "station",
      scope: { stationId: "station-tau" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      workflowState: {
        phase: "implement",
        status: "blocked",
        summary: "Applying the patch.",
        updatedAt: 10,
        phaseHistory: [
          {
            phase: "implement",
            status: "blocked",
            summary: "Applying the patch.",
            providerId: "copilot",
            model: "work-session",
            startedAt: 5,
            updatedAt: 10,
            completedAt: null,
            blockedBy: {
              kind: "approval",
              reason: "Awaiting approval.",
              pendingRequestIds: ["perm-stale"],
              blockedAt: 10,
            },
          },
        ],
        handoffs: [],
        blockedBy: {
          kind: "approval",
          reason: "Awaiting approval.",
          pendingRequestIds: ["perm-stale"],
          blockedAt: 10,
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
    });
    const memory = createRuntimeMemoryDb({
      stationId: "station-tau",
      state: "idle",
      promptInFlight: false,
      activeSessionId: null,
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    memory.runtimeSessions.set("station:station-tau", {
      runtimeSessionId: "station:station-tau",
      stationId: "station-tau",
      kind: "station",
      contract: runtimeSession,
    });
    memory.sessionState.set(
      "station:station-tau:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-tau",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "implement",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [
          {
            phase: "classify",
            status: "complete",
            summary: "WorkSession activated from explicit coding intent.",
            startedAt: 1,
            updatedAt: 1,
            completedAt: 1,
          },
          {
            phase: "discover",
            status: "complete",
            summary: "Repository context discovered.",
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
          {
            phase: "summarise",
            status: "complete",
            summary: "Repository findings summarised.",
            startedAt: 1,
            updatedAt: 3,
            completedAt: 3,
          },
          {
            phase: "plan",
            status: "complete",
            summary: "Plan ready.",
            startedAt: 1,
            updatedAt: 4,
            completedAt: 4,
          },
          {
            phase: "implement",
            status: "active",
            summary: "Applying the patch.",
            startedAt: 5,
            updatedAt: 10,
            completedAt: null,
          },
          {
            phase: "validate",
            status: "pending",
            summary: null,
            startedAt: 10,
            updatedAt: 10,
          },
        ],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: [],
        selectedFiles: [],
        summary: "Applying the patch.",
        planSummary: "Plan ready.",
        changedFiles: [],
        patchAttempts: [],
        validationResults: [],
        fixIterationCount: 0,
        repeatFailureCount: 0,
        lastValidationFingerprint: null,
        readyForReview: false,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 10,
      }),
    );

    createManager([], {
      memoryDb: memory.db,
      stationId: "station-tau",
    });

    expect(memory.runtimeSessions.get("station:station-tau")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
          summary: "Applying the patch.",
          phaseHistory: expect.arrayContaining([
            expect.objectContaining({
              phase: "implement",
              status: "active",
              blockedBy: null,
            }),
          ]),
        },
      },
    });
  });

  it("does not rewind a later runtime phase when restoring a persisted work session", () => {
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:station-nu",
      kind: "station",
      scope: { stationId: "station-nu" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      workflowState: {
        phase: "implement",
        status: "active",
        summary: "Implementing the change.",
        updatedAt: 10,
        phaseHistory: [],
        handoffs: [],
        blockedBy: null,
        review: {
          status: "idle",
          attempt: 0,
          runId: null,
          summary: null,
          failureReason: null,
          lastUpdatedAt: null,
        },
      },
    });
    const memory = createRuntimeMemoryDb({
      stationId: "station-nu",
      state: "idle",
      promptInFlight: false,
      activeSessionId: null,
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    memory.runtimeSessions.set("station:station-nu", {
      runtimeSessionId: "station:station-nu",
      stationId: "station-nu",
      kind: "station",
      contract: runtimeSession,
    });
    memory.sessionState.set(
      "station:station-nu:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-nu",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "plan",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [],
        searchTerms: ["bridge"],
        candidateFiles: [],
        summary: "Plan ready.",
        planSummary: "Plan ready.",
        createdAt: 1,
        updatedAt: 4,
      }),
    );

    createManager([], {
      memoryDb: memory.db,
      stationId: "station-nu",
    });

    expect(memory.runtimeSessions.get("station:station-nu")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          summary: "Implementing the change.",
        },
      },
    });
  });

  it("emits provider usage when a turn becomes idle", () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const usage = vi.fn();
    internals.activeSessionId = "session-usage";
    internals.session = {
      sessionId: "session-usage",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.bus.on("provider:usage", usage);

    internals.handleSessionEvent({ type: "session.idle", data: {} });

    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "copilot",
        sessionId: "session-usage",
        source: "unknown",
      }),
    );
  });

  it("uses normalized assistant usage when the provider reports it before idle", () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const usage = vi.fn();
    internals.activeSessionId = "session-usage";
    internals.session = {
      sessionId: "session-usage",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.bus.on("provider:usage", usage);

    internals.handleSessionEvent({
      type: "assistant.usage",
      data: {
        model: "gpt-5.4",
        totalTokens: 16,
        source: "provider",
      },
    });
    internals.handleSessionEvent({ type: "session.idle", data: {} });

    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "copilot",
        sessionId: "session-usage",
        model: "gpt-5.4",
        totalTokens: 16,
        source: "provider",
      }),
    );
  });

  it("persists station runtime tool-call state", () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "tool-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "tool-session";

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-1",
        toolName: "vision_read_screen",
        arguments: { target: "screen" },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        result: { ok: true },
      },
    });

    expect(memory.runtimeStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stationId: "primary",
          activeToolCalls: [
            expect.objectContaining({
              callId: "tool-1",
              toolName: "vision_read_screen",
            }),
          ],
        }),
        expect.objectContaining({
          stationId: "primary",
          activeToolCalls: [],
        }),
      ]),
    );
  });

  it("resumes the persisted SDK session after disconnecting the live handle", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], { memoryDb: runtimeMemory.db, stationId: "primary" });
    const internals = manager as unknown as SessionManagerInternals;
    const resumedSession = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const manifest = (
      manager as unknown as {
        getCurrentToolManifest(provider: typeof client): { hostManifestHash: string; projectionHash: string };
      }
    ).getCurrentToolManifest(client);
    runtimeMemory.db.getRuntimeStationState = () => ({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });

    internals.activeSessionId = "persisted-session";
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(resumedSession);

    expect(client.resumeSession).toHaveBeenCalledTimes(1);
    expect(client.resumeSession).toHaveBeenCalledWith(
      "persisted-session",
      expect.objectContaining({
        clientName: "Spira",
        infiniteSessions: { enabled: true },
      }),
    );
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("loads a persisted session id from session persistence on startup", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const resumedSession = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn().mockResolvedValue(resumedSession),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const manifest = (
      manager as unknown as {
        getCurrentToolManifest(provider: typeof client): { hostManifestHash: string; projectionHash: string };
      }
    ).getCurrentToolManifest(client);
    runtimeMemory.db.getRuntimeStationState = () => ({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(resumedSession);

    expect(persistence.load).toHaveBeenCalled();
    expect(client.resumeSession).toHaveBeenCalledWith(
      "persisted-session",
      expect.objectContaining({ clientName: "Spira" }),
    );
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("discards persisted sessions when runtime manifest provenance is missing or stale", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith("persisted-session");
    expect(persistence.save).toHaveBeenCalledWith(null);
    expect(runtimeMemory.runtimeStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          hostManifestHash: expect.any(String),
          providerProjectionHash: expect.any(String),
        }),
      ]),
    );
  });

  it("queues stale persisted-session cleanup failures and continues with a fresh session", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "persisted-session",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
      providerId: "copilot",
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "copilot" as const,
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
        toolManifestMode: "projected" as const,
        modelSelection: "session-scoped" as const,
        toolCalling: "native" as const,
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn().mockRejectedValue(new Error("delete failed")),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith("persisted-session");
    expect(persistence.save).toHaveBeenCalledWith(null);
    expect(runtimeMemory.sessionState.get("runtime.provider-session-cleanup")).toBe(
      JSON.stringify([{ providerId: "copilot", sessionId: "persisted-session" }]),
    );
  });

  it("discards persisted sessions when runtime state points at a different active session id", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const manifest = (
      manager as unknown as {
        getCurrentToolManifest(provider: typeof client): { hostManifestHash: string; projectionHash: string };
      }
    ).getCurrentToolManifest(client);
    runtimeMemory.db.getRuntimeStationState = () => ({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      hostManifestHash: manifest.hostManifestHash,
      providerProjectionHash: manifest.projectionHash,
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledWith(null);
  });

  it("tries stale persisted-session cleanup across providers when runtime state points at a different active session id", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      providerId: "azure-openai",
      hostManifestHash: "stale-host-manifest",
      providerProjectionHash: "stale-projection",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      sessionPersistence: persistence,
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const copilotClient = {
      providerId: "copilot" as const,
      capabilities: getDefaultProviderCapabilities("copilot"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    const azureDeleteSession = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof copilotClient> },
      "getOrCreateClient",
    ).mockResolvedValue(copilotClient);
    vi.spyOn(clientFactory, "createProviderClientForProvider").mockImplementation(async (_env, providerId) => ({
      client:
        providerId === "azure-openai"
          ? ({
              providerId: "azure-openai",
              capabilities: getDefaultProviderCapabilities("azure-openai"),
              createSession: vi.fn(),
              resumeSession: vi.fn(),
              deleteSession: azureDeleteSession,
              getAuthStatus: vi.fn(),
              stop: vi.fn().mockResolvedValue([]),
            } as never)
          : (copilotClient as never),
      strategy: {} as never,
    }));

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(copilotClient.deleteSession).toHaveBeenCalledWith("persisted-session");
    expect(azureDeleteSession).toHaveBeenCalledWith("persisted-session");
  });

  it("tries clearSession teardown across providers when runtime state points at a different active session id", async () => {
    const runtimeMemory = createRuntimeMemoryDb({
      stationId: "primary",
      state: "idle",
      promptInFlight: false,
      activeSessionId: "other-session",
      providerId: "azure-openai",
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.client = {
      providerId: "copilot",
      stop: vi.fn().mockResolvedValue(undefined),
    } as never;
    internals.activeSessionId = "persisted-session";

    const deletePersistedSession = vi
      .spyOn(
        manager as unknown as {
          deletePersistedSession(sessionId: string, providerId: "copilot" | "azure-openai"): Promise<void>;
        },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    await expect(manager.clearSession()).resolves.toBeUndefined();

    expect(deletePersistedSession).toHaveBeenNthCalledWith(1, "persisted-session", "copilot");
    expect(deletePersistedSession).toHaveBeenNthCalledWith(2, "persisted-session", "azure-openai");
  });

  it("saves the active session id through session persistence", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue(null),
      save: vi.fn(),
    };
    const manager = createManager([], { sessionPersistence: persistence });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "fresh-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(persistence.save).toHaveBeenCalledWith("fresh-session");
  });

  it("does not load a persisted session id for providers without durable session support", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const manager = createManager([], {
      sessionPersistence: persistence,
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(persistence.load).not.toHaveBeenCalled();
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledWith(null);
  });

  it("requests native streaming for providers that support it", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: true,
      }),
    );
  });

  it("drives a streamed Azure turn through the unchanged station event path", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const delta = vi.fn();
    const toolCall = vi.fn();
    const toolResult = vi.fn();
    const responseEnd = vi.fn();
    const usage = vi.fn();
    internals.bus.on("assistant:delta", delta);
    internals.bus.on("assistant:tool-call", toolCall);
    internals.bus.on("assistant:tool-result", toolResult);
    internals.bus.on("assistant:response-end", responseEnd);
    internals.bus.on("provider:usage", usage);
    const session = {
      sessionId: "azure-session",
      send: vi.fn(async () => {
        internals.handleSessionEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "call-1",
            toolName: "spira_ui_get_snapshot",
            arguments: {},
          },
        });
        internals.handleSessionEvent({
          type: "tool.execution_complete",
          data: {
            toolCallId: "call-1",
            success: true,
            result: { activeView: "bridge" },
          },
        });
        internals.handleSessionEvent({
          type: "assistant.message_delta",
          data: {
            messageId: "msg-1",
            deltaContent: "Snapshot captured.",
          },
        });
        internals.handleSessionEvent({
          type: "assistant.message",
          data: {
            messageId: "msg-1",
            content: "Snapshot captured.",
          },
        });
        internals.handleSessionEvent({
          type: "session.idle",
          data: {
            usage: {
              model: "gpt-4.1",
              totalTokens: 42,
              source: "provider",
            },
          },
        });
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(manager.sendMessage("Check the bridge")).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        streaming: true,
      }),
    );
    expect(toolCall).toHaveBeenCalledWith("call-1", "spira_ui_get_snapshot", {});
    expect(toolResult).toHaveBeenCalledWith("call-1", { activeView: "bridge" });
    expect(delta).toHaveBeenCalledWith("msg-1", "Snapshot captured.");
    expect(responseEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg-1",
        text: "Snapshot captured.",
      }),
    );
    expect(usage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "azure-openai",
        sessionId: "azure-session",
        totalTokens: 42,
        source: "provider",
      }),
    );
  });

  it("includes the current runtime model on final assistant responses when available", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const responseEnd = vi.fn();
    internals.session = {
      sessionId: "openai-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.hostContinuityState = {
      providerId: "openai-escalation",
      model: "gpt-5.4",
      updatedAt: 1_000,
      messages: [],
    };
    internals.bus.on("assistant:response-end", responseEnd);

    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-2",
        content: "Escalation confirmed.",
      },
    });

    expect(responseEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "assistant-2",
        text: "Escalation confirmed.",
        model: "gpt-5.4",
      }),
    );
  });

  it("publishes an assistant model update when observed usage arrives after the reply", () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const modelUpdate = vi.fn();
    internals.session = {
      sessionId: "openai-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.bus.on("assistant:message-model", modelUpdate);

    internals.handleSessionEvent({
      type: "assistant.message",
      data: {
        messageId: "assistant-3",
        content: "Observed model arrives later.",
      },
    });
    internals.handleSessionEvent({
      type: "session.idle",
      data: {
        usage: {
          model: "gpt-5.4",
          totalTokens: 42,
          source: "provider",
        },
      },
    });

    expect(modelUpdate).toHaveBeenCalledWith({
      messageId: "assistant-3",
      text: "Observed model arrives later.",
      timestamp: expect.any(Number),
      model: "gpt-5.4",
    });
  });

  it("uses Azure provider abort without clearing the live session", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue(null),
      save: vi.fn(),
    };
    const manager = createManager([], {
      sessionPersistence: persistence,
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "azure-session",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    internals.activeToolCalls.set("call-1", { toolName: "spira_ui_get_snapshot" });
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
    expect(internals.activeSessionId).toBe("azure-session");
    expect(internals.promptInFlight).toBe(false);
    expect(internals.activeToolCalls.size).toBe(0);
    expect(persistence.save).not.toHaveBeenCalled();
  });

  it("deletes a timed-out Azure session from the provider cache", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "azure-timeout",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "partial" as const,
        toolManifestMode: "literal" as const,
        modelSelection: "provider-default" as const,
        toolCalling: "native" as const,
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "azure-timeout";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.stopTimedOutTurn(session)).resolves.toBeUndefined();

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(client.deleteSession).toHaveBeenCalledWith("azure-timeout");
  });

  it("restores the last committed host continuity after an Azure timeout", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const committedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 900,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    const interruptedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [
        { role: "assistant", content: "Committed reply." },
        { role: "user", content: "Interrupted request" },
      ],
    };
    const session = {
      sessionId: "azure-timeout",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.client = client as never;
    internals.activeSessionId = "azure-timeout";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    internals.hostContinuityState = interruptedContinuity;
    internals.resumableHostContinuityState = committedContinuity;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.stopTimedOutTurn(session)).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(internals.hostContinuityState).toEqual(committedContinuity);
    expect(internals.resumableHostContinuityState).toEqual(committedContinuity);
    expect(persistedRuntimeContract?.hostContinuity).toEqual(committedContinuity);
  });

  it("persists and clears an abort marker around response cancellation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "copilot-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "copilot-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    expect(memory.runtimeStates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stationId: "primary",
          abortRequestedAt: expect.any(Number),
        }),
        expect.objectContaining({
          stationId: "primary",
          state: "idle",
          abortRequestedAt: null,
        }),
      ]),
    );
  });

  it("uses provider abort without disconnecting the live session when supported", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "copilot-session",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.activeSessionId = "copilot-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(internals.activeSessionId).toBe("copilot-session");
  });

  it("deletes the persisted SDK session when the user clears chat", async () => {
    const persistence = {
      load: vi.fn().mockReturnValue("persisted-session"),
      save: vi.fn(),
    };
    const manager = createManager([], { sessionPersistence: persistence });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "persisted-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.activeSessionId = "persisted-session";
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    await expect(manager.clearSession()).resolves.toBeUndefined();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.activeSessionId).toBeNull();
    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("persisted-session", "copilot");
    expect(persistence.save).toHaveBeenCalledWith(null);
  });

  it("prepends continuity context only for fresh sessions", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.sessionOrigin = "created";
    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(
      manager.sendMessage("Continue fixing the renderer", { continuityPreamble: "[Recovered context]\nPrior work." }),
    ).resolves.toBeUndefined();

    expect(session.send).toHaveBeenCalledWith({
      prompt: "[Recovered context]\nPrior work.\n\nCurrent user request:\nContinue fixing the renderer",
    });
  });

  it("maps auto-approved SDK permission requests to approve-once", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;

    await expect(
      internals.handlePermissionRequest({
        kind: "read",
        path: "README.md",
      }),
    ).resolves.toEqual({ kind: "approve-once" });
  });

  it("maps interactive permission approvals to approve-once", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "mcp",
      serverName: "Vision",
      toolName: "vision_read_screen",
      toolTitle: "Read screen",
      readOnly: true,
    });
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;

    expect(typeof requestId).toBe("string");
    expect(manager.resolvePermissionRequest(requestId, true)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "approve-once" });
  });

  it("requires interactive approval for host-owned mutating tools", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "custom-tool",
      toolName: "apply_patch",
      toolCallId: "call-1",
      args: { patch: "*** Begin Patch\n*** End Patch\n" },
    });
    const requestPayload = permissionRequest.mock.calls[0]?.[0];

    expect(requestPayload).toMatchObject({
      serverName: "Spira host runtime",
      toolName: "apply_patch",
      readOnly: false,
    });
    expect(manager.resolvePermissionRequest(requestPayload.requestId, true)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "approve-once" });
  });

  it("requires interactive approval for the manual escalation tool", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "custom-tool",
      toolName: "spira_escalate_session",
      toolCallId: "call-2",
      args: {},
    });
    const requestPayload = permissionRequest.mock.calls[0]?.[0];

    expect(requestPayload).toMatchObject({
      serverName: "Spira host runtime",
      toolName: "spira_escalate_session",
      readOnly: false,
    });
    expect(manager.resolvePermissionRequest(requestPayload.requestId, true)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "approve-once" });
  });

  it("maps interactive permission denials to reject", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const bus = (manager as unknown as { bus: SpiraEventBus }).bus;
    const permissionRequest = vi.fn();
    bus.on("assistant:permission-request", permissionRequest);
    internals.session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const response = internals.handlePermissionRequest({
      kind: "mcp",
      serverName: "Vision",
      toolName: "vision_read_screen",
      toolTitle: "Read screen",
      readOnly: true,
    });
    const requestId = permissionRequest.mock.calls[0]?.[0]?.requestId;

    expect(typeof requestId).toBe("string");
    expect(manager.resolvePermissionRequest(requestId, false)).toBe(true);
    await expect(response).resolves.toEqual({ kind: "reject" });
  });

  it("maps unavailable interactive approvals to user-not-available", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;

    await expect(
      internals.handlePermissionRequest({
        kind: "mcp",
        serverName: "Vision",
        toolName: "vision_read_screen",
        toolTitle: "Read screen",
        readOnly: true,
      }),
    ).resolves.toEqual({ kind: "user-not-available" });
  });

  it("does not prepend continuity context for resumed sessions", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "persisted-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.sessionOrigin = "resumed";
    vi.spyOn(
      manager as unknown as { getOrCreateSession: () => Promise<typeof session> },
      "getOrCreateSession",
    ).mockResolvedValue(session);

    await expect(
      manager.sendMessage("Continue fixing the renderer", { continuityPreamble: "[Recovered context]" }),
    ).resolves.toBeUndefined();

    expect(session.send).toHaveBeenCalledWith({
      prompt: "Continue fixing the renderer",
    });
  });

  it("builds host continuity context from the runtime checkpoint for host-managed providers", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });
    runtimeMemory.db.upsertRuntimeCheckpoint({
      checkpointId: "checkpoint-1",
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "session-summary",
      summary: "Recovered the last Azure-hosted station turn.",
      payload: createRuntimeCheckpointPayload({
        checkpointId: "checkpoint-1",
        kind: "session-summary",
        createdAt: 1_000,
        summary: "Recovered the last Azure-hosted station turn.",
        artifactRefs: runtimeSession.artifactRefs,
        turnState: runtimeSession.turnState,
        workflowState: runtimeSession.workflowState,
        permissionState: runtimeSession.permissionState,
        cancellationState: runtimeSession.cancellationState,
        usageSummary: runtimeSession.usageSummary,
        providerBinding: runtimeSession.providerBinding,
      }),
      createdAt: 1_000,
    });
    runtimeMemory.db.appendRuntimeLedgerEvent({
      eventId: "event-1",
      runtimeSessionId: "station:primary",
      stationId: "primary",
      type: "assistant.message",
      payload: {
        messageId: "assistant-1",
        content: "The renderer issue is isolated to the bridge panel.",
      },
      occurredAt: 1_100,
    });

    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "partial" as const,
        toolManifestMode: "literal" as const,
        modelSelection: "provider-default" as const,
        toolCalling: "native" as const,
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(
      manager.sendMessage("Continue fixing the renderer", {
        continuityPreamble: "[Recovered conversation memory]\nFallback conversation context.",
      }),
    ).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        systemMessage: expect.objectContaining({
          sections: expect.objectContaining({
            runtime_recovery: expect.objectContaining({
              content: expect.stringContaining("Recovered the last Azure-hosted station turn."),
            }),
          }),
        }),
      }),
    );
    expect(client.createSession.mock.calls[0]?.[0]?.systemMessage.sections.runtime_recovery.content).toContain(
      "The renderer issue is isolated to the bridge panel.",
    );
    expect(session.send).toHaveBeenCalledWith({
      prompt: "Continue fixing the renderer",
    });
  });

  it("rebuilds a fresh Azure session from persisted host continuity state", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manifestSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as {
          getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
        },
        "getCurrentToolManifest",
      )
      .mockReturnValue({
        hostManifestHash: "host-manifest-1",
        projectionHash: "projection-1",
      });
    const systemHashSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as { getCurrentSystemMessageHash(): string },
        "getCurrentSystemMessageHash",
      )
      .mockReturnValue("system-hash-1");
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        systemMessageHash: "system-hash-1",
        updatedAt: 1_000,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "First request" },
          { role: "assistant", content: "First reply" },
        ],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });

    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    try {
      await expect(
        manager.sendMessage("Second request", {
          continuityPreamble: "[Recovered conversation memory]\nFallback conversation context.",
        }),
      ).resolves.toBeUndefined();
    } finally {
      manifestSpy.mockRestore();
      systemHashSpy.mockRestore();
    }

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: expect.objectContaining({
          providerId: "azure-openai",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "First request" }),
            expect.objectContaining({ role: "assistant", content: "First reply" }),
          ]),
        }),
        systemMessage: expect.objectContaining({
          sections: expect.not.objectContaining({
            runtime_recovery: expect.anything(),
          }),
        }),
      }),
    );
    expect(session.send).toHaveBeenCalledWith({
      prompt: "Second request",
    });
  });

  it("does not reuse interrupted Azure host continuity state for a fresh session", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      turnState: {
        state: "thinking",
        activeToolCallIds: [],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: null,
      },
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        updatedAt: 1_000,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "Interrupted request" },
        ],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });

    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    await expect(manager.sendMessage("Second request")).resolves.toBeUndefined();

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: null,
      }),
    );
  });

  it("reuses committed Azure host continuity after restart from an error state", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manifestSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as {
          getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
        },
        "getCurrentToolManifest",
      )
      .mockReturnValue({
        hostManifestHash: "host-manifest-1",
        projectionHash: "projection-1",
      });
    const systemHashSpy = vi
      .spyOn(
        StationSessionManager.prototype as unknown as { getCurrentSystemMessageHash(): string },
        "getCurrentSystemMessageHash",
      )
      .mockReturnValue("system-hash-1");
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      turnState: {
        state: "error",
        activeToolCallIds: [],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: "assistant-1",
      },
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        systemMessageHash: "system-hash-1",
        updatedAt: 1_000,
        messages: [
          { role: "system", content: "Persisted system." },
          { role: "user", content: "Last committed request" },
          { role: "assistant", content: "Last committed reply" },
        ],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });

    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    try {
      await expect(manager.sendMessage("Second request")).resolves.toBeUndefined();
    } finally {
      manifestSpy.mockRestore();
      systemHashSpy.mockRestore();
    }

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: expect.objectContaining({
          providerId: "azure-openai",
          messages: expect.arrayContaining([
            expect.objectContaining({ role: "user", content: "Last committed request" }),
            expect.objectContaining({ role: "assistant", content: "Last committed reply" }),
          ]),
        }),
      }),
    );
  });

  it("forces a fresh Azure session after session.error so rolled-back continuity is reused", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const committedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      systemMessageHash: "system-hash-1",
      updatedAt: 900,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    const interruptedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [
        { role: "assistant", content: "Committed reply." },
        { role: "user", content: "Interrupted request" },
      ],
    };
    const createdSession = {
      sessionId: "azure-fresh",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.client = client as never;
    internals.session = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.hostContinuityState = interruptedContinuity;
    internals.resumableHostContinuityState = committedContinuity;
    internals.resumableHostContinuityHostManifestHash = "host-manifest-1";
    internals.resumableHostContinuityProjectionHash = "projection-1";
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);
    vi.spyOn(
      manager as unknown as { getCurrentSystemMessageHash(): string },
      "getCurrentSystemMessageHash",
    ).mockReturnValue("system-hash-1");
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "host-manifest-1",
      projectionHash: "projection-1",
    });

    internals.handleSessionEvent({
      type: "session.error",
      data: {
        errorType: "internal_error",
        message: "Azure blew a fuse.",
      },
    });
    await Promise.resolve();

    expect(client.deleteSession).toHaveBeenCalledWith("azure-session");
    expect(internals.activeSessionId).toBeNull();

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: expect.objectContaining({
          providerId: "azure-openai",
          messages: [expect.objectContaining({ role: "assistant", content: "Committed reply." })],
        }),
      }),
    );
  });

  it("does not reuse in-memory Azure continuity when the tool projection has changed", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const createdSession = {
      sessionId: "azure-fresh",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(createdSession),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.resumableHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    internals.resumableHostContinuityHostManifestHash = "old-host-manifest";
    internals.resumableHostContinuityProjectionHash = "old-projection";
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "new-host-manifest",
      projectionHash: "new-projection",
    });

    await expect(internals.createSession()).resolves.toBe(createdSession);

    expect(client.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        hostContinuity: null,
      }),
    );
  });

  it("clears Azure continuity instead of re-tagging it after session.error with projection drift", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.client = client as never;
    internals.session = {
      sessionId: "azure-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.boundHostManifestHash = "old-host-manifest";
    internals.boundProviderProjectionHash = "old-projection";
    internals.hostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      systemMessageHash: "system-hash-1",
      updatedAt: 1_000,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    internals.resumableHostContinuityState = internals.hostContinuityState;
    internals.resumableHostContinuityHostManifestHash = "old-host-manifest";
    internals.resumableHostContinuityProjectionHash = "old-projection";
    vi.spyOn(
      manager as unknown as { getCurrentSystemMessageHash(): string },
      "getCurrentSystemMessageHash",
    ).mockReturnValue("system-hash-1");
    vi.spyOn(
      manager as unknown as {
        getCurrentToolManifest: () => { hostManifestHash: string; projectionHash: string };
      },
      "getCurrentToolManifest",
    ).mockReturnValue({
      hostManifestHash: "new-host-manifest",
      projectionHash: "new-projection",
    });

    internals.handleSessionEvent({
      type: "session.error",
      data: {
        errorType: "internal_error",
        message: "Azure blew a fuse.",
      },
    });
    await Promise.resolve();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(persistedRuntimeContract?.hostContinuity).toBeNull();
  });

  it("persists Azure host continuity snapshots into the runtime session contract", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const session = {
      sessionId: "azure-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn().mockImplementation(async (config: ProviderSessionConfig & { sessionId: string }) => {
        config.onHostContinuitySnapshot?.({
          providerId: "azure-openai",
          model: "gpt-4.1",
          updatedAt: 1_000,
          messages: [
            { role: "system", content: "Persisted system." },
            { role: "user", content: "First request" },
            { role: "assistant", content: "First reply" },
          ],
        });
        return session;
      }),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(manager.sendMessage("Second request")).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(persistedRuntimeSession?.runtimeSessionId).toBe("station:primary");
    expect(persistedRuntimeContract?.hostContinuity).toMatchObject({
      providerId: "azure-openai",
      model: "gpt-4.1",
      messages: [
        { role: "system", content: "Persisted system." },
        { role: "user", content: "First request" },
        { role: "assistant", content: "First reply" },
      ],
    });
  });

  it("ignores late Azure host continuity snapshots from a torn-down session", () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const config = internals.getSessionConfig(undefined, {
      providerId: "azure-openai",
      capabilities: getDefaultProviderCapabilities("azure-openai"),
    }) as ProviderSessionConfig;

    internals.activeSessionId = "azure-session";
    internals.sessionTeardownEpoch += 1;
    config.onHostContinuitySnapshot?.({
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [{ role: "assistant", content: "Too late." }],
    });

    expect(internals.hostContinuityState).toBeNull();
    expect(runtimeMemory.runtimeSessions.get("station:primary")).toBeUndefined();
  });

  it("switches providers without changing the host runtime session id", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });

    await expect(manager.switchProvider("azure-openai")).resolves.toBeUndefined();

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
    });
    expect(runtimeMemory.runtimeLedgerEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          runtimeSessionId: "station:primary",
          type: "provider.switched",
          payload: expect.objectContaining({
            fromProviderId: "copilot",
            toProviderId: "azure-openai",
          }),
        }),
      ]),
    );
  });

  it("clears persisted Azure host continuity when switching providers", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const runtimeSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "azure-openai",
      providerCapabilities: getDefaultProviderCapabilities("azure-openai"),
      hostContinuity: {
        providerId: "azure-openai",
        model: "gpt-4.1",
        updatedAt: 1_000,
        messages: [{ role: "assistant", content: "Old Azure reply." }],
      },
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: runtimeSession,
    });
    const manager = createManager([], {
      memoryDb: runtimeMemory.db,
      stationId: "primary",
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
    });

    await expect(manager.switchProvider("copilot")).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    const providerBinding = persistedRuntimeContract?.providerBinding as Record<string, unknown> | undefined;
    expect(persistedRuntimeSession?.runtimeSessionId).toBe("station:primary");
    expect(persistedRuntimeContract?.hostContinuity).toBeNull();
    expect(providerBinding?.providerId).toBe("copilot");
  });

  it("deletes the previous provider-managed session before switching providers", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "active-copilot-session",
      send: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "copilot" as const,
      capabilities: getDefaultProviderCapabilities("copilot"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    internals.session = session as never;
    internals.client = client as never;
    internals.activeSessionId = "active-copilot-session";

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(manager.switchProvider("azure-openai")).resolves.toBeUndefined();

    expect(client.deleteSession).toHaveBeenCalledWith("active-copilot-session");
  });

  it("cleans up late-opened teardown sessions with the provider that created them", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals & {
      cleanupSessionOpenedDuringTeardown(
        session: { sessionId: string; disconnect: () => Promise<void> },
        providerId: "copilot" | "azure-openai",
      ): Promise<void>;
      providerOverride: "copilot" | "azure-openai" | null;
    };
    const session = {
      sessionId: "late-copilot-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.providerOverride = "azure-openai";
    internals.client = { providerId: "azure-openai", stop: vi.fn() } as never;

    const deletePersistedSession = vi
      .spyOn(
        manager as unknown as {
          deletePersistedSession(sessionId: string, providerId: "copilot" | "azure-openai"): Promise<void>;
        },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    await expect(internals.cleanupSessionOpenedDuringTeardown(session, "copilot")).resolves.toBeUndefined();

    expect(deletePersistedSession).toHaveBeenCalledWith("late-copilot-session", "copilot");
  });

  it("does not tear down the active session for a no-op provider switch", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "active-copilot-session",
      send: vi.fn(),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "copilot" as const,
      capabilities: getDefaultProviderCapabilities("copilot"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };
    internals.session = session as never;
    internals.client = client as never;

    await expect(manager.switchProvider("copilot")).resolves.toBeUndefined();

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
  });

  it("preserves a non-default provider override on a no-op switch", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    });
    const internals = manager as unknown as SessionManagerInternals & { providerOverride: string | null };
    internals.providerOverride = "azure-openai";

    await expect(manager.switchProvider("azure-openai")).resolves.toBeUndefined();

    expect(internals.providerOverride).toBe("azure-openai");
  });

  it("prefers the configured provider over a stale persisted runtime binding after restart", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const persistedSession = createRuntimeSessionContract({
      runtimeSessionId: "station:primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-manifest-1",
      providerProjectionHash: "projection-1",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
    });
    runtimeMemory.db.upsertRuntimeSession({
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "station",
      contract: persistedSession,
    });
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const createProviderClientForProvider = vi
      .spyOn(clientFactory, "createProviderClientForProvider")
      .mockResolvedValue({
        client: {
          providerId: "azure-openai",
          capabilities: getDefaultProviderCapabilities("azure-openai"),
          createSession: vi.fn(),
          resumeSession: vi.fn(),
          deleteSession: vi.fn(),
          getAuthStatus: vi.fn(),
          stop: vi.fn().mockResolvedValue([]),
        } as never,
        strategy: "azure-openai-key",
      });

    await expect((manager as unknown as { createClient(): Promise<unknown> }).createClient()).resolves.toBeDefined();

    expect(createProviderClientForProvider).toHaveBeenCalledWith(
      expect.any(Object),
      "azure-openai",
      expect.any(Object),
    );
  });

  it.each([
    {
      providerId: "copilot" as const,
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
        toolManifestMode: "projected" as const,
        modelSelection: "session-scoped" as const,
        toolCalling: "native" as const,
      },
    },
    {
      providerId: "azure-openai" as const,
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed" as const,
        turnCancellation: "provider-abort" as const,
        responseStreaming: "native" as const,
        usageReporting: "partial" as const,
        toolManifestMode: "literal" as const,
        modelSelection: "provider-default" as const,
        toolCalling: "native" as const,
      },
    },
  ])(
    "preserves host runtime identity across multi-turn station flows for $providerId",
    async ({ providerId, capabilities }) => {
      const runtimeMemory = createRuntimeMemoryDb();
      const manager = createManager([], {
        memoryDb: runtimeMemory.db,
        stationId: "primary",
        envInput: { SPIRA_MODEL_PROVIDER: providerId },
      });
      const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
      const usage = vi.fn();
      internals.bus.on("provider:usage", usage);

      let turnIndex = 0;
      const session = {
        sessionId: `${providerId}-station-session`,
        send: vi.fn().mockImplementation(async ({ prompt }: { prompt: string }) => {
          turnIndex += 1;
          expect(prompt).toBe(turnIndex === 1 ? "First turn" : "Second turn");
          internals.handleSessionEvent({
            type: "assistant.message",
            data: {
              messageId: `assistant-${turnIndex}`,
              content: `Reply ${turnIndex}`,
            },
          });
          internals.handleSessionEvent({
            type: "session.idle",
            data: {
              usage: {
                model: `${providerId}-model`,
                totalTokens: turnIndex * 10,
                source: "provider",
              },
            },
          });
        }),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
      const client = {
        providerId,
        capabilities,
        resumeSession: vi.fn(),
        createSession: vi.fn().mockResolvedValue(session),
        deleteSession: vi.fn(),
        getAuthStatus: vi.fn(),
        stop: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(
        manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
        "getOrCreateClient",
      ).mockResolvedValue(client);

      await expect(manager.sendMessage("First turn")).resolves.toBeUndefined();
      await expect(manager.sendMessage("Second turn")).resolves.toBeUndefined();

      expect(client.createSession).toHaveBeenCalledTimes(1);
      expect(session.send).toHaveBeenCalledTimes(2);
      expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
        runtimeSessionId: "station:primary",
        stationId: "primary",
        kind: "station",
        contract: expect.objectContaining({
          providerBinding: expect.objectContaining({
            providerId,
          }),
        }),
      });
      expect(runtimeMemory.runtimeLedgerEvents.filter((event) => event.type === "user.message")).toHaveLength(2);
      expect(runtimeMemory.runtimeLedgerEvents.filter((event) => event.type === "assistant.message")).toHaveLength(2);
      expect(runtimeMemory.runtimeLedgerEvents.filter((event) => event.type === "usage.recorded")).toHaveLength(2);
      expect(usage).toHaveBeenCalledTimes(2);
    },
  );

  it("recovers delegated subagents with their persisted working directory", () => {
    const manager = createManager([], { workingDirectory: "C:\\GitHub\\Spira\\station-worktree" } as never);
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: ReturnType<typeof vi.fn>;
      subagentRunners: Map<string, unknown>;
      recoverManagedSubagent(snapshot: Record<string, unknown>): unknown;
    };
    const recover = vi.fn().mockReturnValue({ write: vi.fn(), stop: vi.fn() });
    internals.subagentRunners = new Map();
    internals.createSubagentRunner = vi.fn().mockReturnValue({ recover });

    internals.recoverManagedSubagent({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      startedAt: 1000,
      updatedAt: 1100,
      workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
    });

    expect(internals.createSubagentRunner).toHaveBeenCalledWith(
      expect.objectContaining({ id: "spira" }),
      "C:\\GitHub\\Spira\\mission-worktree",
    );
    expect(recover).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
      }),
    );
    expect(internals.subagentRunners.size).toBe(1);
  });

  it("propagates provider switches to recovered delegated subagents", async () => {
    const manager = createManager([], {
      workingDirectory: "C:\\GitHub\\Spira\\station-worktree",
      envInput: { SPIRA_MODEL_PROVIDER: "copilot" },
    } as never);
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: ReturnType<typeof vi.fn>;
      subagentRunners: Map<string, unknown>;
      recoverManagedSubagent(snapshot: Record<string, unknown>): unknown;
    };
    const switchProvider = vi.fn().mockResolvedValue(undefined);
    const recover = vi.fn().mockReturnValue({ write: vi.fn(), stop: vi.fn() });
    internals.subagentRunners = new Map();
    internals.createSubagentRunner = vi.fn().mockReturnValue({ recover, switchProvider });

    internals.recoverManagedSubagent({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      startedAt: 1000,
      updatedAt: 1100,
      workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
    });

    await manager.switchProvider("azure-openai");

    expect(switchProvider).toHaveBeenCalledWith("azure-openai", "user-requested");
  });

  it("does not cache recovered subagent runners when recovery fails closed", () => {
    const manager = createManager([], { workingDirectory: "C:\\GitHub\\Spira\\station-worktree" } as never);
    const internals = manager as unknown as SessionManagerInternals & {
      createSubagentRunner: ReturnType<typeof vi.fn>;
      subagentRunners: Map<string, unknown>;
      recoverManagedSubagent(snapshot: Record<string, unknown>): unknown;
    };
    internals.subagentRunners = new Map();
    internals.createSubagentRunner = vi.fn().mockReturnValue({ recover: vi.fn().mockReturnValue(null) });

    const recovered = internals.recoverManagedSubagent({
      agent_id: "run-recovered",
      runId: "run-recovered",
      roomId: "agent:subagent-run-recovered",
      domain: "spira",
      task: "Inspect Spira",
      status: "idle",
      startedAt: 1000,
      updatedAt: 1100,
      workingDirectory: "C:\\GitHub\\Spira\\mission-worktree",
    });

    expect(recovered).toBeNull();
    expect(internals.subagentRunners.size).toBe(0);
  });

  it("does not retry non-session-not-found send failures", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      send: vi.fn().mockImplementation(async () => {
        internals.handleSessionEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "call-1",
            toolName: "view",
            arguments: {},
          },
        });
        throw new Error("Boom");
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof session> }, "getOrCreateSession")
      .mockResolvedValue(session);

    await expect(manager.sendMessage("hello")).rejects.toBeInstanceOf(AssistantError);

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(1);
    expect(internals.activeToolCalls.size).toBe(0);
  });

  it("allows tool-active turns to continue well past twenty seconds", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const internals = manager as unknown as SessionManagerInternals;
      const session = {
        sessionId: "test-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_start",
                  data: {
                    toolCallId: "call-1",
                    toolName: "view",
                    arguments: {},
                  },
                });
              }, 10_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_complete",
                  data: {
                    toolCallId: "call-1",
                    success: true,
                    result: { lines: 1 },
                  },
                });
              }, 11_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "assistant.message_delta",
                  data: {
                    messageId: "message-1",
                    deltaContent: "Done.",
                  },
                });
              }, 25_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "assistant.message",
                  data: {
                    messageId: "message-1",
                    content: "Done.",
                  },
                });
              }, 25_100);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "session.idle",
                  data: {},
                });
                resolve();
              }, 40_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      internals.session = session;

      const sendPromise = manager.sendMessage("hello");
      await vi.advanceTimersByTimeAsync(41_000);

      await expect(sendPromise).resolves.toBeUndefined();
      expect(session.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not time out while a tool is still running", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const internals = manager as unknown as SessionManagerInternals;
      const session = {
        sessionId: "test-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_start",
                  data: {
                    toolCallId: "call-1",
                    toolName: "powershell",
                    arguments: { command: "pnpm test" },
                  },
                });
              }, 10_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "tool.execution_complete",
                  data: {
                    toolCallId: "call-1",
                    success: true,
                    result: { exitCode: 0 },
                  },
                });
              }, 140_000);
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "session.idle",
                  data: {},
                });
                resolve();
              }, 141_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      internals.session = session;

      const sendPromise = manager.sendMessage("hello");
      await vi.advanceTimersByTimeAsync(142_000);

      await expect(sendPromise).resolves.toBeUndefined();
      expect(session.disconnect).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out stalled turns after activity stops", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const internals = manager as unknown as SessionManagerInternals;
      const session = {
        sessionId: "test-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>(() => {
              setTimeout(() => {
                internals.handleSessionEvent({
                  type: "assistant.message_delta",
                  data: {
                    messageId: "message-1",
                    deltaContent: "Working",
                  },
                });
              }, 10_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      internals.session = session;

      const sendPromise = manager.sendMessage("hello");
      const sendExpectation = expect(sendPromise).rejects.toThrow("Turn stalled while waiting for activity");
      await vi.advanceTimersByTimeAsync(131_000);

      await sendExpectation;
      expect(session.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the same watchdog budget across a missing-session retry", async () => {
    vi.useFakeTimers();
    try {
      const manager = createManager([]);
      const staleSession = {
        sessionId: "stale-session",
        send: vi.fn().mockImplementation(
          () =>
            new Promise<void>((_resolve, reject) => {
              setTimeout(() => {
                reject(new Error("Request session.send failed with message: Session not found: stale-session"));
              }, 119_000);
            }),
        ),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };
      const freshSession = {
        sessionId: "fresh-session",
        send: vi.fn().mockImplementation(() => new Promise<void>(() => undefined)),
        disconnect: vi.fn().mockResolvedValue(undefined),
      };

      vi.spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
        .mockResolvedValueOnce(staleSession)
        .mockResolvedValueOnce(freshSession);

      const sendPromise = manager.sendMessage("hello");
      const sendExpectation = expect(sendPromise).rejects.toThrow("Timed out while waiting");

      await vi.advanceTimersByTimeAsync(119_000);
      await vi.advanceTimersByTimeAsync(2_000);

      await sendExpectation;
      expect(staleSession.send).toHaveBeenCalledTimes(1);
      expect(freshSession.send).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts an in-flight response without surfacing an error", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    let rejectSend: ((error: Error) => void) | undefined;
    const session = {
      sessionId: "test-session",
      send: vi.fn().mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectSend = reject;
          }),
      ),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: true,
        abortableTurns: false,
        sessionResumption: "provider-managed" as const,
        turnCancellation: "disconnect-and-reset" as const,
        responseStreaming: "native" as const,
        usageReporting: "full" as const,
        toolManifestMode: "projected" as const,
        modelSelection: "session-scoped" as const,
        toolCalling: "native" as const,
      },
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    const sendPromise = manager.sendMessage("hello");
    for (let index = 0; index < 5 && !rejectSend; index += 1) {
      await Promise.resolve();
    }

    const abortPromise = internals.abortResponse();
    rejectSend?.(new Error("Aborted by test"));

    await expect(abortPromise).resolves.toBeUndefined();
    await expect(sendPromise).resolves.toBeUndefined();
    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.currentState).toBe("idle");
  });

  it("allows a fresh Azure turn after provider abort on the same session", async () => {
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const delta = vi.fn();
    internals.bus.on("assistant:delta", delta);
    let rejectFirstSend: ((error: Error) => void) | undefined;
    const session = {
      sessionId: "azure-session",
      send: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectFirstSend = reject;
            }),
        )
        .mockImplementationOnce(async () => {
          internals.handleSessionEvent({
            type: "assistant.message_delta",
            data: {
              messageId: "fresh-1",
              deltaContent: "Fresh reply",
            },
          });
          internals.handleSessionEvent({
            type: "assistant.message",
            data: {
              messageId: "fresh-1",
              content: "Fresh reply",
            },
          });
          internals.handleSessionEvent({
            type: "session.idle",
            data: {},
          });
        }),
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      capabilities: {
        persistentSessions: false,
        abortableTurns: true,
        sessionResumption: "host-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
      resumeSession: vi.fn(),
      createSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    const firstSend = manager.sendMessage("First");
    for (let index = 0; index < 5 && session.send.mock.calls.length === 0; index += 1) {
      await Promise.resolve();
    }
    internals.session = session;
    await expect(internals.abortResponse()).resolves.toBeUndefined();
    const secondSend = manager.sendMessage("Second");
    rejectFirstSend?.(new Error("Session not found: disconnected"));
    await expect(firstSend).resolves.toBeUndefined();
    await expect(secondSend).resolves.toBeUndefined();
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.disconnect).not.toHaveBeenCalled();
    expect(session.send).toHaveBeenCalledTimes(2);
    expect(delta).toHaveBeenCalledWith("fresh-1", "Fresh reply");
  });

  it("restores the last committed host continuity after Azure abort", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "azure-openai" },
      memoryDb: runtimeMemory.db,
      stationId: "primary",
    });
    const internals = manager as unknown as SessionManagerInternals;
    const committedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 900,
      messages: [{ role: "assistant", content: "Committed reply." }],
    };
    const interruptedContinuity: ProviderHostContinuityState = {
      providerId: "azure-openai",
      model: "gpt-4.1",
      updatedAt: 1_000,
      messages: [
        { role: "assistant", content: "Committed reply." },
        { role: "user", content: "Interrupted request" },
      ],
    };
    const session = {
      sessionId: "azure-session",
      abort: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      providerId: "azure-openai" as const,
      capabilities: getDefaultProviderCapabilities("azure-openai"),
      resumeSession: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getAuthStatus: vi.fn(),
      stop: vi.fn().mockResolvedValue([]),
    };

    internals.session = session;
    internals.client = client as never;
    internals.activeSessionId = "azure-session";
    internals.currentState = "thinking";
    internals.promptInFlight = true;
    internals.hostContinuityState = interruptedContinuity;
    internals.resumableHostContinuityState = committedContinuity;
    vi.spyOn(
      manager as unknown as { getOrCreateClient: () => Promise<typeof client> },
      "getOrCreateClient",
    ).mockResolvedValue(client);

    await expect(internals.abortResponse()).resolves.toBeUndefined();

    const persistedRuntimeSession = runtimeMemory.runtimeSessions.get("station:primary");
    const persistedRuntimeContract = persistedRuntimeSession?.contract as Record<string, unknown> | undefined;
    expect(internals.hostContinuityState).toEqual(committedContinuity);
    expect(internals.resumableHostContinuityState).toEqual(committedContinuity);
    expect(persistedRuntimeContract?.hostContinuity).toEqual(committedContinuity);
  });

  it("does not retry a missing session after tool activity was already observed", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const staleSession = {
      sessionId: "stale-session",
      send: vi.fn().mockImplementation(async () => {
        internals.handleSessionEvent({
          type: "tool.execution_start",
          data: {
            toolCallId: "call-1",
            toolName: "spira_ui_get_snapshot",
            arguments: {},
          },
        });
        internals.handleSessionEvent({
          type: "tool.execution_complete",
          data: {
            toolCallId: "call-1",
            success: true,
            result: { activeView: "bridge" },
          },
        });
        throw new Error("Request session.send failed with message: Session not found: stale-session");
      }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = staleSession;
    internals.activeSessionId = "stale-session";
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
      .mockResolvedValueOnce(staleSession)
      .mockResolvedValueOnce(freshSession);

    await expect(manager.sendMessage("hello")).rejects.toBeInstanceOf(AssistantError);

    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(1);
    expect(freshSession.send).not.toHaveBeenCalled();
  });

  it("does not retry a recovered send after the response is aborted", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals;
    const staleSession = {
      sessionId: "stale-session",
      send: vi
        .fn()
        .mockRejectedValue(new Error("Request session.send failed with message: Session not found: stale-session")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const freshSession = {
      sessionId: "fresh-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = staleSession;
    const getOrCreateSessionSpy = vi
      .spyOn(manager as unknown as { getOrCreateSession: () => Promise<typeof staleSession> }, "getOrCreateSession")
      .mockResolvedValueOnce(staleSession)
      .mockImplementationOnce(async () => {
        await internals.abortResponse();
        return freshSession;
      });

    await expect(manager.sendMessage("hello")).resolves.toBeUndefined();

    expect(staleSession.send).toHaveBeenCalledTimes(1);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(freshSession.send).not.toHaveBeenCalled();
    expect(getOrCreateSessionSpy).toHaveBeenCalledTimes(2);
  });

  it("suppresses copilot errors when clearSession tears down a missing-session retry", async () => {
    const manager = createManager([]);
    const internals = manager as unknown as SessionManagerInternals & { bus: SpiraEventBus };
    const staleSession = {
      sessionId: "stale-session",
      send: vi
        .fn()
        .mockRejectedValue(new Error("Request session.send failed with message: Session not found: stale-session")),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const reportedError = vi.fn();

    internals.session = staleSession;
    internals.activeSessionId = "stale-session";
    internals.bus.on("assistant:error", reportedError);
    vi.spyOn(
      manager as unknown as { invalidateExpiredSession: (session: typeof staleSession) => Promise<void> },
      "invalidateExpiredSession",
    ).mockImplementation(async () => {
      await manager.clearSession();
    });

    await expect(manager.sendMessage("hello")).resolves.toBeUndefined();

    expect(staleSession.send).toHaveBeenCalledTimes(1);
    expect(staleSession.disconnect).toHaveBeenCalledTimes(1);
    expect(reportedError).not.toHaveBeenCalled();
  });
});
