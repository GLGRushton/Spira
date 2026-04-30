import { randomUUID } from "node:crypto";
import type {
  AppendProviderUsageRecordInput,
  PersistedRuntimeCheckpointRecord,
  PersistedRuntimeHostResourceRecord,
  PersistedRuntimeLedgerEventRecord,
  PersistedRuntimeSessionRecord,
  RuntimeStationStateRecord,
  RuntimeHostResourceStatus,
  RuntimePermissionRequestStatus,
  RuntimeRecoverySummary,
  SpiraMemoryDatabase,
  UpsertRuntimeHostResourceInput,
  UpsertRuntimeStationStateInput,
  UpsertRuntimePermissionRequestInput,
  UpsertRuntimeSessionInput,
  UpsertRuntimeSubagentRunInput,
} from "@spira/memory-db";
import type { Env, PermissionRequestPayload, StationId, SubagentRunSnapshot } from "@spira/shared";
import { createProviderClientForProvider, stopProviderClient } from "../provider/client-factory.js";
import type { ProviderUsageRecord } from "../provider/types.js";
import { createLogger } from "../util/logger.js";
import type {
  RuntimeCheckpointPayload,
  RuntimeLedgerEvent,
  RuntimeSessionContract,
} from "./runtime-contract.js";
import { createRuntimeLedgerEvent } from "./runtime-contract.js";
import { resolveSubagentProviderBinding } from "./provider-binding.js";
import { getStationRuntimeSessionId, getSubagentRuntimeSessionId } from "./runtime-session-ids.js";

const logger = createLogger("runtime-store");
const PENDING_PROVIDER_SESSION_CLEANUP_KEY = "runtime.provider-session-cleanup";
type PendingProviderSessionCleanup = { providerId: "copilot" | "azure-openai"; sessionId: string };
const collectErrorMessages = (error: unknown, depth = 0): string[] => {
  if (depth > 5 || error === null || error === undefined) {
    return [];
  }
  if (typeof error === "string") {
    return [error];
  }
  if (error instanceof Error) {
    const messages = [error.message];
    if ("cause" in error && error.cause !== undefined) {
      messages.push(...collectErrorMessages(error.cause, depth + 1));
    }
    return messages;
  }
  return [];
};
const isMissingProviderSessionError = (error: unknown): boolean =>
  collectErrorMessages(error).some((message) => message.includes("Session not found:"));

export class RuntimeStore {
  private static readonly pendingProviderSessionCleanupDrains = new WeakMap<
    SpiraMemoryDatabase,
    { active: Promise<void> | null; requested: boolean }
  >();

  constructor(
    private readonly memoryDb: SpiraMemoryDatabase | null,
    private readonly stationId: StationId | null = null,
  ) {}

  forStation(stationId: StationId | null): RuntimeStore {
    return new RuntimeStore(this.memoryDb, stationId);
  }

  getStationRuntimeSessionId(): string | null {
    return this.stationId ? getStationRuntimeSessionId(this.stationId) : null;
  }

  getSubagentRuntimeSessionId(runId: string): string {
    return getSubagentRuntimeSessionId(runId);
  }

