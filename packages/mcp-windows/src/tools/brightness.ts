import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "../util/powershell.js";
import { errorResult, successResult } from "../util/results.js";
import { EmptySchema, SetBrightnessSchema } from "../util/validation.js";

const BRIGHTNESS_UNAVAILABLE_MESSAGE = "Display brightness control is unavailable on this device.";

const readBrightness = async (): Promise<number> => {
  const { stdout } = await runPs(`
$value = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction Stop |
  Select-Object -First 1 -ExpandProperty CurrentBrightness
[int]$value
`);

  return Number.parseInt(stdout, 10);
};

export const registerBrightnessTools = (server: McpServer): void => {
  server.registerTool(
    "system_get_brightness",
    {
      description: "Get the current display brightness percentage.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const level = await readBrightness();
        return successResult({ level });
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? `${BRIGHTNESS_UNAVAILABLE_MESSAGE} ${error.message}`
            : BRIGHTNESS_UNAVAILABLE_MESSAGE,
        );
      }
    },
  );

  server.registerTool(
    "system_set_brightness",
    {
      description: "Set the current display brightness percentage.",
      inputSchema: SetBrightnessSchema,
    },
    async ({ level }) => {
      try {
        await runPs(`
$methods = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction Stop |
  Select-Object -First 1
$null = $methods.WmiSetBrightness(1, ${level})
`);

        return successResult({ success: true, level }, `Brightness set to ${level}%.`);
      } catch (error) {
        return errorResult(
          error instanceof Error
            ? `${BRIGHTNESS_UNAVAILABLE_MESSAGE} ${error.message}`
            : BRIGHTNESS_UNAVAILABLE_MESSAGE,
        );
      }
    },
  );
};
