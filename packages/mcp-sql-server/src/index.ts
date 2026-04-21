import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerDescribeTableTool } from "./tools/describe-table.js";
import { registerListDatabasesTool } from "./tools/list-databases.js";
import { registerListSchemasTool } from "./tools/list-schemas.js";
import { registerListTablesTool } from "./tools/list-tables.js";
import { registerQueryTool } from "./tools/query.js";
import { SqlServerPoolManager } from "./util/connection.js";
import { loadSqlServerRuntimeConfig } from "./util/env.js";

const server = new McpServer({
  name: "spira-sql-server",
  version: "0.1.0",
});

const config = loadSqlServerRuntimeConfig();
const pools = new SqlServerPoolManager(config);
const context = { config, pools };

registerListDatabasesTool(server, context);
registerListSchemasTool(server, context);
registerListTablesTool(server, context);
registerDescribeTableTool(server, context);
registerQueryTool(server, context);

const cleanupPools = () => {
  void pools.closeAll().catch((error) => {
    console.warn("[spira-sql-server] Failed to close SQL Server pools during shutdown", error);
  });
};

process.once("beforeExit", cleanupPools);
process.once("SIGINT", cleanupPools);
process.once("SIGTERM", cleanupPools);

const transport = new StdioServerTransport();
await server.connect(transport);
