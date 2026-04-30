import { randomUUID } from "node:crypto";
import {
  type McpTool,
  type MissionServiceSnapshot,
  type RunTicketRunProofResult,
  type SubagentDelegationArgs,
  type SubagentDomain,
  type SubagentEnvelope,
  type SubagentRunHandle,
  type SubagentRunSnapshot,
  type TicketRunMissionClassification,
  type TicketRunMissionPhase,
  type TicketRunMissionPlan,
  type TicketRunMissionProofStrategy,
  type TicketRunMissionSummary,
  type TicketRunMissionValidationRecord,
  type TicketRunProofArtifact,
  type TicketRunProofRunSummary,
  type TicketRunProofSnapshotResult,
  type UpgradeProposal,
  classifyUpgradeScope,
  getRelevantUpgradeFiles,
} from "@spira/shared";
import {
  TICKET_RUN_MISSION_CLASSIFICATIONS,
  TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES,
  TICKET_RUN_MISSION_VALIDATION_KINDS,
  TICKET_RUN_MISSION_VALIDATION_STATUSES,
  TICKET_RUN_PROOF_ARTIFACT_KINDS,
  TICKET_RUN_PROOF_RUN_STATUSES,
  TICKET_RUN_PROOF_STATUSES,
} from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import type { MissionContextSnapshot, MissionProofResultInput } from "../missions/mission-lifecycle.js";
import type { MissionWorkflowState } from "../missions/mission-workflow-guard.js";
import type { ProviderToolDefinition, ProviderToolResultObject } from "../provider/types.js";
import { createHostTools } from "../runtime/host-tools.js";
import type { RuntimeStore } from "../runtime/runtime-store.js";
import type { StationSessionStorage } from "../runtime/station-session-storage.js";
import { createLogger } from "../util/logger.js";

const logger = createLogger("tool-bridge");
const DEFAULT_READ_SUBAGENT_TIMEOUT_MS = 30_000;
const defineTool = (name: string, config: Omit<ProviderToolDefinition, "name">): ProviderToolDefinition => ({
  name,
  ...config,
});

