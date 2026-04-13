import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { callSpiraUiBridge, errorResult, successResult } from "@spira/mcp-util";
import type {
  McpServerConfig,
  McpServerUpdateConfig,
  SpiraUiCreateSubagentConfig,
  SubagentDomain,
} from "@spira/shared";
import type { z } from "zod";
import { describeSource, normalizeIdentifier } from "../util/entries.js";
import {
  CreateMcpServerSchema,
  CreateSubagentSchema,
  McpServerListSchema,
  McpServerQuerySchema,
  SubagentListSchema,
  SubagentQuerySchema,
  UpdateMcpServerSchema,
  UpdateSubagentSchema,
} from "../util/validation.js";

const getSnapshot = async () => {
  const result = await callSpiraUiBridge({ kind: "get-snapshot" });
  if (result.type !== "snapshot") {
    throw new Error("The Spira UI bridge returned an unexpected response.");
  }

  return result.snapshot;
};

const filterBySource = <T extends { source?: "builtin" | "user" }>(
  entries: readonly T[],
  source?: "builtin" | "user",
): T[] => (source ? entries.filter((entry) => (entry.source ?? "builtin") === source) : [...entries]);

const getExistingSubagent = (agents: readonly SubagentDomain[], id: string): SubagentDomain | undefined =>
  agents.find((agent) => agent.id === id);

const buildSubagentConfig = (input: z.infer<typeof CreateSubagentSchema>): SpiraUiCreateSubagentConfig => {
  const id = normalizeIdentifier(input.id ?? input.label);
  return {
    id,
    label: input.label.trim(),
    description: input.description?.trim() ?? "",
    serverIds: input.serverIds,
    allowedToolNames: input.allowedToolNames ?? null,
    allowWrites: input.allowWrites,
    systemPrompt: input.systemPrompt.trim(),
    ready: input.ready,
    delegationToolName: input.delegationToolName?.trim() || undefined,
  };
};

const buildMcpConfig = (input: z.infer<typeof CreateMcpServerSchema>): McpServerConfig => ({
  id: normalizeIdentifier(input.id ?? input.name),
  name: input.name.trim(),
  description: input.description?.trim() ?? "",
  transport: "stdio",
  command: input.command.trim(),
  args: input.args,
  env: input.env,
  toolAccess: input.toolAccess,
  enabled: input.enabled,
  autoRestart: input.autoRestart,
  maxRestarts: input.maxRestarts,
});

const buildMcpPatch = (input: z.infer<typeof UpdateMcpServerSchema>): McpServerUpdateConfig => ({
  ...(input.name !== undefined ? { name: input.name.trim() } : {}),
  ...(input.description !== undefined ? { description: input.description.trim() } : {}),
  ...(input.command !== undefined ? { command: input.command.trim() } : {}),
  ...(input.args !== undefined ? { args: input.args } : {}),
  ...(input.env !== undefined ? { env: input.env } : {}),
  ...(input.toolAccess !== undefined ? { toolAccess: input.toolAccess } : {}),
  ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
  ...(input.autoRestart !== undefined ? { autoRestart: input.autoRestart } : {}),
  ...(input.maxRestarts !== undefined ? { maxRestarts: input.maxRestarts } : {}),
});

