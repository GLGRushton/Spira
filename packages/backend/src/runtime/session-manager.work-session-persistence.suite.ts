import { describe, expect, it, vi } from "vitest";
import {
  createManager,
  createRuntimeMemoryDb,
  createRuntimeSessionContract,
  getDefaultProviderCapabilities,
} from "./session-manager.test-support.js";
import type {
  RuntimeWorkflowState,
  SessionManagerInternals,
  WorkSessionClassification,
  WorkSessionSnapshot,
} from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
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
});
