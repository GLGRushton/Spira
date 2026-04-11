import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "@spira/mcp-util/powershell";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { EmptySchema } from "../util/validation.js";

interface MemoryInfoResult extends Record<string, unknown> {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usedPercent: number;
}

export const registerMemoryTools = (server: McpServer): void => {
  server.registerTool(
    "system_get_memory_info",
    {
      description: "Get the current physical memory usage, including total, available, and used RAM.",
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
$os = Get-CimInstance Win32_OperatingSystem
$totalBytes = [int64]$os.TotalVisibleMemorySize * 1KB
$availableBytes = [int64]$os.FreePhysicalMemory * 1KB
$usedBytes = [Math]::Max($totalBytes - $availableBytes, 0)
$usedPercent = if ($totalBytes -gt 0) { [Math]::Round(($usedBytes / $totalBytes) * 100, 1) } else { 0 }
$result = @{
  totalBytes = $totalBytes
  availableBytes = $availableBytes
  usedBytes = $usedBytes
  usedPercent = $usedPercent
}
$result | ConvertTo-Json -Compress
`,
          20_000,
        );

        const memoryInfo = JSON.parse(stdout) as MemoryInfoResult;
        return successResult(memoryInfo, `Memory usage is ${memoryInfo.usedPercent}%.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get memory information.");
      }
    },
  );
};