export interface ToolBridgeOptions {
  workingDirectory?: string | null;
  includeHostTools?: boolean;
  sessionStorage?: StationSessionStorage | null;
  runtimeStore?: RuntimeStore | null;
  runtimeSessionId?: string | null;
  stationId?: string | null;
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
  missionRunId?: string;
  getMissionContext?: (runId: string) => Promise<MissionContextSnapshot>;
  saveMissionClassification?: (
    runId: string,
    classification: TicketRunMissionClassification,
  ) => Promise<unknown> | unknown;
  saveMissionPlan?: (runId: string, plan: TicketRunMissionPlan) => Promise<unknown> | unknown;
  setMissionPhase?: (runId: string, phase: TicketRunMissionPhase) => Promise<unknown> | unknown;
  recordMissionValidation?: (runId: string, validation: TicketRunMissionValidationRecord) => Promise<unknown> | unknown;
  setMissionProofStrategy?: (runId: string, proofStrategy: TicketRunMissionProofStrategy) => Promise<unknown> | unknown;
  recordMissionProofResult?: (runId: string, result: MissionProofResultInput) => Promise<unknown> | unknown;
  saveMissionSummary?: (runId: string, missionSummary: TicketRunMissionSummary) => Promise<unknown> | unknown;
  missionWorkflowState?: MissionWorkflowState | null;
  wrapToolExecution?: (tool: McpTool, args: unknown, execute: () => Promise<unknown>) => Promise<unknown>;
  wrapHostToolExecution?: (
    tool: ProviderToolDefinition,
    args: Record<string, unknown>,
    execute: () => Promise<ProviderToolResultObject>,
  ) => Promise<ProviderToolResultObject>;
  filterHostTool?: (tool: ProviderToolDefinition) => boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const _isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const assertEnumValue = <T extends string>(value: string, values: readonly T[], label: string): T => {
  if (!values.includes(value as T)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value as T;
};

const parseProofArtifact = (value: unknown): TicketRunProofArtifact => {
  if (!isRecord(value)) {
    throw new Error("Proof artifacts require an object payload.");
  }
  const artifactId = typeof value.artifactId === "string" ? value.artifactId.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const artifactPath = typeof value.path === "string" ? value.path.trim() : "";
  const fileUrl = typeof value.fileUrl === "string" ? value.fileUrl.trim() : "";
  const kind = assertEnumValue(
    typeof value.kind === "string" ? value.kind : "",
    TICKET_RUN_PROOF_ARTIFACT_KINDS,
    "proof artifact kind",
  );
  if (!artifactId || !label || !artifactPath || !fileUrl) {
    throw new Error("Proof artifacts require non-empty artifactId, label, path, and fileUrl values.");
  }
  return {
    artifactId,
    kind,
    label,
    path: artifactPath,
    fileUrl,
  };
};

const parseMissionClassification = (value: unknown): TicketRunMissionClassification => {
  if (!isRecord(value)) {
    throw new Error("save_classification requires a classification object.");
  }
  const kind = assertEnumValue(
    typeof value.kind === "string" ? value.kind : "",
    TICKET_RUN_MISSION_CLASSIFICATIONS,
    "classification kind",
  );
  const scopeSummary = typeof value.scopeSummary === "string" ? value.scopeSummary.trim() : "";
  if (!scopeSummary) {
    throw new Error("Classification requires a non-empty scopeSummary.");
  }
  return {
    kind,
    scopeSummary,
    acceptanceCriteria: asStringArray(value.acceptanceCriteria),
    impactedRepoRelativePaths: asStringArray(value.impactedRepoRelativePaths),
    risks: asStringArray(value.risks),
    uiChange: value.uiChange === true,
    proofRequired: value.proofRequired === true,
    proofArtifactMode: assertEnumValue(
      typeof value.proofArtifactMode === "string" ? value.proofArtifactMode : "none",
      TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES,
      "proof artifact mode",
    ),
    rationale: typeof value.rationale === "string" ? value.rationale.trim() || null : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
  };
};

const parseMissionPlan = (value: unknown): TicketRunMissionPlan => {
  if (!isRecord(value)) {
    throw new Error("save_plan requires a plan object.");
  }
  return {
    steps: asStringArray(value.steps),
    touchedRepoRelativePaths: asStringArray(value.touchedRepoRelativePaths),
    validationPlan: asStringArray(value.validationPlan),
    proofIntent: typeof value.proofIntent === "string" ? value.proofIntent.trim() || null : null,
    blockers: asStringArray(value.blockers),
    assumptions: asStringArray(value.assumptions),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
  };
};

const parseMissionValidation = (runId: string, value: unknown): TicketRunMissionValidationRecord => {
  if (!isRecord(value)) {
    throw new Error("record_validation requires a validation object.");
  }
  const validationId = typeof value.validationId === "string" ? value.validationId.trim() : "";
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const cwd = typeof value.cwd === "string" ? value.cwd.trim() : "";
  if (!validationId || !command || !cwd) {
    throw new Error("Validation requires non-empty validationId, command, and cwd values.");
  }
  return {
    validationId,
    runId,
    kind: assertEnumValue(
      typeof value.kind === "string" ? value.kind : "",
      TICKET_RUN_MISSION_VALIDATION_KINDS,
      "validation kind",
    ),
    command,
    cwd,
    status: assertEnumValue(
      typeof value.status === "string" ? value.status : "",
      TICKET_RUN_MISSION_VALIDATION_STATUSES,
      "validation status",
    ),
    summary: typeof value.summary === "string" ? value.summary.trim() || null : null,
    artifacts: Array.isArray(value.artifacts) ? value.artifacts.map((artifact) => parseProofArtifact(artifact)) : [],
    startedAt: typeof value.startedAt === "number" ? value.startedAt : Date.now(),
    completedAt: typeof value.completedAt === "number" ? value.completedAt : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
  };
};

const parseMissionProofStrategy = (runId: string, value: unknown): TicketRunMissionProofStrategy => {
  if (!isRecord(value)) {
    throw new Error("set_proof_strategy requires a proof strategy object.");
  }
  const adapterId = typeof value.adapterId === "string" ? value.adapterId.trim() : "";
  const repoRelativePath = typeof value.repoRelativePath === "string" ? value.repoRelativePath.trim() : "";
  const command = typeof value.command === "string" ? value.command.trim() : "";
  const rationale = typeof value.rationale === "string" ? value.rationale.trim() : "";
  if (!adapterId || !repoRelativePath || !command || !rationale) {
    throw new Error("Proof strategy requires non-empty adapterId, repoRelativePath, command, and rationale values.");
  }
  return {
    runId,
    adapterId,
    repoRelativePath,
    scenarioPath: typeof value.scenarioPath === "string" ? value.scenarioPath.trim() || null : null,
    scenarioName: typeof value.scenarioName === "string" ? value.scenarioName.trim() || null : null,
    command,
    artifactMode: assertEnumValue(
      typeof value.artifactMode === "string" ? value.artifactMode : "",
      TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES,
      "proof artifact mode",
    ),
    rationale,
    metadata: isRecord(value.metadata) ? value.metadata : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
  };
};

const parseMissionProofRun = (runId: string, value: unknown): TicketRunProofRunSummary => {
  if (!isRecord(value)) {
    throw new Error("record_proof_result proofRun must be an object.");
  }
  const proofRunId = typeof value.proofRunId === "string" ? value.proofRunId.trim() : "";
  const profileId = typeof value.profileId === "string" ? value.profileId.trim() : "";
  const profileLabel = typeof value.profileLabel === "string" ? value.profileLabel.trim() : "";
  if (!proofRunId || !profileId || !profileLabel) {
    throw new Error("Proof runs require non-empty proofRunId, profileId, and profileLabel values.");
  }
  return {
    proofRunId,
    runId,
    profileId,
    profileLabel,
    status: assertEnumValue(
      typeof value.status === "string" ? value.status : "",
      TICKET_RUN_PROOF_RUN_STATUSES,
      "proof run status",
    ),
    summary: typeof value.summary === "string" ? value.summary.trim() || null : null,
    startedAt: typeof value.startedAt === "number" ? value.startedAt : Date.now(),
    completedAt: typeof value.completedAt === "number" ? value.completedAt : null,
    exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
    command: typeof value.command === "string" ? value.command.trim() || null : null,
    artifacts: Array.isArray(value.artifacts) ? value.artifacts.map((artifact) => parseProofArtifact(artifact)) : [],
  };
};

const parseMissionProofResult = (runId: string, value: unknown): MissionProofResultInput => {
  if (!isRecord(value) || !isRecord(value.proof)) {
    throw new Error("record_proof_result requires a proof result object with a proof payload.");
  }
  return {
    proof: {
      status: assertEnumValue(
        typeof value.proof.status === "string" ? value.proof.status : "",
        TICKET_RUN_PROOF_STATUSES,
        "proof status",
      ),
      lastProofRunId: typeof value.proof.lastProofRunId === "string" ? value.proof.lastProofRunId.trim() || null : null,
      lastProofProfileId:
        typeof value.proof.lastProofProfileId === "string" ? value.proof.lastProofProfileId.trim() || null : null,
      lastProofAt: typeof value.proof.lastProofAt === "number" ? value.proof.lastProofAt : null,
      lastProofSummary:
        typeof value.proof.lastProofSummary === "string" ? value.proof.lastProofSummary.trim() || null : null,
      staleReason: typeof value.proof.staleReason === "string" ? value.proof.staleReason.trim() || null : null,
    },
    proofRun:
      value.proofRun === null || value.proofRun === undefined ? null : parseMissionProofRun(runId, value.proofRun),
  };
};

const parseMissionSummary = (value: unknown): TicketRunMissionSummary => {
  if (!isRecord(value)) {
    throw new Error("save_summary requires a summary object.");
  }
  const completedWork = typeof value.completedWork === "string" ? value.completedWork.trim() : "";
  if (!completedWork) {
    throw new Error("Mission summary requires non-empty completedWork text.");
  }
  return {
    completedWork,
    changedRepoRelativePaths: asStringArray(value.changedRepoRelativePaths),
    validationSummary: typeof value.validationSummary === "string" ? value.validationSummary.trim() || null : null,
    proofSummary: typeof value.proofSummary === "string" ? value.proofSummary.trim() || null : null,
    openQuestions: asStringArray(value.openQuestions),
    followUps: asStringArray(value.followUps),
    createdAt: typeof value.createdAt === "number" ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : Date.now(),
  };
};

const resolveScopedMissionRunId = (payload: Record<string, unknown>, missionRunId?: string): string => {
  const requestedRunId = typeof payload.run_id === "string" ? payload.run_id.trim() : "";
  if (missionRunId) {
    if (requestedRunId && requestedRunId !== missionRunId) {
      throw new Error(`This mission station is bound to run_id ${missionRunId}.`);
    }
    return missionRunId;
  }
  if (!requestedRunId) {
    throw new Error("A non-empty run_id is required.");
  }
  return requestedRunId;
};

const isPermissionlessTool = (tool: McpTool): boolean =>
  !tool.name.startsWith("vision_") && tool.access?.mode === "read";

export const filterMissionScopedMcpTools = (
  tools: readonly McpTool[],
  _workflow: MissionWorkflowState | null | undefined,
): McpTool[] => {
  return [...tools];
};

const toSuccessResult = (result: unknown): ProviderToolResultObject => ({
  textResultForLlm: typeof result === "string" ? result : JSON.stringify(result ?? null),
  resultType: "success",
});

const toFailureResult = (toolName: string, error: unknown): ProviderToolResultObject => {
  const message = error instanceof Error ? error.message : `Tool ${toolName} failed`;
  return {
    textResultForLlm: message,
    error: message,
    resultType: "failure",
  };
};

export const buildTool = (
  tool: McpTool,
  aggregator: McpToolAggregator,
  wrapToolExecution?: ToolBridgeOptions["wrapToolExecution"],
): ProviderToolDefinition => ({
  name: tool.name,
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

export const buildUpgradeProposalTool = (
  requestUpgradeProposal: NonNullable<ToolBridgeOptions["requestUpgradeProposal"]>,
  applyHotCapabilityUpgrade?: ToolBridgeOptions["applyHotCapabilityUpgrade"],
): ProviderToolDefinition => ({
  name: "spira_propose_upgrade",
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

export const buildDelegationTool = (
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
        model: {
          type: "string",
          description: "Optional model ID to request for the delegated run.",
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
            ...(typeof payload.model === "string" && payload.model.trim() ? { model: payload.model.trim() } : {}),
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

export const buildReadSubagentTool = (readSubagent: NonNullable<ToolBridgeOptions["readSubagent"]>) =>
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

export const buildListSubagentsTool = (listSubagents: NonNullable<ToolBridgeOptions["listSubagents"]>) =>
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

export const buildWriteSubagentTool = (writeSubagent: NonNullable<ToolBridgeOptions["writeSubagent"]>) =>
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

export const buildStopSubagentTool = (stopSubagent: NonNullable<ToolBridgeOptions["stopSubagent"]>) =>
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

export const buildListMissionServicesTool = (
  listMissionServices: NonNullable<ToolBridgeOptions["listMissionServices"]>,
  missionRunId?: string,
) =>
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
        const runId = resolveScopedMissionRunId(payload, missionRunId);

        return toSuccessResult(await listMissionServices(runId));
      } catch (error) {
        logger.error({ error }, "Failed to list mission services");
        return toFailureResult("spira_list_mission_services", error);
      }
    },
  });

export const buildStartMissionServiceTool = (
  startMissionService: NonNullable<ToolBridgeOptions["startMissionService"]>,
  missionRunId?: string,
) =>
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
        const runId = resolveScopedMissionRunId(payload, missionRunId);
        const profileId = typeof payload.profile_id === "string" ? payload.profile_id.trim() : "";
        if (!profileId) {
          throw new Error("spira_start_mission_service requires a non-empty profile_id");
        }

        return toSuccessResult(await startMissionService(runId, profileId));
      } catch (error) {
        logger.error({ error }, "Failed to start mission service");
        return toFailureResult("spira_start_mission_service", error);
      }
    },
  });

