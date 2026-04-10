import type { SubagentWriteIntentRequest } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { SubagentLockManager } from "./lock-manager.js";

const createRequest = (overrides: Partial<SubagentWriteIntentRequest> = {}): SubagentWriteIntentRequest => ({
  intentId: "intent-1",
  runId: "run-1",
  domain: "windows",
  targetType: "windows-system",
  targetId: "name=notepad.exe",
  action: "system_close_app",
  toolName: "system_close_app",
  serverId: "windows-system",
  requestedAt: 1000,
  expiresAt: 4000,
  ...overrides,
});

describe("SubagentLockManager", () => {
  it("denies conflicting locks for the same target", () => {
    const manager = new SubagentLockManager({ now: () => 1500 });

    const first = manager.requestIntent(createRequest());
    const second = manager.requestIntent(createRequest({ intentId: "intent-2", runId: "run-2" }));

    expect("grantedAt" in first).toBe(true);
    expect("reason" in second).toBe(true);
    expect(second).toMatchObject({
      runId: "run-2",
      conflictingRunId: "run-1",
    });
  });

  it("releases and expires locks", () => {
    let now = 1500;
    const manager = new SubagentLockManager({ now: () => now });

    const granted = manager.requestIntent(createRequest());
    expect("grantedAt" in granted).toBe(true);

    manager.releaseIntent("intent-1");
    const afterRelease = manager.requestIntent(createRequest({ intentId: "intent-2", runId: "run-2" }));
    expect("grantedAt" in afterRelease).toBe(true);

    now = 5000;
    const afterExpiry = manager.requestIntent(createRequest({ intentId: "intent-3", runId: "run-3" }));
    expect("grantedAt" in afterExpiry).toBe(true);
  });

  it("prunes expired locks that were never explicitly released", () => {
    let now = 1500;
    const manager = new SubagentLockManager({ now: () => now });

    manager.requestIntent(createRequest());

    now = 5000;
    const afterExpiry = manager.requestIntent(createRequest({ intentId: "intent-2", runId: "run-2" }));

    expect("grantedAt" in afterExpiry).toBe(true);
  });

  it("releases all locks owned by a run", () => {
    const manager = new SubagentLockManager({ now: () => 1500 });

    manager.requestIntent(createRequest({ intentId: "intent-1", targetId: "name=notepad.exe" }));
    manager.requestIntent(createRequest({ intentId: "intent-2", targetId: "name=calc.exe" }));

    manager.releaseByRunId("run-1");

    const next = manager.requestIntent(
      createRequest({ intentId: "intent-3", runId: "run-2", targetId: "name=calc.exe" }),
    );
    expect("grantedAt" in next).toBe(true);
  });
});