  static async recoverInterruptedState(
    memoryDb: SpiraMemoryDatabase | null,
    env: Env | null,
    now = Date.now(),
  ): Promise<RuntimeRecoverySummary> {
    if (!memoryDb) {
      return {
        expiredPermissionRequestIds: [],
        recoveredSubagentRunIds: [],
        recoveredStationIds: [],
        unrecoverableHostResourceIds: [],
      };
    }
    const orphanedProviderSessions = this.mergePendingProviderSessionCleanup(
      this.getPendingProviderSessionCleanup(memoryDb),
      memoryDb
        .listRuntimeStationStates()
        .filter(
          (record) =>
            record.activeSessionId &&
            record.providerId &&
            (record.promptInFlight ||
              record.state === "thinking" ||
              record.activeToolCalls.length > 0 ||
              record.abortRequestedAt),
        )
        .map((record) => ({
          providerId: record.providerId!,
          sessionId: record.activeSessionId!,
        })),
      memoryDb
        .listRuntimeSubagentRuns()
        .filter((record) => record.snapshot.status === "running")
        .flatMap((record) => {
          const runtimeSession = memoryDb.getRuntimeSession(getSubagentRuntimeSessionId(record.runId));
          const contract = (runtimeSession?.contract ?? null) as Partial<RuntimeSessionContract> | null;
          const stationRuntimeSession =
            record.stationId !== null && record.stationId !== undefined
              ? memoryDb.getRuntimeSession(getStationRuntimeSessionId(record.stationId))?.contract ?? null
              : null;
          const { providerId, providerSessionId } = resolveSubagentProviderBinding(
            record.snapshot,
            contract?.providerBinding
              ? {
                  providerBinding: contract.providerBinding as RuntimeSessionContract["providerBinding"],
                  providerSwitches: (contract.providerSwitches ?? []) as RuntimeSessionContract["providerSwitches"],
                }
              : null,
            stationRuntimeSession &&
              "providerBinding" in stationRuntimeSession &&
              "providerSwitches" in stationRuntimeSession
              ? {
                  providerBinding: stationRuntimeSession.providerBinding as RuntimeSessionContract["providerBinding"],
                  providerSwitches: stationRuntimeSession.providerSwitches as RuntimeSessionContract["providerSwitches"],
                }
              : null,
          );
          return providerId && providerSessionId
            ? [{ providerId, sessionId: providerSessionId }]
            : [];
        }),
    );
    const summary = memoryDb.recoverInterruptedRuntimeState(now);
    const remainingCleanup = env
      ? await this.cleanupProviderSessions(orphanedProviderSessions, env)
      : orphanedProviderSessions;
    this.setPendingProviderSessionCleanup(memoryDb, remainingCleanup);
    for (const resourceId of summary.unrecoverableHostResourceIds) {
      const resource = memoryDb.getRuntimeHostResource(resourceId);
      if (!resource || resource.kind !== "powershell") {
        continue;
      }
      const event = createRuntimeLedgerEvent({
        eventId: randomUUID(),
        sessionId: resource.runtimeSessionId,
        occurredAt: resource.updatedAt,
        type: "host.resource_recorded",
        payload: {
          resourceId: resource.resourceId,
          kind: "powershell",
          status: resource.status,
          outputCursor:
            typeof resource.state === "object" &&
            resource.state !== null &&
            "outputCursor" in resource.state &&
            typeof resource.state.outputCursor === "number"
              ? resource.state.outputCursor
              : undefined,
        },
      });
      memoryDb.appendRuntimeLedgerEvent({
        eventId: event.eventId,
        runtimeSessionId: resource.runtimeSessionId,
        stationId: resource.stationId,
        runId: null,
        type: event.type,
        payload: event.payload as unknown as Record<string, unknown>,
        occurredAt: event.occurredAt,
      });
    }
    return summary;
  }

  queueProviderSessionCleanup(providerId: "copilot" | "azure-openai", sessionId: string): void {
    if (!this.memoryDb || typeof this.memoryDb.getSessionState !== "function" || typeof this.memoryDb.setSessionState !== "function") {
      return;
    }
    const merged = RuntimeStore.mergePendingProviderSessionCleanup(
      RuntimeStore.getPendingProviderSessionCleanup(this.memoryDb),
      [{ providerId, sessionId }],
    );
    RuntimeStore.setPendingProviderSessionCleanup(this.memoryDb, merged);
  }

  clearPendingProviderSessionCleanup(providerId: "copilot" | "azure-openai", sessionId: string): void {
    if (!this.memoryDb || typeof this.memoryDb.getSessionState !== "function" || typeof this.memoryDb.setSessionState !== "function") {
      return;
    }
    const remaining = RuntimeStore.getPendingProviderSessionCleanup(this.memoryDb).filter(
      (record) => !(record.providerId === providerId && record.sessionId === sessionId),
    );
    RuntimeStore.setPendingProviderSessionCleanup(this.memoryDb, remaining);
  }

