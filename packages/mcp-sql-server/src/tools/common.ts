import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResult } from "@spira/mcp-util/results";
import { type SqlServerPoolManager, describeSqlServerError } from "../util/connection.js";
import type { SqlServerRuntimeConfig } from "../util/env.js";

export interface SqlServerToolContext {
  config: SqlServerRuntimeConfig;
  pools: SqlServerPoolManager;
}

export const READONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

export const sqlServerToolError = (error: unknown): CallToolResult => errorResult(describeSqlServerError(error));

export type SqlServerToolRegistrar = (server: McpServer, context: SqlServerToolContext) => void;
