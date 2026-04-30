import type {
  Env,
  SubagentDelegationArgs,
  SubagentDomainId,
  SubagentEnvelope,
  SubagentRunHandle,
  SubagentRunSnapshot,
  SubagentRunStatus,
  SubagentToolCallRecord,
} from "@spira/shared";
import type { ProviderUsageRecord } from "../provider/types.js";
import type { RuntimeStore } from "../runtime/runtime-store.js";
import { resolveSubagentProviderBinding } from "../runtime/provider-binding.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { setUnrefTimeout } from "../util/timers.js";
import type { RecoveredSubagentRunLaunch, SubagentRunLaunch } from "./subagent-runner.js";

const DEFAULT_RETENTION_MS = 10 * 60_000;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60_000;

interface TrackedSubagentRun {
  snapshot: SubagentRunSnapshot;
  turnPromise: Promise<void>;
  sequence: number;
  terminal: boolean;
  idleTimer?: NodeJS.Timeout;
  pruneTimer?: NodeJS.Timeout;
  waiters: Set<() => void>;
  launch?: Pick<SubagentRunLaunch, "write" | "stop">;
}

type PersistedSubagentRunSnapshot = SubagentRunSnapshot & { workingDirectory?: string };

interface SubagentRunRegistryOptions {
  bus?: SpiraEventBus;
  runtimeStore?: RuntimeStore;
  env?: Env;
  now?: () => number;
  retentionMs?: number;
  idleTimeoutMs?: number;
  recoverLaunch?: (snapshot: SubagentRunSnapshot) => RecoveredSubagentRunLaunch | null;
}

export class SubagentRunRegistry {
  private readonly bus: SpiraEventBus | null;
  private readonly runtimeStore: RuntimeStore | null;
  private readonly env: Env | null;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly idleTimeoutMs: number;
  private readonly recoverLaunch: ((snapshot: SubagentRunSnapshot) => RecoveredSubagentRunLaunch | null) | null;
  private readonly runs = new Map<string, TrackedSubagentRun>();

  constructor(options: SubagentRunRegistryOptions = {}) {
    this.bus = options.bus ?? null;
    this.runtimeStore = options.runtimeStore ?? null;
    this.env = options.env ?? null;
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.recoverLaunch = options.recoverLaunch ?? null;
    this.bindBusEvents();
    this.hydratePersistedRuns();
  }

  private bindBusEvents(): void {
    this.bus?.on("subagent:runtime-sync", (event) => {
      const trackedRun = this.runs.get(event.runId);
      if (!trackedRun || trackedRun.terminal) {
        return;
      }

      trackedRun.snapshot = {
        ...trackedRun.snapshot,
        allowWrites: event.allowWrites,
        providerId: event.providerId,
        providerSessionId: event.providerSessionId ?? undefined,
        hostManifestHash: event.hostManifestHash ?? undefined,
        providerProjectionHash: event.providerProjectionHash ?? undefined,
        updatedAt: this.now(),
      };
      this.persistSnapshot(trackedRun.snapshot);
    });
    this.bus?.on("subagent:tool-call", (event) => {
      const trackedRun = this.runs.get(event.runId);
      if (!trackedRun || trackedRun.terminal) {
        return;
      }

      trackedRun.snapshot = {
        ...trackedRun.snapshot,
        activeToolCalls: upsertToolRecord(trackedRun.snapshot.activeToolCalls ?? [], {
          callId: event.callId,
          toolName: event.toolName,
          ...(event.serverId ? { serverId: event.serverId } : {}),
          ...(event.args ? { args: event.args } : {}),
          status: "running",
          startedAt: event.startedAt,
        }),
        updatedAt: this.now(),
      };
      this.persistSnapshot(trackedRun.snapshot);
    });
    this.bus?.on("subagent:tool-result", (event) => {
      const trackedRun = this.runs.get(event.runId);
      if (!trackedRun || trackedRun.terminal) {
        return;
      }

      trackedRun.snapshot = {
        ...trackedRun.snapshot,
        activeToolCalls: (trackedRun.snapshot.activeToolCalls ?? []).filter((call) => call.callId !== event.callId),
        toolCalls: upsertToolRecord(trackedRun.snapshot.toolCalls ?? [], {
          callId: event.callId,
          toolName: event.toolName,
          ...(event.serverId ? { serverId: event.serverId } : {}),
          ...(event.result !== undefined ? { result: event.result } : {}),
          status: event.status,
          startedAt: event.startedAt,
          completedAt: event.completedAt,
          durationMs: event.durationMs,
          ...(event.details ? { details: event.details } : {}),
        }),
        updatedAt: this.now(),
      };
      this.persistSnapshot(trackedRun.snapshot);
    });
    this.bus?.on("provider:usage", (record: ProviderUsageRecord) => {
      if (!record.runId) {
        return;
      }
      const trackedRun = this.runs.get(record.runId);
      if (!trackedRun || typeof record.model !== "string" || record.model.trim().length === 0) {
        return;
      }

      trackedRun.snapshot = {
        ...trackedRun.snapshot,
        observedModel: record.model.trim(),
        updatedAt: this.now(),
      };
      this.persistSnapshot(trackedRun.snapshot);
    });
  }