  async drainPendingProviderSessionCleanup(env: Env): Promise<void> {
    if (!this.memoryDb) {
      return;
    }
    const drainState = RuntimeStore.getPendingProviderSessionCleanupDrainState(this.memoryDb);
    drainState.requested = true;
    if (drainState.active) {
      await drainState.active;
      return;
    }
    const memoryDb = this.memoryDb;
    drainState.active = (async () => {
      while (drainState.requested) {
        drainState.requested = false;
        const queued = RuntimeStore.getPendingProviderSessionCleanup(memoryDb);
        if (queued.length === 0) {
          continue;
        }
        const remaining = await RuntimeStore.cleanupProviderSessions(queued, env);
        const cleared = queued.filter(
          (record) => !remaining.some((candidate) => RuntimeStore.isSamePendingProviderSessionCleanup(record, candidate)),
        );
        const preserved = RuntimeStore.getPendingProviderSessionCleanup(memoryDb).filter(
          (record) => !cleared.some((candidate) => RuntimeStore.isSamePendingProviderSessionCleanup(record, candidate)),
        );
        RuntimeStore.setPendingProviderSessionCleanup(
          memoryDb,
          RuntimeStore.mergePendingProviderSessionCleanup(preserved, remaining),
        );
      }
    })().finally(() => {
      drainState.active = null;
    });
    await drainState.active;
  }

  getStationRuntimeState(): RuntimeStationStateRecord | null {
    if (!this.memoryDb || !this.stationId) {
      return null;
    }
    return this.memoryDb.getRuntimeStationState(this.stationId);
  }

  persistStationRuntimeState(input: Omit<UpsertRuntimeStationStateInput, "stationId">): void {
    if (!this.memoryDb || !this.stationId) {
      return;
    }
    this.memoryDb.upsertRuntimeStationState({
      stationId: this.stationId,
      ...input,
    });
  }

  persistPermissionRequest(payload: PermissionRequestPayload, createdAt = Date.now()): void {
    if (!this.memoryDb) {
      return;
    }
    const input: UpsertRuntimePermissionRequestInput = {
      requestId: payload.requestId,
      stationId: this.stationId ?? payload.stationId ?? null,
      payload: {
        ...payload,
        ...(this.stationId ? { stationId: this.stationId } : {}),
      },
      createdAt,
    };
    this.memoryDb.upsertRuntimePermissionRequest(input);
  }

  resolvePermissionRequest(
    requestId: string,
    status: Exclude<RuntimePermissionRequestStatus, "pending">,
    resolvedAt = Date.now(),
  ): void {
    this.memoryDb?.resolveRuntimePermissionRequest(requestId, status, resolvedAt);
  }

  listPersistedSubagentRuns(): SubagentRunSnapshot[] {
    return (this.memoryDb?.listRuntimeSubagentRuns(this.stationId) ?? []).map((record) => record.snapshot);
  }

  persistSubagentRun(snapshot: SubagentRunSnapshot, createdAt = snapshot.startedAt): void {
    if (!this.memoryDb) {
      return;
    }
    const input: UpsertRuntimeSubagentRunInput = {
      runId: snapshot.runId,
      stationId: this.stationId,
      snapshot,
      createdAt,
    };
    this.memoryDb.upsertRuntimeSubagentRun(input);
  }

  deleteSubagentRun(runId: string): void {
    this.memoryDb?.deleteRuntimeSubagentRun(runId);
  }

  getRuntimeSession(runtimeSessionId: string): RuntimeSessionContract | null {
    const record = this.memoryDb?.getRuntimeSession(runtimeSessionId) ?? null;
    return record ? this.toRuntimeSessionContract(record) : null;
  }

  persistRuntimeSession(
    input: Omit<UpsertRuntimeSessionInput, "contract"> & { contract: RuntimeSessionContract },
  ): RuntimeSessionContract | null {
    if (!this.memoryDb) {
      return null;
    }
    const record = this.memoryDb.upsertRuntimeSession({
      ...input,
      contract: input.contract as unknown as Record<string, unknown>,
    });
    return this.toRuntimeSessionContract(record);
  }

  appendRuntimeLedgerEvent(event: RuntimeLedgerEvent): RuntimeLedgerEvent | null {
    if (!this.memoryDb) {
      return null;
    }
    const scope = this.getScopeFromLedgerEvent(event);
    const record = this.memoryDb.appendRuntimeLedgerEvent({
      eventId: event.eventId,
      runtimeSessionId: event.sessionId,
      stationId: scope.stationId,
      runId: scope.runId,
      type: event.type,
      payload: event.payload as unknown as Record<string, unknown>,
      occurredAt: event.occurredAt,
    });
    return this.toRuntimeLedgerEvent(record);
  }