export const registerSpiraDataEntryTools = (server: McpServer): void => {
  server.registerTool(
    "spira_data_entry_list_mcp_servers",
    {
      description: "List Spira MCP servers and explicitly mark each one as built-in or custom.",
      inputSchema: McpServerListSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ source }) => {
      try {
        const snapshot = await getSnapshot();
        const servers = filterBySource(snapshot.mcpServers, source);
        return successResult(
          { servers },
          `Found ${servers.length} ${source ? describeSource(source) : ""}${source ? " " : ""}MCP server${servers.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Spira MCP servers.");
      }
    },
  );

  server.registerTool(
    "spira_data_entry_get_mcp_server",
    {
      description: "Read a single Spira MCP server and report whether it is built-in or custom.",
      inputSchema: McpServerQuerySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ serverId }) => {
      try {
        const snapshot = await getSnapshot();
        const serverEntry = snapshot.mcpServers.find((entry) => entry.id === serverId);
        if (!serverEntry) {
          return errorResult(`No MCP server with id "${serverId}" is currently visible in Spira.`);
        }
        return successResult(
          { server: serverEntry },
          `Read ${describeSource(serverEntry.source)} MCP server "${serverId}".`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the requested MCP server.");
      }
    },
  );

  server.registerTool(
    "spira_data_entry_create_mcp_server",
    {
      description:
        "Create a custom MCP server in Spira. This tool only creates custom entries and never overwrites built-ins.",
      inputSchema: CreateMcpServerSchema,
    },
    async (input) => {
      try {
        const config = buildMcpConfig(input);
        if (!config.id) {
          return errorResult("MCP server id cannot be empty.");
        }

        const snapshot = await getSnapshot();
        const existing = snapshot.mcpServers.find((entry) => entry.id === config.id);
        if (existing) {
          return errorResult(
            `MCP server "${config.id}" already exists as a ${describeSource(existing.source)} entry. This tool only creates custom MCP servers.`,
          );
        }

        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "add-mcp-server", config },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }

        const created = result.snapshot.mcpServers.find((entry) => entry.id === config.id);
        if (!created) {
          return errorResult(`Spira did not report MCP server "${config.id}" after creation.`);
        }

        return successResult(
          { server: created },
          `Created custom MCP server "${config.id}" and Spira now reports it as ${created.state}.`,
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Failed to create the requested custom MCP server.",
        );
      }
    },
  );

  server.registerTool(
    "spira_data_entry_update_mcp_server",
    {
      description:
        "Update a custom MCP server in Spira, including explicit tool access policy for read/write guard behavior.",
      inputSchema: UpdateMcpServerSchema,
    },
    async (input) => {
      try {
        const snapshot = await getSnapshot();
        const existing = snapshot.mcpServers.find((entry) => entry.id === input.serverId);
        if (!existing) {
          return errorResult(`No MCP server with id "${input.serverId}" is currently visible in Spira.`);
        }
        if ((existing.source ?? "builtin") !== "user") {
          return errorResult(`MCP server "${input.serverId}" is built-in and cannot be edited by this tool.`);
        }

        const patch = buildMcpPatch(input);
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "update-mcp-server", serverId: input.serverId, patch },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }

        const updated = result.snapshot.mcpServers.find((entry) => entry.id === input.serverId);
        if (!updated) {
          return errorResult(`Spira did not report MCP server "${input.serverId}" after update.`);
        }

        return successResult(
          { server: updated },
          `Updated custom MCP server "${input.serverId}" and Spira now reports it as ${updated.state}.`,
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Failed to update the requested custom MCP server.",
        );
      }
    },
  );

  server.registerTool(
    "spira_data_entry_list_subagents",
    {
      description: "List Spira subagents and explicitly mark each one as built-in or custom.",
      inputSchema: SubagentListSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ source }) => {
      try {
        const snapshot = await getSnapshot();
        const agents = filterBySource(snapshot.subagents, source);
        return successResult(
          { agents },
          `Found ${agents.length} ${source ? describeSource(source) : ""}${source ? " " : ""}subagent${agents.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Spira subagents.");
      }
    },
  );

  server.registerTool(
    "spira_data_entry_get_subagent",
    {
      description: "Read a single Spira subagent and report whether it is built-in or custom.",
      inputSchema: SubagentQuerySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ agentId }) => {
      try {
        const snapshot = await getSnapshot();
        const agent = getExistingSubagent(snapshot.subagents, agentId);
        if (!agent) {
          return errorResult(`No subagent with id "${agentId}" is currently visible in Spira.`);
        }
        return successResult({ agent }, `Read ${describeSource(agent.source)} subagent "${agentId}".`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the requested subagent.");
      }
    },
  );

  server.registerTool(
    "spira_data_entry_create_subagent",
    {
      description:
        "Create a custom subagent in Spira. This tool only creates custom entries and never overwrites built-ins.",
      inputSchema: CreateSubagentSchema,
    },
    async (input) => {
      try {
        const config = buildSubagentConfig(input);
        if (!config.id) {
          return errorResult("Subagent id cannot be empty.");
        }

        const snapshot = await getSnapshot();
        const existing = getExistingSubagent(snapshot.subagents, config.id);
        if (existing) {
          return errorResult(
            `Subagent "${config.id}" already exists as a ${describeSource(existing.source)} entry. This tool only creates custom subagents.`,
          );
        }

        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "create-subagent", config },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }

        const created = getExistingSubagent(result.snapshot.subagents, config.id);
        if (!created) {
          return errorResult(`Spira did not report subagent "${config.id}" after creation.`);
        }

        return successResult({ agent: created }, `Created custom subagent "${config.id}".`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to create the requested custom subagent.");
      }
    },
  );

  server.registerTool(
    "spira_data_entry_update_subagent",
    {
      description: "Update a custom subagent in Spira without changing its identity or delegation tool name.",
      inputSchema: UpdateSubagentSchema,
    },
    async (input) => {
      try {
        const snapshot = await getSnapshot();
        const existing = getExistingSubagent(snapshot.subagents, input.agentId);
        if (!existing) {
          return errorResult(`No subagent with id "${input.agentId}" is currently visible in Spira.`);
        }
        if ((existing.source ?? "builtin") !== "user") {
          return errorResult(`Subagent "${input.agentId}" is built-in and cannot be edited by this tool.`);
        }

        const patch = {
          ...(input.description !== undefined ? { description: input.description.trim() } : {}),
          ...(input.serverIds !== undefined ? { serverIds: input.serverIds } : {}),
          ...(input.allowedToolNames !== undefined ? { allowedToolNames: input.allowedToolNames } : {}),
          ...(input.allowWrites !== undefined ? { allowWrites: input.allowWrites } : {}),
          ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt.trim() } : {}),
          ...(input.ready !== undefined ? { ready: input.ready } : {}),
        };

        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "update-subagent", agentId: input.agentId, patch },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }

        const updated = getExistingSubagent(result.snapshot.subagents, input.agentId);
        if (!updated) {
          return errorResult(`Spira did not report subagent "${input.agentId}" after update.`);
        }

        return successResult({ agent: updated }, `Updated custom subagent "${input.agentId}".`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to update the requested custom subagent.");
      }
    },
  );
};
