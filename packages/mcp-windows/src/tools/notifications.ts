import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { quotePsString, runPs } from "@spira/mcp-util/powershell";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { SendNotificationSchema } from "../util/validation.js";

export const registerNotificationTools = (server: McpServer): void => {
  server.registerTool(
    "system_send_notification",
    {
      description: "Show a native Windows toast notification.",
      inputSchema: SendNotificationSchema,
    },
    async ({ title, message }) => {
      const escapedTitle = quotePsString(title);
      const escapedMessage = quotePsString(message);

      try {
        await runPs(`
$title = '${escapedTitle}'
$message = '${escapedMessage}'
$titleXml = [System.Security.SecurityElement]::Escape($title)
$messageXml = [System.Security.SecurityElement]::Escape($message)
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastText02'><text>$titleXml</text><text>$messageXml</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
`);

        return successResult({ success: true, title, message }, `Notification sent: ${title}`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to send notification.");
      }
    },
  );
};
