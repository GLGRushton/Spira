import { randomUUID } from "node:crypto";
import type { RuntimeStationToolCallRecord, SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  AssistantState,
  Env,
  PermissionRequestPayload,
  StationId,
  SubagentDelegationArgs,
  SubagentDomain,
  SubagentEnvelope,
  SubagentRunHandle,
  SubagentRunSnapshot,
  UpgradeProposal,
} from "@spira/shared";
import { SUBAGENT_DOMAINS } from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import {
  type MissionWorkflowState,
  assertMissionMcpToolAllowedForState,
  assertMissionWorkflowStateActionAllowed,
} from "../missions/mission-workflow-guard.js";
import {
  getDefaultProviderCapabilities,
  normalizeProviderUsageSnapshot,
  shouldPersistProviderSession,
  shouldRequestNativeStreaming,
  shouldUseProviderAbort,
} from "../provider/capability-fallback.js";
import {
  type ProviderAuthStrategy,
  createFreshProviderSession,
  createProviderClientForProvider,
  stopProviderClient,
  withTimeout,
} from "../provider/client-factory.js";
import { getConfiguredProviderId, getProviderLabel } from "../provider/provider-config.js";
import type {
  ProviderClient,
  ProviderHostContinuityState,
  ProviderId,
  ProviderPermissionRequest,
  ProviderPermissionResult,
  ProviderSession,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderSystemMessageSection,
  ProviderUsageRecord,
  ProviderUsageSnapshot,
} from "../provider/types.js";
import { buildRuntimeCapabilityRegistry, getProviderToolManifest } from "../runtime/capability-registry.js";
import {
  approvePermissionOnce,
  permissionUserNotAvailable,
  rejectPermission,
} from "../runtime/permission-decisions.js";
import {
  type RuntimeCheckpointPayload,
  type RuntimeLedgerEvent,
  type RuntimeSessionContract,
  type RuntimeUsageSummary,
  createRuntimeLedgerEvent,
} from "../runtime/runtime-contract.js";
import {
  recordRuntimeAssistantMessage,
  recordRuntimeAssistantMessageDelta,
  recordRuntimeCancellationCompleted,
  recordRuntimeCancellationRequested,
  recordRuntimeProviderBound,
  recordRuntimeRecoveryCompleted,
  recordRuntimeToolExecutionCompleted,
  recordRuntimeToolExecutionStarted,
  recordRuntimeUsageObserved,
} from "../runtime/runtime-lifecycle.js";
import { executeRuntimePermissionRequest } from "../runtime/runtime-permission-lifecycle.js";
import { completeRuntimeCancellation, requestRuntimeCancellation } from "../runtime/runtime-state-machine.js";
import { RuntimeStore } from "../runtime/runtime-store.js";
import { handleSharedTurnEvent, updateRuntimeUsageSummary } from "../runtime/runtime-turn-engine.js";
import {
  appendStationRuntimeLedgerEventIfSession,
  buildStationRuntimeRecoverySection,
  createStationRuntimeCheckpoint,
  getStationManagerRuntimeSessionId,
  persistStationRuntimeSessionContract,
  recordStationRuntimeUserMessage,
  syncStationRuntimeState,
} from "../runtime/station-runtime-persistence.js";
import { type StationSessionStorage, createStationSessionStorage } from "../runtime/station-session-storage.js";
import { StreamAssembler } from "../runtime/stream-handler.js";
import type { ToolBridgeOptions } from "../runtime/tool-bridge.js";
import { SubagentLockManager } from "../subagent/lock-manager.js";
import type { SubagentRegistry } from "../subagent/registry.js";
import { SubagentRunRegistry } from "../subagent/run-registry.js";
import { SubagentRunner } from "../subagent/subagent-runner.js";
import { appRootDir } from "../util/app-paths.js";
import { AssistantError, formatErrorDetails } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import { setUnrefTimeout } from "../util/timers.js";
import {
  VOICE_RESPONSE_INSTRUCTIONS,
  buildOutgoingPrompt,
  createSessionConfig,
  getSessionSystemMessageHash,
} from "./session-config.js";

const logger = createLogger("station-session");

const SESSION_INIT_TIMEOUT_MS = 20_000;
const TURN_FIRST_ACTIVITY_TIMEOUT_MS = 120_000;
const TURN_ACTIVITY_TIMEOUT_MS = 120_000;
const TURN_HARD_TIMEOUT_MS = 15 * 60_000;
const TURN_WATCHDOG_POLL_MS = 1_000;
const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;
const ALL_PROVIDER_IDS: ProviderId[] = ["copilot", "azure-openai"];

export interface SessionPersistence {
  load(): string | null;
  save(sessionId: string | null): void;
}

interface SendPromptOptions {
  continuityPreamble?: string | null;
}

interface SessionManagerOptions {
  stationId?: StationId | null;
  memoryDb?: SpiraMemoryDatabase | null;
  sessionPersistence?: SessionPersistence | null;
  subagentLockManager?: SubagentLockManager;
  subagentRegistry?: SubagentRegistry | null;
  requestedModel?: string | null;
  additionalInstructions?: string | null;
  workingDirectory?: string | null;
  allowUpgradeTools?: boolean;
  missionRunId?: string;
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
}

export interface ManagedSubagentLaunch {
  handle: SubagentRunHandle;
  completion: Promise<SubagentRunSnapshot | null>;
}

type ReportedAssistantError = AssistantError & { reportedToClient?: boolean };
type PendingPermissionRequest = {
  resolve: (result: ProviderPermissionResult) => void;
  timeout: NodeJS.Timeout;
};

type ActiveTurnWatchdog = {
  promptEpoch: number;
  startedAt: number;
  lastActivityAt: number;
  firstActivityAt: number | null;
};

const getPermissionToolName = (request: ProviderPermissionRequest): string | null =>
  "toolName" in request && typeof request.toolName === "string" ? request.toolName : null;

const isVisionPermissionRequest = (
  request: ProviderPermissionRequest,
): request is ProviderPermissionRequest & {
  kind: "mcp";
  serverName: string;
  toolName: string;
  toolTitle?: string;
  args?: Record<string, unknown>;
  readOnly?: boolean;
} => {
  const toolName = getPermissionToolName(request);
  return request.kind === "mcp" && toolName !== null && toolName.startsWith("vision_");
};

const isMissionServicePermissionRequest = (
  request: ProviderPermissionRequest,
): request is ProviderPermissionRequest & {
  kind: "custom-tool";
  toolName: "spira_start_mission_service" | "spira_stop_mission_service" | "spira_run_mission_proof";
  toolCallId?: string;
  args?: Record<string, unknown>;
} =>
  request.kind === "custom-tool" &&
  (() => {
    const toolName = getPermissionToolName(request);
    return (
      toolName === "spira_start_mission_service" ||
      toolName === "spira_stop_mission_service" ||
      toolName === "spira_run_mission_proof"
    );
  })();

const getMissionServiceToolTitle = (toolName: string): string => {
  switch (toolName) {
    case "spira_start_mission_service":
      return "Start mission service";
    case "spira_stop_mission_service":
      return "Stop mission service";
    case "spira_run_mission_proof":
      return "Run mission proof";
    default:
      return toolName;
  }
};

const INTERACTIVE_HOST_TOOL_NAMES = new Set([
  "write_file",
  "apply_patch",
  "powershell",
  "write_powershell",
  "stop_powershell",
  "spira_session_set_plan",
  "spira_session_set_scratchpad",
  "spira_session_set_context",
]);

const HOST_TOOL_MISSION_ACTIONS = new Map<string, "load-context" | "repo-read" | "repo-write">([
  ["view", "repo-read"],
  ["glob", "repo-read"],
  ["rg", "repo-read"],
  ["read_powershell", "repo-read"],
  ["list_powershell", "repo-read"],
  ["spira_session_get_plan", "load-context"],
  ["spira_session_get_scratchpad", "load-context"],
  ["spira_session_get_context", "load-context"],
  ["write_file", "repo-write"],
  ["apply_patch", "repo-write"],
  ["powershell", "repo-write"],
  ["write_powershell", "repo-write"],
  ["stop_powershell", "repo-write"],
  ["spira_session_set_plan", "repo-write"],
  ["spira_session_set_scratchpad", "repo-write"],
  ["spira_session_set_context", "repo-write"],
]);

const isInteractiveHostToolPermissionRequest = (
  request: ProviderPermissionRequest,
): request is ProviderPermissionRequest & {
  kind: "custom-tool";
  toolName: string;
  toolCallId?: string;
  args?: Record<string, unknown>;
} => request.kind === "custom-tool" && INTERACTIVE_HOST_TOOL_NAMES.has(getPermissionToolName(request) ?? "");

