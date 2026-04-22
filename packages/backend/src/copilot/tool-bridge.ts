import { randomUUID } from "node:crypto";
import { type Tool, type ToolResultObject, defineTool } from "@github/copilot-sdk";
import {
  type McpTool,
  type MissionServiceSnapshot,
  type RunTicketRunProofResult,
  type SubagentDelegationArgs,
  type SubagentDomain,
  type SubagentEnvelope,
  type SubagentRunHandle,
  type SubagentRunSnapshot,
  type TicketRunProofSnapshotResult,
  type UpgradeProposal,
  classifyUpgradeScope,
  getRelevantUpgradeFiles,
} from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { createLogger } from "../util/logger.js";

const logger = createLogger("tool-bridge");
const DEFAULT_READ_SUBAGENT_TIMEOUT_MS = 30_000;

export interface ToolBridgeOptions {
  requestUpgradeProposal?: (proposal: UpgradeProposal) => Promise<void> | void;
  applyHotCapabilityUpgrade?: () => Promise<void> | void;
  includeServerIds?: readonly string[];
  excludeServerIds?: readonly string[];
  delegationDomains?: readonly SubagentDomain[];
  delegateToDomain?: (
    domainId: SubagentDomain["id"],
    args: SubagentDelegationArgs,
  ) => Promise<SubagentEnvelope | SubagentRunHandle>;
  readSubagent?: (
    agentId: string,
    options?: { wait?: boolean; timeoutMs?: number },
  ) => Promise<SubagentRunSnapshot | null>;
  listSubagents?: (options?: { includeCompleted?: boolean }) => Promise<SubagentRunSnapshot[]> | SubagentRunSnapshot[];
  writeSubagent?: (agentId: string, input: string) => Promise<SubagentRunSnapshot | null>;
  stopSubagent?: (agentId: string) => Promise<SubagentRunSnapshot | null>;
  listMissionServices?: (runId: string) => Promise<MissionServiceSnapshot>;
  startMissionService?: (runId: string, profileId: string) => Promise<MissionServiceSnapshot>;
  stopMissionService?: (runId: string, serviceId: string) => Promise<MissionServiceSnapshot>;
  listMissionProofs?: (runId: string) => Promise<TicketRunProofSnapshotResult>;
  runMissionProof?: (runId: string, profileId: string) => Promise<RunTicketRunProofResult>;
  wrapToolExecution?: (tool: McpTool, args: unknown, execute: () => Promise<unknown>) => Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isPermissionlessTool = (tool: McpTool): boolean =>
  !tool.name.startsWith("vision_") && tool.access?.mode === "read";

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

const buildTool = (
  tool: McpTool,
  aggregator: McpToolAggregator,
  wrapToolExecution?: ToolBridgeOptions["wrapToolExecution"],
) =>
  defineTool(tool.name, {
    description: tool.description ?? `Execute the ${tool.name} tool from ${tool.serverName}.`,
    parameters: tool.inputSchema,
    skipPermission: isPermissionlessTool(tool),
    handler: async (args) => {
      try {
        const execute = () => aggregator.executeTool(tool.name, args);
        return toSuccessResult(await (wrapToolExecution ? wrapToolExecution(tool, args, execute) : execute()));
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

const buildDelegationTool = (
  domain: SubagentDomain,
  delegateToDomain: NonNullable<ToolBridgeOptions["delegateToDomain"]>,
) =>
  defineTool(domain.delegationToolName, {
    description: `Delegate a task to the ${domain.label}. Use mode="background" to get a handle immediately.`,
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "The task the subagent should complete.",
        },
        context: {
          type: "string",
          description: "Optional supporting context for the delegated task.",
        },
        allowWrites: {
          type: "boolean",
          description: "Whether the subagent may perform state-changing actions.",
        },
        mode: {
          type: "string",
          enum: ["sync", "background"],
          description: "Run synchronously for an immediate envelope or in the background to get a handle back.",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const task = typeof payload.task === "string" ? payload.task.trim() : "";
        if (!task) {
          throw new Error(`Delegation to ${domain.label} requires a non-empty task`);
        }

        return toSuccessResult(
          await delegateToDomain(domain.id, {
            task,
            ...(typeof payload.context === "string" && payload.context.trim()
              ? { context: payload.context.trim() }
              : {}),
            ...(typeof payload.allowWrites === "boolean" ? { allowWrites: payload.allowWrites } : {}),
            ...(payload.mode === "background" || payload.mode === "sync" ? { mode: payload.mode } : {}),
          }),
        );
      } catch (error) {
        logger.error({ error, domainId: domain.id }, "Subagent delegation failed");
        return toFailureResult(domain.delegationToolName, error);
      }
    },
  });

const buildReadSubagentTool = (readSubagent: NonNullable<ToolBridgeOptions["readSubagent"]>) =>
  defineTool("read_subagent", {
    description: "Read the current status or final result of a delegated subagent run by agent_id.",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "The delegated subagent handle returned by delegate_to_* in background mode.",
        },
        wait: {
          type: "boolean",
          description: "Whether to wait briefly for the run to finish before returning.",
        },
        timeout_seconds: {
          type: "number",
          description: "Optional wait timeout in seconds when wait is true. Defaults to 30 seconds when omitted.",
        },
      },
      required: ["agent_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const agentId = typeof payload.agent_id === "string" ? payload.agent_id.trim() : "";
        if (!agentId) {
          throw new Error("read_subagent requires a non-empty agent_id");
        }

        const shouldWait = payload.wait === true;
        const snapshot = await readSubagent(agentId, {
          ...(shouldWait ? { wait: true } : {}),
          ...(shouldWait
            ? {
                timeoutMs:
                  typeof payload.timeout_seconds === "number" && Number.isFinite(payload.timeout_seconds)
                    ? Math.max(0, payload.timeout_seconds) * 1000
                    : DEFAULT_READ_SUBAGENT_TIMEOUT_MS,
              }
            : {}),
        });
        if (!snapshot) {
          throw new Error(`No delegated subagent run found for ${agentId}`);
        }

        return toSuccessResult(snapshot);
      } catch (error) {
        logger.error({ error }, "Failed to read delegated subagent run");
        return toFailureResult("read_subagent", error);
      }
    },
  });

