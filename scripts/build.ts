import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const rootDir = process.cwd();
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const pathsToClean = [
  "dist",
  "packages/shared/dist",
  "packages/memory-db/dist",
  "packages/backend/dist",
  "packages/main/dist",
  "packages/mcp-util/dist",
  "packages/mcp-memories/dist",
  "packages/mcp-spira-data-entry/dist",
  "packages/mcp-nexus-mods/dist",
  "packages/mcp-spira-ui/dist",
  "packages/mcp-vision/dist",
  "packages/mcp-windows/dist",
  "packages/mcp-windows-ui/dist",
  "packages/renderer/dist",
];

async function cleanBuildOutputs(): Promise<void> {
  await Promise.all(
    pathsToClean.map((relativePath) => rm(resolve(rootDir, relativePath), { recursive: true, force: true })),
  );
}

async function runPnpm(args: string[], label: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    console.log(`\n==> ${label}`);

    const child = spawn(pnpmCommand, args, {
      cwd: rootDir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`${label} exited from signal ${signal}`));
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(`${label} failed with exit code ${code ?? -1}`));
        return;
      }

      resolvePromise();
    });
  });
}

async function main(): Promise<void> {
  await cleanBuildOutputs();
  await runPnpm(["exec", "tsc", "--build", "--force"], "Building TypeScript packages");
  await runPnpm(["--filter", "@spira/renderer", "exec", "vite", "build"], "Building renderer bundle");
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
