import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SpiraMemoryDatabase, getSpiraMemoryDbPath } from "@spira/memory-db";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultProviderCapabilities } from "../provider/capability-fallback.js";
import { persistSharedRuntimeSessionState } from "./runtime-session-state.js";
import { RuntimeStore } from "./runtime-store.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const openRuntimeStore = () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-runtime-session-state-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return {
    database,
    runtimeStore: new RuntimeStore(database, "primary"),
  };
};

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close();
  }
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("persistSharedRuntimeSessionState", () => {
  it("records workflow update events when orchestration state changes", () => {
    const { runtimeStore } = openRuntimeStore();
    const runtimeSessionId = "station:primary";

    persistSharedRuntimeSessionState(runtimeStore, {
      runtimeSessionId,
      stationId: "primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      providerSessionId: "provider-1",
      model: "gpt-5.4-mini",
      turnState: {
        state: "thinking",
        activeToolCallIds: [],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: null,
      },
      permissionState: { status: "idle", pendingRequestIds: [], lastResolvedAt: null },
      cancellationState: { status: "idle", requestedAt: null, completedAt: null },
      usageSummary: { model: "gpt-5.4-mini", totalTokens: 12, lastObservedAt: 100, source: "provider" },
      workflowState: {
        phase: "discover",
        status: "active",
        summary: "Searching the repository.",
        updatedAt: 100,
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
      now: 100,
    });

    persistSharedRuntimeSessionState(runtimeStore, {
      runtimeSessionId,
      stationId: "primary",
      kind: "station",
      scope: { stationId: "primary" },
      workingDirectory: "C:\\GitHub\\Spira",
      hostManifestHash: "host-hash",
      providerProjectionHash: "projection-hash",
      providerId: "copilot",
      providerCapabilities: getDefaultProviderCapabilities("copilot"),
      providerSessionId: "provider-1",
      model: "gpt-5.4",
      turnState: {
        state: "thinking",
        activeToolCallIds: [],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: null,
      },
      permissionState: { status: "pending", pendingRequestIds: ["perm-1"], lastResolvedAt: null },
      cancellationState: { status: "idle", requestedAt: null, completedAt: null },
      usageSummary: { model: "gpt-5.4", totalTokens: 24, lastObservedAt: 200, source: "provider" },
      workflowState: {
        phase: "implement",
        status: "blocked",
        summary: "Escalated implementation is waiting on approval.",
        updatedAt: 200,
        phaseHistory: [
          {
            phase: "discover",
            status: "complete",
            summary: "Candidate files identified.",
            providerId: "copilot",
            model: "gpt-5.4-mini",
            startedAt: 100,
            updatedAt: 180,
            completedAt: 180,
            blockedBy: null,
          },
        ],
        handoffs: [
          {
            handoffId: "handoff-1",
            kind: "model-escalation",
            phase: "implement",
            reason: "cross-file complexity",
            continuationMode: "continue-current-phase",
            occurredAt: 190,
            fromProviderId: "copilot",
            toProviderId: "copilot",
            fromModel: "gpt-5.4-mini",
            toModel: "gpt-5.4",
          },
        ],
        blockedBy: {
          kind: "approval",
          reason: "Permission request is pending.",
          pendingRequestIds: ["perm-1"],
          blockedAt: 200,
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
      now: 200,
    });

    const persisted = runtimeStore.getRuntimeSession(runtimeSessionId);
    expect(persisted?.workflowState).toEqual({
      phase: "implement",
      status: "blocked",
      summary: "Escalated implementation is waiting on approval.",
      updatedAt: 200,
      phaseHistory: [
        {
          phase: "discover",
          status: "complete",
          summary: "Candidate files identified.",
          providerId: "copilot",
          model: "gpt-5.4-mini",
          startedAt: 100,
          updatedAt: 180,
          completedAt: 180,
          blockedBy: null,
        },
      ],
      handoffs: [
        {
          handoffId: "handoff-1",
          kind: "model-escalation",
          phase: "implement",
          reason: "cross-file complexity",
          continuationMode: "continue-current-phase",
          occurredAt: 190,
          fromProviderId: "copilot",
          toProviderId: "copilot",
          fromModel: "gpt-5.4-mini",
          toModel: "gpt-5.4",
        },
      ],
      blockedBy: {
        kind: "approval",
        reason: "Permission request is pending.",
        pendingRequestIds: ["perm-1"],
        blockedAt: 200,
      },
      review: {
        status: "idle",
        attempt: 0,
        runId: null,
        summary: null,
        failureReason: null,
        lastUpdatedAt: null,
      },
    });

    expect(runtimeStore.listRuntimeLedgerEvents(runtimeSessionId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow.updated",
          payload: expect.objectContaining({
            phase: "implement",
            status: "blocked",
            summary: "Escalated implementation is waiting on approval.",
          }),
        }),
      ]),
    );
  });
});
