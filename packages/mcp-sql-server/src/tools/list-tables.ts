import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { successResult } from "@spira/mcp-util/results";
import { resolveDatabaseName } from "../util/guard.js";
import { ListTablesSchema } from "../util/validation.js";
import { READONLY_ANNOTATIONS, type SqlServerToolContext, sqlServerToolError } from "./common.js";

const LIST_TABLES_QUERY = `
  SELECT
    TABLE_SCHEMA AS schemaName,
    TABLE_NAME AS tableName,
    TABLE_TYPE AS tableType
  FROM INFORMATION_SCHEMA.TABLES
  WHERE (@schemaName IS NULL OR TABLE_SCHEMA = @schemaName)
  ORDER BY TABLE_SCHEMA, TABLE_NAME;
`;

export const registerListTablesTool = (server: McpServer, context: SqlServerToolContext): void => {
  server.registerTool(
    "sqlserver_list_tables",
    {
      description: "List tables and views in a SQL Server database, optionally filtered to one schema.",
      inputSchema: ListTablesSchema,
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ database, schema }) => {
      try {
        const resolvedDatabase = resolveDatabaseName(context.config, database);
        const pool = await context.pools.getDatabasePool(resolvedDatabase);
        const request = pool.request();
        request.input("schemaName", schema?.trim() || null);
        const result = await request.query<{
          schemaName: string;
          tableName: string;
          tableType: string;
        }>(LIST_TABLES_QUERY);
        const tables = result.recordset ?? [];
        return successResult({
          database: resolvedDatabase,
          ...(schema ? { schema } : {}),
          tables,
          totalCount: tables.length,
        });
      } catch (error) {
        return sqlServerToolError(error);
      }
    },
  );
};
