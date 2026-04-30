import {
  type ToolBridgeOptions,
  buildDelegationTool,
  buildGetMissionContextTool,
  buildListMissionProofsTool,
  buildListMissionServicesTool,
  buildListSubagentsTool,
  buildReadSubagentTool,
  buildRecordProofResultTool,
  buildRecordValidationTool,
  buildRunMissionProofTool,
  buildSaveClassificationTool,
  buildSavePlanTool,
  buildSaveSummaryTool,
  buildSetProofStrategyTool,
  buildStartMissionServiceTool,
  buildStopMissionServiceTool,
  buildStopSubagentTool,
  buildTool,
  buildUpgradeProposalTool,
  buildWriteSubagentTool,
  filterMissionScopedMcpTools,
} from "./tool-bridge.js";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import type { ProviderId, ProviderToolDefinition, ProviderToolResultObject } from "../provider/types.js";
import { createLogger } from "../util/logger.js";
import { createHostTools } from "./host-tools.js";
import type { RuntimeCapabilitySource } from "./runtime-contract.js";

const logger = createLogger("capability-tools");

const COPILOT_RESERVED_HOST_TOOL_NAMES = new Set([
  "view",
  "glob",
  "rg",
  "write_file",
  "apply_patch",
  "powershell",
  "read_powershell",
  "write_powershell",
  "stop_powershell",
  "list_powershell",
]);

const HOST_RESOURCE_TOOL_NAMES = new Set([
  "powershell",
  "read_powershell",
  "write_powershell",
  "stop_powershell",
  "list_powershell",
]);

export type RuntimeCapabilityDefinition = {
  capabilityId: string;
  source: RuntimeCapabilitySource;
  tool: ProviderToolDefinition;
  suppressForProviders: ProviderId[];
  binding?: Record<string, unknown>;
};

const getHostCapabilitySource = (toolName: string): RuntimeCapabilitySource => {
  if (toolName.startsWith("spira_session_")) {
    return "storage-tool";
  }
  if (HOST_RESOURCE_TOOL_NAMES.has(toolName)) {
    return "host-resource";
  }
  return "host-tool";
};

const getSuppressedProviders = (source: RuntimeCapabilitySource, toolName: string): ProviderId[] => {
  if ((source === "host-tool" || source === "host-resource") && COPILOT_RESERVED_HOST_TOOL_NAMES.has(toolName)) {
    return ["copilot"];
  }
  return [];
};