export const buildStopMissionServiceTool = (
  stopMissionService: NonNullable<ToolBridgeOptions["stopMissionService"]>,
  missionRunId?: string,
) =>
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
        const runId = resolveScopedMissionRunId(payload, missionRunId);
        const serviceId = typeof payload.service_id === "string" ? payload.service_id.trim() : "";
        if (!serviceId) {
          throw new Error("spira_stop_mission_service requires a non-empty service_id");
        }

        return toSuccessResult(await stopMissionService(runId, serviceId));
      } catch (error) {
        logger.error({ error }, "Failed to stop mission service");
        return toFailureResult("spira_stop_mission_service", error);
      }
    },
  });

export const buildListMissionProofsTool = (
  listMissionProofs: NonNullable<ToolBridgeOptions["listMissionProofs"]>,
  missionRunId?: string,
) =>
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
        const runId = resolveScopedMissionRunId(payload, missionRunId);

        return toSuccessResult(await listMissionProofs(runId));
      } catch (error) {
        logger.error({ error }, "Failed to list mission proofs");
        return toFailureResult("spira_list_mission_proofs", error);
      }
    },
  });

export const buildRunMissionProofTool = (
  runMissionProof: NonNullable<ToolBridgeOptions["runMissionProof"]>,
  missionRunId?: string,
) =>
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
        const runId = resolveScopedMissionRunId(payload, missionRunId);
        const profileId = typeof payload.profile_id === "string" ? payload.profile_id.trim() : "";
        if (!profileId) {
          throw new Error("spira_run_mission_proof requires a non-empty profile_id");
        }

        return toSuccessResult(await runMissionProof(runId, profileId));
      } catch (error) {
        logger.error({ error }, "Failed to run mission proof");
        return toFailureResult("spira_run_mission_proof", error);
      }
    },
  });

