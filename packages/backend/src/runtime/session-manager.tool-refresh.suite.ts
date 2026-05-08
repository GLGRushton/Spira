import { describe, expect, it, vi } from "vitest";
import { createManager } from "./session-manager.test-support.js";
import type { McpTool, SessionManagerInternals } from "./session-manager.test-support.js";

describe("StationSessionManager", () => {
  it("defers MCP session refresh until the active turn becomes idle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.currentState = "thinking";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).not.toHaveBeenCalled();
    expect(internals.pendingToolRefreshSignature).toBe(internals.getCurrentToolSignature());

    internals.handleSessionEvent({ type: "session.idle", data: {} });
    await Promise.resolve();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.session).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBeNull();
  });

  it("refreshes immediately when the assistant is already idle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    internals.session = session;
    internals.activeSessionId = "test-session";
    internals.currentState = "idle";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("test-session", "copilot");
    expect(internals.session).toBeNull();
    expect(internals.activeSessionId).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBeNull();
  });

  it("deletes the persisted provider session when tool drift is detected without a live handle", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const deletePersistedSessionSpy = vi
      .spyOn(
        manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
        "deletePersistedSession",
      )
      .mockResolvedValue(undefined);

    internals.session = null;
    internals.activeSessionId = "stale-session";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(deletePersistedSessionSpy).toHaveBeenCalledWith("stale-session", "copilot");
    expect(internals.activeSessionId).toBeNull();
    expect(internals.registeredToolSignature).toBe(internals.getCurrentToolSignature());
  });

  it("clears stale binding state even if tool-drift session deletion fails", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    vi.spyOn(
      manager as unknown as { deletePersistedSession: (sessionId: string) => Promise<void> },
      "deletePersistedSession",
    ).mockRejectedValue(new Error("delete failed"));

    internals.session = null;
    internals.activeSessionId = "stale-session";
    internals.registeredToolSignature = JSON.stringify([]);

    await internals.refreshSessionForToolChanges();

    expect(internals.activeSessionId).toBeNull();
    expect(internals.pendingToolRefreshSignature).toBe(internals.getCurrentToolSignature());
  });

  it("re-checks for a newer tool signature after an in-flight refresh completes", async () => {
    const tools: McpTool[] = [
      {
        serverId: "windows-system",
        serverName: "Windows System",
        name: "system_get_memory_info",
        description: "Read memory info.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ];
    const manager = createManager(tools);
    const internals = manager as unknown as SessionManagerInternals;
    const session = {
      sessionId: "test-session",
      disconnect: vi.fn().mockResolvedValue(undefined),
    };

    internals.session = session;
    internals.currentState = "idle";
    internals.registeredToolSignature = JSON.stringify([]);
    internals.refreshingSessionForToolChanges = Promise.resolve().then(() => {
      internals.refreshingSessionForToolChanges = null;
    });

    await internals.refreshSessionForToolChanges();

    expect(session.disconnect).toHaveBeenCalledTimes(1);
    expect(internals.session).toBeNull();
    expect(internals.registeredToolSignature).toBeNull();
  });

  it("replaces delegated MCP tools with delegation tools when subagents are enabled", () => {
    const manager = createManager(
      [
        {
          serverId: "windows-system",
          serverName: "Windows System",
          name: "system_get_memory_info",
          description: "Read memory info.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          serverId: "memories",
          serverName: "Spira Memories",
          name: "spira_memory_list_entries",
          description: "List stored memories.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          serverId: "spira-ui",
          serverName: "Spira UI",
          name: "spira_ui_get_snapshot",
          description: "Read the current Spira snapshot.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      {
        envInput: { SPIRA_SUBAGENTS_ENABLED: "true" },
      },
    );
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "delegate_to_windows",
        "delegate_to_spira",
        "spira_memory_list_entries",
        "read_subagent",
        "list_subagents",
        "write_subagent",
        "stop_subagent",
      ]),
    );
    expect(toolNames).not.toContain("system_get_memory_info");
    expect(toolNames).not.toContain("delegate_to_nexus");
  });

  it("exposes host-only delegation domains when subagents are enabled", () => {
    const manager = createManager([], {
      envInput: { SPIRA_SUBAGENTS_ENABLED: "true" },
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toContain("delegate_to_code_review");
  });

  it("includes the upgrade tool for stations that allow upgrades", () => {
    const manager = createManager([], {
      requestUpgradeProposal: vi.fn(),
      applyHotCapabilityUpgrade: vi.fn(),
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).toContain("spira_propose_upgrade");
  });

  it("omits the upgrade tool for stations that disable upgrades", () => {
    const manager = createManager([], {
      requestUpgradeProposal: vi.fn(),
      applyHotCapabilityUpgrade: vi.fn(),
      allowUpgradeTools: false,
    });
    const internals = manager as unknown as SessionManagerInternals;
    const toolNames = internals.getSessionConfig().tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("spira_propose_upgrade");
  });
});