  listRuntimeLedgerEvents(runtimeSessionId: string): RuntimeLedgerEvent[] {
    return (this.memoryDb?.listRuntimeLedgerEvents(runtimeSessionId) ?? []).map((record) =>
      this.toRuntimeLedgerEvent(record),
    );
  }

  persistRuntimeCheckpoint(
    runtimeSessionId: string,
    payload: RuntimeCheckpointPayload,
    scope: { stationId?: string | null; runId?: string | null } = {},
  ): RuntimeCheckpointPayload | null {
    if (!this.memoryDb) {
      return null;
    }
    const record = this.memoryDb.upsertRuntimeCheckpoint({
      checkpointId: payload.checkpointId,
      runtimeSessionId,
      stationId: scope.stationId ?? null,
      runId: scope.runId ?? null,
      kind: payload.kind,
      summary: payload.summary,
      payload: payload as unknown as Record<string, unknown>,
      createdAt: payload.createdAt,
    });
    return this.toRuntimeCheckpointPayload(record);
  }

  getLatestRuntimeCheckpoint(runtimeSessionId: string): RuntimeCheckpointPayload | null {
    const record = this.memoryDb?.getLatestRuntimeCheckpoint(runtimeSessionId) ?? null;
    return record ? this.toRuntimeCheckpointPayload(record) : null;
  }

  upsertRuntimeHostResource(
    input: UpsertRuntimeHostResourceInput,
  ): PersistedRuntimeHostResourceRecord | null {
    if (!this.memoryDb) {
      return null;
    }
    return this.memoryDb.upsertRuntimeHostResource(input);
  }

  listRuntimeHostResources(runtimeSessionId: string): PersistedRuntimeHostResourceRecord[] {
    return this.memoryDb?.listRuntimeHostResources(runtimeSessionId) ?? [];
  }

  getRuntimeHostResource(resourceId: string): PersistedRuntimeHostResourceRecord | null {
    return this.memoryDb?.getRuntimeHostResource(resourceId) ?? null;
  }

  deleteRuntimeHostResource(resourceId: string): boolean {
    return this.memoryDb?.deleteRuntimeHostResource(resourceId) ?? false;
  }

  persistProviderUsage(record: ProviderUsageRecord): void {
    if (!this.memoryDb) {
      return;
    }
    const input: AppendProviderUsageRecordInput = {
      provider: record.provider,
      stationId: record.stationId ?? this.stationId ?? null,
      runId: record.runId ?? null,
      sessionId: record.sessionId ?? null,
      model: record.model ?? null,
      inputTokens: record.inputTokens ?? null,
      outputTokens: record.outputTokens ?? null,
      totalTokens: record.totalTokens ?? null,
      estimatedCostUsd: record.estimatedCostUsd ?? null,
      latencyMs: record.latencyMs ?? null,
      observedAt: record.observedAt,
      source: record.source,
    };
    this.memoryDb.appendProviderUsageRecord(input);
  }

  private toRuntimeSessionContract(record: PersistedRuntimeSessionRecord): RuntimeSessionContract {
    return record.contract as unknown as RuntimeSessionContract;
  }

  private toRuntimeCheckpointPayload(record: PersistedRuntimeCheckpointRecord): RuntimeCheckpointPayload {
    return record.payload as unknown as RuntimeCheckpointPayload;
  }

  private toRuntimeLedgerEvent(record: PersistedRuntimeLedgerEventRecord): RuntimeLedgerEvent {
    return {
      eventId: record.eventId,
      sessionId: record.runtimeSessionId,
      occurredAt: record.occurredAt,
      type: record.type as RuntimeLedgerEvent["type"],
      payload: record.payload as RuntimeLedgerEvent["payload"],
    } as RuntimeLedgerEvent;
  }

