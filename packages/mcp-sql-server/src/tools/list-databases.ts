import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { successResult } from "@spira/mcp-util/results";
import { READONLY_ANNOTATIONS, type SqlServerToolContext, sqlServerToolError } from "./common.js";

const LIST_DATABASES_QUERY = `
  SELECT
    name,
    compatibility_level AS compatibilityLevel,
    create_date AS createdAt
  FROM sys.databases
  WHERE state = 0
    AND HAS_DBACCESS(name) = 1
    AND database_id > 4
  ORDER BY name;
`;

export const registerListDatabasesTool = (server: McpServer, context: SqlServerToolContext): void => {
  server.registerTool(
    "sqlserver_list_databases",
    {
      description: "List SQL Server databases visible to the configured read-only login.",
      annotations: READONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const pool = await context.pools.getMasterPool();
        const result = await pool.request().query<{
          name: string;
          compatibilityLevel: number;
          createdAt: Date;
        }>(LIST_DATABASES_QUERY);
        const allowed = new Set(context.config.allowedDatabases.map((database) => database.toLowerCase()));
        const databases = (result.recordset ?? []).filter(
          (entry: { name: string }) => allowed.size === 0 || allowed.has(entry.name.toLowerCase()),
        );
        return successResult({ databases, totalCount: databases.length });
      } catch (error) {
        return sqlServerToolError(error);
      }
    },
  );
};
