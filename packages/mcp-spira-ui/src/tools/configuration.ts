import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorResult, successResult } from "@spira/mcp-util/results";
import { callSpiraUiBridge } from "../util/bridge-client.js";
import {
  EmptySchema,
  PermissionResponseSchema,
  TtsProviderSchema,
  UpdateSettingsSchema,
  UpgradeResponseSchema,
} from "../util/validation.js";

export const registerConfigurationTools = (server: McpServer): void => {
  server.registerTool(
    "spira_ui_get_settings",
    {
      description: "Read Spira's current effective settings from the UI state snapshot.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult({ settings: result.snapshot.settings }, "Read the current Spira settings.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read Spira settings.");
      }
    },
  );

  server.registerTool(
    "spira_ui_update_settings",
    {
      description: "Update one or more Spira settings through the semantic UI control bridge.",
      inputSchema: UpdateSettingsSchema,
    },
    async ({ settings }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "update-settings",
            settings,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, "Updated Spira settings.");
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to update Spira settings.");
      }
    },
  );

  server.registerTool(
    "spira_ui_toggle_wake_word",
    {
      description: "Toggle Spira's wake-word listening setting.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "toggle-wake-word" },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          result,
          `Wake-word listening is now ${result.snapshot.settings.wakeWordEnabled ? "enabled" : "disabled"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to toggle Spira wake-word listening.");
      }
    },
  );

  server.registerTool(
    "spira_ui_toggle_spoken_replies",
    {
      description: "Toggle whether Spira speaks replies aloud.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: { type: "toggle-spoken-replies" },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          result,
          `Spoken replies are now ${result.snapshot.settings.voiceEnabled ? "enabled" : "disabled"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to toggle Spira spoken replies.");
      }
    },
  );

  server.registerTool(
    "spira_ui_set_tts_provider",
    {
      description: "Set Spira's active TTS provider.",
      inputSchema: TtsProviderSchema,
    },
    async ({ provider }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "set-tts-provider",
            provider,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(result, `Set Spira's TTS provider to ${provider}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to set Spira's TTS provider.");
      }
    },
  );

  server.registerTool(
    "spira_ui_get_upgrade_banner",
    {
      description: "Read Spira's current upgrade or protocol warning banner state.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          {
            upgradeBanner: result.snapshot.upgradeBanner,
            protocolBanner: result.snapshot.protocolBanner,
          },
          result.snapshot.upgradeBanner || result.snapshot.protocolBanner
            ? "Read the current Spira banner state."
            : "No upgrade or protocol banner is currently visible.",
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read Spira's banner state.");
      }
    },
  );

  server.registerTool(
    "spira_ui_respond_upgrade",
    {
      description: "Approve or deny the currently visible Spira upgrade proposal.",
      inputSchema: UpgradeResponseSchema,
    },
    async ({ proposalId, approved }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "respond-upgrade",
            proposalId,
            approved,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          result,
          approved ? "Approved the Spira upgrade prompt." : "Dismissed the Spira upgrade prompt.",
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to respond to the Spira upgrade prompt.");
      }
    },
  );

  server.registerTool(
    "spira_ui_list_permission_requests",
    {
      description: "List visible permission requests currently awaiting a response in Spira.",
      inputSchema: EmptySchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      try {
        const result = await callSpiraUiBridge({ kind: "get-snapshot" });
        if (result.type !== "snapshot") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          { requests: result.snapshot.permissions },
          `Spira currently has ${result.snapshot.permissions.length} visible permission request${result.snapshot.permissions.length === 1 ? "" : "s"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Spira permission requests.");
      }
    },
  );

  server.registerTool(
    "spira_ui_respond_permission",
    {
      description: "Approve or deny a visible Spira permission request.",
      inputSchema: PermissionResponseSchema,
    },
    async ({ requestId, approved }) => {
      try {
        const result = await callSpiraUiBridge({
          kind: "perform-action",
          action: {
            type: "respond-permission",
            requestId,
            approved,
          },
        });
        if (result.type !== "action-result") {
          return errorResult("The Spira UI bridge returned an unexpected response.");
        }
        return successResult(
          result,
          approved ? "Approved the Spira permission request." : "Denied the Spira permission request.",
        );
      } catch (error) {
        return errorResult(
          error instanceof Error ? error.message : "Failed to respond to the Spira permission request.",
        );
      }
    },
  );
};
