import { describe, expect, it, vi } from "vitest";
import { createManager, createRuntimeMemoryDb } from "./session-manager.test-support.js";
import type { SessionManagerInternals } from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
  it("resets the fix-iteration budget after a successful validation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-gamma-success-reset",
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
        toolCallId: "tool-patch-1",
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
        toolCallId: "tool-patch-1",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-1",
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
        toolCallId: "tool-validate-1",
        success: false,
        error: {
          message: "TS2322: Type 'string' is not assignable to type 'number'.",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-2",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ fixed\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-2",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-2",
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
        toolCallId: "tool-validate-2",
        success: true,
        result: { summary: "All tests passed." },
      },
    });

    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "validate",
          readyForReview: true,
          fixIterationCount: 0,
        }),
      ]),
    );
  });

  it("treats async powershell failures with different shell ids as the same repeated validation failure", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-gamma-async",
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

    for (const [index, shellId] of [
      [1, "shell-a"],
      [2, "shell-b"],
    ] as const) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-patch-${index}`,
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
          toolCallId: `tool-patch-${index}`,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-validate-${index}`,
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
          toolCallId: `tool-validate-${index}`,
          success: true,
          result: {
            resultType: "success",
            textResultForLlm: JSON.stringify({
              shellId,
              status: "running",
              exitCode: null,
              output: "partial output",
            }),
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-validate-read-${index}`,
          toolName: "read_powershell",
          arguments: {
            shellId,
            delay: 5,
          },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_complete",
        data: {
          toolCallId: `tool-validate-read-${index}`,
          success: true,
          result: {
            resultType: "success",
            textResultForLlm: JSON.stringify({
              shellId,
              status: "failed",
              exitCode: 1,
              output: "TS2322: Type 'string' is not assignable to type 'number'.",
            }),
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-gamma-async")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
        },
      },
    });
  });

  it("treats cancelled powershell validation sessions as failures instead of passes", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-gamma-cancelled",
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
            shellId: "shell-cancelled",
            status: "cancelled",
            exitCode: 1,
            output: "Validation cancelled.",
          }),
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-gamma-cancelled")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          readyForReview: false,
          validationResults: [
            expect.objectContaining({
              success: false,
            }),
          ],
        }),
      ]),
    );
  });

  it("stalls the work session after the same validation failure repeats twice", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta",
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

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
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
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
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
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-delta")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
          blockedBy: expect.objectContaining({
            kind: "error",
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
          repeatFailureCount: 2,
          stalledReason: "Validation repeated the same failure twice; escalation or manual intervention is required.",
        }),
      ]),
    );
  });

  it("clears stalled workflow blocking after a corrective patch and successful validation", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-recover",
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

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
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
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
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
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-delta-recover")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
        },
      },
    });

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ newer\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3-validate",
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
        toolCallId: "tool-patch-3-validate",
        success: true,
        result: { summary: "All tests passed." },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-recover")).toMatchObject({
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

  it("does not clear a stalled validation state just by rerunning validation without a corrective patch", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-guard",
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

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
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
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
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
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-3",
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
        toolCallId: "tool-validate-3",
        success: false,
        error: {
          message: "Different validation failure.",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-guard")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
          blockedBy: expect.objectContaining({
            kind: "error",
          }),
        },
      },
    });
  });

  it("does not allow validation to restart from implement after a failed stalled-recovery write", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-failed-recovery",
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

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
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
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
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
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ newer\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3",
        success: false,
        error: {
          message: "Patch failed.",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3-validate",
        toolName: "powershell",
        arguments: {
          command: "pnpm exec vitest run packages\\backend\\src\\copilot\\session-manager.test.ts",
          description: "Run targeted session manager tests",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-failed-recovery")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "stalled",
          blockedBy: expect.objectContaining({
            kind: "error",
          }),
        },
      },
    });
  });

  it("resets the repeat-failure budget after a stalled validation resumes with a corrective patch", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-budget",
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

    for (const patchId of ["tool-patch-1", "tool-patch-2"]) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: patchId,
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
          toolCallId: patchId,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `${patchId}-validate`,
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
          toolCallId: `${patchId}-validate`,
          success: false,
          error: {
            message: "TS2322: Type 'string' is not assignable to type 'number'.",
          },
        },
      });
    }

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ newer\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-3",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-3-validate",
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
        toolCallId: "tool-patch-3-validate",
        success: false,
        error: {
          message: "TS2322: Type 'string' is not assignable to type 'number'.",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-budget")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
        },
      },
    });
    expect(
      [...memory.sessionState.values()].map((value) => (typeof value === "string" ? JSON.parse(value) : value)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currentPhase: "implement",
          repeatFailureCount: 1,
          lastValidationFingerprint: expect.stringMatching(/^TS2322:/),
          stalledReason: null,
        }),
      ]),
    );
  });

  it("resets the attempt-limit budget after recovering from a bounded fix-loop stall", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-exec-delta-attempt-budget",
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

    for (const [index, errorMessage] of [
      [1, "Failure one."],
      [2, "Failure two."],
      [3, "Failure three."],
      [4, "Failure four."],
      [5, "Failure five."],
    ] as const) {
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-patch-${index}`,
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
          toolCallId: `tool-patch-${index}`,
          success: true,
          result: { ok: true },
        },
      });
      internals.handleSessionEvent({
        type: "tool.execution_start",
        data: {
          toolCallId: `tool-validate-${index}`,
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
          toolCallId: `tool-validate-${index}`,
          success: false,
          error: {
            message: errorMessage,
          },
        },
      });
    }

    expect(memory.runtimeSessions.get("station:station-exec-delta-attempt-budget")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "stalled",
        },
      },
    });

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-patch-6",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ recovered\n*** End Patch\n",
        },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-patch-6",
        success: true,
        result: { ok: true },
      },
    });
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-validate-6",
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
        toolCallId: "tool-validate-6",
        success: false,
        error: {
          message: "Failure after recovery.",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-exec-delta-attempt-budget")).toMatchObject({
      contract: {
        workflowState: {
          phase: "implement",
          status: "active",
          blockedBy: null,
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
          stalledReason: null,
        }),
      ]),
    );
  });

  it("preserves continue-current-phase escalation semantics during validate", async () => {
    const runtimeMemory = createRuntimeMemoryDb();
    const manager = createManager([], {
      envInput: { SPIRA_MODEL_PROVIDER: "openai-escalation" },
      stationId: "primary",
      memoryDb: runtimeMemory.db,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "work-session",
      send: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      escalate: vi.fn().mockResolvedValue({
        status: "escalated",
        providerId: "openai-escalation",
        fromModel: "gpt-5.4-mini",
        toModel: "gpt-5.4",
      }),
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

    const tool = internals.getSessionConfig().tools.find((entry) => entry.name === "spira_escalate_session");
    expect(tool).toBeDefined();
    if (!tool) {
      throw new Error("Expected spira_escalate_session to be available.");
    }

    await tool.handler({});

    expect(runtimeMemory.runtimeSessions.get("station:primary")).toMatchObject({
      contract: {
        workflowState: {
          phase: "validate",
          status: "active",
          handoffs: [
            expect.objectContaining({
              kind: "model-escalation",
              phase: "validate",
              continuationMode: "continue-current-phase",
              toModel: "gpt-5.4",
            }),
          ],
        },
      },
    });
  });

  it("preserves approval blocks while syncing work-session workflow phases", async () => {
    const memory = createRuntimeMemoryDb();
    memory.db.upsertRuntimePermissionRequest({
      requestId: "perm-1",
      stationId: "station-kappa",
      payload: { kind: "custom-tool", toolName: "spira_escalate_session" },
      createdAt: 123,
    });
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-kappa",
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
    internals.workflowState = {
      ...internals.workflowState,
      phase: "discover",
      status: "blocked",
      blockedBy: {
        kind: "approval",
        reason: "Awaiting approval.",
        pendingRequestIds: ["perm-1"],
        blockedAt: 123,
      },
    };

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        success: true,
        result: { ok: true },
      },
    });

    expect(memory.runtimeSessions.get("station:station-kappa")).toMatchObject({
      contract: {
        workflowState: {
          phase: "summarise",
          status: "blocked",
          blockedBy: {
            kind: "approval",
            pendingRequestIds: ["perm-1"],
          },
        },
      },
    });
    expect(memory.runtimeSessions.get("station:station-kappa")).toMatchObject({
      contract: {
        workflowState: {
          phaseHistory: expect.arrayContaining([expect.objectContaining({ phase: "summarise", status: "blocked" })]),
        },
      },
    });
  });

  it("resumes work-session workflow syncing after review completes", async () => {
    const memory = createRuntimeMemoryDb();
    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-mu",
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
    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "complete",
      review: {
        ...internals.workflowState.review,
        status: "completed",
        summary: "Review completed.",
        lastUpdatedAt: 123,
      },
    };

    internals.handleSessionEvent({
      type: "tool.execution_complete",
      data: {
        toolCallId: "tool-1",
        success: true,
        result: { ok: true },
      },
    });

    expect(memory.runtimeSessions.get("station:station-mu")).toMatchObject({
      contract: {
        workflowState: {
          phase: "summarise",
          status: "active",
          phaseHistory: expect.arrayContaining([expect.objectContaining({ phase: "summarise", status: "active" })]),
          review: expect.objectContaining({
            status: "completed",
          }),
        },
      },
    });
  });

  it("seals a ready-for-review work session when review completes", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-mu-complete:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-mu-complete",
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
        reviewSummary: null,
        completedAt: null,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 6,
      }),
    );

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-mu-complete",
    });
    const internals = manager as unknown as SessionManagerInternals & {
      handleReviewSubagentStatus(
        runId: string,
        domain: string,
        status: string,
        occurredAt: number,
        summary: string | null,
      ): void;
    };

    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "active",
      summary: "Running review: Review the current diff",
      review: {
        ...internals.workflowState.review,
        status: "running",
        origin: "managed-subagent",
        runId: "review-run-1",
        attempt: 1,
        summary: "Running review: Review the current diff",
        failureReason: null,
        lastUpdatedAt: 11,
      },
    };

    internals.handleReviewSubagentStatus("review-run-1", "code-review", "completed", 12, "Review completed cleanly.");

    expect(memory.runtimeSessions.get("station:station-mu-complete")).toMatchObject({
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
    expect(JSON.parse(String(memory.sessionState.get("station:station-mu-complete:work-session")))).toMatchObject({
      currentPhase: "validate",
      readyForReview: true,
      reviewSummary: "Review completed cleanly.",
      completedAt: 12,
      summary: "Review completed cleanly.",
    });

    internals.session = {
      sessionId: "work-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "work-session";
    const runtimeBeforeLateEvent = structuredClone(memory.runtimeSessions.get("station:station-mu-complete"));
    const ledgerCountBeforeLateEvent = memory.runtimeLedgerEvents.length;
    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-late",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-mu-complete")).toEqual(runtimeBeforeLateEvent);
    expect(memory.runtimeLedgerEvents).toHaveLength(ledgerCountBeforeLateEvent);
    expect(
      (
        memory.runtimeSessions.get("station:station-mu-complete")?.contract as {
          workflowState?: { phaseHistory?: unknown[] };
        }
      ).workflowState?.phaseHistory?.filter((entry) =>
        Boolean(
          entry && typeof entry === "object" && "phase" in entry && (entry as { phase?: string }).phase === "complete",
        ),
      ),
    ).toHaveLength(1);
    expect(JSON.parse(String(memory.sessionState.get("station:station-mu-complete:work-session")))).toMatchObject({
      updatedAt: 12,
    });

    internals.handleReviewSubagentStatus("review-run-1", "code-review", "failed", 13, "Late failure.");

    expect(memory.runtimeSessions.get("station:station-mu-complete")).toMatchObject({
      contract: {
        workflowState: {
          phase: "complete",
          status: "complete",
          summary: "Review completed cleanly.",
          review: {
            status: "completed",
            summary: "Review completed cleanly.",
          },
        },
      },
    });
  });

  it("ignores tool events while review is running for a ready-for-review work session", () => {
    const memory = createRuntimeMemoryDb();
    memory.sessionState.set(
      "station:station-mu-review-running:work-session",
      JSON.stringify({
        sessionId: "work-session",
        stationId: "station-mu-review-running",
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
        reviewSummary: null,
        completedAt: null,
        stalledReason: null,
        stalledAt: null,
        createdAt: 1,
        updatedAt: 6,
      }),
    );

    const manager = createManager([], {
      memoryDb: memory.db,
      stationId: "station-mu-review-running",
    });
    const internals = manager as unknown as SessionManagerInternals;
    internals.session = {
      sessionId: "work-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    internals.activeSessionId = "work-session";
    internals.workflowState = {
      ...internals.workflowState,
      phase: "review",
      status: "active",
      review: {
        ...internals.workflowState.review,
        status: "running",
        origin: "managed-subagent",
        runId: "review-run-1",
        attempt: 1,
        summary: "Running review: Review the current diff",
        failureReason: null,
        lastUpdatedAt: 11,
      },
    };
    const runtimeBeforeLateTool = structuredClone(memory.runtimeSessions.get("station:station-mu-review-running"));

    internals.handleSessionEvent({
      type: "tool.execution_start",
      data: {
        toolCallId: "tool-late-review",
        toolName: "apply_patch",
        arguments: {
          patch:
            "*** Begin Patch\n*** Update File: packages/renderer/src/components/base/BridgeRoomDetail.tsx\n@@\n- old\n+ new\n*** End Patch\n",
        },
      },
    });

    expect(memory.runtimeSessions.get("station:station-mu-review-running")).toEqual(runtimeBeforeLateTool);
    expect(JSON.parse(String(memory.sessionState.get("station:station-mu-review-running:work-session")))).toMatchObject(
      {
        currentPhase: "validate",
        readyForReview: true,
        completedAt: null,
      },
    );
  });
});