const buildListSubagentsTool = (listSubagents: NonNullable<ToolBridgeOptions["listSubagents"]>) =>
  defineTool("list_subagents", {
    description: "List active and recently completed delegated subagent runs.",
    parameters: {
      type: "object",
      properties: {
        include_completed: {
          type: "boolean",
          description: "Whether to include recently completed runs alongside active ones.",
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        return toSuccessResult(
          await listSubagents({
            ...(typeof payload.include_completed === "boolean" ? { includeCompleted: payload.include_completed } : {}),
          }),
        );
      } catch (error) {
        logger.error({ error }, "Failed to list delegated subagent runs");
        return toFailureResult("list_subagents", error);
      }
    },
  });

const buildWriteSubagentTool = (writeSubagent: NonNullable<ToolBridgeOptions["writeSubagent"]>) =>
  defineTool("write_subagent", {
    description: "Send a follow-up message to an idle delegated subagent run by agent_id.",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "The delegated subagent handle returned by delegate_to_* in background mode.",
        },
        input: {
          type: "string",
          description: "The follow-up instruction or message to send to the delegated subagent.",
        },
      },
      required: ["agent_id", "input"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const agentId = typeof payload.agent_id === "string" ? payload.agent_id.trim() : "";
        const input = typeof payload.input === "string" ? payload.input.trim() : "";
        if (!agentId) {
          throw new Error("write_subagent requires a non-empty agent_id");
        }
        if (!input) {
          throw new Error("write_subagent requires non-empty input");
        }

        const snapshot = await writeSubagent(agentId, input);
        if (!snapshot) {
          throw new Error(`No delegated subagent run found for ${agentId}`);
        }

        return toSuccessResult(snapshot);
      } catch (error) {
        logger.error({ error }, "Failed to write to delegated subagent run");
        return toFailureResult("write_subagent", error);
      }
    },
  });