  private hydratePersistedRuns(): void {
    for (const persistedSnapshot of this.runtimeStore?.listPersistedSubagentRuns() ?? []) {
      let snapshot =
        persistedSnapshot.status === "running" ? this.failInterruptedSnapshot(persistedSnapshot) : persistedSnapshot;
      const recoveredLaunch = snapshot.status === "idle" ? (this.recoverLaunch?.(snapshot) ?? null) : null;
      if (snapshot.status === "idle" && this.recoverLaunch && !recoveredLaunch) {
        snapshot = this.failUnrecoverableIdleSnapshot(snapshot);
      }
      if (snapshot.status === "idle") {
        const rearmedExpiresAt = this.now() + this.idleTimeoutMs;
        const expiresAt =
          typeof snapshot.expiresAt === "number" ? Math.min(snapshot.expiresAt, rearmedExpiresAt) : rearmedExpiresAt;
        snapshot = {
          ...snapshot,
          expiresAt,
        };
        this.persistSnapshot(snapshot);
      }
      const trackedRun: TrackedSubagentRun = {
        snapshot,
        turnPromise: Promise.resolve(),
        sequence: 0,
        terminal: snapshot.status !== "running" && snapshot.status !== "idle",
        waiters: new Set(),
        ...(snapshot.status === "idle" && recoveredLaunch ? { launch: recoveredLaunch } : {}),
      };
      this.runs.set(snapshot.runId, trackedRun);
      if (snapshot.status === "idle") {
        this.armIdleTimer(trackedRun);
      } else if (trackedRun.terminal && snapshot.expiresAt) {
        const remainingTtlMs = snapshot.expiresAt - this.now();
        if (remainingTtlMs <= 0) {
          this.deleteRun(snapshot.runId);
          continue;
        }
        this.schedulePrune(trackedRun, remainingTtlMs);
      }
    }
  }

  private failInterruptedSnapshot(snapshot: SubagentRunSnapshot): PersistedSubagentRunSnapshot {
    const occurredAt = this.now();
    const interruptedSnapshot: PersistedSubagentRunSnapshot = {
      ...snapshot,
      status: "failed",
      providerId: undefined,
      providerSessionId: undefined,
      activeToolCalls: [],
      updatedAt: occurredAt,
      completedAt: snapshot.completedAt ?? occurredAt,
      summary: snapshot.summary ?? "Delegated subagent run was interrupted before completion.",
      expiresAt: occurredAt + this.retentionMs,
    };
    this.persistSnapshot(interruptedSnapshot);
    return interruptedSnapshot;
  }

  private failUnrecoverableIdleSnapshot(snapshot: SubagentRunSnapshot): PersistedSubagentRunSnapshot {
    const occurredAt = this.now();
    this.queueProviderSessionCleanup(snapshot);
    const failedSnapshot: PersistedSubagentRunSnapshot = {
      ...snapshot,
      status: "failed",
      providerId: undefined,
      providerSessionId: undefined,
      activeToolCalls: [],
      updatedAt: occurredAt,
      completedAt: snapshot.completedAt ?? occurredAt,
      summary: snapshot.summary ?? "Delegated subagent run could not be recovered after restart.",
      expiresAt: occurredAt + this.retentionMs,
    };
    this.persistSnapshot(failedSnapshot);
    return failedSnapshot;
  }

