import type {
  SubagentDelegationArgs,
  SubagentDomainId,
  SubagentEnvelope,
  SubagentRunHandle,
  SubagentRunSnapshot,
  SubagentRunStatus,
} from "@spira/shared";
import type { SpiraEventBus } from "../util/event-bus.js";
import { setUnrefTimeout } from "../util/timers.js";
import type { SubagentRunLaunch } from "./subagent-runner.js";

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
  launch: SubagentRunLaunch;
}

interface SubagentRunRegistryOptions {
  bus?: SpiraEventBus;
  now?: () => number;
  retentionMs?: number;
  idleTimeoutMs?: number;
}

export class SubagentRunRegistry {
  private readonly bus: SpiraEventBus | null;
  private readonly now: () => number;
  private readonly retentionMs: number;
  private readonly idleTimeoutMs: number;
  private readonly runs = new Map<string, TrackedSubagentRun>();

  constructor(options: SubagentRunRegistryOptions = {}) {
    this.bus = options.bus ?? null;
    this.now = options.now ?? Date.now;
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  track(domain: SubagentDomainId, args: SubagentDelegationArgs, launch: SubagentRunLaunch): SubagentRunHandle {
    this.pruneExpired();

    const snapshot: SubagentRunSnapshot = {
      agent_id: launch.runId,
      runId: launch.runId,
      roomId: launch.roomId,
      domain,
      task: args.task,
      status: "running",
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

    this.clearIdleTimer(trackedRun);
    trackedRun.snapshot = {
      ...trackedRun.snapshot,
      status: "running",
      updatedAt: this.now(),
    };
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
      await trackedRun.launch.stop();
    } catch {
      // The runner already logs cleanup failures; cancellation should still reach a terminal snapshot.
    }
    const occurredAt = this.now();
    trackedRun.snapshot = {
      ...trackedRun.snapshot,
      status: "cancelled",
      updatedAt: occurredAt,
      completedAt: trackedRun.snapshot.completedAt ?? occurredAt,
      summary: trackedRun.snapshot.summary ?? "Delegated subagent run cancelled.",
      expiresAt: occurredAt + this.retentionMs,
    };
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
          envelope,
        };
        if (envelope.status === "completed") {
          this.emitStatus(current.snapshot, current.snapshot.status);
          this.armIdleTimer(current);
        } else {
          current.terminal = true;
          current.snapshot = {
            ...current.snapshot,
            expiresAt: updatedAt + this.retentionMs,
          };
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
          updatedAt: occurredAt,
          completedAt: occurredAt,
          summary: error instanceof Error ? error.message : "Subagent run failed",
          expiresAt: occurredAt + this.retentionMs,
        };
        this.emitStatus(current.snapshot, "failed");
        this.schedulePrune(current);
        this.notifyWaiters(current);
      });
  }

  private armIdleTimer(trackedRun: TrackedSubagentRun): void {
    this.clearIdleTimer(trackedRun);
    trackedRun.idleTimer = setUnrefTimeout(() => {
      void this.expire(trackedRun.snapshot.runId);
    }, this.idleTimeoutMs);
  }

  private clearIdleTimer(trackedRun: TrackedSubagentRun): void {
    if (trackedRun.idleTimer) {
      clearTimeout(trackedRun.idleTimer);
      trackedRun.idleTimer = undefined;
    }
  }

  private schedulePrune(trackedRun: TrackedSubagentRun): void {
    this.clearPruneTimer(trackedRun);
    trackedRun.pruneTimer = setUnrefTimeout(() => {
      this.deleteRun(trackedRun.snapshot.runId);
    }, this.retentionMs);
  }

  private async expire(runId: string): Promise<void> {
    const trackedRun = this.runs.get(runId);
    if (!trackedRun || trackedRun.terminal || trackedRun.snapshot.status !== "idle") {
      return;
    }

    trackedRun.terminal = true;
    this.clearIdleTimer(trackedRun);
    try {
      await trackedRun.launch.stop();
    } catch {
      // Expiry is best-effort cleanup; a terminal snapshot is still preferable to an unhandled rejection.
    }
    const occurredAt = this.now();
    trackedRun.snapshot = {
      ...trackedRun.snapshot,
      status: "expired",
      updatedAt: occurredAt,
      completedAt: trackedRun.snapshot.completedAt ?? occurredAt,
      summary: trackedRun.snapshot.summary ?? "Delegated subagent run expired after inactivity.",
      expiresAt: occurredAt + this.retentionMs,
    };
    this.emitStatus(trackedRun.snapshot, "expired");
    this.schedulePrune(trackedRun);
    this.notifyWaiters(trackedRun);
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [runId, trackedRun] of this.runs.entries()) {
      if (trackedRun.snapshot.expiresAt && trackedRun.snapshot.expiresAt <= now) {
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