const buildStopSubagentTool = (stopSubagent: NonNullable<ToolBridgeOptions["stopSubagent"]>) =>
  defineTool("stop_subagent", {
    description: "Stop a delegated subagent run by agent_id and mark it as cancelled.",
    parameters: {
      type: "object",
      properties: {
        agent_id: {
          type: "string",
          description: "The delegated subagent handle returned by delegate_to_* in background mode.",
        },
      },
      required: ["agent_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const agentId = typeof payload.agent_id === "string" ? payload.agent_id.trim() : "";
        if (!agentId) {
          throw new Error("stop_subagent requires a non-empty agent_id");
        }

        const snapshot = await stopSubagent(agentId);
        if (!snapshot) {
          throw new Error(`No delegated subagent run found for ${agentId}`);
        }

        return toSuccessResult(snapshot);
      } catch (error) {
        logger.error({ error }, "Failed to stop delegated subagent run");
        return toFailureResult("stop_subagent", error);
      }
    },
  });

const buildListMissionServicesTool = (listMissionServices: NonNullable<ToolBridgeOptions["listMissionServices"]>) =>
  defineTool("spira_list_mission_services", {
    description: "List launchable and active mission services for a mission run by run_id.",
    parameters: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "The mission run ID, such as the runId from the current mission station.",
        },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const runId = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
        if (!runId) {
          throw new Error("spira_list_mission_services requires a non-empty run_id");
        }

        return toSuccessResult(await listMissionServices(runId));
      } catch (error) {
        logger.error({ error }, "Failed to list mission services");
        return toFailureResult("spira_list_mission_services", error);
      }
    },
  });

const buildStartMissionServiceTool = (startMissionService: NonNullable<ToolBridgeOptions["startMissionService"]>) =>
  defineTool("spira_start_mission_service", {
    description: "Start a tracked mission service profile by run_id and profile_id.",
    parameters: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "The mission run ID that owns the worktrees and launch profile.",
        },
        profile_id: {
          type: "string",
          description: "The mission service profile ID returned by spira_list_mission_services.",
        },
      },
      required: ["run_id", "profile_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const runId = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
        const profileId = typeof payload.profile_id === "string" ? payload.profile_id.trim() : "";
        if (!runId || !profileId) {
          throw new Error("spira_start_mission_service requires non-empty run_id and profile_id");
        }

        return toSuccessResult(await startMissionService(runId, profileId));
      } catch (error) {
        logger.error({ error }, "Failed to start mission service");
        return toFailureResult("spira_start_mission_service", error);
      }
    },
  });

const buildStopMissionServiceTool = (stopMissionService: NonNullable<ToolBridgeOptions["stopMissionService"]>) =>
  defineTool("spira_stop_mission_service", {
    description: "Stop a tracked mission service process by run_id and service_id.",
    parameters: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "The mission run ID that owns the tracked service process.",
        },
        service_id: {
          type: "string",
          description: "The running mission service ID returned by spira_list_mission_services.",
        },
      },
      required: ["run_id", "service_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const runId = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
        const serviceId = typeof payload.service_id === "string" ? payload.service_id.trim() : "";
        if (!runId || !serviceId) {
          throw new Error("spira_stop_mission_service requires non-empty run_id and service_id");
        }

        return toSuccessResult(await stopMissionService(runId, serviceId));
      } catch (error) {
        logger.error({ error }, "Failed to stop mission service");
        return toFailureResult("spira_stop_mission_service", error);
      }
    },
  });