  private queueProviderSessionCleanup(snapshot: SubagentRunSnapshot): void {
    const runtimeSessionId =
      this.runtimeStore && typeof this.runtimeStore.getSubagentRuntimeSessionId === "function"
        ? this.runtimeStore.getSubagentRuntimeSessionId(snapshot.runId)
        : null;
    const runtimeSession =
      runtimeSessionId && this.runtimeStore && typeof this.runtimeStore.getRuntimeSession === "function"
        ? this.runtimeStore.getRuntimeSession(runtimeSessionId)
        : null;
    const stationRuntimeSessionId =
      this.runtimeStore && typeof this.runtimeStore.getStationRuntimeSessionId === "function"
        ? this.runtimeStore.getStationRuntimeSessionId()
        : null;
    const stationRuntimeSession =
      stationRuntimeSessionId && this.runtimeStore && typeof this.runtimeStore.getRuntimeSession === "function"
        ? this.runtimeStore.getRuntimeSession(stationRuntimeSessionId)
        : null;
    const { providerId, providerSessionId } = resolveSubagentProviderBinding(snapshot, runtimeSession, stationRuntimeSession);
    if (!providerId || !providerSessionId || !this.runtimeStore) {
      return;
    }
    this.runtimeStore.queueProviderSessionCleanup(providerId, providerSessionId);
    if (this.env) {
      void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
    }
  }

  private persistSnapshot(snapshot: SubagentRunSnapshot): void {
    this.runtimeStore?.persistSubagentRun(snapshot);
  }

  track(domain: SubagentDomainId, args: SubagentDelegationArgs, launch: SubagentRunLaunch): SubagentRunHandle {
    this.pruneExpired();

    const snapshot: PersistedSubagentRunSnapshot = {
      agent_id: launch.runId,
      runId: launch.runId,
      roomId: launch.roomId,
      domain,
      task: args.task,
      ...(args.model ? { requestedModel: args.model } : {}),
      status: "running",
      allowWrites: launch.allowWrites === true,
      workingDirectory: launch.workingDirectory,
      activeToolCalls: [],
      toolCalls: [],
      startedAt: launch.startedAt,
      updatedAt: launch.startedAt,
    };
    const trackedRun: TrackedSubagentRun = {
      snapshot,
      turnPromise: Promise.resolve(),
      sequence: 0,
      terminal: false,
      waiters: new Set(),
      launch,
    };

    this.runs.set(launch.runId, trackedRun);
    this.persistSnapshot(snapshot);
    this.bindTurnPromise(trackedRun, launch.resultPromise);
    this.emitStatus(snapshot, "running");

    return {
      agent_id: launch.runId,
      runId: launch.runId,
      roomId: launch.roomId,
      domain,
      status: "running",
      startedAt: launch.startedAt,
    };
  }

  get(runId: string): SubagentRunSnapshot | null {
    this.pruneExpired();
    return this.runs.get(runId)?.snapshot ?? null;
  }

  list(options: { includeCompleted?: boolean } = {}): SubagentRunSnapshot[] {
    this.pruneExpired();
    const snapshots = [...this.runs.values()].map((run) => run.snapshot);
    if (options.includeCompleted === false) {
      return snapshots.filter((snapshot) => snapshot.status === "running" || snapshot.status === "idle");
    }

    return snapshots;
  }

