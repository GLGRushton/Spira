import type { SubagentWriteIntentDenial, SubagentWriteIntentGrant, SubagentWriteIntentRequest } from "@spira/shared";

interface ActiveIntent {
  request: SubagentWriteIntentRequest;
  grant: SubagentWriteIntentGrant;
}

interface SubagentLockManagerOptions {
  now?: () => number;
}

const getTargetKey = (request: SubagentWriteIntentRequest): string =>
  `${request.domain}:${request.targetType}:${request.targetId}:${request.action}`;

export class SubagentLockManager {
  private readonly locks = new Map<string, ActiveIntent>();
  private readonly now: () => number;

  constructor(options: SubagentLockManagerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  requestIntent(request: SubagentWriteIntentRequest): SubagentWriteIntentGrant | SubagentWriteIntentDenial {
    this.pruneExpiredLocks();

    const targetKey = getTargetKey(request);
    const existing = this.locks.get(targetKey);
    if (existing) {
      if (existing.request.runId === request.runId) {
        return existing.grant;
      }

      return {
        intentId: request.intentId,
        runId: request.runId,
        deniedAt: this.now(),
        reason: `Target ${request.targetType}:${request.targetId} is already locked by ${existing.request.runId}`,
        conflictingRunId: existing.request.runId,
      };
    }

    const grant: SubagentWriteIntentGrant = {
      intentId: request.intentId,
      runId: request.runId,
      grantedAt: this.now(),
      expiresAt: request.expiresAt,
    };
    this.locks.set(targetKey, { request, grant });
    return grant;
  }

  releaseIntent(intentId: string): void {
    for (const [targetKey, lock] of this.locks.entries()) {
      if (lock.request.intentId === intentId) {
        this.locks.delete(targetKey);
      }
    }
  }

  releaseByRunId(runId: string): void {
    for (const [targetKey, lock] of this.locks.entries()) {
      if (lock.request.runId === runId) {
        this.locks.delete(targetKey);
      }
    }
  }

  private pruneExpiredLocks(): void {
    const now = this.now();
    for (const [targetKey, lock] of this.locks.entries()) {
      if (lock.grant.expiresAt <= now) {
        this.locks.delete(targetKey);
      }
    }
  }
}
