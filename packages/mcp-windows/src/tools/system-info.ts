import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "../util/powershell.js";
import { errorResult, successResult } from "../util/results.js";
import { EmptySchema } from "../util/validation.js";

interface SystemInfoResult extends Record<string, unknown> {
  computerName: string;
  userName: string;
  manufacturer: string;
  model: string;
  osCaption: string;
  osVersion: string;
  osBuildNumber: string;
  lastBootTime: string;
  uptimeSeconds: number;
}

interface ProcessCountResult extends Record<string, unknown> {
  processCount: number;
}

interface ServiceCountResult extends Record<string, unknown> {
  serviceCount: number;
}

export const registerSystemInfoTools = (server: McpServer): void => {
  server.registerTool(
    "system_get_upgrade_probe",
    {
      description: "Return a simple read-only probe payload for upgrade checks.",
      inputSchema: EmptySchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () =>
      successResult(
        {
          probe: "upgrade-ok",
          source: "system_get_upgrade_probe",
        },
        "Upgrade probe succeeded.",
      ),
  );

  server.registerTool(
    "system_get_upgrade_probe_details",
    {
      description: "Return a detailed read-only probe payload for upgrade checks.",
      inputSchema: EmptySchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () =>
      successResult(
        {
          probe: "upgrade-ok-2",
          source: "system_get_upgrade_probe_details",
          summary: "Detailed upgrade probe succeeded.",
        },
        "Detailed upgrade probe succeeded.",
      ),
  );

  server.registerTool(
    "system_get_system_info",
    {
      description: "Get basic Windows host, OS, and uptime details.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$os = Get-CimInstance Win32_OperatingSystem
$computer = Get-CimInstance Win32_ComputerSystem
$bootTime = if ($os.LastBootUpTime -is [datetime]) {
  [datetime]$os.LastBootUpTime
} else {
  [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$os.LastBootUpTime)
}
$result = @{
  computerName = $env:COMPUTERNAME
  userName = $env:USERNAME
  manufacturer = $computer.Manufacturer
  model = $computer.Model
  osCaption = $os.Caption
  osVersion = $os.Version
  osBuildNumber = $os.BuildNumber
  lastBootTime = $bootTime.ToString('o')
  uptimeSeconds = [int][Math]::Floor(((Get-Date) - $bootTime).TotalSeconds)
}
$result | ConvertTo-Json -Compress
`,
          20_000,
        );

        const systemInfo = JSON.parse(stdout) as SystemInfoResult;
        return successResult(systemInfo);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get system information.");
      }
    },
  );

  server.registerTool(
    "system_get_process_count",
    {
      description: "Get the total number of running Windows processes.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$result = @{
  processCount = @(Get-Process).Count
}
$result | ConvertTo-Json -Compress
`,
          20_000,
        );

        const processInfo = JSON.parse(stdout) as ProcessCountResult;
        return successResult(
          processInfo,
          `Found ${processInfo.processCount} running process${processInfo.processCount === 1 ? "" : "es"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get process count.");
      }
    },
  );

  server.registerTool(
    "system_get_service_count",
    {
      description: "Get the total number of Windows services.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$result = @{
  serviceCount = @(Get-Service).Count
}
$result | ConvertTo-Json -Compress
`,
          20_000,
        );

        const serviceInfo = JSON.parse(stdout) as ServiceCountResult;
        return successResult(
          serviceInfo,
          `Found ${serviceInfo.serviceCount} service${serviceInfo.serviceCount === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get service count.");
      }
    },
  );
};