export const buildGetMissionContextTool = (
  missionRunId: string,
  getMissionContext: NonNullable<ToolBridgeOptions["getMissionContext"]>,
) =>
  defineTool("get_mission_context", {
    description: "Load the authoritative stored mission lifecycle state for the active mission station.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async () => {
      try {
        return toSuccessResult(await getMissionContext(missionRunId));
      } catch (error) {
        logger.error({ error, missionRunId }, "Failed to load mission context");
        return toFailureResult("get_mission_context", error);
      }
    },
  });

export const buildSaveClassificationTool = (
  missionRunId: string,
  saveMissionClassification: NonNullable<ToolBridgeOptions["saveMissionClassification"]>,
) =>
  defineTool("save_classification", {
    description: "Persist the mission classification, acceptance criteria, risks, and UI proof decision.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...TICKET_RUN_MISSION_CLASSIFICATIONS] },
        scopeSummary: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        impactedRepoRelativePaths: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        uiChange: { type: "boolean" },
        proofRequired: { type: "boolean" },
        proofArtifactMode: { type: "string", enum: [...TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES] },
        rationale: { type: "string" },
      },
      required: ["kind", "scopeSummary", "uiChange", "proofRequired", "proofArtifactMode"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        return toSuccessResult(await saveMissionClassification(missionRunId, parseMissionClassification(args)));
      } catch (error) {
        logger.error({ error, missionRunId }, "Failed to save mission classification");
        return toFailureResult("save_classification", error);
      }
    },
  });

