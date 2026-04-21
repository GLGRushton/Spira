import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { successResult } from "@spira/mcp-util/results";
import { resolveDatabaseName } from "../util/guard.js";
import { DescribeTableSchema } from "../util/validation.js";
import { READONLY_ANNOTATIONS, type SqlServerToolContext, sqlServerToolError } from "./common.js";

const DESCRIBE_TABLE_QUERY = `
  SELECT
    COLUMN_NAME AS columnName,
    ORDINAL_POSITION AS ordinalPosition,
    DATA_TYPE AS dataType,
    IS_NULLABLE AS isNullable,
    COLUMN_DEFAULT AS columnDefault,
    CHARACTER_MAXIMUM_LENGTH AS maxLength,
    NUMERIC_PRECISION AS numericPrecision,
    NUMERIC_SCALE AS numericScale
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schemaName
    AND TABLE_NAME = @tableName
  ORDER BY ORDINAL_POSITION;
`;

export const registerDescribeTableTool = (server: McpServer, context: SqlServerToolContext): void => {
  server.registerTool(
    "sqlserver_describe_table",
    {
      description: "Describe a table or view by listing its visible columns and SQL Server data types.",
      inputSchema: DescribeTableSchema,
      annotations: READONLY_ANNOTATIONS,
    },
    async ({ database, schema, table }) => {
      try {
        const resolvedDatabase = resolveDatabaseName(context.config, database);
        const pool = await context.pools.getDatabasePool(resolvedDatabase);
        const request = pool.request();
        request.input("schemaName", schema.trim());
        request.input("tableName", table.trim());
        const result = await request.query<{
          columnName: string;
          ordinalPosition: number;
          dataType: string;
          isNullable: string;
          columnDefault: string | null;
          maxLength: number | null;
          numericPrecision: number | null;
          numericScale: number | null;
        }>(DESCRIBE_TABLE_QUERY);
        const columns = result.recordset ?? [];
        if (columns.length === 0) {
          throw new Error(
            `No visible table or view named "${schema}.${table}" exists in database "${resolvedDatabase}".`,
          );
        }
        return successResult({
          database: resolvedDatabase,
          schema: schema.trim(),
          table: table.trim(),
          columns,
          totalCount: columns.length,
        });
      } catch (error) {
        return sqlServerToolError(error);
      }
    },
  );
};
