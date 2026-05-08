import { normalizeMcpToolAccessPolicy } from "@spira/shared";
import type { McpServerConfig, SubagentDomain } from "@spira/shared";
import { type DatabasePersistenceContext, assertDatabaseWritable } from "./context.js";
import { normalizeStringArray, normalizeText, serializeJson } from "./helpers.js";
import { mapMcpServerConfigRow, mapSubagentConfigRow } from "./mappers.js";
import type { McpServerConfigRow, SubagentConfigRow } from "./rows.js";
import type {
  McpServerConfigRecord,
  SubagentConfigRecord,
  UpsertMcpServerConfigInput,
  UpsertSubagentConfigInput,
} from "./types.js";

export const createToolingPersistence = (context: DatabasePersistenceContext) => {
  const listMcpServerConfigs = (): McpServerConfigRecord[] => {
    const rows = context.db
      .prepare(
        `SELECT
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json AS argsJson,
           env_json AS envJson,
           url,
           headers_json AS headersJson,
           tool_access_json AS toolAccessJson,
           enabled,
           auto_restart AS autoRestart,
           max_restarts AS maxRestarts,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM mcp_server_configs
         ORDER BY source ASC, name COLLATE NOCASE ASC`,
      )
      .all() as unknown as McpServerConfigRow[];

    return rows.map(mapMcpServerConfigRow);
  };

  const getMcpServerConfig = (serverId: string): McpServerConfigRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json AS argsJson,
           env_json AS envJson,
           url,
           headers_json AS headersJson,
           tool_access_json AS toolAccessJson,
           enabled,
           auto_restart AS autoRestart,
           max_restarts AS maxRestarts,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM mcp_server_configs
         WHERE id = @serverId`,
      )
      .get({ serverId }) as McpServerConfigRow | undefined;

    return row ? mapMcpServerConfigRow(row) : null;
  };

  const upsertMcpServerConfig = (input: UpsertMcpServerConfigInput): McpServerConfigRecord => {
    assertDatabaseWritable(context);
    const now = input.createdAt ?? Date.now();
    const existing = getMcpServerConfig(input.id);
    const description = normalizeText(input.description);
    const transportPayload =
      input.transport === "streamable-http"
        ? {
            command: "",
            argsJson: "[]",
            envJson: null,
            url: input.url.trim(),
            headersJson: serializeJson(input.headers ?? {}),
          }
        : {
            command: input.command.trim(),
            argsJson: serializeJson(normalizeStringArray(input.args)) ?? "[]",
            envJson: serializeJson(input.env ?? {}),
            url: null,
            headersJson: null,
          };
    const payload = {
      id: input.id,
      name: input.name.trim(),
      description,
      source: input.source,
      transport: input.transport,
      ...transportPayload,
      toolAccessJson: serializeJson(normalizeMcpToolAccessPolicy(input.toolAccess) ?? null),
      enabled: input.enabled ? 1 : 0,
      autoRestart: input.autoRestart ? 1 : 0,
      maxRestarts: input.maxRestarts ?? 3,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!payload.name) {
      throw new Error("MCP server name cannot be empty.");
    }
    if (input.transport === "stdio" && !payload.command) {
      throw new Error("MCP server command cannot be empty.");
    }
    if (input.transport === "streamable-http" && !payload.url) {
      throw new Error("MCP server URL cannot be empty.");
    }

    context.db
      .prepare(
        `INSERT INTO mcp_server_configs (
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json,
           env_json,
           url,
           headers_json,
           tool_access_json,
           enabled,
           auto_restart,
           max_restarts,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @name,
           @description,
           @source,
           @transport,
           @command,
           @argsJson,
           @envJson,
           @url,
           @headersJson,
           @toolAccessJson,
           @enabled,
           @autoRestart,
           @maxRestarts,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           source = excluded.source,
           transport = excluded.transport,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           url = excluded.url,
           headers_json = excluded.headers_json,
           tool_access_json = excluded.tool_access_json,
           enabled = excluded.enabled,
           auto_restart = excluded.auto_restart,
           max_restarts = excluded.max_restarts,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = getMcpServerConfig(input.id);
    if (!saved) {
      throw new Error(`Failed to load MCP server config ${input.id}.`);
    }

    return saved;
  };

  const seedBuiltinMcpServerConfigs = (configs: readonly McpServerConfig[]): McpServerConfigRecord[] => {
    assertDatabaseWritable(context);
    const seed = context.db.transaction((items: readonly McpServerConfig[]) =>
      items.map((config) =>
        upsertMcpServerConfig({
          ...config,
          description: config.description,
          source: "builtin",
          enabled: getMcpServerConfig(config.id)?.enabled ?? config.enabled,
        }),
      ),
    );

    return seed(configs);
  };

  const removeMcpServerConfig = (serverId: string): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare(
        `DELETE FROM mcp_server_configs
         WHERE id = @serverId`,
      )
      .run({ serverId });

    return result.changes > 0;
  };

  const setMcpServerEnabled = (serverId: string, enabled: boolean): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare(
        `UPDATE mcp_server_configs
         SET enabled = @enabled,
             updated_at = @updatedAt
         WHERE id = @serverId`,
      )
      .run({
        serverId,
        enabled: enabled ? 1 : 0,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  };

  const listSubagentConfigs = (): SubagentConfigRecord[] => {
    const rows = context.db
      .prepare(
        `SELECT
           id,
           label,
           description,
           source,
           system_prompt AS systemPrompt,
           delegation_tool_name AS delegationToolName,
           server_ids_json AS serverIdsJson,
           allowed_tool_names_json AS allowedToolNamesJson,
           allow_writes AS allowWrites,
           ready,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM subagent_configs
         ORDER BY source ASC, label COLLATE NOCASE ASC`,
      )
      .all() as unknown as SubagentConfigRow[];

    return rows.map(mapSubagentConfigRow);
  };

  const getSubagentConfig = (agentId: string): SubagentConfigRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           id,
           label,
           description,
           source,
           system_prompt AS systemPrompt,
           delegation_tool_name AS delegationToolName,
           server_ids_json AS serverIdsJson,
           allowed_tool_names_json AS allowedToolNamesJson,
           allow_writes AS allowWrites,
           ready,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM subagent_configs
         WHERE id = @agentId`,
      )
      .get({ agentId }) as SubagentConfigRow | undefined;

    return row ? mapSubagentConfigRow(row) : null;
  };

  const upsertSubagentConfig = (input: UpsertSubagentConfigInput): SubagentConfigRecord => {
    assertDatabaseWritable(context);
    const now = input.createdAt ?? Date.now();
    const existing = getSubagentConfig(input.id);
    const payload = {
      id: input.id,
      label: input.label.trim(),
      description: normalizeText(input.description),
      source: input.source,
      systemPrompt: normalizeText(input.systemPrompt),
      delegationToolName: input.delegationToolName.trim(),
      serverIdsJson: serializeJson(normalizeStringArray(input.serverIds)) ?? "[]",
      allowedToolNamesJson:
        input.allowedToolNames === null || input.allowedToolNames === undefined
          ? null
          : serializeJson(normalizeStringArray(input.allowedToolNames)),
      allowWrites: input.allowWrites ? 1 : 0,
      ready: input.ready ? 1 : 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!payload.label) {
      throw new Error("Subagent label cannot be empty.");
    }
    if (!payload.delegationToolName) {
      throw new Error("Subagent delegation tool name cannot be empty.");
    }

    context.db
      .prepare(
        `INSERT INTO subagent_configs (
           id,
           label,
           description,
           source,
           system_prompt,
           delegation_tool_name,
           server_ids_json,
           allowed_tool_names_json,
           allow_writes,
           ready,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @label,
           @description,
           @source,
           @systemPrompt,
           @delegationToolName,
           @serverIdsJson,
           @allowedToolNamesJson,
           @allowWrites,
           @ready,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           description = excluded.description,
           source = excluded.source,
           system_prompt = excluded.system_prompt,
           delegation_tool_name = excluded.delegation_tool_name,
           server_ids_json = excluded.server_ids_json,
           allowed_tool_names_json = excluded.allowed_tool_names_json,
           allow_writes = excluded.allow_writes,
           ready = excluded.ready,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = getSubagentConfig(input.id);
    if (!saved) {
      throw new Error(`Failed to load subagent config ${input.id}.`);
    }

    return saved;
  };

  const seedBuiltinSubagentConfigs = (configs: readonly SubagentDomain[]): SubagentConfigRecord[] => {
    assertDatabaseWritable(context);
    const seed = context.db.transaction((items: readonly SubagentDomain[]) =>
      items.map((config) =>
        upsertSubagentConfig({
          ...config,
          source: "builtin",
          ready: getSubagentConfig(config.id)?.ready ?? config.ready,
        }),
      ),
    );

    return seed(configs);
  };

  const removeSubagentConfig = (agentId: string): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare(
        `DELETE FROM subagent_configs
         WHERE id = @agentId`,
      )
      .run({ agentId });

    return result.changes > 0;
  };

  const setSubagentReady = (agentId: string, ready: boolean): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare(
        `UPDATE subagent_configs
         SET ready = @ready,
             updated_at = @updatedAt
         WHERE id = @agentId`,
      )
      .run({
        agentId,
        ready: ready ? 1 : 0,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  };

  return {
    listMcpServerConfigs,
    getMcpServerConfig,
    upsertMcpServerConfig,
    seedBuiltinMcpServerConfigs,
    removeMcpServerConfig,
    setMcpServerEnabled,
    listSubagentConfigs,
    getSubagentConfig,
    upsertSubagentConfig,
    seedBuiltinSubagentConfigs,
    removeSubagentConfig,
    setSubagentReady,
  };
};
