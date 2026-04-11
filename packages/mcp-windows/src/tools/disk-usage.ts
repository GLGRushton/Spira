import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "@spira/mcp-util/powershell";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { EmptySchema } from "../util/validation.js";

interface RawDriveUsage {
  DeviceID: string;
  VolumeName: string | null;
  FileSystem: string | null;
  Size: number;
  FreeSpace: number;
}

export const registerDiskUsageTools = (server: McpServer): void => {
  server.registerTool(
    "system_get_disk_usage",
    {
      description: "Get usage details for local fixed drives, including free and total space.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$drives = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType = 3" |
  Sort-Object DeviceID |
  Select-Object DeviceID, VolumeName, FileSystem, Size, FreeSpace)
$drives | ConvertTo-Json -Compress
`,
          20_000,
        );

        const parsed = JSON.parse(stdout) as RawDriveUsage | RawDriveUsage[];
        const drives = (Array.isArray(parsed) ? parsed : [parsed]).map((drive) => {
          const sizeBytes = Number(drive.Size);
          const freeBytes = Number(drive.FreeSpace);
          const usedBytes = Math.max(sizeBytes - freeBytes, 0);
          const usedPercent = sizeBytes > 0 ? Math.round((usedBytes / sizeBytes) * 1000) / 10 : 0;

          return {
            drive: drive.DeviceID,
            volumeName: drive.VolumeName ?? "",
            fileSystem: drive.FileSystem ?? "",
            sizeBytes,
            freeBytes,
            usedBytes,
            usedPercent,
          };
        });

        return successResult({ drives }, `Found ${drives.length} fixed drive${drives.length === 1 ? "" : "s"}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get disk usage.");
      }
    },
  );
};