export const buildSavePlanTool = (
  missionRunId: string,
  saveMissionPlan: NonNullable<ToolBridgeOptions["saveMissionPlan"]>,
) =>
  defineTool("save_plan", {
    description: "Persist the ordered implementation plan, validation plan, blockers, and proof intent.",
    parameters: {
      type: "object",
      properties: {
        steps: { type: "array", items: { type: "string" } },
        touchedRepoRelativePaths: { type: "array", items: { type: "string" } },
        validationPlan: { type: "array", items: { type: "string" } },
        proofIntent: { type: "string" },
        blockers: { type: "array", items: { type: "string" } },
        assumptions: { type: "array", items: { type: "string" } },
      },
      required: ["steps", "touchedRepoRelativePaths", "validationPlan"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        return toSuccessResult(await saveMissionPlan(missionRunId, parseMissionPlan(args)));
      } catch (error) {
        logger.error({ error, missionRunId }, "Failed to save mission plan");
        return toFailureResult("save_plan", error);
      }
    },
  });

export const buildRecordValidationTool = (
  missionRunId: string,
  recordMissionValidation: NonNullable<ToolBridgeOptions["recordMissionValidation"]>,
) =>
  defineTool("record_validation", {
    description:
      "Append a validation record for the active mission, including build, test, lint, or typecheck results.",
    parameters: {
      type: "object",
      properties: {
        validationId: { type: "string" },
        kind: { type: "string", enum: [...TICKET_RUN_MISSION_VALIDATION_KINDS] },
        command: { type: "string" },
        cwd: { type: "string" },
        status: { type: "string", enum: [...TICKET_RUN_MISSION_VALIDATION_STATUSES] },
        summary: { type: "string" },
        artifacts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              artifactId: { type: "string" },
              kind: { type: "string", enum: [...TICKET_RUN_PROOF_ARTIFACT_KINDS] },
              label: { type: "string" },
              path: { type: "string" },
              fileUrl: { type: "string" },
            },
            required: ["artifactId", "kind", "label", "path", "fileUrl"],
            additionalProperties: false,
          },
        },
        startedAt: { type: "number" },
        completedAt: { type: "number" },
      },
      required: ["validationId", "kind", "command", "cwd", "status"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        return toSuccessResult(await recordMissionValidation(missionRunId, parseMissionValidation(missionRunId, args)));
      } catch (error) {
        logger.error({ error, missionRunId }, "Failed to record mission validation");
        return toFailureResult("record_validation", error);
      }
    },
  });

