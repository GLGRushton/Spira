import {
  type McpTool,
  type SubagentDomain,
  type WorkSessionClassification,
  type WorkSessionSnapshot,
  parseEnv,
} from "@spira/shared";
import { vi } from "vitest";
import { createWorkSessionStorage, isWorkSessionSnapshot } from "../coding/work-session-storage.js";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import * as clientFactory from "../provider/client-factory.js";
import type { ProviderHostContinuityState, ProviderSessionConfig } from "../provider/types.js";
import { AssistantError } from "../util/errors.js";
import { SpiraEventBus } from "../util/event-bus.js";
import {
  type RuntimeWorkflowState,
  createRuntimeCheckpointPayload,
  createRuntimeSessionContract,
} from "./runtime-contract.js";
import { StationSessionManager } from "./session-manager.js";

export {
  AssistantError,
  SpiraEventBus,
  StationSessionManager,
  clientFactory,
  createRuntimeCheckpointPayload,
  createRuntimeSessionContract,
  createWorkSessionStorage,
  getDefaultProviderCapabilities,
  isWorkSessionSnapshot,
};
export type {
  McpTool,
  ProviderHostContinuityState,
  ProviderSessionConfig,
  RuntimeWorkflowState,
  SubagentDomain,
  WorkSessionClassification,
  WorkSessionSnapshot,
};

export type SessionManagerInternals = {
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

export const createManager = (
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
    isAutoApprovePermissionsEnabled?: () => boolean;
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
        isAutoApprovePermissionsEnabled: options.isAutoApprovePermissionsEnabled,
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

export const createRuntimeMemoryDb = (initialState: Record<string, unknown> | null = null) => {
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
      getRuntimePermissionRequest: (requestId: string) => runtimePermissionRequests.get(requestId) ?? null,
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
