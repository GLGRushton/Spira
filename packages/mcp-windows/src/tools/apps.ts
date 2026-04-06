import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { quotePsString, runPs } from "../util/powershell.js";
import { errorResult, successResult } from "../util/results.js";
import { CloseAppSchema, EmptySchema, LaunchAppSchema } from "../util/validation.js";

export const registerAppTools = (server: McpServer): void => {
  server.registerTool(
    "system_launch_app",
    {
      description: "Launch an installed Windows application or executable by path or name.",
      inputSchema: LaunchAppSchema,
    },
    async ({ name }) => {
      const escapedName = quotePsString(name);

      try {
        await runPs(`
Start-Process -FilePath '${escapedName}' -ErrorAction Stop | Out-Null
`);

        return successResult({ success: true, name }, `Launched ${name}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Failed to launch ${name}.`);
      }
    },
  );

  server.registerTool(
    "system_close_app",
    {
      description: "Force close a running Windows process by process name.",
      inputSchema: CloseAppSchema,
    },
    async ({ name }) => {
      const escapedName = quotePsString(name);

      try {
        await runPs(`
Get-Process -Name '${escapedName}' -ErrorAction Stop | Stop-Process -Force -ErrorAction Stop
`);

        return successResult({ success: true, name }, `Closed ${name}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Failed to close ${name}.`);
      }
    },
  );

  server.registerTool(
    "system_list_apps",
    {
      description: "List running Windows processes with their names, PIDs, and main window titles.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$apps = @(Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Sort-Object Name | Select-Object Name, Id, MainWindowTitle)
$apps | ConvertTo-Json -Compress
`,
          20_000,
        );

        const parsed = JSON.parse(stdout) as Array<{ Name: string; Id: number; MainWindowTitle: string }>;
        const apps = (Array.isArray(parsed) ? parsed : [parsed]).map((app) => ({
          name: app.Name,
          pid: app.Id,
          mainWindowTitle: app.MainWindowTitle,
        }));

        return successResult({ apps }, `Found ${apps.length} running processes.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list running applications.");
      }
    },
  );
};
