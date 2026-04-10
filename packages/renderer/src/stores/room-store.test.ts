import { beforeEach, describe, expect, it } from "vitest";
import { useRoomStore } from "./room-store.js";

describe("room-store subagent events", () => {
  beforeEach(() => {
    useRoomStore.getState().clearAll();
  });

  it("tracks subagent lifecycle from start to completion", () => {
    useRoomStore.getState().handleSubagentStarted({
      roomId: "agent:subagent-windows-1",
      runId: "run-1",
      domain: "windows",
      task: "Inspect active window",
      attempt: 1,
      startedAt: 1000,
      allowWrites: false,
    });

    expect(useRoomStore.getState().agentRooms[0]).toMatchObject({
      roomId: "agent:subagent-windows-1",
      kind: "subagent",
      domainId: "windows",
      runId: "run-1",
      attempt: 1,
    });

    useRoomStore.getState().handleSubagentToolCall({
      roomId: "agent:subagent-windows-1",
      runId: "run-1",
      callId: "call-1",
      toolName: "vision_read_screen",
      serverId: "vision",
      startedAt: 1100,
    });

    useRoomStore.getState().handleSubagentToolResult({
      roomId: "agent:subagent-windows-1",
      runId: "run-1",
      callId: "call-1",
      toolName: "vision_read_screen",
      serverId: "vision",
      status: "success",
      details: "Captured visible text",
      startedAt: 1100,
      completedAt: 1300,
      durationMs: 200,
    });

    useRoomStore.getState().handleSubagentDelta({
      roomId: "agent:subagent-windows-1",
      runId: "run-1",
      messageId: "msg-1",
      delta: "Scanning the window...",
    });

    useRoomStore.getState().handleSubagentCompleted({
      roomId: "agent:subagent-windows-1",
      runId: "run-1",
      domain: "windows",
      completedAt: 1500,
      envelope: {
        runId: "run-1",
        domain: "windows",
        task: "Inspect active window",
        status: "completed",
        retryCount: 0,
        startedAt: 1000,
        completedAt: 1500,
        durationMs: 500,
        followupNeeded: false,
        summary: "Read the active window text.",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
      },
    });

    const room = useRoomStore.getState().agentRooms[0];
    expect(room).toMatchObject({
      roomId: "agent:subagent-windows-1",
      kind: "subagent",
      domainId: "windows",
      attempt: 1,
      status: "idle",
      activeToolCount: 0,
      detail: "Read the active window text.",
    });
    expect(room.liveText).toBe("");
    expect(room.toolHistory).toEqual([
      expect.objectContaining({
        callId: "call-1",
        toolName: "vision_read_screen",
        status: "success",
        details: "Captured visible text",
      }),
    ]);
  });

  it("surfaces lock denials as room errors", () => {
    useRoomStore.getState().handleSubagentStarted({
      roomId: "agent:subagent-spira-1",
      runId: "run-2",
      domain: "spira",
      task: "Toggle voice setting",
      attempt: 1,
      startedAt: 2000,
      allowWrites: true,
    });

    useRoomStore.getState().handleSubagentLockDenied({
      roomId: "agent:subagent-spira-1",
      runId: "run-2",
      request: {
        intentId: "intent-1",
        runId: "run-2",
        domain: "spira",
        targetType: "spira-ui",
        targetId: "view=settings",
        action: "spira_ui_update_settings",
        toolName: "spira_ui_update_settings",
        serverId: "spira-ui",
        requestedAt: 2100,
        expiresAt: 4100,
      },
      denial: {
        intentId: "intent-1",
        runId: "run-2",
        deniedAt: 2150,
        reason: "Conflicts with run run-1",
        conflictingRunId: "run-1",
      },
    });

    const room = useRoomStore.getState().agentRooms[0];
    expect(room.status).toBe("error");
    expect(room.caption).toBe("Write lock denied");
    expect(room.detail).toBe("Conflicts with run run-1");
  });

  it("deduplicates the terminal error between error and completed events", () => {
    useRoomStore.getState().handleSubagentStarted({
      roomId: "agent:subagent-spira-2",
      runId: "run-3",
      domain: "spira",
      task: "Inspect settings",
      attempt: 1,
      startedAt: 3000,
      allowWrites: false,
    });

    const error = {
      code: "SUBAGENT_FAILURE",
      message: "Unable to finish run",
      details: "The session exhausted its retries.",
    };

    useRoomStore.getState().handleSubagentError({
      roomId: "agent:subagent-spira-2",
      runId: "run-3",
      domain: "spira",
      attempt: 2,
      error,
      willRetry: false,
      occurredAt: 3100,
    });

    useRoomStore.getState().handleSubagentCompleted({
      roomId: "agent:subagent-spira-2",
      runId: "run-3",
      domain: "spira",
      completedAt: 3200,
      envelope: {
        runId: "run-3",
        domain: "spira",
        task: "Inspect settings",
        status: "failed",
        retryCount: 1,
        startedAt: 3000,
        completedAt: 3200,
        durationMs: 200,
        followupNeeded: true,
        summary: "Unable to finish run",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [error],
      },
    });

    expect(useRoomStore.getState().agentRooms[0]?.errorHistory).toEqual([error]);
  });

  it("reflects subagent status updates including expiry metadata", () => {
    useRoomStore.getState().handleSubagentStatus({
      roomId: "agent:subagent-nexus-1",
      runId: "run-4",
      domain: "nexus",
      status: "expired",
      occurredAt: 4000,
      summary: "Delegated search expired after inactivity.",
      expiresAt: 4300,
    });

    expect(useRoomStore.getState().agentRooms[0]).toMatchObject({
      roomId: "agent:subagent-nexus-1",
      runId: "run-4",
      domainId: "nexus",
      status: "idle",
      caption: "Run expired",
      detail: "Delegated search expired after inactivity.",
      expiresAt: 4300,
    });
  });

  it("routes subagent control tool calls back into the existing delegated room", () => {
    useRoomStore.getState().handleSubagentStarted({
      roomId: "agent:subagent-spira-lookup",
      runId: "run-lookup",
      domain: "spira",
      task: "Inspect settings",
      attempt: 1,
      startedAt: 5000,
      allowWrites: false,
    });

    useRoomStore.getState().handleToolCall(
      {
        callId: "call-lookup",
        name: "read_subagent",
        status: "running",
        args: { agent_id: "run-lookup" },
      },
      [],
    );

    expect(useRoomStore.getState().agentRooms.some((room) => room.roomId === "agent:run-lookup")).toBe(false);
  });
});
