import { describe, expect, it, vi } from "vitest";
import { createManager, createRuntimeMemoryDb } from "./session-manager.test-support.js";
import type { SessionManagerInternals } from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
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
});
