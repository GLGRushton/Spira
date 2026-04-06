import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const args = [
  "exec",
  "concurrently",
  "--names",
  "backend,renderer,electron",
  "--prefix-colors",
  "cyan,teal,blue",
  "pnpm --filter @spira/backend dev",
  "pnpm --filter @spira/renderer dev",
  "pnpm --filter @spira/main dev",
];

const child = spawn(command, args, {
  stdio: "inherit",
  shell: false,
});

const stopChild = (signal: NodeJS.Signals) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => {
  stopChild("SIGINT");
});

process.on("SIGTERM", () => {
  stopChild("SIGTERM");
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