  private getScopeFromLedgerEvent(event: RuntimeLedgerEvent): { stationId: string | null; runId: string | null } {
    switch (event.type) {
      case "session.created":
        return {
          stationId: event.payload.scope.stationId ?? null,
          runId: event.payload.scope.runId ?? null,
        };
      default: {
        const runtimeSession = this.getRuntimeSession(event.sessionId);
        return {
          stationId: runtimeSession?.scope.stationId ?? this.stationId ?? null,
          runId: runtimeSession?.scope.runId ?? null,
        };
      }
    }
  }

  private static getPendingProviderSessionCleanup(memoryDb: SpiraMemoryDatabase): PendingProviderSessionCleanup[] {
    if (typeof memoryDb.getSessionState !== "function") {
      return [];
    }
    const raw = memoryDb.getSessionState(PENDING_PROVIDER_SESSION_CLEANUP_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !("providerId" in entry) ||
          !("sessionId" in entry) ||
          (entry.providerId !== "copilot" && entry.providerId !== "azure-openai") ||
          typeof entry.sessionId !== "string" ||
          entry.sessionId.trim().length === 0
        ) {
          return [];
        }
        return [{ providerId: entry.providerId, sessionId: entry.sessionId.trim() }];
      });
    } catch {
      return [];
    }
  }

  private static setPendingProviderSessionCleanup(
    memoryDb: SpiraMemoryDatabase,
    cleanup: PendingProviderSessionCleanup[],
  ): void {
    if (typeof memoryDb.setSessionState !== "function") {
      return;
    }
    memoryDb.setSessionState(
      PENDING_PROVIDER_SESSION_CLEANUP_KEY,
      cleanup.length > 0 ? JSON.stringify(cleanup) : null,
    );
  }

  private static mergePendingProviderSessionCleanup(
    ...groups: PendingProviderSessionCleanup[][]
  ): PendingProviderSessionCleanup[] {
    const merged = new Map<string, PendingProviderSessionCleanup>();
    for (const group of groups) {
      for (const record of group) {
        merged.set(`${record.providerId}:${record.sessionId}`, record);
      }
    }
    return [...merged.values()];
  }

  private static isSamePendingProviderSessionCleanup(
    left: PendingProviderSessionCleanup,
    right: PendingProviderSessionCleanup,
  ): boolean {
    return left.providerId === right.providerId && left.sessionId === right.sessionId;
  }

  private static getPendingProviderSessionCleanupDrainState(memoryDb: SpiraMemoryDatabase): {
    active: Promise<void> | null;
    requested: boolean;
  } {
    const existing = this.pendingProviderSessionCleanupDrains.get(memoryDb);
    if (existing) {
      return existing;
    }
    const created = { active: null, requested: false };
    this.pendingProviderSessionCleanupDrains.set(memoryDb, created);
    return created;
  }

  private static async cleanupProviderSessions(
    sessions: PendingProviderSessionCleanup[],
    env: Env,
  ): Promise<PendingProviderSessionCleanup[]> {
    const cleanupByProvider = new Map<"copilot" | "azure-openai", Set<string>>();
    for (const session of sessions) {
      const bucket = cleanupByProvider.get(session.providerId) ?? new Set<string>();
      bucket.add(session.sessionId);
      cleanupByProvider.set(session.providerId, bucket);
    }
    const remaining: PendingProviderSessionCleanup[] = [];
    for (const [providerId, sessionIds] of cleanupByProvider.entries()) {
      let client: Awaited<ReturnType<typeof createProviderClientForProvider>>["client"] | null = null;
      try {
        client = (await createProviderClientForProvider(env, providerId, logger)).client;
          for (const sessionId of sessionIds) {
            try {
              await client.deleteSession(sessionId);
            } catch (error) {
              if (isMissingProviderSessionError(error)) {
                continue;
              }
              logger.warn(
                { error, providerId, sessionId },
                "Failed to delete orphaned provider-managed session during runtime recovery",
            );
            remaining.push({ providerId, sessionId });
          }
        }
      } catch (error) {
        logger.warn(
          { error, providerId, sessionCount: sessionIds.size },
          "Failed to initialize provider cleanup for orphaned sessions during runtime recovery",
        );
        remaining.push(...[...sessionIds].map((sessionId) => ({ providerId, sessionId })));
      } finally {
        if (client) {
          await stopProviderClient(client, logger);
        }
      }
    }
    return remaining;
  }
}
