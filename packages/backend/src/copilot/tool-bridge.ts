import { randomUUID } from "node:crypto";
import { type Tool, type ToolResultObject, defineTool } from "@github/copilot-sdk";
import { type McpTool, type UpgradeProposal, classifyUpgradeScope, getRelevantUpgradeFiles } from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { createLogger } from "../util/logger.js";

const logger = createLogger("tool-bridge");

interface ToolBridgeOptions {
  requestUpgradeProposal?: (proposal: UpgradeProposal) => Promise<void> | void;
  applyHotCapabilityUpgrade?: () => Promise<void> | void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isPermissionlessTool = (tool: McpTool): boolean =>
  !tool.name.startsWith("vision_") &&
  tool.annotations?.readOnlyHint === true &&
  tool.annotations?.destructiveHint !== true;

const toSuccessResult = (result: unknown): ToolResultObject => ({
  textResultForLlm: typeof result === "string" ? result : JSON.stringify(result ?? null),
  resultType: "success",
});

const toFailureResult = (toolName: string, error: unknown): ToolResultObject => {
  const message = error instanceof Error ? error.message : `Tool ${toolName} failed`;
  return {
    textResultForLlm: message,
    error: message,
    resultType: "failure",
  };
};

const buildTool = (tool: McpTool, aggregator: McpToolAggregator) =>
  defineTool(tool.name, {
    description: tool.description ?? `Execute the ${tool.name} tool from ${tool.serverName}.`,
    parameters: tool.inputSchema,
    skipPermission: isPermissionlessTool(tool),
    handler: async (args) => {
      try {
        return toSuccessResult(await aggregator.executeTool(tool.name, args));
      } catch (error) {
        logger.error({ error, toolName: tool.name, serverId: tool.serverId }, "MCP tool execution failed");
        return toFailureResult(tool.name, error);
      }
    },
  });

const buildUpgradeProposalTool = (
  requestUpgradeProposal: NonNullable<ToolBridgeOptions["requestUpgradeProposal"]>,
  applyHotCapabilityUpgrade?: ToolBridgeOptions["applyHotCapabilityUpgrade"],
) =>
  defineTool("spira_propose_upgrade", {
    description:
      "Ask Spira to apply local code or configuration changes. Provide the changed project-relative file paths and Spira will classify and apply the safest upgrade path automatically.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Short user-facing summary of the upgrade.",
        },
        changedFiles: {
          type: "array",
          items: { type: "string" },
          description: "Project-relative file paths touched by this upgrade.",
        },
      },
      required: ["summary", "changedFiles"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const summary = typeof payload.summary === "string" ? payload.summary : "Spira upgrade";
        const changedFiles = Array.isArray(payload.changedFiles)
          ? payload.changedFiles.filter((value: unknown): value is string => typeof value === "string")
          : [];
        const relevantChangedFiles = getRelevantUpgradeFiles(changedFiles);
        if (relevantChangedFiles.length === 0) {
          return toSuccessResult("No live Spira upgrade is needed for the changed files.");
        }

        const scope = classifyUpgradeScope(relevantChangedFiles);

        if (scope === "hot-capability") {
          if (!applyHotCapabilityUpgrade) {
            throw new Error("Hot-capability upgrades are unavailable in this backend mode");
          }

          await applyHotCapabilityUpgrade();
          return toSuccessResult(
            "MCP capability update applied without restarting the backend. Newly added MCP tools will be available on the next turn after this response finishes.",
          );
        }

        await requestUpgradeProposal({
          proposalId: randomUUID(),
          scope,
          summary,
          changedFiles: relevantChangedFiles,
          requestedAt: Date.now(),
        });
        return toSuccessResult("Upgrade proposal sent to the user for approval.");
      } catch (error) {
        logger.error({ error }, "Failed to apply or propose upgrade");
        return toFailureResult("spira_propose_upgrade", error);
      }
    },
  });

export function getCopilotTools(aggregator: McpToolAggregator, options: ToolBridgeOptions = {}): Tool[] {
  const tools = aggregator.getTools().map((tool) => buildTool(tool, aggregator));
  if (options.requestUpgradeProposal) {
    tools.push(buildUpgradeProposalTool(options.requestUpgradeProposal, options.applyHotCapabilityUpgrade));
  }
  logger.info({ toolCount: tools.length }, "Registered MCP tools with Copilot session");
  return tools;
}
