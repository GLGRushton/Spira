import type { PermissionRequestPayload } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { getShinraStatusContext } from "./shinra-status.js";
import type { ChatMessage } from "./stores/chat-store.js";
import type { AgentRoom } from "./stores/room-store.js";

const createAssistantMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "assistant-1",
  role: "assistant",
  content: "",
  isStreaming: true,
  timestamp: 1,
  toolCalls: [],
  ...overrides,
});

const createPermissionRequest = (overrides: Partial<PermissionRequestPayload> = {}): PermissionRequestPayload => ({
  requestId: "permission-1",
  kind: "mcp",
  serverName: "Vision",
  toolName: "vision_read_screen",
  toolTitle: "Read Screen",
  readOnly: true,
  ...overrides,
});

const createAgentRoom = (overrides: Partial<AgentRoom> = {}): AgentRoom => ({
  stationId: "primary",
  roomId: "agent:windows-1",
  label: "Windows Agent",
  caption: "Delegated run active",
  status: "active",
  createdAt: 1,
  updatedAt: 2,
  activeToolCount: 1,
  toolHistory: [],
  errorHistory: [],
  ...overrides,
});

describe("getShinraStatusContext", () => {
  it("holds on permission boundaries before showing tool activity", () => {
    const context = getShinraStatusContext({
      assistantState: "thinking",
      isStreaming: true,
      messages: [
        createAssistantMessage({
          toolCalls: [
            { callId: "call-1", name: "apply_patch", args: {}, status: "running", details: "Editing AppShell" },
          ],
        }),
      ],
      permissionRequests: [createPermissionRequest()],
    });

    expect(context.phase).toBe("waiting");
    expect(context.phaseLabel).toBe("Waiting");
    expect(context.workSummary).toContain("Awaiting approval");
    expect(context.indicators).toContain("Permission boundary");
  });

  it("surfaces active screen inspection as investigation", () => {
    const context = getShinraStatusContext({
      assistantState: "thinking",
      isStreaming: false,
      messages: [],
      activeCaptures: [{ toolName: "vision_read_screen" }],
    });

    expect(context.phase).toBe("investigating");
    expect(context.workSummary).toBe("Inspecting the current screen");
    expect(context.indicators).toContain("Desktop awareness");
  });

  it("treats active subagent rooms as delegation", () => {
    const context = getShinraStatusContext({
      assistantState: "thinking",
      isStreaming: false,
      messages: [],
      agentRooms: [
        createAgentRoom({
          detail: "Inspecting the active browser tab",
          lastToolName: "vision_read_screen",
        }),
      ],
    });

    expect(context.phase).toBe("delegating");
    expect(context.workSummary).toContain("Inspecting the active browser tab");
    expect(context.indicators).toContain("Windows Agent");
  });

  it("classifies apply_patch as acting", () => {
    const context = getShinraStatusContext({
      assistantState: "thinking",
      isStreaming: false,
      messages: [
        createAssistantMessage({
          toolCalls: [
            { callId: "call-1", name: "apply_patch", args: {}, status: "running", details: "Updating status strip" },
          ],
        }),
      ],
    });

    expect(context.phase).toBe("acting");
    expect(context.phaseLabel).toBe("Acting");
    expect(context.workSummary).toBe("Updating status strip");
    expect(context.indicators).toContain("Machine access");
  });

  it("classifies rg as investigation", () => {
    const context = getShinraStatusContext({
      assistantState: "thinking",
      isStreaming: false,
      messages: [
        createAssistantMessage({
          toolCalls: [
            { callId: "call-1", name: "rg", args: {}, status: "running", details: "Searching renderer components" },
          ],
        }),
      ],
    });

    expect(context.phase).toBe("investigating");
    expect(context.workSummary).toBe("Searching renderer components");
    expect(context.indicators).toContain("Investigation");
  });

  it("reports self-upgrade activity before ordinary planning", () => {
    const context = getShinraStatusContext({
      assistantState: "thinking",
      isStreaming: false,
      messages: [],
      connectionStatus: "upgrading",
    });

    expect(context.phase).toBe("upgrading");
    expect(context.phaseLabel).toBe("Upgrading");
    expect(context.workSummary).toBe("Applying a self-upgrade");
  });
});
