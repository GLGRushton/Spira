import type {
  AssistantState,
  Env,
  StationId,
  SubagentDelegationArgs,
  SubagentEnvelope,
  SubagentRunHandle,
} from "@spira/shared";
import type { McpToolAggregator } from "../../mcp/tool-aggregator.js";
import type { MissionWorkflowState } from "../../missions/mission-workflow-guard.js";
import {
  assertMissionMcpToolAllowedForState,
  assertMissionWorkflowStateActionAllowed,
} from "../../missions/mission-workflow-guard.js";
import { isEscalationProvider } from "../../provider/provider-config.js";
import type {
  ProviderClient,
  ProviderId,
  ProviderSession,
  ProviderSessionEscalationResult,
} from "../../provider/types.js";
import type { SubagentRegistry } from "../../subagent/registry.js";
import type { SubagentRunRegistry } from "../../subagent/run-registry.js";
import type { SubagentRunner } from "../../subagent/subagent-runner.js";
import { appRootDir } from "../../util/app-paths.js";
import type { YouTrackService } from "../../youtrack/service.js";
import { AssistantError } from "../../util/errors.js";
import { createLogger } from "../../util/logger.js";
import { buildRuntimeCapabilityRegistry, getProviderToolManifest } from "../capability-registry.js";
import type { RuntimeStore } from "../runtime-store.js";
import type { ToolBridgeOptions } from "../tool-bridge.js";
import { getDelegatedServerIds, getDelegationDomainTools, getDelegationDomains } from "./delegation-helpers.js";
import { HOST_TOOL_MISSION_ACTIONS } from "./shared.js";

const logger = createLogger("station-session");

export interface ToolRefreshHelperContext {
  env: Env;
  toolAggregator: Pick<McpToolAggregator, "getTools">;
  workingDirectory: string | null;
  sessionStorage: ToolBridgeOptions["sessionStorage"];
  runtimeStore: RuntimeStore;
  stationId: StationId | null;
  missionRunId: string | null;
  configuredProviderId: ProviderId;
  providerOverride: ProviderId | null;
  currentState: AssistantState;
  activeSessionId: string | null;
  client: ProviderClient | null;
  session: ProviderSession | null;
  initializingSession: Promise<ProviderSession> | null;
  allowUpgradeTools: boolean;
  listMissionServices?: ToolBridgeOptions["listMissionServices"];
  startMissionService?: ToolBridgeOptions["startMissionService"];
  stopMissionService?: ToolBridgeOptions["stopMissionService"];
  listMissionProofs?: ToolBridgeOptions["listMissionProofs"];
  runMissionProof?: ToolBridgeOptions["runMissionProof"];
  getMissionContext?: ToolBridgeOptions["getMissionContext"];
  getMissionWorkflowState?: (runId: string) => MissionWorkflowState;
  saveMissionClassification?: ToolBridgeOptions["saveMissionClassification"];
  saveMissionPlan?: ToolBridgeOptions["saveMissionPlan"];
  setMissionPhase?: ToolBridgeOptions["setMissionPhase"];
  recordMissionValidation?: ToolBridgeOptions["recordMissionValidation"];
  setMissionProofStrategy?: ToolBridgeOptions["setMissionProofStrategy"];
  recordMissionProofResult?: ToolBridgeOptions["recordMissionProofResult"];
  saveMissionSummary?: ToolBridgeOptions["saveMissionSummary"];
  subagentRegistry: SubagentRegistry | null;
  subagentRunRegistry: SubagentRunRegistry;
  youTrackService?: Pick<YouTrackService, "isConfigured" | "listAttachments" | "fetchAttachment"> | null;
  requestUpgradeProposal?: ToolBridgeOptions["requestUpgradeProposal"];
  applyHotCapabilityUpgrade?: ToolBridgeOptions["applyHotCapabilityUpgrade"];
  requestSessionEscalation: () => Promise<ProviderSessionEscalationResult>;
  getSubagentRunner: (domainId: string, workingDirectory?: string) => SubagentRunner;
  getRuntimeSessionId: () => string | null;
  registeredToolSignature: string | null;
  pendingToolRefreshSignature: string | null;
  refreshingSessionForToolChanges: Promise<void> | null;
  deletePersistedSession: (sessionId: string, providerId?: ProviderId) => Promise<void>;
  getStalePersistedSessionCleanupProviderIds: (
    persistedSessionId: string,
    runtimeState: ReturnType<RuntimeStore["getStationRuntimeState"]>,
    currentProviderId: ProviderId,
  ) => ProviderId[];
  clearHostContinuityCaches: () => void;
  clearBoundSessionIdentity: () => void;
  disconnectSession: () => Promise<void>;
  syncRuntimeState: () => void;
  setRegisteredToolSignature: (signature: string | null) => void;
  setPendingToolRefreshSignature: (signature: string | null) => void;
  setRefreshingSessionForToolChanges: (promise: Promise<void> | null) => void;
}

