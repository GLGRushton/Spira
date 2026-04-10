import type { McpTool } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import { getCopilotTools } from "./tool-bridge.js";

const createTool = (serverId: string, name: string): McpTool => ({
  serverId,
  serverName: serverId,
  name,
  description: `${name} description`,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
});

const tools = [
  createTool("windows-system", "system_get_volume"),
  createTool("spira-ui", "spira_ui_get_snapshot"),
  createTool("memories", "spira_memory_list_entries"),
];

const createAggregator = () =>
  ({
    getTools: () => tools,
    getToolsForServerIds: (serverIds: readonly string[]) => tools.filter((tool) => serverIds.includes(tool.serverId)),
    getToolsExcludingServerIds: (serverIds: readonly string[]) =>
      tools.filter((tool) => !serverIds.includes(tool.serverId)),
  }) as never;

describe("getCopilotTools", () => {
  it("excludes MCP tools from delegated server ids", () => {
    const aggregator = createAggregator();

    const toolNames = getCopilotTools(aggregator as never, { excludeServerIds: ["windows-system", "spira-ui"] }).map(
      (tool) => tool.name,
    );

    expect(toolNames).toEqual(["spira_memory_list_entries"]);
  });

  it("keeps all tools when no exclude list is provided", () => {
    const aggregator = {
      getTools: () => tools.slice(0, 2),
      getToolsForServerIds: (serverIds: readonly string[]) =>
        tools.slice(0, 2).filter((tool) => serverIds.includes(tool.serverId)),
      getToolsExcludingServerIds: (serverIds: readonly string[]) =>
        tools.slice(0, 2).filter((tool) => !serverIds.includes(tool.serverId)),
    };

    const toolNames = getCopilotTools(aggregator as never).map((tool) => tool.name);

    expect(toolNames).toEqual(["system_get_volume", "spira_ui_get_snapshot"]);
  });

  it("treats an empty exclude list as a no-op", () => {
    const aggregator = createAggregator();

    const toolNames = getCopilotTools(aggregator as never, { excludeServerIds: [] }).map((tool) => tool.name);

    expect(toolNames).toEqual(["system_get_volume", "spira_ui_get_snapshot", "spira_memory_list_entries"]);
  });

  it("keeps the upgrade tool when MCP tools are excluded", () => {
    const aggregator = createAggregator();

    const toolNames = getCopilotTools(aggregator as never, {
      excludeServerIds: ["windows-system", "spira-ui", "memories"],
      requestUpgradeProposal: async () => undefined,
    }).map((tool) => tool.name);

    expect(toolNames).toEqual(["spira_propose_upgrade"]);
  });

  it("builds scoped delegation tools alongside included MCP tools", () => {
    const aggregator = createAggregator();

    const toolNames = getCopilotTools(aggregator as never, {
      includeServerIds: ["memories"],
      delegationDomains: [
        {
          id: "windows",
          label: "Windows Agent",
          serverIds: ["windows-system"],
          delegationToolName: "delegate_to_windows",
          allowWrites: true,
          systemPrompt: "",
        },
      ],
      delegateToDomain: async () => ({
        runId: "run-1",
        domain: "windows",
        task: "inspect",
        status: "completed",
        retryCount: 0,
        startedAt: 0,
        completedAt: 1,
        durationMs: 1,
        followupNeeded: false,
        summary: "done",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
        payload: null,
      }),
      readSubagent: async () => null,
      listSubagents: async () => [],
      writeSubagent: async () => null,
      stopSubagent: async () => null,
    }).map((tool) => tool.name);

    expect(toolNames).toEqual([
      "spira_memory_list_entries",
      "delegate_to_windows",
      "read_subagent",
      "list_subagents",
      "write_subagent",
      "stop_subagent",
    ]);
  });

  it("passes background mode through delegation tools", async () => {
    const aggregator = createAggregator();
    const delegateToDomain = vi.fn().mockResolvedValue({
      agent_id: "run-1",
      runId: "run-1",
      roomId: "agent:subagent-run-1",
      domain: "windows",
      status: "running",
      startedAt: 1000,
    });

    const tool = getCopilotTools(aggregator as never, {
      delegationDomains: [
        {
          id: "windows",
          label: "Windows Agent",
          serverIds: ["windows-system"],
          delegationToolName: "delegate_to_windows",
          allowWrites: true,
          systemPrompt: "",
        },
      ],
      delegateToDomain,
    }).find((candidate) => candidate.name === "delegate_to_windows");

    const result = await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({ task: "Inspect active window", mode: "background" });

    expect(delegateToDomain).toHaveBeenCalledWith("windows", {
      task: "Inspect active window",
      mode: "background",
    });
    expect(result.textResultForLlm).toContain('"agent_id":"run-1"');
  });

  it("reads delegated subagent snapshots", async () => {
    const aggregator = createAggregator();
    const readSubagent = vi.fn().mockResolvedValue({
      agent_id: "run-1",
      runId: "run-1",
      roomId: "agent:subagent-run-1",
      domain: "windows",
      task: "Inspect active window",
      status: "completed",
      startedAt: 1000,
      updatedAt: 1200,
      completedAt: 1200,
      summary: "Done",
    });

    const tool = getCopilotTools(aggregator as never, {
      readSubagent,
    }).find((candidate) => candidate.name === "read_subagent");

    const result = await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({ agent_id: "run-1", wait: true, timeout_seconds: 5 });

    expect(readSubagent).toHaveBeenCalledWith("run-1", {
      wait: true,
      timeoutMs: 5000,
    });
    expect(result.textResultForLlm).toContain('"status":"completed"');
  });

  it("uses a bounded default timeout when waiting for delegated subagent snapshots", async () => {
    const aggregator = createAggregator();
    const readSubagent = vi.fn().mockResolvedValue({
      agent_id: "run-1",
      runId: "run-1",
      roomId: "agent:subagent-run-1",
      domain: "windows",
      task: "Inspect active window",
      status: "running",
      startedAt: 1000,
      updatedAt: 1000,
    });

    const tool = getCopilotTools(aggregator as never, {
      readSubagent,
    }).find((candidate) => candidate.name === "read_subagent");

    await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({ agent_id: "run-1", wait: true });

    expect(readSubagent).toHaveBeenCalledWith("run-1", {
      wait: true,
      timeoutMs: 30000,
    });
  });

  it("ignores timeout_seconds unless wait is enabled", async () => {
    const aggregator = createAggregator();
    const readSubagent = vi.fn().mockResolvedValue({
      agent_id: "run-1",
      runId: "run-1",
      roomId: "agent:subagent-run-1",
      domain: "windows",
      task: "Inspect active window",
      status: "running",
      startedAt: 1000,
      updatedAt: 1000,
    });

    const tool = getCopilotTools(aggregator as never, {
      readSubagent,
    }).find((candidate) => candidate.name === "read_subagent");

    await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({ agent_id: "run-1", timeout_seconds: 5 });

    expect(readSubagent).toHaveBeenCalledWith("run-1", {});
  });

  it("lists delegated subagent runs", async () => {
    const aggregator = createAggregator();
    const listSubagents = vi.fn().mockResolvedValue([
      {
        agent_id: "run-1",
        runId: "run-1",
        roomId: "agent:subagent-run-1",
        domain: "windows",
        task: "Inspect active window",
        status: "running",
        startedAt: 1000,
        updatedAt: 1000,
      },
    ]);

    const tool = getCopilotTools(aggregator as never, {
      listSubagents,
    }).find((candidate) => candidate.name === "list_subagents");

    const result = await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({ include_completed: false });

    expect(listSubagents).toHaveBeenCalledWith({ includeCompleted: false });
    expect(result.textResultForLlm).toContain('"status":"running"');
  });

  it("writes follow-up input to delegated subagent runs", async () => {
    const aggregator = createAggregator();
    const writeSubagent = vi.fn().mockResolvedValue({
      agent_id: "run-1",
      runId: "run-1",
      roomId: "agent:subagent-run-1",
      domain: "windows",
      task: "Inspect active window",
      status: "running",
      startedAt: 1000,
      updatedAt: 1100,
    });

    const tool = getCopilotTools(aggregator as never, {
      writeSubagent,
    }).find((candidate) => candidate.name === "write_subagent");

    const result = await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({ agent_id: "run-1", input: "Continue" });

    expect(writeSubagent).toHaveBeenCalledWith("run-1", "Continue");
    expect(result.textResultForLlm).toContain('"status":"running"');
  });

  it("stops delegated subagent runs", async () => {
    const aggregator = createAggregator();
    const stopSubagent = vi.fn().mockResolvedValue({
      agent_id: "run-1",
      runId: "run-1",
      roomId: "agent:subagent-run-1",
      domain: "windows",
      task: "Inspect active window",
      status: "cancelled",
      startedAt: 1000,
      updatedAt: 1200,
      completedAt: 1200,
    });

    const tool = getCopilotTools(aggregator as never, {
      stopSubagent,
    }).find((candidate) => candidate.name === "stop_subagent");

    const result = await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({ agent_id: "run-1" });

    expect(stopSubagent).toHaveBeenCalledWith("run-1");
    expect(result.textResultForLlm).toContain('"status":"cancelled"');
  });

  it("allows callers to wrap tool execution", async () => {
    const executeTool = vi.fn().mockResolvedValue("wrapped-result");
    const aggregator = {
      getTools: () => [tools[0]],
      getToolsForServerIds: (serverIds: readonly string[]) =>
        [tools[0]].filter((tool) => serverIds.includes(tool.serverId)),
      getToolsExcludingServerIds: (serverIds: readonly string[]) =>
        [tools[0]].filter((tool) => !serverIds.includes(tool.serverId)),
      executeTool,
    };

    const [tool] = getCopilotTools(aggregator as never, {
      wrapToolExecution: async (_tool, _args, execute) => `before:${String(await execute())}`,
    });

    const result = await (
      tool as unknown as {
        handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<{ textResultForLlm: string }>;
      }
    ).handler({});

    expect(executeTool).toHaveBeenCalledWith("system_get_volume", {});
    expect(result.textResultForLlm).toBe("before:wrapped-result");
  });
});