export const buildSetProofStrategyTool = (
  missionRunId: string,
  setMissionProofStrategy: NonNullable<ToolBridgeOptions["setMissionProofStrategy"]>,
) =>
  defineTool("set_proof_strategy", {
    description: "Persist the targeted proof strategy for a UI mission, including scenario, command, and artifacts.",
    parameters: {
      type: "object",
      properties: {
        adapterId: { type: "string" },
        repoRelativePath: { type: "string" },
        scenarioPath: { type: "string" },
        scenarioName: { type: "string" },
        command: { type: "string" },
        artifactMode: { type: "string", enum: [...TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES] },
        rationale: { type: "string" },
        metadata: { type: "object" },
      },
      required: ["adapterId", "repoRelativePath", "command", "artifactMode", "rationale"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        return toSuccessResult(
          await setMissionProofStrategy(missionRunId, parseMissionProofStrategy(missionRunId, args)),
        );
      } catch (error) {
        logger.error({ error, missionRunId }, "Failed to set mission proof strategy");
        return toFailureResult("set_proof_strategy", error);
      }
    },
  });

export const buildRecordProofResultTool = (
  missionRunId: string,
  recordMissionProofResult: NonNullable<ToolBridgeOptions["recordMissionProofResult"]>,
) =>
  defineTool("record_proof_result", {
    description: "Persist the outcome of the targeted mission proof run and any captured artifacts.",
    parameters: {
      type: "object",
      properties: {
        proof: {
          type: "object",
          properties: {
            status: { type: "string", enum: [...TICKET_RUN_PROOF_STATUSES] },
            lastProofRunId: { type: "string" },
            lastProofProfileId: { type: "string" },
            lastProofAt: { type: "number" },
            lastProofSummary: { type: "string" },
            staleReason: { type: "string" },
          },
          required: ["status"],
          additionalProperties: false,
        },
        proofRun: {
          type: "object",
          properties: {
            proofRunId: { type: "string" },
            profileId: { type: "string" },
            profileLabel: { type: "string" },
            status: { type: "string", enum: [...TICKET_RUN_PROOF_RUN_STATUSES] },
            summary: { type: "string" },
            startedAt: { type: "number" },
            completedAt: { type: "number" },
            exitCode: { type: "number" },
            command: { type: "string" },
            artifacts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  artifactId: { type: "string" },
                  kind: { type: "string", enum: [...TICKET_RUN_PROOF_ARTIFACT_KINDS] },
                  label: { type: "string" },
                  path: { type: "string" },
                  fileUrl: { type: "string" },
                },
                required: ["artifactId", "kind", "label", "path", "fileUrl"],
                additionalProperties: false,
              },
            },
          },
          required: ["proofRunId", "profileId", "profileLabel", "status"],
          additionalProperties: false,
        },
      },
      required: ["proof"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        return toSuccessResult(
          await recordMissionProofResult(missionRunId, parseMissionProofResult(missionRunId, args)),
        );
      } catch (error) {
        logger.error({ error, missionRunId }, "Failed to record mission proof result");
        return toFailureResult("record_proof_result", error);
      }
    },
  });