export const getCurrentToolManifestHelper = (
  context: Pick<ToolRefreshHelperContext, "toolAggregator" | "configuredProviderId" | "client"> & {
    getToolBridgeOptions: () => ToolBridgeOptions;
  },
  provider?: Pick<ProviderClient, "providerId" | "capabilities">,
) => {
  const effectiveProviderId = provider?.providerId ?? context.configuredProviderId;
  const effectiveCapabilities = provider?.capabilities ?? context.client?.capabilities;
  return getProviderToolManifest({
    aggregator: context.toolAggregator as never,
    options: context.getToolBridgeOptions(),
    providerId: effectiveProviderId,
    capabilities: effectiveCapabilities ?? context.client?.capabilities ?? undefined,
  });
};

export const getCurrentToolSignatureHelper = (
  context: Pick<ToolRefreshHelperContext, "toolAggregator" | "client"> & {
    getToolBridgeOptions: () => ToolBridgeOptions;
    getCurrentToolManifest: (provider?: Pick<ProviderClient, "providerId" | "capabilities">) => {
      hostManifestHash: string;
      projectionHash: string;
    };
  },
): string => {
  const hostManifestHash = buildRuntimeCapabilityRegistry(
    context.toolAggregator as never,
    context.getToolBridgeOptions(),
  ).hostManifestHash;
  if (!context.client) {
    return hostManifestHash;
  }
  const { projectionHash } = context.getCurrentToolManifest(context.client);
  return `${hostManifestHash}:${projectionHash}`;
};