export class StationSessionManager {
  private client: ProviderClient | null = null;
  private session: ProviderSession | null = null;
  private initializingSession: Promise<ProviderSession> | null = null;
  private activeSessionId: string | null = null;
  private readonly streamAssembler = new StreamAssembler();
  private readonly pendingPermissionRequests = new Map<string, PendingPermissionRequest>();
  private currentState: AssistantState = "idle";
  private authStrategy: ProviderAuthStrategy | null = null;
  private providerOverride: ProviderId | null = null;
  private registeredToolSignature: string | null = null;
  private pendingToolRefreshSignature: string | null = null;
  private refreshingSessionForToolChanges: Promise<void> | null = null;
  private nextResponseAutoSpeak = true;
  private responseAbortEpoch = 0;
  private sessionTeardownEpoch = 0;
  private promptInFlight = false;
  private activePromptEpoch = 0;
  private activeTurnWatchdog: ActiveTurnWatchdog | null = null;
  private sessionOrigin: "created" | "resumed" | null = null;
  private latestUsage: ProviderUsageSnapshot | null = null;
  private observedToolActivity = false;
  private readonly stationId: StationId | null;
  private readonly memoryDb: SpiraMemoryDatabase | null;
  private readonly sessionPersistence: SessionPersistence | null;
  private readonly sessionStorage: StationSessionStorage | null;
  private readonly runtimeStore: RuntimeStore;
  private readonly subagentLockManager: SubagentLockManager;
  private readonly subagentRunRegistry: SubagentRunRegistry;
  private readonly subagentRunners = new Map<string, SubagentRunner>();
  private readonly activeToolCalls = new Map<string, RuntimeStationToolCallRecord>();
  private shutdownRequested = false;
  private abortRequestedAt: number | null = null;
  private lastCancellationCompletedAt: number | null = null;
  private lastPermissionResolvedAt: number | null = null;
  private lastRuntimeUserMessageId: string | null = null;
  private lastRuntimeAssistantMessageId: string | null = null;
  private latestAssistantMessageText: string | null = null;
  private activeRecoverySource: "host-checkpoint" | "continuity-preamble" | "host-transcript" | null = null;
  private runtimeUsageSummary: RuntimeUsageSummary = {
    model: null,
    totalTokens: null,
    lastObservedAt: null,
    source: "unknown",
  };
  private boundHostManifestHash: string | null = null;
  private boundProviderProjectionHash: string | null = null;
  private readonly subagentRegistry: SubagentRegistry | null;
  private readonly requestedModel: string | null;
  private readonly additionalInstructions: string | null;
  private readonly workingDirectory: string | null;
  private readonly allowUpgradeTools: boolean;
  private readonly missionRunId: string | null;
  private readonly listMissionServices: ToolBridgeOptions["listMissionServices"];
  private readonly startMissionService: ToolBridgeOptions["startMissionService"];
  private readonly stopMissionService: ToolBridgeOptions["stopMissionService"];
  private readonly listMissionProofs: ToolBridgeOptions["listMissionProofs"];
  private readonly runMissionProof: ToolBridgeOptions["runMissionProof"];
  private readonly getMissionContext: ToolBridgeOptions["getMissionContext"];
  private readonly getMissionWorkflowState: SessionManagerOptions["getMissionWorkflowState"];
  private readonly saveMissionClassification: ToolBridgeOptions["saveMissionClassification"];
  private readonly saveMissionPlan: ToolBridgeOptions["saveMissionPlan"];
  private readonly setMissionPhase: ToolBridgeOptions["setMissionPhase"];
  private readonly recordMissionValidation: ToolBridgeOptions["recordMissionValidation"];
  private readonly setMissionProofStrategy: ToolBridgeOptions["setMissionProofStrategy"];
  private readonly recordMissionProofResult: ToolBridgeOptions["recordMissionProofResult"];
  private readonly saveMissionSummary: ToolBridgeOptions["saveMissionSummary"];
  private hostContinuityState: ProviderHostContinuityState | null = null;
  private resumableHostContinuityState: ProviderHostContinuityState | null = null;
  private resumableHostContinuityHostManifestHash: string | null = null;
  private resumableHostContinuityProjectionHash: string | null = null;

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly env: Env,
    private readonly toolAggregator: McpToolAggregator,
    private readonly requestUpgradeProposal?: (proposal: UpgradeProposal) => Promise<void> | void,
    private readonly applyHotCapabilityUpgrade?: () => Promise<void> | void,
    options: SessionManagerOptions = {},
  ) {
    this.stationId = options.stationId ?? null;
    this.memoryDb = options.memoryDb ?? null;
    this.sessionPersistence = options.sessionPersistence ?? null;
    this.sessionStorage = createStationSessionStorage(this.memoryDb, this.stationId);
    this.runtimeStore = new RuntimeStore(this.memoryDb, this.stationId);
    this.subagentLockManager = options.subagentLockManager ?? new SubagentLockManager();
    this.subagentRunRegistry = new SubagentRunRegistry({
      bus: this.bus,
      env: this.env,
      runtimeStore: this.runtimeStore,
      recoverLaunch: (snapshot) => this.recoverManagedSubagent(snapshot),
    });
    this.subagentRegistry = options.subagentRegistry ?? null;
    this.requestedModel = options.requestedModel?.trim() || null;
    this.additionalInstructions = options.additionalInstructions?.trim() || null;
    this.workingDirectory = options.workingDirectory?.trim() || null;
    this.allowUpgradeTools = options.allowUpgradeTools ?? true;
    this.missionRunId = options.missionRunId?.trim() || null;
    this.listMissionServices = options.listMissionServices;
    this.startMissionService = options.startMissionService;
    this.stopMissionService = options.stopMissionService;
    this.listMissionProofs = options.listMissionProofs;
    this.runMissionProof = options.runMissionProof;
    this.getMissionContext = options.getMissionContext;
    this.getMissionWorkflowState = options.getMissionWorkflowState;
    this.saveMissionClassification = options.saveMissionClassification;
    this.saveMissionPlan = options.saveMissionPlan;
    this.setMissionPhase = options.setMissionPhase;
    this.recordMissionValidation = options.recordMissionValidation;
    this.setMissionProofStrategy = options.setMissionProofStrategy;
    this.recordMissionProofResult = options.recordMissionProofResult;
    this.saveMissionSummary = options.saveMissionSummary;
    const persistedRuntimeSession = this.runtimeStore.getRuntimeSession(this.getRuntimeSessionId() ?? "");
    const { hostManifestHash, projectionHash } = this.getCurrentToolManifest();
    const systemMessageHash = this.getCurrentSystemMessageHash();
    const persistedHostContinuity =
      persistedRuntimeSession &&
      (persistedRuntimeSession.turnState.state === "idle" ||
        persistedRuntimeSession.turnState.state === "completed" ||
        persistedRuntimeSession.turnState.state === "error") &&
      persistedRuntimeSession.hostManifestHash === hostManifestHash &&
      persistedRuntimeSession.providerProjectionHash === projectionHash &&
      persistedRuntimeSession.hostContinuity?.systemMessageHash === systemMessageHash
        ? persistedRuntimeSession.hostContinuity
        : null;
    this.hostContinuityState = persistedHostContinuity;
    this.resumableHostContinuityState = persistedHostContinuity;
    this.resumableHostContinuityHostManifestHash = persistedHostContinuity ? hostManifestHash : null;
    this.resumableHostContinuityProjectionHash = persistedHostContinuity ? projectionHash : null;
    this.bus.on("mcp:servers-changed", () => {
      this.queueToolRefresh();
    });
    this.bus.on("subagent:catalog-changed", () => {
      this.subagentRunners.clear();
      this.queueToolRefresh();
    });
    this.bus.on("missions:runs-changed", (snapshot) => {
      if (!this.missionRunId || !snapshot.runs.some((run) => run.runId === this.missionRunId)) {
        return;
      }
      this.queueToolRefresh();
    });
  }

  private get configuredProviderId() {
    return this.client?.providerId ?? this.providerOverride ?? getConfiguredProviderId(this.env);
  }

  private get providerLabel(): string {
    return getProviderLabel(this.configuredProviderId);
  }

  async sendMessage(text: string, options: SendPromptOptions = {}): Promise<void> {
    return this.sendPrompt(text, true, options);
  }

  async sendVoiceMessage(text: string, options: SendPromptOptions = {}): Promise<void> {
    return this.sendPrompt(`${VOICE_RESPONSE_INSTRUCTIONS}\n\n${text}`, true, options);
  }

  private async sendPrompt(text: string, autoSpeak: boolean, options: SendPromptOptions): Promise<void> {
    const abortEpoch = this.responseAbortEpoch;
    const teardownEpoch = this.sessionTeardownEpoch;
    const promptEpoch = this.activePromptEpoch + 1;
    try {
      if (this.shutdownRequested) {
        throw new AssistantError("Station is shutting down.");
      }
      if (this.currentState === "error") {
        this.transitionTo("idle");
      }
      if (this.currentState === "thinking" || this.promptInFlight) {
        throw new AssistantError("A response is already in progress.");
      }
      this.activePromptEpoch = promptEpoch;
      this.promptInFlight = true;
      this.observedToolActivity = false;
      this.latestAssistantMessageText = null;
      this.lastRuntimeUserMessageId = randomUUID();
      this.recordRuntimeUserMessage(this.lastRuntimeUserMessageId, text);
      this.transitionTo("thinking");
      this.nextResponseAutoSpeak = autoSpeak;

      await this.sendPromptWithRecovery(text, abortEpoch, teardownEpoch, promptEpoch, options);
    } catch (error) {
      this.nextResponseAutoSpeak = true;
      if (this.responseAbortEpoch !== abortEpoch) {
        logger.info("Suppressed send failure caused by an intentional response abort");
        return;
      }
      if (this.sessionTeardownEpoch !== teardownEpoch) {
        logger.info("Suppressed send failure caused by an intentional session teardown");
        return;
      }
      throw this.reportAndWrapError(error, `Failed to send message to ${this.providerLabel}`);
    } finally {
      if (this.activePromptEpoch === promptEpoch) {
        this.promptInFlight = false;
        this.observedToolActivity = false;
        this.clearTurnWatchdog(promptEpoch);
        this.syncRuntimeState();
      }
    }
  }

  private async sendPromptWithRecovery(
    text: string,
    abortEpoch: number,
    teardownEpoch: number,
    promptEpoch: number,
    options: SendPromptOptions,
  ): Promise<void> {
    const hadLiveSession = this.session !== null;
    const session = await this.getOrCreateSession(teardownEpoch);
    await this.applyRequestedModel(session);

    try {
      await this.awaitTurnCompletion(
        session,
        session.send({ prompt: this.buildOutgoingPrompt(text, options.continuityPreamble ?? null, hadLiveSession) }),
        promptEpoch,
      );
      if (this.activeRecoverySource) {
        this.syncRuntimeState();
        recordRuntimeRecoveryCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
          recoveredFrom: this.activeRecoverySource,
          success: true,
          occurredAt: Date.now(),
        });
        this.activeRecoverySource = null;
      }
    } catch (error) {
      if (this.responseAbortEpoch !== abortEpoch || this.sessionTeardownEpoch !== teardownEpoch) {
        throw error;
      }
      if (!this.isMissingSessionError(error)) {
        throw error;
      }

      logger.warn(
        { error, sessionId: session.sessionId },
        `${this.providerLabel} session was not found during send; re-establishing session and retrying once`,
      );
      await this.invalidateExpiredSession(session);
      if (this.observedToolActivity) {
        throw new AssistantError(
          `${this.providerLabel} session was lost after tool activity; the turn was not retried automatically.`,
        );
      }

      const refreshedSession = await this.getOrCreateSession(teardownEpoch);
      await this.applyRequestedModel(refreshedSession);
      if (this.responseAbortEpoch !== abortEpoch) {
        logger.info("Skipped retry send because the response was aborted during recovery");
        return;
      }
      await this.awaitTurnCompletion(
        refreshedSession,
        refreshedSession.send({ prompt: this.buildOutgoingPrompt(text, options.continuityPreamble ?? null, false) }),
        promptEpoch,
      );
      if (this.activeRecoverySource) {
        this.syncRuntimeState();
        recordRuntimeRecoveryCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
          recoveredFrom: this.activeRecoverySource,
          success: true,
          occurredAt: Date.now(),
        });
        this.activeRecoverySource = null;
      }
    }
  }

  async clearSession(): Promise<void> {
    try {
      this.beginSessionTeardown();
      const sessionId = this.activeSessionId;
      const cleanupProviderIds = sessionId
        ? this.getStalePersistedSessionCleanupProviderIds(
            sessionId,
            this.runtimeStore.getStationRuntimeState(),
            this.client?.providerId ?? this.providerOverride ?? this.configuredProviderId,
          )
        : [];
      await this.disconnectSession();
      if (sessionId) {
        for (const providerId of cleanupProviderIds) {
          try {
            await this.deletePersistedSession(sessionId, providerId);
          } catch (error) {
            this.runtimeStore.queueProviderSessionCleanup(providerId, sessionId);
            void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
            logger.warn(
              { error, sessionId, providerId },
              "Failed to delete provider session during clear; queued cleanup",
            );
          }
        }
      }
      this.clearHostContinuityCaches();
      this.clearBoundSessionIdentity();
      this.syncRuntimeState();
      this.abortRequestedAt = null;
      this.streamAssembler.clear();
      this.transitionTo("idle");
    } catch (error) {
      throw this.reportAndWrapError(error, `Failed to clear the ${this.providerLabel} session`);
    }
  }

  async switchProvider(providerId: ProviderId, reason: "user-requested" | "recovery" | "policy" = "user-requested") {
    const fromProviderId = this.client?.providerId ?? this.providerOverride ?? this.configuredProviderId;
    if (fromProviderId === providerId) {
      this.providerOverride = providerId === getConfiguredProviderId(this.env) ? null : this.providerOverride;
      return;
    }
    const checkpoint = this.createRuntimeCheckpoint(
      "session-summary",
      `Switching provider from ${getProviderLabel(fromProviderId)} to ${getProviderLabel(providerId)}.`,
    );
    const switchedAt = Date.now();
    this.beginSessionTeardown();
    const sessionId = this.activeSessionId;
    const cleanupProviderIds = sessionId
      ? this.getStalePersistedSessionCleanupProviderIds(
          sessionId,
          this.runtimeStore.getStationRuntimeState(),
          fromProviderId,
        )
      : [];
    await this.disconnectSession();
    if (sessionId) {
      for (const cleanupProviderId of cleanupProviderIds) {
        try {
          await this.deletePersistedSession(sessionId, cleanupProviderId);
        } catch (error) {
          this.runtimeStore.queueProviderSessionCleanup(cleanupProviderId, sessionId);
          void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
          logger.warn(
            { error, sessionId, providerId: cleanupProviderId },
            "Failed to delete provider session during provider switch; queued cleanup",
          );
        }
      }
    }
    await this.disposeClient();
    this.clearHostContinuityCaches();
    this.clearBoundSessionIdentity();
    this.providerOverride = providerId;
    await Promise.all([...this.subagentRunners.values()].map((runner) => runner.switchProvider(providerId, reason)));
    const { hostManifestHash, projectionHash } = this.getCurrentToolManifest();
    const runtimeSessionId = this.getRuntimeSessionId();
    if (runtimeSessionId) {
      const existing = this.runtimeStore.getRuntimeSession(runtimeSessionId);
      const switchRecord = {
        switchId: randomUUID(),
        fromProviderId,
        toProviderId: providerId,
        switchedAt,
        reason,
        hostManifestHash,
        projectionHash,
        checkpointId: checkpoint?.checkpointId ?? null,
      } as const;
      this.persistRuntimeSessionContract(hostManifestHash, projectionHash, {
        providerSwitches: [...(existing?.providerSwitches ?? []), switchRecord],
      });
      this.runtimeStore.appendRuntimeLedgerEvent(
        createRuntimeLedgerEvent({
          eventId: randomUUID(),
          sessionId: runtimeSessionId,
          occurredAt: switchedAt,
          type: "provider.switched",
          payload: switchRecord,
        }),
      );
    }
    this.syncRuntimeState();
  }

  async abortResponse(): Promise<void> {
    if (this.currentState !== "thinking" && !this.promptInFlight) {
      return;
    }

    this.responseAbortEpoch += 1;
    const cancellation = requestRuntimeCancellation(Date.now());
    this.abortRequestedAt = cancellation.requestedAt;
    this.lastCancellationCompletedAt = cancellation.completedAt;
    this.syncRuntimeState();
    recordRuntimeCancellationRequested(this.runtimeStore, this.getRuntimeSessionId(), {
      mode: this.getProviderCapabilities().turnCancellation,
      requestedAt: this.abortRequestedAt,
    });
    this.nextResponseAutoSpeak = true;
    const activeSessionId = this.activeSessionId;
    const client = await this.getOrCreateClient();
    const liveSession = this.session;
    if (shouldUseProviderAbort(client.capabilities) && liveSession?.abort) {
      this.activePromptEpoch += 1;
      this.promptInFlight = false;
      this.observedToolActivity = false;
      await liveSession.abort();
      this.restoreCommittedHostContinuity();
      this.clearPendingPermissionRequests("expired");
      this.streamAssembler.clear();
      this.activeToolCalls.clear();
      this.latestUsage = null;
      const completedCancellation = completeRuntimeCancellation(Date.now());
      this.abortRequestedAt = completedCancellation.requestedAt;
      this.lastCancellationCompletedAt = completedCancellation.completedAt;
      this.syncRuntimeState();
      recordRuntimeCancellationCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
        mode: this.getProviderCapabilities().turnCancellation,
        completedAt: this.lastCancellationCompletedAt,
      });
      this.transitionTo("idle");
      return;
    }
    this.activePromptEpoch += 1;
    this.promptInFlight = false;
    this.observedToolActivity = false;
    await this.disconnectSession();
    if (activeSessionId) {
      if (shouldUseProviderAbort(client.capabilities)) {
        this.restoreCommittedHostContinuity();
        const completedCancellation = completeRuntimeCancellation(Date.now());
        this.abortRequestedAt = completedCancellation.requestedAt;
        this.lastCancellationCompletedAt = completedCancellation.completedAt;
        this.syncRuntimeState();
        recordRuntimeCancellationCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
          mode: this.getProviderCapabilities().turnCancellation,
          completedAt: this.lastCancellationCompletedAt,
        });
        this.transitionTo("idle");
        return;
      }
      const cleanupProviderIds = this.getStalePersistedSessionCleanupProviderIds(
        activeSessionId,
        this.runtimeStore.getStationRuntimeState(),
        this.client?.providerId ?? this.providerOverride ?? this.configuredProviderId,
      );
      for (const providerId of cleanupProviderIds) {
        try {
          await this.deletePersistedSession(activeSessionId, providerId);
        } catch (error) {
          this.runtimeStore.queueProviderSessionCleanup(providerId, activeSessionId);
          void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
          logger.warn(
            { error, sessionId: activeSessionId, providerId },
            "Failed to delete provider session during cancellation teardown; queued cleanup",
          );
        }
      }
      this.clearBoundSessionIdentity();
    }
    const completedCancellation = completeRuntimeCancellation(Date.now());
    this.abortRequestedAt = completedCancellation.requestedAt;
    this.lastCancellationCompletedAt = completedCancellation.completedAt;
    this.syncRuntimeState();
    recordRuntimeCancellationCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
      mode: this.getProviderCapabilities().turnCancellation,
      completedAt: this.lastCancellationCompletedAt,
    });
    this.transitionTo("idle");
  }

  async shutdown(): Promise<void> {
    this.shutdownRequested = true;
    this.beginSessionTeardown();
    this.clearPendingPermissionRequests("expired");
    await this.disconnectSession();
    await this.disposeClient();
  }

  cancelPendingPermissionRequests(): void {
    this.clearPendingPermissionRequests("expired");
  }

  resolvePermissionRequest(requestId: string, approved: boolean): boolean {
    const pending = this.pendingPermissionRequests.get(requestId);
    if (!pending) {
      return false;
    }

    this.pendingPermissionRequests.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(approved ? approvePermissionOnce() : rejectPermission());
    return true;
  }

  launchManagedSubagent(
    domain: SubagentDomain,
    args: SubagentDelegationArgs,
    options: { workingDirectory?: string } = {},
  ): ManagedSubagentLaunch {
    if (this.shutdownRequested) {
      throw new AssistantError("Station is shutting down.");
    }
    const launch = this.createSubagentRunner(domain, options.workingDirectory).launch(args);
    const handle = this.subagentRunRegistry.track(domain.id, args, launch);
    return {
      handle,
      completion: this.subagentRunRegistry.waitFor(handle.runId, 24 * 60 * 60 * 1000),
    };
  }

  writeManagedSubagent(runId: string, input: string): Promise<SubagentRunSnapshot | null> {
    return this.subagentRunRegistry.write(runId, input);
  }

  waitForManagedSubagent(runId: string, timeoutMs?: number): Promise<SubagentRunSnapshot | null> {
    return this.subagentRunRegistry.waitFor(runId, timeoutMs);
  }

  stopManagedSubagent(runId: string): Promise<SubagentRunSnapshot | null> {
    return this.subagentRunRegistry.stop(runId);
  }

  listManagedSubagents(options: { includeCompleted?: boolean } = {}): SubagentRunSnapshot[] {
    return this.subagentRunRegistry.list(options);
  }

  private beginSessionTeardown(): number {
    this.sessionTeardownEpoch += 1;
    return this.sessionTeardownEpoch;
  }

  private async getOrCreateSession(expectedTeardownEpoch?: number): Promise<ProviderSession> {
    if (this.shutdownRequested) {
      throw new AssistantError("Station is shutting down.");
    }
    if (expectedTeardownEpoch !== undefined && expectedTeardownEpoch !== this.sessionTeardownEpoch) {
      throw new AssistantError("Station session is being cleared.");
    }
    if (this.session) {
      return this.session;
    }

    if (this.initializingSession) {
      return this.initializingSession;
    }

    const initializingSessionResult = this.createSessionWithProvider();
    const initializingSession = initializingSessionResult.then(({ session }) => session);
    this.initializingSession = initializingSession;

    try {
      const { session, providerId } = await initializingSessionResult;
      if (expectedTeardownEpoch !== undefined && expectedTeardownEpoch !== this.sessionTeardownEpoch) {
        void this.cleanupSessionOpenedDuringTeardown(session, providerId);
        throw new AssistantError("Station session is being cleared.");
      }

      if (this.initializingSession === initializingSession) {
        this.session = session;
      } else {
        void session.disconnect().catch((error) => {
          logger.warn({ error, sessionId: session.sessionId }, "Failed to disconnect superseded provider session");
        });
      }

      return session;
    } finally {
      if (this.initializingSession === initializingSession) {
        this.initializingSession = null;
      }
    }
  }

  private async createSession(): Promise<ProviderSession> {
    const { session } = await this.createSessionWithProvider();
    return session;
  }

  private async createSessionWithProvider(): Promise<{ session: ProviderSession; providerId: ProviderId }> {
    const client = await this.getOrCreateClient();
    const sessionPromise = this.openSession(client);

    let session: ProviderSession;
    try {
      session = await withTimeout(
        sessionPromise,
        SESSION_INIT_TIMEOUT_MS,
        `Timed out while connecting to ${this.providerLabel}`,
      );
    } catch (error) {
      this.session = null;
      sessionPromise
        .then((resolvedSession) =>
          resolvedSession.disconnect().catch((disconnectError) => {
            logger.warn(
              { error: disconnectError, sessionId: resolvedSession.sessionId },
              "Failed to disconnect provider session after initialization failure",
            );
          }),
        )
        .catch((sessionError) => {
          logger.debug({ error: sessionError }, "Ignored failed session initialization cleanup");
        });
      throw error;
    }

    this.activeSessionId = session.sessionId;
    this.persistSessionId(shouldPersistProviderSession(client.capabilities) ? session.sessionId : null);
    this.registeredToolSignature = this.getCurrentToolSignature();
    const contract = this.syncRuntimeState();
    recordRuntimeProviderBound(this.runtimeStore, this.getRuntimeSessionId(), {
      bindingRevision: contract?.providerBinding.bindingRevision ?? 0,
      providerId: client.providerId,
      providerSessionId: this.activeSessionId,
      hostManifestHash: contract?.providerBinding.hostManifestHash ?? this.boundHostManifestHash ?? "",
      projectionHash: contract?.providerBinding.projectionHash ?? this.boundProviderProjectionHash ?? "",
      checkpointId: contract?.checkpointRef?.checkpointId ?? null,
      occurredAt: Date.now(),
    });
    if (this.sessionOrigin === "resumed") {
      const recoveredFrom = this.activeRecoverySource ?? "provider-session";
      this.syncRuntimeState();
      recordRuntimeRecoveryCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
        recoveredFrom,
        success: true,
        occurredAt: Date.now(),
      });
    }
    logger.info({ sessionId: session.sessionId, providerId: client.providerId }, "Provider session ready");

    return { session, providerId: client.providerId };
  }

  private async openSession(client: ProviderClient): Promise<ProviderSession> {
    const persistedSessionId =
      this.activeSessionId ??
      (shouldPersistProviderSession(client.capabilities) ? (this.sessionPersistence?.load() ?? null) : null);
    const runtimeState = this.runtimeStore.getStationRuntimeState();
    const { hostManifestHash, projectionHash } = this.getCurrentToolManifest(client);
    const canResumePersistedSession =
      runtimeState !== null &&
      runtimeState.providerId === client.providerId &&
      runtimeState.activeSessionId === persistedSessionId &&
      runtimeState.hostManifestHash === hostManifestHash &&
      runtimeState.providerProjectionHash === projectionHash;
    if (persistedSessionId) {
      if (!canResumePersistedSession) {
        logger.info(
          {
            sessionId: persistedSessionId,
            providerId: client.providerId,
            persistedActiveSessionId: runtimeState?.activeSessionId ?? null,
            persistedProviderId: runtimeState?.providerId ?? null,
            currentProviderId: client.providerId,
            persistedHostManifestHash: runtimeState?.hostManifestHash ?? null,
            currentHostManifestHash: hostManifestHash,
            persistedProjectionHash: runtimeState?.providerProjectionHash ?? null,
            currentProjectionHash: projectionHash,
          },
          "Discarding persisted provider session because the runtime capability projection changed",
        );
        const cleanupProviderIds = this.getStalePersistedSessionCleanupProviderIds(
          persistedSessionId,
          runtimeState,
          client.providerId,
        );
        for (const cleanupProviderId of cleanupProviderIds) {
          try {
            await this.deletePersistedSession(persistedSessionId, cleanupProviderId);
          } catch (error) {
            this.runtimeStore.queueProviderSessionCleanup(cleanupProviderId, persistedSessionId);
            void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
            logger.warn(
              { error, sessionId: persistedSessionId, providerId: cleanupProviderId },
              "Failed to delete stale persisted provider session before creating a fresh session; queued cleanup",
            );
          }
        }
        this.clearBoundSessionIdentity();
      } else {
        try {
          const session = await client.resumeSession(
            persistedSessionId,
            this.getSessionConfig(persistedSessionId, client, null),
          );
          this.activeSessionId = persistedSessionId;
          this.boundHostManifestHash = hostManifestHash;
          this.boundProviderProjectionHash = projectionHash;
          this.sessionOrigin = "resumed";
          logger.info({ sessionId: persistedSessionId, providerId: client.providerId }, "Provider session resumed");
          return session;
        } catch (error) {
          if (!this.isMissingSessionError(error)) {
            throw error;
          }

          logger.warn(
            { error, sessionId: persistedSessionId },
            `Persisted ${this.providerLabel} session was not found; creating a fresh session`,
          );
          this.clearBoundSessionIdentity();
        }
      }
    }

    const sessionId = randomUUID();
    this.activeSessionId = sessionId;
    this.boundHostManifestHash = hostManifestHash;
    this.boundProviderProjectionHash = projectionHash;
    const hostContinuity =
      client.capabilities.sessionResumption === "host-managed"
        ? this.getHostContinuitySeed(client.providerId, hostManifestHash, projectionHash)
        : null;
    if (hostContinuity) {
      this.sessionOrigin = "resumed";
      this.activeRecoverySource = "host-transcript";
      return createFreshProviderSession(
        client,
        this.getSessionConfig(sessionId, client, null, hostContinuity),
        sessionId,
      );
    }
    this.sessionOrigin = "created";
    const recoverySection = this.buildRuntimeRecoverySection();
    return createFreshProviderSession(
      client,
      this.getSessionConfig(sessionId, client, recoverySection, null),
      sessionId,
    );
  }

  private buildOutgoingPrompt(text: string, continuityPreamble: string | null, hadLiveSession: boolean): string {
    return buildOutgoingPrompt(
      text,
      this.activeRecoverySource ? null : continuityPreamble,
      hadLiveSession,
      this.sessionOrigin,
    );
  }

  private getSessionConfig(
    expectedSessionId?: string | null,
    provider?: Pick<ProviderClient, "providerId" | "capabilities">,
    runtimeRecoverySection: ProviderSystemMessageSection | null = null,
    hostContinuity: ProviderHostContinuityState | null = null,
  ): Omit<ProviderSessionConfig, "sessionId"> {
    const toolBridgeOptions = this.getToolBridgeOptions();
    const expectedTeardownEpoch = this.sessionTeardownEpoch;
    return createSessionConfig({
      env: this.env,
      model: this.requestedModel,
      onEvent: (event) => {
        this.handleSessionEvent(event, expectedSessionId ?? undefined);
      },
      onPermissionRequest: (request) => this.handlePermissionRequest(request, expectedSessionId ?? undefined),
      additionalInstructions: this.additionalInstructions,
      toolAggregator: this.toolAggregator,
      toolBridgeOptions,
      workingDirectory: this.workingDirectory,
      streaming: provider ? shouldRequestNativeStreaming(provider.capabilities) : true,
      providerId: provider?.providerId,
      providerCapabilities: provider?.capabilities,
      runtimeRecoverySection,
      hostContinuity,
      onHostContinuitySnapshot: (snapshot) => {
        if (
          (expectedSessionId && this.activeSessionId !== expectedSessionId) ||
          this.sessionTeardownEpoch !== expectedTeardownEpoch
        ) {
          return;
        }
        this.hostContinuityState = {
          ...snapshot,
          systemMessageHash: this.getCurrentSystemMessageHash(),
        };
        this.syncRuntimeState();
      },
    });
  }

  private getCurrentSystemMessageHash(): string {
    return getSessionSystemMessageHash({
      env: this.env,
      toolAggregator: this.toolAggregator,
      toolBridgeOptions: this.getToolBridgeOptions(),
      additionalInstructions: this.additionalInstructions,
    });
  }

  private async applyRequestedModel(session: ProviderSession): Promise<void> {
    if (!this.requestedModel || !session.setModel) {
      return;
    }
    await withTimeout(
      session.setModel(this.requestedModel),
      SESSION_INIT_TIMEOUT_MS,
      `Timed out while selecting station model ${this.requestedModel}`,
    );
  }

  private beginTurnWatchdog(promptEpoch: number): void {
    if (this.activeTurnWatchdog?.promptEpoch === promptEpoch) {
      return;
    }
    const now = Date.now();
    this.activeTurnWatchdog = {
      promptEpoch,
      startedAt: now,
      lastActivityAt: now,
      firstActivityAt: null,
    };
  }

  private clearTurnWatchdog(promptEpoch: number): void {
    if (this.activeTurnWatchdog?.promptEpoch === promptEpoch) {
      this.activeTurnWatchdog = null;
    }
  }

  private noteTurnActivity(): void {
    const watchdog = this.activeTurnWatchdog;
    if (!watchdog || watchdog.promptEpoch !== this.activePromptEpoch) {
      return;
    }
    const now = Date.now();
    watchdog.lastActivityAt = now;
    watchdog.firstActivityAt ??= now;
  }

  private getTurnWatchdogTimeout(promptEpoch: number): AssistantError | null {
    const watchdog = this.activeTurnWatchdog;
    if (!watchdog || watchdog.promptEpoch !== promptEpoch) {
      return null;
    }
    const now = Date.now();
    if (now - watchdog.startedAt >= TURN_HARD_TIMEOUT_MS) {
      return new AssistantError(`Turn exceeded the maximum duration for ${this.providerLabel}.`);
    }
    if (watchdog.firstActivityAt === null) {
      if (now - watchdog.startedAt >= TURN_FIRST_ACTIVITY_TIMEOUT_MS) {
        return new AssistantError(`Timed out while waiting for ${this.providerLabel} to begin the turn.`);
      }
      return null;
    }
    if (this.pendingPermissionRequests.size > 0 || this.activeToolCalls.size > 0) {
      return null;
    }
    if (now - watchdog.lastActivityAt >= TURN_ACTIVITY_TIMEOUT_MS) {
      return new AssistantError(`Turn stalled while waiting for activity from ${this.providerLabel}.`);
    }
    return null;
  }

  private async stopTimedOutTurn(session: ProviderSession): Promise<void> {
    const providerId = this.client?.providerId ?? this.providerOverride ?? this.configuredProviderId;
    const capabilities = this.client?.capabilities ?? getDefaultProviderCapabilities(providerId);
    const sessionId = session.sessionId;
    try {
      if (session.abort && shouldUseProviderAbort(capabilities)) {
        await session.abort();
      }
      await this.invalidateExpiredSession(session);
      try {
        await this.deletePersistedSession(sessionId, providerId);
      } catch (error) {
        this.runtimeStore.queueProviderSessionCleanup(providerId, sessionId);
        void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
        logger.warn(
          { error, sessionId, providerId },
          "Failed to delete provider session after turn timeout; queued cleanup",
        );
      }
    } catch (error) {
      logger.warn({ error, sessionId: session.sessionId }, "Failed to clean up timed-out turn session");
    }
  }

  private async awaitTurnCompletion(
    session: ProviderSession,
    sendPromise: Promise<void>,
    promptEpoch: number,
  ): Promise<void> {
    this.beginTurnWatchdog(promptEpoch);
    let timeoutId: NodeJS.Timeout | null = null;
    const pending = sendPromise.then(
      () => ({ kind: "resolved" }) as const,
      (error) => ({ kind: "rejected", error }) as const,
    );
    try {
      while (true) {
        const result = await Promise.race([
          pending,
          new Promise<{ kind: "tick" }>((resolve) => {
            timeoutId = setUnrefTimeout(() => resolve({ kind: "tick" }), TURN_WATCHDOG_POLL_MS);
          }),
        ]);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (result.kind === "resolved") {
          return;
        }
        if (result.kind === "rejected") {
          throw result.error;
        }
        const timeoutError = this.getTurnWatchdogTimeout(promptEpoch);
        if (timeoutError) {
          await this.stopTimedOutTurn(session);
          throw timeoutError;
        }
      }
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private handleSessionEvent(event: ProviderSessionEvent, expectedSessionId?: string): void {
    if (this.session === null && this.initializingSession === null) {
      return;
    }
    if (expectedSessionId && this.activeSessionId !== expectedSessionId) {
      return;
    }
    this.noteTurnActivity();

    const sharedTurnState = {
      streamAssembler: this.streamAssembler,
      activeToolCalls: this.activeToolCalls,
      latestUsage: this.latestUsage ?? undefined,
      latestAssistantText: this.latestAssistantMessageText ?? undefined,
      lastAssistantMessageId: this.lastRuntimeAssistantMessageId,
      idleObserved: false,
    };

    const handled = handleSharedTurnEvent({
      state: sharedTurnState,
      event,
      now: () => Date.now(),
      normalizeUsage: (snapshot) => this.normalizeUsage(snapshot),
      createActiveToolCall: (startEvent, occurredAt) => ({
        callId: startEvent.data.toolCallId,
        toolName: startEvent.data.toolName,
        args: startEvent.data.arguments ?? {},
        startedAt: occurredAt,
      }),
      buildToolRecord: () => undefined,
      onAssistantDelta: (deltaEvent, occurredAt) => {
        recordRuntimeAssistantMessageDelta(this.runtimeStore, this.getRuntimeSessionId(), {
          messageId: deltaEvent.data.messageId,
          deltaContent: deltaEvent.data.deltaContent,
          occurredAt,
        });
        this.bus.emit("assistant:delta", deltaEvent.data.messageId, deltaEvent.data.deltaContent);
      },
      onAssistantMessage: (messageEvent, fullText, occurredAt) => {
        this.syncRuntimeState();
        recordRuntimeAssistantMessage(this.runtimeStore, this.getRuntimeSessionId(), {
          messageId: messageEvent.data.messageId,
          content: fullText,
          occurredAt,
        });
        this.bus.emit("assistant:response-end", {
          messageId: messageEvent.data.messageId,
          text: fullText,
          timestamp: occurredAt,
          autoSpeak: this.nextResponseAutoSpeak,
        });
        this.nextResponseAutoSpeak = true;
        this.syncRuntimeState();
      },
      onToolExecutionStart: (startEvent, _activeToolCall, occurredAt) => {
        this.observedToolActivity = true;
        this.syncRuntimeState();
        recordRuntimeToolExecutionStarted(this.runtimeStore, this.getRuntimeSessionId(), {
          toolCallId: startEvent.data.toolCallId,
          toolName: startEvent.data.toolName,
          arguments: startEvent.data.arguments,
          occurredAt,
        });
        this.bus.emit(
          "assistant:tool-call",
          startEvent.data.toolCallId,
          startEvent.data.toolName,
          startEvent.data.arguments ?? {},
        );
      },
      onToolExecutionComplete: (completeEvent, _toolRecord, occurredAt) => {
        this.observedToolActivity = true;
        this.syncRuntimeState();
        recordRuntimeToolExecutionCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
          toolCallId: completeEvent.data.toolCallId,
          success: !(completeEvent.data.success === false || Boolean(completeEvent.data.error)),
          result: completeEvent.data.result,
          errorMessage: completeEvent.data.error?.message,
          occurredAt,
        });
        this.bus.emit("assistant:tool-result", completeEvent.data.toolCallId, completeEvent.data.result ?? null);
      },
      onAssistantUsage: (usage, _usageEvent, occurredAt) => {
        this.runtimeUsageSummary = updateRuntimeUsageSummary(this.runtimeUsageSummary, usage, occurredAt);
      },
      onSessionIdle: (usage, _idleEvent, occurredAt) => {
        this.emitProviderUsage({
          provider: this.configuredProviderId,
          stationId: this.stationId,
          sessionId: this.activeSessionId ?? this.session?.sessionId ?? null,
          runId: this.missionRunId,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
          latencyMs: usage.latencyMs,
          observedAt: occurredAt,
          source: usage.source,
        });
        this.runtimeUsageSummary = updateRuntimeUsageSummary(this.runtimeUsageSummary, usage, occurredAt);
        if (this.currentState === "thinking") {
          this.abortRequestedAt = null;
          this.transitionTo("idle");
        }
        if (sharedTurnState.latestAssistantText) {
          this.createRuntimeCheckpoint("turn-snapshot", sharedTurnState.latestAssistantText);
          sharedTurnState.latestAssistantText = undefined;
        }
      },
    });
    this.latestUsage = sharedTurnState.latestUsage ?? null;
    this.latestAssistantMessageText = sharedTurnState.latestAssistantText ?? null;
    this.lastRuntimeAssistantMessageId = sharedTurnState.lastAssistantMessageId;

    if (handled) {
      if (event.type === "session.idle") {
        this.latestUsage = null;
      }
      return;
    }

    switch (event.type) {
      case "session.error":
        logger.error(
          { errorType: event.data.errorType, providerId: this.configuredProviderId, sessionError: event.data },
          "Provider session error",
        );
        // Invalidate the live handle so the next sendMessage can resume or recreate the session.
        this.restoreCommittedHostContinuity();
        this.clearPendingPermissionRequests("expired");
        this.invalidateHostManagedSessionAfterTurnError();
        this.activeToolCalls.clear();
        this.abortRequestedAt = null;
        this.latestUsage = null;
        this.streamAssembler.clear();
        this.bus.emit(
          "assistant:error",
          "PROVIDER_SESSION_ERROR",
          event.data.message,
          formatErrorDetails(event.data),
          this.configuredProviderId,
        );
        this.nextResponseAutoSpeak = true;
        this.transitionTo("error");
        return;

      default:
        return;
    }
  }

  private async disconnectSession(): Promise<void> {
    this.clearPendingPermissionRequests("expired");
    const session = this.session;
    const initializingSession = this.initializingSession;
    this.session = null;
    this.initializingSession = null;
    this.sessionOrigin = null;
    this.activeRecoverySource = null;
    this.registeredToolSignature = null;
    this.activeToolCalls.clear();
    this.latestUsage = null;
    this.streamAssembler.clear();
    this.syncRuntimeState();

    if (initializingSession) {
      try {
        const inflightSession = await initializingSession;
        await inflightSession.disconnect();
      } catch (error) {
        logger.debug({ error }, "Ignored failed in-flight provider session cleanup");
      }
    }

    if (!session) {
      return;
    }

    try {
      await session.disconnect();
      logger.info(
        { sessionId: session.sessionId, providerId: this.configuredProviderId },
        "Provider session disconnected",
      );
    } catch (error) {
      logger.warn({ error, sessionId: session.sessionId }, "Failed to disconnect provider session cleanly");
    }
  }

  private persistSessionId(sessionId: string | null): void {
    this.sessionPersistence?.save(sessionId);
  }

  private clearBoundSessionIdentity(): void {
    this.activeSessionId = null;
    this.boundHostManifestHash = null;
    this.boundProviderProjectionHash = null;
    this.persistSessionId(null);
  }

  private async invalidateExpiredSession(session: ProviderSession): Promise<void> {
    if (this.session !== session) {
      return;
    }

    this.restoreCommittedHostContinuity();
    this.discardHostContinuityOnProjectionDrift();
    await this.disconnectSession();
    this.clearBoundSessionIdentity();
    this.transitionTo("idle");
  }

  private restoreCommittedHostContinuity(): void {
    this.hostContinuityState = this.resumableHostContinuityState;
  }

  private clearHostContinuityCaches(): void {
    this.hostContinuityState = null;
    this.resumableHostContinuityState = null;
    this.resumableHostContinuityHostManifestHash = null;
    this.resumableHostContinuityProjectionHash = null;
  }

  private captureResumableHostContinuity(): void {
    this.resumableHostContinuityState = this.hostContinuityState;
    if (!this.hostContinuityState) {
      this.resumableHostContinuityHostManifestHash = null;
      this.resumableHostContinuityProjectionHash = null;
      return;
    }
    const { hostManifestHash, projectionHash } =
      this.boundHostManifestHash && this.boundProviderProjectionHash
        ? {
            hostManifestHash: this.boundHostManifestHash,
            projectionHash: this.boundProviderProjectionHash,
          }
        : this.getCurrentToolManifest(this.client ?? undefined);
    this.resumableHostContinuityHostManifestHash = hostManifestHash;
    this.resumableHostContinuityProjectionHash = projectionHash;
  }

  private discardHostContinuityOnProjectionDrift(): void {
    if (!this.hostContinuityState || !this.boundHostManifestHash || !this.boundProviderProjectionHash) {
      return;
    }
    const { hostManifestHash, projectionHash } = this.getCurrentToolManifest(this.client ?? undefined);
    if (this.boundHostManifestHash !== hostManifestHash || this.boundProviderProjectionHash !== projectionHash) {
      this.clearHostContinuityCaches();
    }
  }

  private invalidateHostManagedSessionAfterTurnError(): void {
    this.session = null;
    const sessionId = this.activeSessionId;
    const providerId = this.client?.providerId ?? this.providerOverride ?? this.configuredProviderId;
    const capabilities = this.client?.capabilities ?? getDefaultProviderCapabilities(providerId);
    if (!sessionId || capabilities.sessionResumption !== "host-managed") {
      return;
    }
    this.discardHostContinuityOnProjectionDrift();
    this.clearBoundSessionIdentity();
    void this.deletePersistedSession(sessionId, providerId).catch((error) => {
      this.runtimeStore.queueProviderSessionCleanup(providerId, sessionId);
      void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
      logger.warn(
        { error, sessionId, providerId },
        "Failed to delete host-managed provider session after turn error; queued cleanup",
      );
    });
  }

  private async getOrCreateClient(): Promise<ProviderClient> {
    if (this.client) {
      return this.client;
    }

    const { client, strategy } = await this.createClient();
    this.client = client;
    this.authStrategy = strategy;
    return client;
  }

  private async createClient(): Promise<{ client: ProviderClient; strategy: ProviderAuthStrategy }> {
    return createProviderClientForProvider(this.env, this.configuredProviderId, logger);
  }

  private async cleanupSessionOpenedDuringTeardown(session: ProviderSession, providerId: ProviderId): Promise<void> {
    await session.disconnect().catch((error) => {
      logger.warn(
        { error, sessionId: session.sessionId },
        "Failed to disconnect provider session opened during teardown",
      );
    });
    if (this.activeSessionId === session.sessionId) {
      this.clearBoundSessionIdentity();
      this.syncRuntimeState();
    }
    try {
      await this.deletePersistedSession(session.sessionId, providerId);
    } catch (error) {
      this.runtimeStore.queueProviderSessionCleanup(providerId, session.sessionId);
      void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
      logger.warn(
        { error, sessionId: session.sessionId, providerId },
        "Failed to delete provider session opened during teardown; queued cleanup",
      );
    }
  }

  private transitionTo(nextState: AssistantState): void {
    if (this.currentState === nextState) {
      return;
    }

    const previousState = this.currentState;
    this.currentState = nextState;
    if (nextState === "idle") {
      this.captureResumableHostContinuity();
    }
    this.syncRuntimeState();
    this.bus.emit("assistant:state", nextState);
    this.bus.emit("state:change", previousState, nextState);

    if (nextState === "idle") {
      this.queuePendingToolRefresh();
    }
  }

  private async disposeClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.authStrategy = null;

    if (!client) {
      return;
    }

    await this.stopClient(client);
  }

  private async stopClient(client: ProviderClient): Promise<void> {
    await stopProviderClient(client, logger);
  }

  private async deletePersistedSession(
    sessionId: string,
    providerId: ProviderId = this.configuredProviderId,
  ): Promise<void> {
    const existingClient = this.client;
    const reuseExistingClient = existingClient?.providerId === providerId || this.configuredProviderId === providerId;
    const client = reuseExistingClient
      ? await this.getOrCreateClient()
      : (await createProviderClientForProvider(this.env, providerId, logger)).client;
    try {
      await client.deleteSession(sessionId);
      this.runtimeStore.clearPendingProviderSessionCleanup(providerId, sessionId);
      logger.info({ sessionId, providerId: client.providerId }, "Provider session deleted");
    } catch (error) {
      if (this.isMissingSessionError(error)) {
        this.runtimeStore.clearPendingProviderSessionCleanup(providerId, sessionId);
        logger.info({ sessionId, providerId: client.providerId }, "Provider session was already deleted");
        return;
      }

      throw error;
    } finally {
      if (!reuseExistingClient) {
        await stopProviderClient(client, logger);
      }
    }
  }

  private getStalePersistedSessionCleanupProviderIds(
    persistedSessionId: string,
    runtimeState: ReturnType<RuntimeStore["getStationRuntimeState"]>,
    currentProviderId: ProviderId,
  ): ProviderId[] {
    if (runtimeState?.activeSessionId === persistedSessionId && runtimeState.providerId) {
      return [runtimeState.providerId];
    }
    return [...new Set([currentProviderId, ...ALL_PROVIDER_IDS])];
  }

  private reportAndWrapError(error: unknown, fallbackMessage: string): AssistantError {
    const wrappedError =
      error instanceof AssistantError
        ? error
        : new AssistantError(error instanceof Error ? error.message : fallbackMessage, error);

    this.activeToolCalls.clear();
    this.streamAssembler.clear();
    logger.error({ err: wrappedError, details: formatErrorDetails(wrappedError) }, fallbackMessage);

    // Skip bus emit if a session.error event already reported to the client
    if (this.currentState !== "error") {
      this.bus.emit(
        "assistant:error",
        wrappedError.code,
        wrappedError.message,
        formatErrorDetails(wrappedError),
        this.configuredProviderId,
      );
    }
    this.restoreCommittedHostContinuity();
    this.invalidateHostManagedSessionAfterTurnError();
    this.transitionTo("error");

    (wrappedError as ReportedAssistantError).reportedToClient = true;

    return wrappedError;
  }

  private isMissingSessionError(error: unknown): boolean {
    for (const message of this.collectErrorMessages(error)) {
      if (message.includes("Session not found:")) {
        return true;
      }
    }

    return false;
  }

  private collectErrorMessages(error: unknown, depth = 0): string[] {
    if (depth > 5 || error === null || error === undefined) {
      return [];
    }

    if (typeof error === "string") {
      return [error];
    }

    if (error instanceof Error) {
      const messages = [error.message];
      if ("cause" in error && error.cause !== undefined) {
        messages.push(...this.collectErrorMessages(error.cause, depth + 1));
      }
      return messages;
    }

    return [];
  }

  private async handlePermissionRequest(
    request: ProviderPermissionRequest,
    expectedSessionId?: string,
  ): Promise<ProviderPermissionResult> {
    if (expectedSessionId && this.activeSessionId !== expectedSessionId) {
      return permissionUserNotAvailable();
    }
    const visionPermission = isVisionPermissionRequest(request);
    const missionServicePermission = isMissionServicePermissionRequest(request);
    const interactiveHostToolPermission = isInteractiveHostToolPermissionRequest(request);
    if (!visionPermission && !missionServicePermission && !interactiveHostToolPermission) {
      return approvePermissionOnce();
    }

    if (!this.session) {
      return permissionUserNotAvailable();
    }

    const requestId = randomUUID();
    const payload: PermissionRequestPayload = {
      requestId,
      ...(this.stationId ? { stationId: this.stationId } : {}),
      kind: visionPermission ? "mcp" : "custom-tool",
      toolCallId: typeof request.toolCallId === "string" ? request.toolCallId : undefined,
      serverName: visionPermission
        ? request.serverName
        : missionServicePermission
          ? "Spira mission runtime"
          : "Spira host runtime",
      toolName: request.toolName,
      toolTitle: visionPermission
        ? typeof request.toolTitle === "string" && request.toolTitle.length > 0
          ? request.toolTitle
          : request.toolName
        : missionServicePermission
          ? getMissionServiceToolTitle(request.toolName)
          : request.toolName,
      args: request.args,
      readOnly: visionPermission ? request.readOnly === true : false,
    };

    return await executeRuntimePermissionRequest({
      runtimeStore: this.runtimeStore,
      runtimeSessionId: this.getRuntimeSessionId(),
      payload,
      now: () => Date.now(),
      onRequested: (permissionPayload) => {
        this.noteTurnActivity();
        this.bus.emit("assistant:permission-request", permissionPayload);
        this.runtimeStore.persistPermissionRequest(permissionPayload);
      },
      onResolved: (status) => {
        this.noteTurnActivity();
        this.lastPermissionResolvedAt = Date.now();
        this.runtimeStore.resolvePermissionRequest(requestId, status);
        this.syncRuntimeState();
        this.bus.emit("assistant:permission-complete", requestId, status);
      },
      decide: () =>
        new Promise<ProviderPermissionResult>((resolve) => {
          const timeout = setUnrefTimeout(() => {
            const pending = this.pendingPermissionRequests.get(requestId);
            if (!pending) {
              return;
            }

            this.pendingPermissionRequests.delete(requestId);
            pending.resolve(permissionUserNotAvailable());
          }, PERMISSION_REQUEST_TIMEOUT_MS);

          this.pendingPermissionRequests.set(requestId, { resolve, timeout });
          this.noteTurnActivity();
          this.syncRuntimeState();
        }),
    });
  }

  private clearPendingPermissionRequests(_result: "denied" | "expired"): void {
    for (const [_requestId, pending] of this.pendingPermissionRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.resolve(permissionUserNotAvailable());
    }
    this.pendingPermissionRequests.clear();
  }

  private emitProviderUsage(record: ProviderUsageRecord): void {
    this.bus.emit("provider:usage", record);
    this.syncRuntimeState();
    recordRuntimeUsageObserved(this.runtimeStore, this.getRuntimeSessionId(), {
      model: record.model ?? null,
      totalTokens: record.totalTokens ?? null,
      source: record.source,
      observedAt: record.observedAt,
    });
    logger.info({ usage: record }, "Provider usage observed");
  }

  private normalizeUsage(snapshot: Partial<ProviderUsageSnapshot> | null | undefined): ProviderUsageSnapshot {
    return normalizeProviderUsageSnapshot(
      this.client?.capabilities ?? {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "none",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "none",
      },
      snapshot,
    );
  }

  private syncRuntimeState(): RuntimeSessionContract | null {
    return syncStationRuntimeState(this.getRuntimePersistenceContext());
  }

  private getRuntimeSessionId(): string | null {
    return getStationManagerRuntimeSessionId(this.stationId);
  }

  private getProviderCapabilities() {
    return this.client?.capabilities ?? getDefaultProviderCapabilities(this.configuredProviderId);
  }

  private persistRuntimeSessionContract(
    hostManifestHash: string,
    projectionHash: string,
    overrides: Partial<RuntimeSessionContract> = {},
  ): RuntimeSessionContract | null {
    return persistStationRuntimeSessionContract({
      context: this.getRuntimePersistenceContext(),
      hostManifestHash,
      projectionHash,
      overrides,
    });
  }

  private appendRuntimeLedgerEventIfSession(
    event: Omit<RuntimeLedgerEvent, "sessionId"> | null,
    options: { syncState?: boolean } = {},
  ): void {
    appendStationRuntimeLedgerEventIfSession(
      this.runtimeStore,
      this.getRuntimeSessionId(),
      event,
      () => {
        this.syncRuntimeState();
      },
      options,
    );
  }

  private recordRuntimeUserMessage(messageId: string, content: string): void {
    recordStationRuntimeUserMessage(
      this.runtimeStore,
      this.getRuntimeSessionId(),
      () => {
        this.syncRuntimeState();
      },
      messageId,
      content,
    );
  }

  private createRuntimeCheckpoint(
    kind: RuntimeCheckpointPayload["kind"],
    summary: string,
  ): RuntimeCheckpointPayload | null {
    return createStationRuntimeCheckpoint({
      context: this.getRuntimePersistenceContext(),
      kind,
      summary,
      syncRuntimeState: () => this.syncRuntimeState(),
    });
  }

  private buildRuntimeRecoverySection() {
    const { recoverySection, recoverySource } = buildStationRuntimeRecoverySection({
      runtimeStore: this.runtimeStore,
      stationId: this.stationId,
    });
    this.activeRecoverySource = recoverySource;
    return recoverySection;
  }

  private getHostContinuitySeed(
    providerId: ProviderId,
    hostManifestHash: string,
    projectionHash: string,
  ): ProviderHostContinuityState | null {
    const resumableHostContinuity = this.resumableHostContinuityState;
    const currentSystemMessageHash = this.getCurrentSystemMessageHash();
    const resumableMatchesCurrentProjection =
      this.resumableHostContinuityHostManifestHash === hostManifestHash &&
      this.resumableHostContinuityProjectionHash === projectionHash;
    const runtimeSessionId = this.getRuntimeSessionId();
    if (!runtimeSessionId) {
      return resumableHostContinuity?.providerId === providerId &&
        resumableMatchesCurrentProjection &&
        resumableHostContinuity.systemMessageHash === currentSystemMessageHash
        ? resumableHostContinuity
        : null;
    }
    const runtimeSession = this.runtimeStore.getRuntimeSession(runtimeSessionId);
    if (!runtimeSession) {
      return resumableHostContinuity?.providerId === providerId &&
        resumableMatchesCurrentProjection &&
        resumableHostContinuity.systemMessageHash === currentSystemMessageHash
        ? resumableHostContinuity
        : null;
    }
    if (
      runtimeSession.providerBinding.providerId !== providerId ||
      runtimeSession.providerBinding.hostManifestHash !== hostManifestHash ||
      runtimeSession.providerBinding.projectionHash !== projectionHash
    ) {
      return null;
    }
    if (
      runtimeSession.turnState.state !== "idle" &&
      runtimeSession.turnState.state !== "completed" &&
      runtimeSession.turnState.state !== "error"
    ) {
      if (
        !resumableHostContinuity ||
        resumableHostContinuity.providerId !== providerId ||
        !resumableMatchesCurrentProjection ||
        resumableHostContinuity.systemMessageHash !== currentSystemMessageHash
      ) {
        return null;
      }
      return resumableHostContinuity;
    }
    const hostContinuity = runtimeSession.hostContinuity ?? this.resumableHostContinuityState ?? null;
    if (
      !hostContinuity ||
      hostContinuity.providerId !== providerId ||
      hostContinuity.systemMessageHash !== currentSystemMessageHash
    ) {
      return null;
    }
    return hostContinuity;
  }

  private getRuntimePersistenceContext() {
    return {
      runtimeStore: this.runtimeStore,
      stationId: this.stationId,
      workingDirectory: this.workingDirectory,
      configuredProviderId: this.configuredProviderId,
      activeSessionId: this.activeSessionId,
      boundHostManifestHash: this.boundHostManifestHash,
      boundProviderProjectionHash: this.boundProviderProjectionHash,
      currentState: this.currentState,
      promptInFlight: this.promptInFlight,
      activeToolCalls: this.activeToolCalls,
      abortRequestedAt: this.abortRequestedAt,
      requestedModel: this.requestedModel,
      runtimeUsageSummary: this.runtimeUsageSummary,
      sessionOrigin: this.sessionOrigin,
      lastRuntimeUserMessageId: this.lastRuntimeUserMessageId,
      lastRuntimeAssistantMessageId: this.lastRuntimeAssistantMessageId,
      pendingPermissionRequests: this.pendingPermissionRequests,
      lastPermissionResolvedAt: this.lastPermissionResolvedAt,
      lastCancellationCompletedAt: this.lastCancellationCompletedAt,
      hostContinuity: this.hostContinuityState,
      getProviderCapabilities: () => this.getProviderCapabilities(),
      getCurrentToolManifest: () => this.getCurrentToolManifest(),
    };
  }

  private getCurrentToolManifest(provider?: Pick<ProviderClient, "providerId" | "capabilities">) {
    const effectiveProviderId = provider?.providerId ?? this.configuredProviderId;
    const effectiveCapabilities =
      provider?.capabilities ?? this.client?.capabilities ?? getDefaultProviderCapabilities(effectiveProviderId);
    return getProviderToolManifest({
      aggregator: this.toolAggregator,
      options: this.getToolBridgeOptions(),
      providerId: effectiveProviderId,
      capabilities: effectiveCapabilities,
    });
  }

  private getCurrentToolSignature(): string {
    const hostManifestHash = buildRuntimeCapabilityRegistry(
      this.toolAggregator,
      this.getToolBridgeOptions(),
    ).hostManifestHash;
    if (!this.client) {
      return hostManifestHash;
    }
    const { projectionHash } = this.getCurrentToolManifest(this.client);
    return `${hostManifestHash}:${projectionHash}`;
  }

  private getToolBridgeOptions(): ToolBridgeOptions {
    const subagentsEnabled = this.env.SPIRA_SUBAGENTS_ENABLED;
    const missionWorkflowState = this.missionRunId ? (this.getMissionWorkflowState?.(this.missionRunId) ?? null) : null;
    const withMissionAction =
      <TArgs extends unknown[], TResult>(
        action: Parameters<typeof assertMissionWorkflowStateActionAllowed>[1],
        handler: ((...args: TArgs) => TResult) | undefined,
      ) =>
      (...args: TArgs): TResult => {
        if (this.missionRunId && this.getMissionWorkflowState) {
          const workflowState = this.getMissionWorkflowState(this.missionRunId);
          if (workflowState) {
            assertMissionWorkflowStateActionAllowed(workflowState, action);
          }
        }
        if (!handler) {
          throw new AssistantError(`Mission action ${action} is unavailable.`);
        }
        return handler(...args);
      };
    const readyDelegationDomains = this.getDelegationDomains();
    const connectedDelegationDomains = readyDelegationDomains.filter(
      (domain) =>
        domain.allowHostTools === true ||
        this.getDelegationDomainTools(domain.id, this.toolAggregator.getTools()).length,
    );
    const missionScoped = this.missionRunId !== null;
    const delegationEnabled = connectedDelegationDomains.length > 0;
    return {
      workingDirectory: this.workingDirectory ?? appRootDir,
      sessionStorage: this.sessionStorage,
      runtimeStore: this.runtimeStore,
      runtimeSessionId: this.getRuntimeSessionId(),
      stationId: this.stationId,
      ...(this.allowUpgradeTools
        ? {
            requestUpgradeProposal: this.requestUpgradeProposal,
            applyHotCapabilityUpgrade: this.applyHotCapabilityUpgrade,
          }
        : {}),
      ...(missionScoped && this.listMissionServices
        ? { listMissionServices: withMissionAction("service-read", this.listMissionServices) }
        : {}),
      ...(missionScoped && this.startMissionService
        ? { startMissionService: withMissionAction("service-write", this.startMissionService) }
        : {}),
      ...(missionScoped && this.stopMissionService
        ? { stopMissionService: withMissionAction("service-write", this.stopMissionService) }
        : {}),
      ...(missionScoped && this.listMissionProofs
        ? { listMissionProofs: withMissionAction("proof-read", this.listMissionProofs) }
        : {}),
      ...(missionScoped && this.runMissionProof
        ? { runMissionProof: withMissionAction("record-proof-result", this.runMissionProof) }
        : {}),
      ...(missionScoped && this.missionRunId ? { missionRunId: this.missionRunId } : {}),
      ...(missionScoped ? { missionWorkflowState } : {}),
      ...(missionScoped && this.getMissionContext ? { getMissionContext: this.getMissionContext } : {}),
      ...(missionScoped && this.saveMissionClassification
        ? { saveMissionClassification: this.saveMissionClassification }
        : {}),
      ...(missionScoped && this.saveMissionPlan ? { saveMissionPlan: this.saveMissionPlan } : {}),
      ...(missionScoped && this.setMissionPhase ? { setMissionPhase: this.setMissionPhase } : {}),
      ...(missionScoped && this.recordMissionValidation
        ? { recordMissionValidation: this.recordMissionValidation }
        : {}),
      ...(missionScoped && this.setMissionProofStrategy
        ? { setMissionProofStrategy: this.setMissionProofStrategy }
        : {}),
      ...(missionScoped && this.recordMissionProofResult
        ? { recordMissionProofResult: this.recordMissionProofResult }
        : {}),
      ...(missionScoped && this.saveMissionSummary ? { saveMissionSummary: this.saveMissionSummary } : {}),
      ...(subagentsEnabled && delegationEnabled
        ? {
            excludeServerIds: this.getDelegatedServerIds(),
            delegationDomains: connectedDelegationDomains,
            delegateToDomain: async (
              domainId: string,
              args: SubagentDelegationArgs,
            ): Promise<SubagentEnvelope | SubagentRunHandle> => {
              if (missionScoped && this.missionRunId && this.getMissionWorkflowState) {
                const workflowState = this.getMissionWorkflowState(this.missionRunId);
                if (workflowState) {
                  assertMissionWorkflowStateActionAllowed(workflowState, "delegate");
                }
              }
              const runner = this.getSubagentRunner(domainId, this.workingDirectory ?? undefined);
              if (args.mode === "background") {
                return this.subagentRunRegistry.track(domainId, args, runner.launch(args));
              }

              return runner.run(args);
            },
            readSubagent: async (agentId, options) =>
              options?.wait
                ? this.subagentRunRegistry.waitFor(agentId, options.timeoutMs)
                : this.subagentRunRegistry.get(agentId),
            listSubagents: (options) => this.subagentRunRegistry.list(options),
            writeSubagent: (agentId, input) => this.subagentRunRegistry.write(agentId, input),
            stopSubagent: (agentId) => this.subagentRunRegistry.stop(agentId),
          }
        : {}),
      ...(missionScoped && this.missionRunId && this.getMissionWorkflowState
        ? {
            wrapHostToolExecution: async (tool, _args, execute) => {
              const missionRunId = this.missionRunId;
              if (!missionRunId) {
                return execute();
              }
              const workflowState = this.getMissionWorkflowState?.(missionRunId);
              const action = HOST_TOOL_MISSION_ACTIONS.get(tool.name);
              if (workflowState && action) {
                assertMissionWorkflowStateActionAllowed(workflowState, action);
              }
              return execute();
            },
            wrapToolExecution: async (tool, _args, execute) => {
              const missionRunId = this.missionRunId;
              if (!missionRunId) {
                return execute();
              }
              const workflowState = this.getMissionWorkflowState?.(missionRunId);
              if (workflowState) {
                assertMissionMcpToolAllowedForState(workflowState, tool);
              }
              return execute();
            },
          }
        : {}),
    };
  }

  private getSubagentRunner(domainId: string, workingDirectory?: string): SubagentRunner {
    const key = this.getSubagentRunnerKey(domainId, workingDirectory);
    const existingRunner = this.subagentRunners.get(key);
    if (existingRunner) {
      return existingRunner;
    }

    const domain = this.getDelegationDomain(domainId);
    if (!domain) {
      throw new AssistantError(`Unknown subagent domain ${domainId}`);
    }

    const runner = this.createSubagentRunner(domain, workingDirectory);
    this.subagentRunners.set(key, runner);
    return runner;
  }

  private getSubagentRunnerKey(domainId: string, workingDirectory?: string): string {
    return `${domainId}::${workingDirectory ?? ""}`;
  }

  private createSubagentRunner(domain: SubagentDomain, workingDirectory?: string): SubagentRunner {
    return new SubagentRunner({
      bus: this.bus,
      env: this.env,
      toolAggregator: this.toolAggregator,
      domain,
      workingDirectory,
      initialProviderId: this.client?.providerId ?? this.providerOverride ?? getConfiguredProviderId(this.env),
      onPermissionRequest: (request) => this.handlePermissionRequest(request),
      lockManager: this.subagentLockManager,
      stationId: this.stationId,
      runtimeStore: this.runtimeStore,
    });
  }

  private recoverManagedSubagent(snapshot: SubagentRunSnapshot) {
    const domain = this.getDelegationDomain(snapshot.domain);
    if (!domain) {
      return null;
    }

    const recoveredWorkingDirectory = (snapshot as SubagentRunSnapshot & { workingDirectory?: string })
      .workingDirectory;
    const key = this.getSubagentRunnerKey(domain.id, recoveredWorkingDirectory ?? this.workingDirectory ?? undefined);
    const existingRunner = this.subagentRunners.get(key);
    const runner =
      existingRunner ??
      this.createSubagentRunner(domain, recoveredWorkingDirectory ?? this.workingDirectory ?? undefined);
    const recovered = runner.recover(snapshot);
    if (recovered && !existingRunner) {
      this.subagentRunners.set(key, runner);
    }
    return recovered;
  }

  private getDelegationDomains(): SubagentDomain[] {
    return this.subagentRegistry?.listReady() ?? SUBAGENT_DOMAINS.filter((domain) => domain.ready !== false);
  }

  private getDelegationDomain(domainId: string): SubagentDomain | null {
    return this.subagentRegistry?.get(domainId) ?? SUBAGENT_DOMAINS.find((domain) => domain.id === domainId) ?? null;
  }

  private getDelegatedServerIds(): string[] {
    return (
      this.subagentRegistry?.getDelegatedServerIds() ?? [
        ...new Set(this.getDelegationDomains().flatMap((domain) => domain.serverIds)),
      ]
    );
  }

  private getDelegationDomainTools(domainId: string, tools: ReturnType<McpToolAggregator["getTools"]>) {
    if (this.subagentRegistry) {
      return this.subagentRegistry.getDomainTools(domainId, tools);
    }

    const domain = this.getDelegationDomain(domainId);
    if (!domain) {
      return [];
    }

    const serverIdSet = new Set(domain.serverIds);
    const scopedTools = tools.filter((tool) => serverIdSet.has(tool.serverId));
    if (!domain.allowedToolNames || domain.allowedToolNames.length === 0) {
      return scopedTools;
    }

    const allowedToolNames = new Set(domain.allowedToolNames);
    return scopedTools.filter((tool) => allowedToolNames.has(tool.name));
  }

  private async refreshSessionForToolChanges(): Promise<void> {
    const currentToolSignature = this.getCurrentToolSignature();
    if (this.registeredToolSignature === currentToolSignature) {
      this.pendingToolRefreshSignature = null;
      return;
    }

    if (!this.session && !this.initializingSession) {
      if (this.activeSessionId) {
        const sessionId = this.activeSessionId;
        const cleanupProviderIds = this.getStalePersistedSessionCleanupProviderIds(
          sessionId,
          this.runtimeStore.getStationRuntimeState(),
          this.client?.providerId ?? this.providerOverride ?? this.configuredProviderId,
        );
        let deletionFailed = false;
        try {
          for (const providerId of cleanupProviderIds) {
            try {
              await this.deletePersistedSession(sessionId, providerId);
            } catch (error) {
              deletionFailed = true;
              this.runtimeStore.queueProviderSessionCleanup(providerId, sessionId);
              void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
              logger.warn({ error, sessionId, providerId }, "Failed to delete stale provider session after tool drift");
            }
          }
        } finally {
          this.clearHostContinuityCaches();
          this.clearBoundSessionIdentity();
          this.syncRuntimeState();
        }
        if (deletionFailed) {
          this.pendingToolRefreshSignature = currentToolSignature;
          return;
        }
      }
      this.registeredToolSignature = currentToolSignature;
      this.pendingToolRefreshSignature = null;
      return;
    }

    if (this.currentState !== "idle") {
      this.pendingToolRefreshSignature = currentToolSignature;
      logger.info(
        {
          previousToolSignature: this.registeredToolSignature,
          currentToolSignature,
          currentState: this.currentState,
        },
        "MCP tool inventory changed during an active turn; deferring station session refresh",
      );
      return;
    }

    if (this.refreshingSessionForToolChanges) {
      await this.refreshingSessionForToolChanges;
      await this.refreshSessionForToolChanges();
      return;
    }

    logger.info(
      {
        previousToolSignature: this.registeredToolSignature,
        currentToolSignature,
      },
      "MCP tool inventory changed; refreshing station session",
    );
    this.pendingToolRefreshSignature = null;
    const refreshPromise = (async () => {
      const sessionId = this.activeSessionId;
      const cleanupProviderIds = sessionId
        ? this.getStalePersistedSessionCleanupProviderIds(
            sessionId,
            this.runtimeStore.getStationRuntimeState(),
            this.client?.providerId ?? this.providerOverride ?? this.configuredProviderId,
          )
        : [];
      this.clearHostContinuityCaches();
      this.clearBoundSessionIdentity();
      await this.disconnectSession();
      if (sessionId) {
        for (const providerId of cleanupProviderIds) {
          try {
            await this.deletePersistedSession(sessionId, providerId);
          } catch (error) {
            this.runtimeStore.queueProviderSessionCleanup(providerId, sessionId);
            void this.runtimeStore.drainPendingProviderSessionCleanup(this.env);
            throw error;
          }
        }
      }
    })();
    this.refreshingSessionForToolChanges = refreshPromise;

    try {
      await refreshPromise;
    } finally {
      if (this.refreshingSessionForToolChanges === refreshPromise) {
        this.refreshingSessionForToolChanges = null;
      }
    }
  }

  private async maybeRefreshSessionForToolChanges(): Promise<void> {
    if (!this.pendingToolRefreshSignature || this.currentState !== "idle") {
      return;
    }

    await this.refreshSessionForToolChanges();
  }

  private queueToolRefresh(): void {
    void this.refreshSessionForToolChanges().catch((error) => {
      logger.error({ err: error }, "Failed to refresh the provider session after tool changes");
    });
  }

  private queuePendingToolRefresh(): void {
    void this.maybeRefreshSessionForToolChanges().catch((error) => {
      logger.error({ err: error }, "Failed to refresh the provider session after becoming idle");
    });
  }
}
