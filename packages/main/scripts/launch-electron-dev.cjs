const { spawn } = require("node:child_process");

const env = { ...process.env };
const nodeOptions = env.NODE_OPTIONS
  ?.split(/\s+/)
  .filter(Boolean)
  .filter((option) => option !== "--use-system-ca");

if (nodeOptions && nodeOptions.length > 0) {
  env.NODE_OPTIONS = nodeOptions.join(" ");
} else {
  delete env.NODE_OPTIONS;
}

if (process.argv.includes("--external")) {
  env.SPIRA_EXTERNAL_BACKEND = "1";
} else {
  env.SPIRA_BACKEND_EXEC_PATH = process.execPath;
}

spawn("electron", ["./dev-main.mjs"], {
  stdio: "inherit",
  shell: true,
  env,
}).on("exit", (code) => process.exit(code ?? 0));