export const getToolBridgeOptionsHelper = (context: ToolRefreshHelperContext): ToolBridgeOptions => {
  const subagentsEnabled = context.env.SPIRA_SUBAGENTS_ENABLED;
  const missionWorkflowState = context.missionRunId
    ? (context.getMissionWorkflowState?.(context.missionRunId) ?? null)
    : null;
  const withMissionAction =
    <TArgs extends unknown[], TResult>(
      action: Parameters<typeof assertMissionWorkflowStateActionAllowed>[1],
      handler: ((...args: TArgs) => TResult) | undefined,
    ) =>
    (...args: TArgs): TResult => {
      if (context.missionRunId && context.getMissionWorkflowState) {
        const workflowState = context.getMissionWorkflowState(context.missionRunId);
        if (workflowState) {
          assertMissionWorkflowStateActionAllowed(workflowState, action);
        }
      }
      if (!handler) {
        throw new AssistantError(`Mission action ${action} is unavailable.`);
      }
      return handler(...args);
    };
  const readyDelegationDomains = getDelegationDomains(context.subagentRegistry);
  const connectedDelegationDomains = readyDelegationDomains.filter(
    (domain) =>
      domain.allowHostTools === true ||
      getDelegationDomainTools(context.subagentRegistry, domain.id, context.toolAggregator.getTools() as never[])
        .length,
  );
  const missionScoped = context.missionRunId !== null;
  const delegationEnabled = connectedDelegationDomains.length > 0;
  const manualSessionEscalationEnabled =
    context.stationId === "primary" && !missionScoped && isEscalationProvider(context.configuredProviderId);
  return {
    workingDirectory: context.workingDirectory ?? appRootDir,
    sessionStorage: context.sessionStorage,
    runtimeStore: context.runtimeStore,
    runtimeSessionId: context.getRuntimeSessionId(),
    stationId: context.stationId,
    ...(context.youTrackService ? { youTrackService: context.youTrackService } : {}),
    ...(context.allowUpgradeTools
      ? {
          requestUpgradeProposal: context.requestUpgradeProposal,
          applyHotCapabilityUpgrade: context.applyHotCapabilityUpgrade,
        }
      : {}),
    ...(manualSessionEscalationEnabled
      ? {
          requestSessionEscalation: () => context.requestSessionEscalation(),
        }
      : {}),
    ...(missionScoped && context.listMissionServices
      ? { listMissionServices: withMissionAction("service-read", context.listMissionServices) }
      : {}),
    ...(missionScoped && context.startMissionService
      ? { startMissionService: withMissionAction("service-write", context.startMissionService) }
      : {}),
    ...(missionScoped && context.stopMissionService
      ? { stopMissionService: withMissionAction("service-write", context.stopMissionService) }
      : {}),
    ...(missionScoped && context.listMissionProofs
      ? { listMissionProofs: withMissionAction("proof-read", context.listMissionProofs) }
      : {}),
    ...(missionScoped && context.runMissionProof
      ? { runMissionProof: withMissionAction("record-proof-result", context.runMissionProof) }
      : {}),
    ...(missionScoped && context.missionRunId ? { missionRunId: context.missionRunId } : {}),
    ...(missionScoped ? { missionWorkflowState } : {}),
    ...(missionScoped && context.getMissionContext ? { getMissionContext: context.getMissionContext } : {}),
    ...(missionScoped && context.saveMissionClassification
      ? { saveMissionClassification: context.saveMissionClassification }
      : {}),
    ...(missionScoped && context.saveMissionPlan ? { saveMissionPlan: context.saveMissionPlan } : {}),
    ...(missionScoped && context.setMissionPhase ? { setMissionPhase: context.setMissionPhase } : {}),
    ...(missionScoped && context.recordMissionValidation
      ? { recordMissionValidation: context.recordMissionValidation }
      : {}),
    ...(missionScoped && context.setMissionProofStrategy
      ? { setMissionProofStrategy: context.setMissionProofStrategy }
      : {}),
    ...(missionScoped && context.recordMissionProofResult
      ? { recordMissionProofResult: context.recordMissionProofResult }
      : {}),
    ...(missionScoped && context.saveMissionSummary ? { saveMissionSummary: context.saveMissionSummary } : {}),
    ...(subagentsEnabled && delegationEnabled
      ? {
          excludeServerIds: getDelegatedServerIds(context.subagentRegistry),
          delegationDomains: connectedDelegationDomains,
          delegateToDomain: async (
            domainId: string,
            args: SubagentDelegationArgs,
          ): Promise<SubagentEnvelope | SubagentRunHandle> => {
            if (missionScoped && context.missionRunId && context.getMissionWorkflowState) {
              const workflowState = context.getMissionWorkflowState(context.missionRunId);
              if (workflowState) {
                assertMissionWorkflowStateActionAllowed(workflowState, "delegate");
              }
            }
            const runner = context.getSubagentRunner(domainId, context.workingDirectory ?? undefined);
            if (args.mode === "background") {
              return context.subagentRunRegistry.track(domainId, args, runner.launch(args));
            }
            return runner.run(args);
          },
          readSubagent: async (agentId, options) =>
            options?.wait
              ? context.subagentRunRegistry.waitFor(agentId, options.timeoutMs)
              : context.subagentRunRegistry.get(agentId),
          listSubagents: (options) => context.subagentRunRegistry.list(options),
          writeSubagent: (agentId, input) => context.subagentRunRegistry.write(agentId, input),
          stopSubagent: (agentId) => context.subagentRunRegistry.stop(agentId),
        }
      : {}),
    ...(missionScoped && context.missionRunId && context.getMissionWorkflowState
      ? {
          wrapHostToolExecution: async (tool, _args, execute) => {
            const missionRunId = context.missionRunId;
            if (!missionRunId) {
              return execute();
            }
            const workflowState = context.getMissionWorkflowState?.(missionRunId);
            const action = HOST_TOOL_MISSION_ACTIONS.get(tool.name);
            if (workflowState && action) {
              assertMissionWorkflowStateActionAllowed(workflowState, action);
            }
            return execute();
          },
          wrapToolExecution: async (tool, _args, execute) => {
            const missionRunId = context.missionRunId;
            if (!missionRunId) {
              return execute();
            }
            const workflowState = context.getMissionWorkflowState?.(missionRunId);
            if (workflowState) {
              assertMissionMcpToolAllowedForState(workflowState, tool);
            }
            return execute();
          },
        }
      : {}),
  };
};

