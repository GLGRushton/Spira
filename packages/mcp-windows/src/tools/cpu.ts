import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "../util/powershell.js";
import { errorResult, successResult } from "../util/results.js";
import { EmptySchema } from "../util/validation.js";

interface CpuUsageResult extends Record<string, unknown> {
  usagePercent: number;
  logicalProcessorCount: number;
}

export const registerCpuTools = (server: McpServer): void => {
  server.registerTool(
    "system_get_cpu_usage",
    {
      description: "Get the current overall CPU usage percentage and logical processor count.",
      inputSchema: EmptySchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$processors = @(Get-CimInstance Win32_Processor)
$loadMeasure = $processors | Measure-Object -Property LoadPercentage -Average
$averageLoad = if ($processors.Count -gt 0 -and $null -ne $loadMeasure.Average) {
  [Math]::Round($loadMeasure.Average, 1)
} else {
  0
}
$logicalProcessorMeasure = $processors | Measure-Object -Property NumberOfLogicalProcessors -Sum
$logicalProcessorCount = if ($null -ne $logicalProcessorMeasure.Sum) {
  [int]$logicalProcessorMeasure.Sum
} else {
  0
}
$result = @{
  usagePercent = $averageLoad
  logicalProcessorCount = $logicalProcessorCount
}
$result | ConvertTo-Json -Compress
`,
          20_000,
        );

        const cpuInfo = JSON.parse(stdout) as CpuUsageResult;
        return successResult(
          cpuInfo,
          `CPU usage is ${cpuInfo.usagePercent}% across ${cpuInfo.logicalProcessorCount} logical processor${cpuInfo.logicalProcessorCount === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get CPU usage.");
      }
    },
  );
};