export const buildSaveSummaryTool = (
  missionRunId: string,
  saveMissionSummary: NonNullable<ToolBridgeOptions["saveMissionSummary"]>,
) =>
  defineTool("save_summary", {
    description: "Persist the final mission summary, validation outcome, proof outcome, and follow-ups.",
    parameters: {
      type: "object",
      properties: {
        completedWork: { type: "string" },
        changedRepoRelativePaths: { type: "array", items: { type: "string" } },
        validationSummary: { type: "string" },
        proofSummary: { type: "string" },
        openQuestions: { type: "array", items: { type: "string" } },
        followUps: { type: "array", items: { type: "string" } },
      },
      required: ["completedWork", "changedRepoRelativePaths"],
      additionalProperties: false,
    },
    handler: async (args) => {
      try {
        return toSuccessResult(await saveMissionSummary(missionRunId, parseMissionSummary(args)));
      } catch (error) {
        logger.error({ error, missionRunId }, "Failed to save mission summary");
        return toFailureResult("save_summary", error);
      }
    },
  });

export function getCopilotTools(
  aggregator: McpToolAggregator,
  options: ToolBridgeOptions = {},
): ProviderToolDefinition[] {
  let mcpTools =
    options.includeServerIds !== undefined
      ? aggregator.getToolsForServerIds(options.includeServerIds)
      : aggregator.getTools();
  if (options.excludeServerIds?.length) {
    const excludedServerIds = new Set(options.excludeServerIds);
    mcpTools = mcpTools.filter((tool) => !excludedServerIds.has(tool.serverId));
  }
  mcpTools = filterMissionScopedMcpTools(mcpTools, options.missionWorkflowState);

  const hostTools =
    options.workingDirectory && options.includeHostTools !== false
      ? createHostTools({
          workingDirectory: options.workingDirectory,
          sessionStorage: options.sessionStorage ?? null,
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
        )
      : [];

  const tools = [...hostTools, ...mcpTools.map((tool) => buildTool(tool, aggregator, options.wrapToolExecution))];
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
    tools.push(buildListMissionServicesTool(options.listMissionServices, options.missionRunId));
  }
  if (options.startMissionService) {
    tools.push(buildStartMissionServiceTool(options.startMissionService, options.missionRunId));
  }
  if (options.stopMissionService) {
    tools.push(buildStopMissionServiceTool(options.stopMissionService, options.missionRunId));
  }
  if (options.listMissionProofs) {
    tools.push(buildListMissionProofsTool(options.listMissionProofs, options.missionRunId));
  }
  if (options.runMissionProof) {
    tools.push(buildRunMissionProofTool(options.runMissionProof, options.missionRunId));
  }
  if (options.missionRunId && options.getMissionContext) {
    tools.push(buildGetMissionContextTool(options.missionRunId, options.getMissionContext));
  }
  if (options.missionRunId && options.saveMissionClassification) {
    tools.push(buildSaveClassificationTool(options.missionRunId, options.saveMissionClassification));
  }
  if (options.missionRunId && options.saveMissionPlan) {
    tools.push(buildSavePlanTool(options.missionRunId, options.saveMissionPlan));
  }
  if (options.missionRunId && options.recordMissionValidation) {
    tools.push(buildRecordValidationTool(options.missionRunId, options.recordMissionValidation));
  }
  if (options.missionRunId && options.setMissionProofStrategy) {
    tools.push(buildSetProofStrategyTool(options.missionRunId, options.setMissionProofStrategy));
  }
  if (options.missionRunId && options.recordMissionProofResult) {
    tools.push(buildRecordProofResultTool(options.missionRunId, options.recordMissionProofResult));
  }
  if (options.missionRunId && options.saveMissionSummary) {
    tools.push(buildSaveSummaryTool(options.missionRunId, options.saveMissionSummary));
  }
  logger.info({ toolCount: tools.length }, "Registered MCP tools with Copilot session");
  return tools;
}