export const refreshSessionForToolChangesHelper = async (
  context: ToolRefreshHelperContext & {
    getCurrentToolSignature: () => string;
  },
): Promise<void> => {
  const currentToolSignature = context.getCurrentToolSignature();
  if (context.registeredToolSignature === currentToolSignature) {
    context.setPendingToolRefreshSignature(null);
    return;
  }

  if (!context.session && !context.initializingSession) {
    if (context.activeSessionId) {
      const sessionId = context.activeSessionId;
      const cleanupProviderIds = context.getStalePersistedSessionCleanupProviderIds(
        sessionId,
        context.runtimeStore.getStationRuntimeState(),
        context.providerOverride ?? context.configuredProviderId,
      );
      let deletionFailed = false;
      try {
        for (const providerId of cleanupProviderIds) {
          try {
            await context.deletePersistedSession(sessionId, providerId);
          } catch (error) {
            deletionFailed = true;
            context.runtimeStore.queueProviderSessionCleanup(providerId, sessionId);
            void context.runtimeStore.drainPendingProviderSessionCleanup(context.env);
            logger.warn({ error, sessionId, providerId }, "Failed to delete stale provider session after tool drift");
          }
        }
      } finally {
        context.clearHostContinuityCaches();
        context.clearBoundSessionIdentity();
        context.syncRuntimeState();
      }
      if (deletionFailed) {
        context.setPendingToolRefreshSignature(currentToolSignature);
        return;
      }
    }
    context.setRegisteredToolSignature(currentToolSignature);
    context.setPendingToolRefreshSignature(null);
    return;
  }

  if (context.currentState !== "idle") {
    context.setPendingToolRefreshSignature(currentToolSignature);
    logger.info(
      {
        previousToolSignature: context.registeredToolSignature,
        currentToolSignature,
        currentState: context.currentState,
      },
      "MCP tool inventory changed during an active turn; deferring station session refresh",
    );
    return;
  }

  if (context.refreshingSessionForToolChanges) {
    await context.refreshingSessionForToolChanges;
    await refreshSessionForToolChangesHelper(context);
    return;
  }

  logger.info(
    {
      previousToolSignature: context.registeredToolSignature,
      currentToolSignature,
    },
    "MCP tool inventory changed; refreshing station session",
  );
  context.setPendingToolRefreshSignature(null);
  const refreshPromise = (async () => {
    const sessionId = context.activeSessionId;
    const cleanupProviderIds = sessionId
      ? context.getStalePersistedSessionCleanupProviderIds(
          sessionId,
          context.runtimeStore.getStationRuntimeState(),
          context.client?.providerId ?? context.providerOverride ?? context.configuredProviderId,
        )
      : [];
    context.clearHostContinuityCaches();
    context.clearBoundSessionIdentity();
    await context.disconnectSession();
    if (sessionId) {
      for (const providerId of cleanupProviderIds) {
        try {
          await context.deletePersistedSession(sessionId, providerId);
        } catch (error) {
          context.runtimeStore.queueProviderSessionCleanup(providerId, sessionId);
          void context.runtimeStore.drainPendingProviderSessionCleanup(context.env);
          throw error;
        }
      }
    }
  })();
  context.setRefreshingSessionForToolChanges(refreshPromise);

  try {
    await refreshPromise;
  } finally {
    if (context.refreshingSessionForToolChanges === refreshPromise) {
      context.setRefreshingSessionForToolChanges(null);
    }
  }
};

export const maybeRefreshSessionForToolChangesHelper = async (
  context: Pick<ToolRefreshHelperContext, "pendingToolRefreshSignature" | "currentState"> & {
    refreshSessionForToolChanges: () => Promise<void>;
  },
): Promise<void> => {
  if (!context.pendingToolRefreshSignature || context.currentState !== "idle") {
    return;
  }

  await context.refreshSessionForToolChanges();
};

export const queueToolRefreshHelper = (refreshSessionForToolChanges: () => Promise<void>): void => {
  void refreshSessionForToolChanges().catch((error) => {
    logger.error({ err: error }, "Failed to refresh the provider session after tool changes");
  });
};

export const queuePendingToolRefreshHelper = (maybeRefreshSessionForToolChanges: () => Promise<void>): void => {
  void maybeRefreshSessionForToolChanges().catch((error) => {
    logger.error({ err: error }, "Failed to refresh the provider session after becoming idle");
  });
};