  async waitFor(runId: string, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS): Promise<SubagentRunSnapshot | null> {
    this.pruneExpired();
    const trackedRun = this.runs.get(runId);
    if (!trackedRun) {
      return null;
    }
    if (trackedRun.snapshot.status !== "running") {
      return trackedRun.snapshot;
    }

    await new Promise<void>((resolve) => {
      const waiter = () => {
        trackedRun.waiters.delete(waiter);
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setUnrefTimeout(waiter, Math.max(0, timeoutMs));
      trackedRun.waiters.add(waiter);
    });

    return this.runs.get(runId)?.snapshot ?? null;
  }

  async write(runId: string, input: string): Promise<SubagentRunSnapshot | null> {
    this.pruneExpired();
    const trackedRun = this.runs.get(runId);
    if (!trackedRun) {
      return null;
    }
    if (trackedRun.terminal || trackedRun.snapshot.status !== "idle") {
      throw new Error(`Delegated subagent run ${runId} is not idle and cannot accept follow-up input`);
    }
    if (!trackedRun.launch) {
      throw new Error(`Delegated subagent run ${runId} cannot accept follow-up input after recovery`);
    }

    this.clearIdleTimer(trackedRun);
    trackedRun.snapshot = {
      ...trackedRun.snapshot,
      status: "running",
      activeToolCalls: [],
      toolCalls: [],
      updatedAt: this.now(),
      expiresAt: undefined,
    };
    this.persistSnapshot(trackedRun.snapshot);
    this.emitStatus(trackedRun.snapshot, "running");
    this.bindTurnPromise(trackedRun, trackedRun.launch.write(input));
    return trackedRun.snapshot;
  }

  async stop(runId: string): Promise<SubagentRunSnapshot | null> {
    this.pruneExpired();
    const trackedRun = this.runs.get(runId);
    if (!trackedRun) {
      return null;
    }
    if (trackedRun.terminal) {
      return trackedRun.snapshot;
    }

    trackedRun.terminal = true;
    this.clearIdleTimer(trackedRun);
    try {
      await trackedRun.launch?.stop();
    } catch {
      // The runner already logs cleanup failures; cancellation should still reach a terminal snapshot.
    }
    const occurredAt = this.now();
    trackedRun.snapshot = {
      ...trackedRun.snapshot,
      status: "cancelled",
      providerId: undefined,
      providerSessionId: undefined,
      activeToolCalls: [],
      updatedAt: occurredAt,
      completedAt: trackedRun.snapshot.completedAt ?? occurredAt,
      summary: trackedRun.snapshot.summary ?? "Delegated subagent run cancelled.",
      expiresAt: occurredAt + this.retentionMs,
    };
    this.persistSnapshot(trackedRun.snapshot);
    this.emitStatus(trackedRun.snapshot, "cancelled");
    this.schedulePrune(trackedRun);
    this.notifyWaiters(trackedRun);
    return trackedRun.snapshot;
  }

  private bindTurnPromise(trackedRun: TrackedSubagentRun, promise: Promise<SubagentEnvelope>): void {
    const sequence = trackedRun.sequence + 1;
    trackedRun.sequence = sequence;
    trackedRun.turnPromise = promise
      .then((envelope) => {
        const current = this.runs.get(trackedRun.snapshot.runId);
        if (!current || current.terminal || current.sequence !== sequence) {
          return;
        }

        const updatedAt = this.now();
        current.snapshot = {
          ...current.snapshot,
          status: envelope.status === "completed" ? "idle" : envelope.status,
          updatedAt,
          completedAt: envelope.completedAt,
          summary: envelope.summary,
          followupNeeded: envelope.followupNeeded,
          activeToolCalls: [],
          toolCalls: envelope.toolCalls,
          envelope,
          ...(envelope.status === "completed" ? { expiresAt: updatedAt + this.idleTimeoutMs } : { expiresAt: undefined }),
        };
        this.persistSnapshot(current.snapshot);
        if (envelope.status === "completed") {
          this.emitStatus(current.snapshot, current.snapshot.status);
          this.armIdleTimer(current);
        } else {
          current.terminal = true;
          current.snapshot = {
            ...current.snapshot,
            providerId: undefined,
            providerSessionId: undefined,
            expiresAt: updatedAt + this.retentionMs,
          };
          this.persistSnapshot(current.snapshot);
          this.emitStatus(current.snapshot, current.snapshot.status);
          this.schedulePrune(current);
        }
        this.notifyWaiters(current);
      })
      .catch((error) => {
        const current = this.runs.get(trackedRun.snapshot.runId);
        if (!current || current.terminal || current.sequence !== sequence) {
          return;
        }

        current.terminal = true;
        const occurredAt = this.now();
        current.snapshot = {
          ...current.snapshot,
          status: "failed",
          providerId: undefined,
          providerSessionId: undefined,
          activeToolCalls: [],
          updatedAt: occurredAt,
          completedAt: occurredAt,
          summary: error instanceof Error ? error.message : "Subagent run failed",
          expiresAt: occurredAt + this.retentionMs,
        };
        this.persistSnapshot(current.snapshot);
        this.emitStatus(current.snapshot, "failed");
        this.schedulePrune(current);
        this.notifyWaiters(current);
      });
  }

  private armIdleTimer(trackedRun: TrackedSubagentRun): void {
    this.clearIdleTimer(trackedRun);
    const delay = Math.max(0, (trackedRun.snapshot.expiresAt ?? this.now() + this.idleTimeoutMs) - this.now());
    trackedRun.idleTimer = setUnrefTimeout(() => {
      void this.expire(trackedRun.snapshot.runId);
    }, delay);
  }

  private clearIdleTimer(trackedRun: TrackedSubagentRun): void {
    if (trackedRun.idleTimer) {
      clearTimeout(trackedRun.idleTimer);
      trackedRun.idleTimer = undefined;
    }
  }

  private schedulePrune(trackedRun: TrackedSubagentRun, delayMs = this.retentionMs): void {
    this.clearPruneTimer(trackedRun);
    trackedRun.pruneTimer = setUnrefTimeout(() => {
      this.deleteRun(trackedRun.snapshot.runId);
    }, Math.max(0, delayMs));
  }

  private async expire(runId: string): Promise<void> {
    const trackedRun = this.runs.get(runId);
    if (!trackedRun || trackedRun.terminal || trackedRun.snapshot.status !== "idle") {
      return;
    }

    trackedRun.terminal = true;
    this.clearIdleTimer(trackedRun);
    try {
      await trackedRun.launch?.stop();
    } catch {
      // Expiry is best-effort cleanup; a terminal snapshot is still preferable to an unhandled rejection.
    }
    const occurredAt = this.now();
    trackedRun.snapshot = {
      ...trackedRun.snapshot,
      status: "expired",
      providerId: undefined,
      providerSessionId: undefined,
      activeToolCalls: [],
      updatedAt: occurredAt,
      completedAt: trackedRun.snapshot.completedAt ?? occurredAt,
      summary: trackedRun.snapshot.summary ?? "Delegated subagent run expired after inactivity.",
      expiresAt: occurredAt + this.retentionMs,
    };
    this.persistSnapshot(trackedRun.snapshot);
    this.emitStatus(trackedRun.snapshot, "expired");
    this.schedulePrune(trackedRun);
    this.notifyWaiters(trackedRun);
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [runId, trackedRun] of this.runs.entries()) {
      if (trackedRun.snapshot.expiresAt && trackedRun.snapshot.expiresAt <= now) {
        if (!trackedRun.terminal && trackedRun.snapshot.status === "idle") {
          void this.expire(runId);
          continue;
        }
        if (!trackedRun.terminal) {
          continue;
        }
        this.deleteRun(runId);
      }
    }
  }