export const buildRuntimeCapabilityDefinitions = (
  aggregator: McpToolAggregator,
  options: ToolBridgeOptions = {},
): RuntimeCapabilityDefinition[] => {
  const definitions: RuntimeCapabilityDefinition[] = [];
  const workingDirectory = options.workingDirectory ?? null;

  if (workingDirectory && options.includeHostTools !== false) {
    const hostTools = createHostTools({
      workingDirectory,
      sessionStorage: options.sessionStorage ?? null,
      runtimeStore: options.runtimeStore ?? null,
      runtimeSessionId: options.runtimeSessionId ?? null,
      stationId: options.stationId ?? null,
    }).map((tool) =>
      options.wrapHostToolExecution
        ? {
            ...tool,
            handler: async (args: Record<string, unknown>, ...rest: unknown[]) => {
              if (options.wrapHostToolExecution) {
                return options.wrapHostToolExecution(
                  tool,
                  args,
                  () => tool.handler(args, ...rest) as Promise<ProviderToolResultObject>,
                );
              }
              return tool.handler(args, ...rest) as Promise<ProviderToolResultObject>;
            },
          }
        : tool,
    );
    const filteredHostTools = options.filterHostTool
      ? hostTools.filter((tool) => options.filterHostTool?.(tool))
      : hostTools;

    definitions.push(
      ...filteredHostTools.map((tool) => {
        const source = getHostCapabilitySource(tool.name);
        return {
          capabilityId: tool.name,
          source,
          tool,
          suppressForProviders: getSuppressedProviders(source, tool.name),
          binding: {
            workingDirectory,
          },
        } satisfies RuntimeCapabilityDefinition;
      }),
    );
  }

  let mcpTools =
    options.includeServerIds !== undefined
      ? aggregator.getToolsForServerIds(options.includeServerIds)
      : aggregator.getTools();
  if (options.excludeServerIds?.length) {
    const excludedServerIds = new Set(options.excludeServerIds);
    mcpTools = mcpTools.filter((tool) => !excludedServerIds.has(tool.serverId));
  }
  mcpTools = filterMissionScopedMcpTools(mcpTools, options.missionWorkflowState);

  definitions.push(
    ...mcpTools.map((tool) => ({
      capabilityId: `${tool.serverId}:${tool.name}`,
      source: "mcp-tool" as const,
      tool: buildTool(tool, aggregator, options.wrapToolExecution),
      suppressForProviders: [],
      binding: {
        serverId: tool.serverId,
        serverName: tool.serverName,
      },
    })),
  );

  if (options.requestUpgradeProposal) {
    definitions.push({
      capabilityId: "spira_propose_upgrade",
      source: "synthetic-tool",
      tool: buildUpgradeProposalTool(options.requestUpgradeProposal, options.applyHotCapabilityUpgrade),
      suppressForProviders: [],
    });
  }
  const delegateToDomain = options.delegateToDomain;
  if (options.delegationDomains?.length && delegateToDomain) {
    definitions.push(
      ...options.delegationDomains.map((domain) => ({
        capabilityId: domain.delegationToolName,
        source: "delegation-tool" as const,
        tool: buildDelegationTool(domain, delegateToDomain),
        suppressForProviders: [],
        binding: {
          domainId: domain.id,
          serverIds: [...domain.serverIds],
          allowedToolNames: domain.allowedToolNames ? [...domain.allowedToolNames] : null,
          allowHostTools: domain.allowHostTools === true,
          allowWrites: domain.allowWrites,
          systemPrompt: domain.systemPrompt,
        },
      })),
    );
  }
  if (options.readSubagent) {
    definitions.push({
      capabilityId: "read_subagent",
      source: "delegation-tool",
      tool: buildReadSubagentTool(options.readSubagent),
      suppressForProviders: [],
    });
  }
  if (options.listSubagents) {
    definitions.push({
      capabilityId: "list_subagents",
      source: "delegation-tool",
      tool: buildListSubagentsTool(options.listSubagents),
      suppressForProviders: [],
    });
  }
  if (options.writeSubagent) {
    definitions.push({
      capabilityId: "write_subagent",
      source: "delegation-tool",
      tool: buildWriteSubagentTool(options.writeSubagent),
      suppressForProviders: [],
    });
  }
  if (options.stopSubagent) {
    definitions.push({
      capabilityId: "stop_subagent",
      source: "delegation-tool",
      tool: buildStopSubagentTool(options.stopSubagent),
      suppressForProviders: [],
    });
  }

  const missionBinding = options.missionRunId ? { missionRunId: options.missionRunId } : undefined;
  if (options.listMissionServices) {
    definitions.push({
      capabilityId: "spira_list_mission_services",
      source: "mission-tool",
      tool: buildListMissionServicesTool(options.listMissionServices, options.missionRunId),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.startMissionService) {
    definitions.push({
      capabilityId: "spira_start_mission_service",
      source: "mission-tool",
      tool: buildStartMissionServiceTool(options.startMissionService, options.missionRunId),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.stopMissionService) {
    definitions.push({
      capabilityId: "spira_stop_mission_service",
      source: "mission-tool",
      tool: buildStopMissionServiceTool(options.stopMissionService, options.missionRunId),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.listMissionProofs) {
    definitions.push({
      capabilityId: "spira_list_mission_proofs",
      source: "mission-tool",
      tool: buildListMissionProofsTool(options.listMissionProofs, options.missionRunId),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.runMissionProof) {
    definitions.push({
      capabilityId: "spira_run_mission_proof",
      source: "mission-tool",
      tool: buildRunMissionProofTool(options.runMissionProof, options.missionRunId),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.missionRunId && options.getMissionContext) {
    definitions.push({
      capabilityId: "get_mission_context",
      source: "mission-tool",
      tool: buildGetMissionContextTool(options.missionRunId, options.getMissionContext),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.missionRunId && options.saveMissionClassification) {
    definitions.push({
      capabilityId: "save_classification",
      source: "mission-tool",
      tool: buildSaveClassificationTool(options.missionRunId, options.saveMissionClassification),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.missionRunId && options.saveMissionPlan) {
    definitions.push({
      capabilityId: "save_plan",
      source: "mission-tool",
      tool: buildSavePlanTool(options.missionRunId, options.saveMissionPlan),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.missionRunId && options.recordMissionValidation) {
    definitions.push({
      capabilityId: "record_validation",
      source: "mission-tool",
      tool: buildRecordValidationTool(options.missionRunId, options.recordMissionValidation),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.missionRunId && options.setMissionProofStrategy) {
    definitions.push({
      capabilityId: "set_proof_strategy",
      source: "mission-tool",
      tool: buildSetProofStrategyTool(options.missionRunId, options.setMissionProofStrategy),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.missionRunId && options.recordMissionProofResult) {
    definitions.push({
      capabilityId: "record_proof_result",
      source: "mission-tool",
      tool: buildRecordProofResultTool(options.missionRunId, options.recordMissionProofResult),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }
  if (options.missionRunId && options.saveMissionSummary) {
    definitions.push({
      capabilityId: "save_summary",
      source: "mission-tool",
      tool: buildSaveSummaryTool(options.missionRunId, options.saveMissionSummary),
      suppressForProviders: [],
      binding: missionBinding,
    });
  }

  logger.info({ toolCount: definitions.length }, "Built runtime capability definitions");
  return definitions;
};

export const buildRuntimeCapabilityTools = (
  aggregator: McpToolAggregator,
  options: ToolBridgeOptions = {},
): ProviderToolDefinition[] =>
  buildRuntimeCapabilityDefinitions(aggregator, options).map((definition) => definition.tool);
