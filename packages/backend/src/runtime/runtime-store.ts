import type {
  AppendProviderUsageRecordInput,
  RuntimeStationStateRecord,
  RuntimePermissionRequestStatus,
  RuntimeRecoverySummary,
  SpiraMemoryDatabase,
  UpsertRuntimeStationStateInput,
  UpsertRuntimePermissionRequestInput,
  UpsertRuntimeSubagentRunInput,
} from "@spira/memory-db";
import type { PermissionRequestPayload, StationId, SubagentRunSnapshot } from "@spira/shared";
import type { ProviderUsageRecord } from "../provider/types.js";

export class RuntimeStore {
  constructor(
    private readonly memoryDb: SpiraMemoryDatabase | null,
    private readonly stationId: StationId | null = null,
  ) {}

  forStation(stationId: StationId | null): RuntimeStore {
    return new RuntimeStore(this.memoryDb, stationId);
  }

  static recoverInterruptedState(memoryDb: SpiraMemoryDatabase | null, now = Date.now()): RuntimeRecoverySummary {
    if (!memoryDb) {
      return {
        expiredPermissionRequestIds: [],
        recoveredSubagentRunIds: [],
        recoveredStationIds: [],
      };
    }
    return memoryDb.recoverInterruptedRuntimeState(now);
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
}