  private deleteRun(runId: string): void {
    const trackedRun = this.runs.get(runId);
    if (!trackedRun) {
      return;
    }

    this.clearIdleTimer(trackedRun);
    this.clearPruneTimer(trackedRun);
    this.notifyWaiters(trackedRun);
    this.runs.delete(runId);
    this.runtimeStore?.deleteSubagentRun(runId);
  }

  private clearPruneTimer(trackedRun: TrackedSubagentRun): void {
    if (trackedRun.pruneTimer) {
      clearTimeout(trackedRun.pruneTimer);
      trackedRun.pruneTimer = undefined;
    }
  }

  private notifyWaiters(trackedRun: TrackedSubagentRun): void {
    for (const waiter of trackedRun.waiters) {
      waiter();
    }
    trackedRun.waiters.clear();
  }

  private emitStatus(snapshot: SubagentRunSnapshot, status: SubagentRunStatus): void {
    this.bus?.emit("subagent:status", {
      runId: snapshot.runId,
      roomId: snapshot.roomId,
      domain: snapshot.domain,
      label: snapshot.domain,
      status,
      occurredAt: snapshot.updatedAt,
      ...(snapshot.summary ? { summary: snapshot.summary } : {}),
      ...(snapshot.expiresAt ? { expiresAt: snapshot.expiresAt } : {}),
    });
  }
}

const upsertToolRecord = (
  records: SubagentToolCallRecord[],
  record: SubagentToolCallRecord,
): SubagentToolCallRecord[] => {
  const index = records.findIndex((entry) => entry.callId === record.callId);
  if (index < 0) {
    return [...records, record];
  }

  const next = [...records];
  next[index] = record;
  return next;
};
