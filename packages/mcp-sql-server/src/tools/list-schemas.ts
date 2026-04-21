import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { successResult } from "@spira/mcp-util/results";
import { resolveDatabaseName } from "../util/guard.js";
import { DatabaseScopeSchema } from "../util/validation.js";
import { READONLY_ANNOTATIONS, type SqlServerToolContext, sqlServerToolError } from "./common.js";

const LIST_SCHEMAS_QUERY = `
  SELECT
    schema_name AS name
  FROM INFORMATION_SCHEMA.SCHEMATA
  ORDER BY schema_name;
`;

export const registerListSchemasTool = (server: McpServer, context: SqlServerToolContext): void => {
  server.registerTool(
    "sqlserver_list_schemas",
    {
      description: "List schemas in a specific SQL Server database that the read-only login can inspect.",
      inputSchema: DatabaseScopeSchema,
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ database }) => {
      try {
        const resolvedDatabase = resolveDatabaseName(context.config, database);
        const pool = await context.pools.getDatabasePool(resolvedDatabase);
        const result = await pool.request().query<{ name: string }>(LIST_SCHEMAS_QUERY);
        const schemas = result.recordset ?? [];
        return successResult({ database: resolvedDatabase, schemas, totalCount: schemas.length });
      } catch (error) {
        return sqlServerToolError(error);
      }
    },
  );
};
