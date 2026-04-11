import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const rootDir = process.cwd();
const configPath = resolve(rootDir, "mcp-servers.json");

const serverName = process.argv[2]?.trim().toLowerCase();

if (!serverName || !/^[a-z0-9-]+$/.test(serverName)) {
  console.error("Usage: pnpm new-mcp-server <server-name>");
  console.error("Server names must use lowercase letters, numbers, and hyphens only.");
  process.exit(1);
}

const packageName = `mcp-${serverName}`;
const packageDir = resolve(rootDir, "packages", packageName);
const serverId = serverName;

const ensureNewServer = async (): Promise<void> => {
  const configRaw = await readFile(configPath, "utf8");
  const config = JSON.parse(configRaw) as { servers: Array<Record<string, unknown>> };

  if (config.servers.some((server) => server.id === serverId)) {
    throw new Error(`An MCP server with id "${serverId}" already exists in mcp-servers.json.`);
  }

  await mkdir(join(packageDir, "src", "tools"), { recursive: true });

  const files = new Map<string, string>([
    [
      join(packageDir, "package.json"),
      `{
  "name": "@spira/${packageName}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@spira/mcp-util": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
`,
    ],
    [
      join(packageDir, "tsconfig.json"),
      `{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "composite": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "references": [{ "path": "../mcp-util" }]
}
`,
    ],
    [
      join(packageDir, "src", "index.ts"),
      `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerExampleTools } from "./tools/example.js";

const server = new McpServer({
  name: "spira-${serverName}",
  version: "0.1.0",
});

registerExampleTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);
`,
    ],
    [
      join(packageDir, "src", "tools", "example.ts"),
      `import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { ExampleEchoSchema } from "@spira/mcp-util/validation";

export const registerExampleTools = (server: McpServer): void => {
  server.registerTool(
    "example_echo",
    {
      description: "Echo a message back to the caller.",
      inputSchema: ExampleEchoSchema,
    },
    async ({ message }) => {
      try {
        return successResult({ message }, message);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Echo failed.");
      }
    },
  );
};
`,
    ],
  ]);

  for (const [filePath, content] of files) {
    await writeFile(filePath, content, "utf8");
  }

  config.servers.push({
    id: serverId,
    name: serverName
      .split("-")
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join(" "),
    transport: "stdio",
    command: "tsx",
    args: [`packages/${packageName}/src/index.ts`],
    env: {},
    enabled: false,
    autoRestart: true,
    maxRestarts: 3,
  });

  await writeFile(`${configPath}`, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  console.log(`Created ${packageName} at ${packageDir}`);
  console.log("Next steps:");
  console.log("  1. pnpm install");
  console.log(`  2. pnpm -F @spira/${packageName} dev`);
  console.log(`  3. Enable "${serverId}" in mcp-servers.json when ready`);
};

ensureNewServer().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