const buildListMissionProofsTool = (listMissionProofs: NonNullable<ToolBridgeOptions["listMissionProofs"]>) =>
  defineTool("spira_list_mission_proofs", {
    description: "List discovered proof profiles and recent proof runs for a mission run by run_id.",
    parameters: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "The mission run ID that owns the proof-capable worktrees.",
        },
      },
      required: ["run_id"],
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const runId = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
        if (!runId) {
          throw new Error("spira_list_mission_proofs requires a non-empty run_id");
        }

        return toSuccessResult(await listMissionProofs(runId));
      } catch (error) {
        logger.error({ error }, "Failed to list mission proofs");
        return toFailureResult("spira_list_mission_proofs", error);
      }
    },
  });

const buildRunMissionProofTool = (runMissionProof: NonNullable<ToolBridgeOptions["runMissionProof"]>) =>
  defineTool("spira_run_mission_proof", {
    description: "Run a discovered mission proof profile by run_id and profile_id.",
    parameters: {
      type: "object",
      properties: {
        run_id: {
          type: "string",
          description: "The mission run ID that owns the proof-capable worktrees.",
        },
        profile_id: {
          type: "string",
          description: "The proof profile ID returned by spira_list_mission_proofs.",
        },
      },
      required: ["run_id", "profile_id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        const payload = isRecord(args) ? args : {};
        const runId = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
        const profileId = typeof payload.profile_id === "string" ? payload.profile_id.trim() : "";
        if (!runId || !profileId) {
          throw new Error("spira_run_mission_proof requires non-empty run_id and profile_id");
        }

        return toSuccessResult(await runMissionProof(runId, profileId));
      } catch (error) {
        logger.error({ error }, "Failed to run mission proof");
        return toFailureResult("spira_run_mission_proof", error);
      }
    },
  });

export function getCopilotTools(aggregator: McpToolAggregator, options: ToolBridgeOptions = {}): Tool[] {
  let mcpTools = options.includeServerIds?.length
    ? aggregator.getToolsForServerIds(options.includeServerIds)
    : aggregator.getTools();
  if (options.excludeServerIds?.length) {
    const excludedServerIds = new Set(options.excludeServerIds);
    mcpTools = mcpTools.filter((tool) => !excludedServerIds.has(tool.serverId));
  }

  const tools = mcpTools.map((tool) => buildTool(tool, aggregator, options.wrapToolExecution));
  if (options.requestUpgradeProposal) {
    tools.push(buildUpgradeProposalTool(options.requestUpgradeProposal, options.applyHotCapabilityUpgrade));
  }
  if (options.delegationDomains?.length && options.delegateToDomain) {
    const delegateToDomain = options.delegateToDomain;
    tools.push(...options.delegationDomains.map((domain) => buildDelegationTool(domain, delegateToDomain)));
  }
  if (options.readSubagent) {
    tools.push(buildReadSubagentTool(options.readSubagent));
  }
  if (options.listSubagents) {
    tools.push(buildListSubagentsTool(options.listSubagents));
  }
  if (options.writeSubagent) {
    tools.push(buildWriteSubagentTool(options.writeSubagent));
  }
  if (options.stopSubagent) {
    tools.push(buildStopSubagentTool(options.stopSubagent));
  }
  if (options.listMissionServices) {
    tools.push(buildListMissionServicesTool(options.listMissionServices));
  }
  if (options.startMissionService) {
    tools.push(buildStartMissionServiceTool(options.startMissionService));
  }
  if (options.stopMissionService) {
    tools.push(buildStopMissionServiceTool(options.stopMissionService));
  }
  if (options.listMissionProofs) {
    tools.push(buildListMissionProofsTool(options.listMissionProofs));
  }
  if (options.runMissionProof) {
    tools.push(buildRunMissionProofTool(options.runMissionProof));
  }
  logger.info({ toolCount: tools.length }, "Registered MCP tools with Copilot session");
  return tools;
}
