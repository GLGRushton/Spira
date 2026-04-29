const { spawn, spawnSync } = require("node:child_process");

const env = { ...process.env };
const nodeOptions = env.NODE_OPTIONS?.split(/\s+/)
  .filter(Boolean)
  .filter((option) => option !== "--use-system-ca");

if (nodeOptions && nodeOptions.length > 0) {
  env.NODE_OPTIONS = nodeOptions.join(" ");
} else {
  env.NODE_OPTIONS = undefined;
}

if (process.argv.includes("--external")) {
  env.SPIRA_EXTERNAL_BACKEND = "1";
} else {
  env.SPIRA_BACKEND_EXEC_PATH = process.execPath;
}

const stopStaleWindowsDevProcesses = () => {
  if (process.platform !== "win32" || process.argv.includes("--external")) {
    return;
  }

  const cleanupScript = `
$portPids = @(Get-NetTCPConnection -State Listen -LocalPort 9720 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
$matchingPortPids = @(Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -in $portPids -and
  $_.Name -match '^(node|electron)\\.exe$' -and
  $_.CommandLine -match 'packages\\\\backend\\\\src\\\\index\\.ts|dev-main\\.mjs|C:\\\\GitHub\\\\Spira'
} | Select-Object -ExpandProperty ProcessId)
$electronPids = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'electron.exe' -and $_.CommandLine -match 'dev-main\\.mjs'
} | Select-Object -ExpandProperty ProcessId)
$ids = @($matchingPortPids + $electronPids | Sort-Object -Unique)
if ($ids.Count -gt 0) {
  Write-Host ('[spira-dev] stopping stale dev processes: ' + ($ids -join ', '))
}
foreach ($id in $ids) {
  try {
    Stop-Process -Id $id -Force -ErrorAction Stop
  } catch {
  }
}
`;

  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cleanupScript], {
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    console.warn("[spira-dev] failed to stop stale dev processes", result.error);
  }
};

stopStaleWindowsDevProcesses();

spawn("electron", ["./dev-main.mjs"], {
  stdio: "inherit",
  shell: true,
  env,
}).on("exit", (code) => process.exit(code ?? 0));
