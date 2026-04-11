import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "@spira/mcp-util/powershell";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { EmptySchema } from "../util/validation.js";

const registerPowerTool = (
  server: McpServer,
  name: string,
  description: string,
  command: string,
  action: string,
): void => {
  server.registerTool(
    name,
    {
      description,
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        await runPs(command);
        return successResult({ success: true, action }, `${action} command sent.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Failed to ${action}.`);
      }
    },
  );
};

export const registerPowerTools = (server: McpServer): void => {
  registerPowerTool(
    server,
    "system_sleep",
    "Put the Windows machine to sleep.",
    "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null",
    "sleep",
  );

  registerPowerTool(server, "system_shutdown", "Shut down the Windows machine.", "Stop-Computer -Force", "shutdown");
  registerPowerTool(server, "system_restart", "Restart the Windows machine.", "Restart-Computer -Force", "restart");
  registerPowerTool(
    server,
    "system_lock",
    "Lock the current Windows workstation.",
    "Start-Process -FilePath rundll32.exe -ArgumentList 'user32.dll,LockWorkStation' -Wait",
    "lock",
  );
};
