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
  await mkdir(join(packageDir, "src", "util"), { recursive: true });

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
  "include": ["src"]
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
      join(packageDir, "src", "util", "powershell.ts"),
      `import { spawn } from "node:child_process";

export interface PsResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const quotePsString = (value: string): string => value.replaceAll("'", "''");

export async function runPs(command: string, timeoutMs = 10_000): Promise<PsResult> {
  return await new Promise<PsResult>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(\`PowerShell command timed out after \${timeoutMs}ms\`));
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      const normalizedExitCode = exitCode ?? -1;
      const result: PsResult = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: normalizedExitCode,
      };

      if (normalizedExitCode !== 0) {
        reject(new Error(result.stderr || result.stdout || \`PowerShell exited with code \${normalizedExitCode}\`));
        return;
      }

      resolve(result);
    });
  });
}
`,
    ],
    [
      join(packageDir, "src", "util", "results.ts"),
      `import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const formatText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

export const successResult = (payload: Record<string, unknown>, text?: string): CallToolResult => ({
  content: [{ type: "text", text: text ?? formatText(payload) }],
  structuredContent: payload,
});

export const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  structuredContent: { error: message },
  isError: true,
});
`,
    ],
    [
      join(packageDir, "src", "util", "validation.ts"),
      `import { z } from "zod";

export const ExampleEchoSchema = z.object({
  message: z.string().min(1).max(500),
});
`,
    ],
    [
      join(packageDir, "src", "tools", "example.ts"),
      `import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "../util/results.js";
import { ExampleEchoSchema } from "../util/validation.js";

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
