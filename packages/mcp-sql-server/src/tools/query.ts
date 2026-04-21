import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { successResult } from "@spira/mcp-util/results";
import { executeSqlQuery } from "../util/connection.js";
import { assertReadOnlyQuery, resolveDatabaseName } from "../util/guard.js";
import { QuerySchema } from "../util/validation.js";
import { READONLY_ANNOTATIONS, type SqlServerToolContext, sqlServerToolError } from "./common.js";

export const registerQueryTool = (server: McpServer, context: SqlServerToolContext): void => {
  server.registerTool(
    "sqlserver_query",
    {
      description:
        "Run a single read-only SQL Server SELECT query against a specific database with enforced row and timeout caps.",
      inputSchema: QuerySchema,
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ database, sql }) => {
      try {
        const resolvedDatabase = resolveDatabaseName(context.config, database);
        const safeSql = assertReadOnlyQuery(sql);
        const pool = await context.pools.getDatabasePool(resolvedDatabase);
        const result = await executeSqlQuery(pool, safeSql, context.config);
        return successResult({
          database: resolvedDatabase,
          query: safeSql,
          ...result,
        });
      } catch (error) {
        return sqlServerToolError(error);
      }
    },
  );
};
