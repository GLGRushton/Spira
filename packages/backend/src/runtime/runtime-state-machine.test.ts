import { describe, expect, it } from "vitest";
import {
  buildRuntimeCancellationState,
  buildRuntimePermissionState,
  buildRuntimeTurnContract,
  completeRuntimeCancellation,
  requestRuntimeCancellation,
} from "./runtime-state-machine.js";

describe("runtime-state-machine", () => {
  it("derives shared runtime turn contracts", () => {
    expect(
      buildRuntimeTurnContract({
        isThinking: true,
        activeToolCallIds: ["tool-1"],
        lastUserMessageId: "user-1",
        lastAssistantMessageId: "assistant-1",
      }),
    ).toEqual({
      state: "executing_tool",
      activeToolCallIds: ["tool-1"],
      lastUserMessageId: "user-1",
      lastAssistantMessageId: "assistant-1",
    });

    expect(
      buildRuntimeTurnContract({
        isThinking: true,
        activeToolCallIds: [],
        lastUserMessageId: "user-2",
        lastAssistantMessageId: null,
        waitingForPermission: true,
      }),
    ).toEqual({
      state: "waiting_for_permission",
      activeToolCallIds: [],
      lastUserMessageId: "user-2",
      lastAssistantMessageId: null,
    });
  });

  it("derives shared permission and cancellation states", () => {
    expect(
      buildRuntimePermissionState({
        pendingRequestIds: ["req-1"],
        lastResolvedAt: 10,
      }),
    ).toEqual({
      status: "pending",
      pendingRequestIds: ["req-1"],
      lastResolvedAt: 10,
    });
    expect(
      buildRuntimePermissionState({
        pendingRequestIds: [],
        lastResolvedAt: 15,
      }),
    ).toEqual({
      status: "resolved",
      pendingRequestIds: [],
      lastResolvedAt: 15,
    });

    expect(buildRuntimeCancellationState({ requestedAt: 11, completedAt: null })).toEqual({
      status: "requested",
      requestedAt: 11,
      completedAt: null,
    });
    expect(buildRuntimeCancellationState({ requestedAt: null, completedAt: 12, completed: true })).toEqual({
      status: "completed",
      requestedAt: null,
      completedAt: 12,
    });
  });

  it("marks cancellation request and completion transitions consistently", () => {
    expect(requestRuntimeCancellation(21)).toEqual({
      requestedAt: 21,
      completedAt: null,
    });
    expect(completeRuntimeCancellation(34)).toEqual({
      requestedAt: null,
      completedAt: 34,
    });
  });
});
