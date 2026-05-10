import { randomUUID } from "node:crypto";
import type { RuntimeStationToolCallRecord, SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  AssistantState,
  Env,
  PermissionRequestPayload,
  StationId,
  SubagentDelegationArgs,
  SubagentDomain,
  SubagentRunSnapshot,
  UpgradeProposal,
  WorkSessionClassification,
  WorkSessionPhase,
  WorkSessionSnapshot,
  WorkSessionSummary,
} from "@spira/shared";
import { decideWorkSessionMode } from "../coding/work-session-gate.js";
import { type WorkSessionStorage, createWorkSessionStorage } from "../coding/work-session-storage.js";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import type { MissionWorkflowState } from "../missions/mission-workflow-guard.js";
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
import { getConfiguredProviderId, getProviderLabel, isEscalationProvider } from "../provider/provider-config.js";
import type {
  ProviderClient,
  ProviderHostContinuityState,
  ProviderId,
  ProviderPermissionRequest,
  ProviderPermissionResult,
  ProviderSession,
  ProviderSessionConfig,
  ProviderSessionEscalationResult,
  ProviderSessionEvent,
  ProviderSystemMessageSection,
  ProviderUsageRecord,
  ProviderUsageSnapshot,
} from "../provider/types.js";
import { SubagentLockManager } from "../subagent/lock-manager.js";
import type { SubagentRegistry } from "../subagent/registry.js";
import { SubagentRunRegistry } from "../subagent/run-registry.js";
import { SubagentRunner } from "../subagent/subagent-runner.js";
import { AssistantError, formatErrorDetails } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import { setUnrefTimeout } from "../util/timers.js";
import { approvePermissionOnce, permissionUserNotAvailable, rejectPermission } from "./permission-decisions.js";
import {
  type RuntimeCheckpointPayload,
  type RuntimeLedgerEvent,
  type RuntimeSessionContract,
  type RuntimeUsageSummary,
  createDefaultRuntimeWorkflowState,
  createRuntimeLedgerEvent,
} from "./runtime-contract.js";
import {
  recordRuntimeAssistantMessage,
  recordRuntimeAssistantMessageDelta,
  recordRuntimeCancellationCompleted,
  recordRuntimeCancellationRequested,
  recordRuntimePermissionResolved,
  recordRuntimeProviderBound,
  recordRuntimeRecoveryCompleted,
  recordRuntimeToolExecutionCompleted,
  recordRuntimeToolExecutionStarted,
  recordRuntimeUsageObserved,
} from "./runtime-lifecycle.js";
import { executeRuntimePermissionRequest } from "./runtime-permission-lifecycle.js";
import { completeRuntimeCancellation, requestRuntimeCancellation } from "./runtime-state-machine.js";
import { RuntimeStore } from "./runtime-store.js";
import { handleSharedTurnEvent, updateRuntimeUsageSummary } from "./runtime-turn-engine.js";
import {
  VOICE_RESPONSE_INSTRUCTIONS,
  buildOutgoingPrompt,
  createSessionConfig,
  getSessionSystemMessageHash,
} from "./session-config.js";
import { getDelegationDomain, getSubagentRunnerKey } from "./session-manager/delegation-helpers.js";
import {
  appendRuntimeLedgerEventIfSessionHelper,
  buildRuntimeRecoverySectionHelper,
  createRuntimeCheckpointHelper,
  getHostContinuitySeedHelper,
  getRuntimeSessionIdHelper,
  persistRuntimeSessionContractHelper,
  recordRuntimeUserMessageHelper,
  syncRuntimeStateHelper,
} from "./session-manager/runtime-persistence-helpers.js";
import {
  ALL_PROVIDER_IDS,
  type ActiveTurnWatchdog,
  type ManagedSubagentLaunch,
  PERMISSION_REQUEST_TIMEOUT_MS,
  type PendingPermissionRequest,
  REVIEW_STALL_TIMEOUT_MS,
  type ReportedAssistantError,
  SESSION_INIT_TIMEOUT_MS,
  type SessionPersistence,
  TURN_ACTIVITY_TIMEOUT_MS,
  TURN_FIRST_ACTIVITY_TIMEOUT_MS,
  TURN_HARD_TIMEOUT_MS,
  TURN_WATCHDOG_POLL_MS,
  WORK_SESSION_IMPLEMENTATION_TOOL_NAMES,
  WORK_SESSION_WORKFLOW_PHASES,
  type WorkSessionToolCompletion,
  getMissionServiceToolTitle,
  isInteractiveHostToolPermissionRequest,
  isMissionServicePermissionRequest,
  isVisionPermissionRequest,
} from "./session-manager/shared.js";
import {
  getCurrentToolManifestHelper,
  getCurrentToolSignatureHelper,
  getToolBridgeOptionsHelper,
  maybeRefreshSessionForToolChangesHelper,
  queuePendingToolRefreshHelper,
  queueToolRefreshHelper,
  refreshSessionForToolChangesHelper,
} from "./session-manager/tool-refresh-helpers.js";
import {
  buildPatchAttempt,
  compactAssistantSummary,
  createInitialWorkSessionPhaseHistory,
  extractWorkSessionSearchTerms,
  getNonWorkSessionWorkflowPhaseHistory,
  getToolArgsRecord,
  getToolStringArg,
  getValidationCommand,
  getWorkSessionWorkflowBlock as getWorkSessionWorkflowBlockHelper,
  isValidationCommand,
  isWorkSessionReadyForReview as isWorkSessionReadyForReviewHelper,
  recordWorkSessionValidationResult as recordWorkSessionValidationResultHelper,
  setWorkSessionPhase,
  startWorkSessionImplementation as startWorkSessionImplementationHelper,
  startWorkSessionValidation as startWorkSessionValidationHelper,
} from "./session-manager/work-session-helpers.js";
import {
  writeWorkSessionClosed,
  writeWorkSessionTelemetry,
} from "./session-manager/work-session-telemetry.js";
import { classifyWorkSessionOutcome } from "./session-manager/work-session-outcome.js";
import { writeWorkSessionPostmortem } from "./session-manager/work-session-postmortem.js";
import {
  buildWorkflowReviewState,
  buildWorkflowStateForSessionEscalation,
  clearOpenWorkflowPhaseEntryBlocking,
  getEffectiveWorkflowBlock,
  shouldRestoreWorkSessionWorkflowState,
  syncOpenWorkflowPhaseEntryBlocking,
} from "./session-manager/workflow-helpers.js";
import { type StationSessionStorage, createStationSessionStorage } from "./station-session-storage.js";
import { StreamAssembler } from "./stream-handler.js";
import type { ToolBridgeOptions } from "./tool-bridge.js";

const logger = createLogger("station-session");

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
  isAutoApprovePermissionsEnabled?: () => boolean;
}

export type { ManagedSubagentLaunch, SessionPersistence } from "./session-manager/shared.js";

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
  private readonly workSessionStorage: WorkSessionStorage;
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
  private lastRuntimeAssistantMessageTimestamp: number | null = null;
  private latestAssistantMessageText: string | null = null;
  private activeRecoverySource: "host-checkpoint" | "continuity-preamble" | "host-transcript" | null = null;
  private runtimeUsageSummary: RuntimeUsageSummary = {
    model: null,
    totalTokens: null,
    lastObservedAt: null,
    source: "unknown",
  };
  private workflowState: RuntimeSessionContract["workflowState"] = createDefaultRuntimeWorkflowState();
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
  private readonly isAutoApprovePermissionsEnabled: () => boolean;
  private activeWorkSession: WorkSessionSnapshot | null = null;
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
    this.workSessionStorage = createWorkSessionStorage(this.memoryDb, this.stationId);
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
    this.isAutoApprovePermissionsEnabled = options.isAutoApprovePermissionsEnabled ?? (() => false);
    const persistedRuntimeSession = this.runtimeStore.getRuntimeSession(this.getRuntimeSessionId() ?? "");
    this.activeWorkSession = this.workSessionStorage.load();
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
    this.workflowState = persistedRuntimeSession?.workflowState ?? createDefaultRuntimeWorkflowState();
    const reconciledPersistedReviewState = this.reconcilePersistedReviewState();
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
    this.bus.on("subagent:status", (event) => {
      this.handleReviewSubagentStatus(event.runId, event.domain, event.status, event.occurredAt, event.summary ?? null);
    });
    this.bus.on("missions:runs-changed", (snapshot) => {
      if (!this.missionRunId || !snapshot.runs.some((run) => run.runId === this.missionRunId)) {
        return;
      }
      this.queueToolRefresh();
    });
    const activeWorkSession = this.activeWorkSession;
    if (activeWorkSession && shouldRestoreWorkSessionWorkflowState(this.workflowState, activeWorkSession)) {
      this.syncWorkSessionWorkflowState(activeWorkSession.updatedAt);
    }
    if (this.activeWorkSession || reconciledPersistedReviewState) {
      this.syncRuntimeState();
    }
  }

  private get configuredProviderId() {
    return this.client?.providerId ?? this.providerOverride ?? getConfiguredProviderId(this.env);
  }

  private get providerLabel(): string {
    return getProviderLabel(this.configuredProviderId);
  }

  getWorkSessionSummary(): WorkSessionSummary | null {
    if (this.missionRunId) {
      return {
        mode: "mission",
        active: true,
        updatedAt: null,
      };
    }
    if (!this.activeWorkSession) {
      return null;
    }
    return {
      mode: "work-session",
      active: true,
      sessionId: this.activeWorkSession.sessionId,
      phase: this.activeWorkSession.currentPhase,
      summary: this.activeWorkSession.summary,
      updatedAt: this.activeWorkSession.updatedAt,
    };
  }

  private activateWorkSession(
    taskText: string,
    classification: WorkSessionClassification,
    options: { startsNewSession?: boolean } = {},
  ): void {
    if (!this.stationId) {
      return;
    }
    const now = Date.now();
    const restartSession = options.startsNewSession === true;
    if (restartSession) {
      this.resetWorkflowForNewWorkSession(now);
    }
    const persistedSnapshot = restartSession ? null : this.activeWorkSession;
    const existingSnapshot = persistedSnapshot?.completedAt
      ? {
          ...persistedSnapshot,
          readyForReview: false,
          reviewSummary: null,
          completedAt: null,
        }
      : persistedSnapshot;
    const sessionId = existingSnapshot?.sessionId ?? randomUUID();
    const isNewSession = existingSnapshot === null;
    const reopeningCompletedSession = Boolean(persistedSnapshot?.completedAt);
    if (reopeningCompletedSession) {
      this.clearWorkflowReviewState(now);
    }
    const snapshot: WorkSessionSnapshot = {
      sessionId,
      stationId: this.stationId,
      taskText: existingSnapshot?.taskText ?? taskText,
      currentPhase: existingSnapshot?.currentPhase ?? "discover",
      classification: existingSnapshot?.classification ?? classification,
      phaseHistory:
        existingSnapshot?.phaseHistory ??
        createInitialWorkSessionPhaseHistory(
          now,
          restartSession
            ? "WorkSession restarted for a new explicit task."
            : "WorkSession activated from explicit coding intent.",
        ),
      searchTerms: existingSnapshot?.searchTerms ?? extractWorkSessionSearchTerms(taskText),
      candidateFiles: existingSnapshot?.candidateFiles ?? [],
      selectedFiles: existingSnapshot?.selectedFiles ?? [],
      summary: existingSnapshot?.summary ?? "Discovering repository context.",
      planSummary: existingSnapshot?.planSummary ?? null,
      patchAttempts: existingSnapshot?.patchAttempts ?? [],
      changedFiles: existingSnapshot?.changedFiles ?? [],
      validationResults: existingSnapshot?.validationResults ?? [],
      pendingValidationShellId: existingSnapshot?.pendingValidationShellId ?? null,
      pendingValidationCommand: existingSnapshot?.pendingValidationCommand ?? null,
      fixIterationCount: existingSnapshot?.fixIterationCount ?? 0,
      repeatFailureCount: existingSnapshot?.repeatFailureCount ?? 0,
      lastValidationFingerprint: existingSnapshot?.lastValidationFingerprint ?? null,
      readyForReview: isWorkSessionReadyForReviewHelper(existingSnapshot),
      reviewSummary: existingSnapshot?.reviewSummary ?? null,
      completedAt: existingSnapshot?.completedAt ?? null,
      stalledReason: existingSnapshot?.stalledReason ?? null,
      stalledAt: existingSnapshot?.stalledAt ?? null,
      createdAt: existingSnapshot?.createdAt ?? now,
      updatedAt: now,
    };
    this.persistWorkSession(snapshot);
    if (isNewSession || reopeningCompletedSession) {
      this.syncWorkSessionWorkflowState(now);
    }
    if (reopeningCompletedSession) {
      this.syncRuntimeState();
    }
  }

  /**
   * Emit the close event + the post-mortem stub for a WorkSession that's about to be
   * cleared. Best-effort: errors are logged but never thrown. The "everStalled" signal
   * is sourced from the work_session_events table since the snapshot's `stalledAt` is
   * sticky-cleared on validation success.
   */
  private emitClosingWorkSessionTelemetry(closingSnapshot: WorkSessionSnapshot): void {
    try {
      const everStalled = this.workSessionEverStalled(closingSnapshot.sessionId);
      const outcome = classifyWorkSessionOutcome(closingSnapshot, { everStalled });
      const reachedReadyForReview =
        outcome.kind === "clean-pass" || outcome.kind === "pass-with-friction";
      writeWorkSessionClosed(
        this.memoryDb,
        closingSnapshot,
        { completed: reachedReadyForReview, outcome: outcome.kind, reason: outcome.reason },
        (error) =>
          logger.warn(
            { err: error, sessionId: closingSnapshot.sessionId },
            "Failed to write WorkSession close telemetry; continuing",
          ),
      );
      void writeWorkSessionPostmortem(this.memoryDb, closingSnapshot, outcome).catch((error) =>
        logger.warn(
          { err: error, sessionId: closingSnapshot.sessionId },
          "Failed to write WorkSession post-mortem; continuing",
        ),
      );
    } catch (error) {
      logger.warn(
        { err: error, sessionId: closingSnapshot.sessionId },
        "Unexpected error during WorkSession close; continuing",
      );
    }
  }

  private workSessionEverStalled(sessionId: string): boolean {
    if (!this.memoryDb) return false;
    try {
      // Page through enough events to find any worksession-stalled marker. 500 covers
      // the practical maximum for a single session; if more exist the operator has bigger
      // problems than the missed signal.
      const events = this.memoryDb.listWorkSessionEvents(sessionId, { limit: 500 });
      return events.some((event) => event.eventType === "worksession-stalled");
    } catch {
      return false;
    }
  }

  private clearWorkSessionState(): void {
    const closingSnapshot = this.activeWorkSession;
    if (closingSnapshot) {
      this.emitClosingWorkSessionTelemetry(closingSnapshot);
    }
    const now = Date.now();
    const activeWorkflowPhase = this.workflowState.phase;
    const remainingPhaseHistory = getNonWorkSessionWorkflowPhaseHistory(this.workflowState.phaseHistory);
    const shouldResetWorkflow =
      WORK_SESSION_WORKFLOW_PHASES.includes(activeWorkflowPhase as WorkSessionPhase) ||
      activeWorkflowPhase === "review" ||
      activeWorkflowPhase === "complete";

    if (shouldResetWorkflow) {
      this.workflowState = {
        ...this.workflowState,
        phase: "intake",
        status: "idle",
        summary: null,
        updatedAt: now,
        blockedBy: null,
        phaseHistory: remainingPhaseHistory,
        review: {
          ...this.workflowState.review,
          status: "idle",
          runId: null,
          summary: null,
          failureReason: null,
          lastUpdatedAt: now,
        },
      };
    } else if (remainingPhaseHistory.length !== this.workflowState.phaseHistory.length) {
      this.workflowState = {
        ...this.workflowState,
        updatedAt: now,
        phaseHistory: remainingPhaseHistory,
      };
    }
    this.activeWorkSession = null;
    this.workSessionStorage.clear();
  }

  private resetWorkflowForNewWorkSession(occurredAt: number): void {
    const remainingPhaseHistory = getNonWorkSessionWorkflowPhaseHistory(this.workflowState.phaseHistory);
    this.workflowState = {
      ...this.workflowState,
      phase: "intake",
      status: "idle",
      summary: null,
      updatedAt: occurredAt,
      blockedBy: null,
      phaseHistory: remainingPhaseHistory,
      review: {
        ...this.workflowState.review,
        status: "idle",
        runId: null,
        summary: null,
        failureReason: null,
        lastUpdatedAt: occurredAt,
      },
    };
  }

  private persistWorkSession(snapshot: WorkSessionSnapshot): void {
    const previous = this.activeWorkSession;
    if (previous === snapshot) return; // identity short-circuit — common no-op transform
    this.activeWorkSession = snapshot;
    this.workSessionStorage.save(snapshot);
    writeWorkSessionTelemetry(this.memoryDb, previous, snapshot, (error) =>
      logger.warn(
        { err: error, sessionId: snapshot.sessionId, stationId: snapshot.stationId },
        "Failed to write WorkSession telemetry; continuing",
      ),
    );
  }

  private applyWorkSessionApprovalOutcome(status: "approved" | "denied" | "expired"): void {
    if (status === "approved") {
      return;
    }
    if (!this.activeWorkSession) {
      return;
    }
    const phase = this.activeWorkSession.currentPhase;
    if (phase !== "implement" && phase !== "validate") {
      return;
    }
    const stalledReason =
      status === "denied"
        ? `${phase === "implement" ? "Implementation" : "Validation"} blocked: a tool permission was denied.`
        : `${phase === "implement" ? "Implementation" : "Validation"} blocked: a tool permission expired before approval.`;
    const occurredAt = Date.now();
    this.updateWorkSession(
      (snapshot) => ({
        ...setWorkSessionPhase(snapshot, phase, "active", occurredAt, stalledReason),
        summary: stalledReason,
        readyForReview: false,
        stalledReason,
        stalledAt: occurredAt,
      }),
      occurredAt,
    );
  }

  private updateWorkSession(
    transform: (snapshot: WorkSessionSnapshot) => WorkSessionSnapshot | null,
    occurredAt: number = Date.now(),
  ): void {
    if (!this.activeWorkSession) {
      return;
    }
    const nextSnapshot = transform(this.activeWorkSession);
    if (!nextSnapshot) {
      return;
    }
    this.persistWorkSession({
      ...nextSnapshot,
      updatedAt: occurredAt,
    });
    this.syncWorkSessionWorkflowState(occurredAt);
  }

  private isWorkSessionImplementationTool(toolName: string): boolean {
    return WORK_SESSION_IMPLEMENTATION_TOOL_NAMES.has(toolName);
  }

  private isWorkSessionValidationTool(
    toolName: string,
    args: Record<string, unknown>,
    snapshot?: WorkSessionSnapshot,
  ): boolean {
    if (toolName === "read_powershell") {
      const shellId = getToolStringArg(args, "shellId");
      return Boolean(shellId && snapshot?.pendingValidationShellId === shellId);
    }
    const command = getValidationCommand(toolName, args);
    return Boolean(command && isValidationCommand(command));
  }

  private recordWorkSessionPatchAttempt(
    snapshot: WorkSessionSnapshot,
    tool: WorkSessionToolCompletion,
    occurredAt: number,
  ): WorkSessionSnapshot {
    return buildPatchAttempt(snapshot, tool, occurredAt).snapshot;
  }

  private startWorkSessionImplementation(
    snapshot: WorkSessionSnapshot,
    toolName: string,
    args: Record<string, unknown>,
    occurredAt: number,
  ): WorkSessionSnapshot {
    return startWorkSessionImplementationHelper(snapshot, toolName, args, occurredAt);
  }

  private startWorkSessionValidation(
    snapshot: WorkSessionSnapshot,
    toolName: string,
    args: Record<string, unknown>,
    occurredAt: number,
  ): WorkSessionSnapshot {
    return startWorkSessionValidationHelper(snapshot, toolName, args, occurredAt);
  }

  private recordWorkSessionValidationResult(
    snapshot: WorkSessionSnapshot,
    tool: WorkSessionToolCompletion,
    occurredAt: number,
  ): WorkSessionSnapshot {
    return recordWorkSessionValidationResultHelper(snapshot, tool, occurredAt);
  }

  private getWorkSessionWorkflowBlock(
    snapshot: WorkSessionSnapshot,
    occurredAt: number,
  ): RuntimeSessionContract["workflowState"]["blockedBy"] {
    return getWorkSessionWorkflowBlockHelper(snapshot, occurredAt);
  }

  private isWorkSessionReadyForReview(snapshot: WorkSessionSnapshot | null | undefined): boolean {
    return isWorkSessionReadyForReviewHelper(snapshot);
  }

  private clearWorkflowReviewState(occurredAt: number): void {
    this.workflowState = {
      ...this.workflowState,
      phase:
        this.workflowState.phase === "review" || this.workflowState.phase === "complete"
          ? "intake"
          : this.workflowState.phase,
      status:
        this.workflowState.phase === "review" || this.workflowState.phase === "complete"
          ? "idle"
          : this.workflowState.status,
      summary:
        this.workflowState.phase === "review" || this.workflowState.phase === "complete"
          ? null
          : this.workflowState.summary,
      updatedAt: occurredAt,
      blockedBy: this.workflowState.blockedBy?.kind === "review" ? null : this.workflowState.blockedBy,
      phaseHistory: this.workflowState.phaseHistory.filter(
        (entry) => entry.phase !== "review" && entry.phase !== "complete",
      ),
      review: {
        ...this.workflowState.review,
        status: "idle",
        runId: null,
        summary: null,
        failureReason: null,
        lastUpdatedAt: occurredAt,
      },
    };
  }

  private sealWorkSessionOnReviewCompletion(summary: string | null, occurredAt: number): void {
    if (!this.activeWorkSession) {
      return;
    }
    if (this.activeWorkSession.completedAt) {
      return;
    }
    if (!isWorkSessionReadyForReviewHelper(this.activeWorkSession)) {
      return;
    }
    const completionSummary =
      summary ?? this.activeWorkSession.reviewSummary ?? this.activeWorkSession.summary ?? "Review completed.";
    this.persistWorkSession({
      ...this.activeWorkSession,
      summary: completionSummary,
      reviewSummary: completionSummary,
      completedAt: occurredAt,
      stalledReason: null,
      stalledAt: null,
      pendingValidationShellId: null,
      pendingValidationCommand: null,
      updatedAt: occurredAt,
    });
    this.syncWorkSessionWorkflowState(occurredAt);
  }

  private syncWorkSessionWorkflowState(occurredAt: number): void {
    if (!this.activeWorkSession) {
      return;
    }
    if (this.activeWorkSession.completedAt) {
      const providerId = this.configuredProviderId;
      const model = this.getCurrentAssistantModel() ?? "work-session";
      const completionSummary =
        this.activeWorkSession.reviewSummary ?? this.activeWorkSession.summary ?? "Review completed.";
      const phaseHistory = [
        ...this.workflowState.phaseHistory.filter((entry) => entry.phase !== "complete"),
        {
          phase: "complete" as const,
          status: "complete" as const,
          summary: completionSummary,
          providerId,
          model,
          startedAt: this.activeWorkSession.completedAt,
          updatedAt: this.activeWorkSession.completedAt,
          completedAt: this.activeWorkSession.completedAt,
          blockedBy: null,
        },
      ];
      this.workflowState = {
        ...this.workflowState,
        phase: "complete",
        status: "complete",
        summary: completionSummary,
        updatedAt: this.activeWorkSession.completedAt,
        blockedBy: null,
        phaseHistory,
      };
      return;
    }
    if (
      this.workflowState.phase === "review" &&
      (this.workflowState.review.status === "running" || this.workflowState.review.status === "relaunching")
    ) {
      return;
    }
    const workSessionBlock = getWorkSessionWorkflowBlockHelper(this.activeWorkSession, occurredAt);
    const existingBlock = getEffectiveWorkflowBlock(this.workflowState);
    const preservedBlock = workSessionBlock ?? (existingBlock?.kind === "approval" ? existingBlock : null);
    const providerId = this.configuredProviderId;
    const model = this.getCurrentAssistantModel() ?? "work-session";
    const currentPhase = this.activeWorkSession.currentPhase;
    const activePhaseEntry = this.activeWorkSession.phaseHistory.find((entry) => entry.phase === currentPhase) ?? null;
    const status = workSessionBlock
      ? "stalled"
      : preservedBlock
        ? "blocked"
        : activePhaseEntry?.status === "complete"
          ? "complete"
          : "active";

    let phaseHistory = this.workflowState.phaseHistory.filter(
      (entry) => !WORK_SESSION_WORKFLOW_PHASES.includes(entry.phase as WorkSessionPhase),
    );
    for (const entry of this.activeWorkSession.phaseHistory) {
      const entryBlockedBy = entry.phase === currentPhase ? preservedBlock : null;
      phaseHistory = [
        ...phaseHistory.filter(
          (candidate) => !(candidate.phase === entry.phase && candidate.providerId === providerId),
        ),
        {
          phase: entry.phase,
          status:
            entry.phase === currentPhase && workSessionBlock
              ? "stalled"
              : entry.phase === currentPhase && preservedBlock
                ? "blocked"
                : entry.status === "complete"
                  ? "complete"
                  : entry.status === "active"
                    ? "active"
                    : "idle",
          summary: entry.summary ?? null,
          providerId,
          model,
          startedAt: entry.startedAt,
          updatedAt: entry.updatedAt,
          ...(entry.completedAt !== undefined ? { completedAt: entry.completedAt } : {}),
          blockedBy: entryBlockedBy,
        },
      ];
    }

    this.workflowState = {
      ...this.workflowState,
      phase: currentPhase,
      status,
      summary: this.activeWorkSession.summary,
      updatedAt: occurredAt,
      blockedBy: preservedBlock,
      phaseHistory,
    };
  }

  private getCurrentAssistantModel(): string | null {
    return this.latestUsage?.model ?? this.runtimeUsageSummary.model ?? this.hostContinuityState?.model ?? null;
  }

  private getWorkflowPendingPermissionRequestIds(): string[] {
    const inMemoryRequestIds = [...this.pendingPermissionRequests.keys()];
    return inMemoryRequestIds.length > 0 ? inMemoryRequestIds : this.runtimeStore.listPendingPermissionRequestIds();
  }

  private setWorkflowReviewState(input: {
    status: RuntimeSessionContract["workflowState"]["review"]["status"];
    origin?: RuntimeSessionContract["workflowState"]["review"]["origin"];
    summary?: string | null;
    failureReason?: string | null;
    runId?: string | null;
    attempt?: number;
    occurredAt?: number;
    snapshot?: SubagentRunSnapshot | null;
  }): void {
    const occurredAt = input.occurredAt ?? Date.now();
    const snapshot = input.snapshot ?? (input.runId ? this.subagentRunRegistry.get(input.runId) : null);
    const providerId = snapshot?.providerId ?? this.configuredProviderId;
    const model = snapshot?.observedModel ?? snapshot?.requestedModel ?? this.getCurrentAssistantModel() ?? "review";
    this.workflowState = buildWorkflowReviewState({
      workflowState: this.workflowState,
      ...input,
      occurredAt,
      providerId,
      model,
    });
  }

  private reconcilePersistedReviewState(): boolean {
    const review = this.workflowState.review;
    if (this.activeWorkSession?.completedAt) {
      if (review.status === "completed") {
        return false;
      }
      const completionSummary =
        this.activeWorkSession.reviewSummary ?? this.activeWorkSession.summary ?? "Review completed.";
      this.setWorkflowReviewState({
        status: "completed",
        origin: review.origin ?? "managed-subagent",
        runId: review.runId ?? null,
        attempt: review.attempt,
        occurredAt: this.activeWorkSession.completedAt,
        summary: completionSummary,
      });
      return true;
    }
    if (review.status === "idle") {
      return false;
    }
    if (review.origin !== "managed-subagent") {
      return false;
    }
    if (!review.runId) {
      if (review.status === "running" || review.status === "relaunching") {
        this.setWorkflowReviewState({
          status: "missing",
          origin: "managed-subagent",
          runId: null,
          attempt: review.attempt,
          summary: "Persisted review run reference is missing.",
          failureReason: "Persisted review run reference is missing.",
        });
        return true;
      }
      return false;
    }

    const snapshot = this.subagentRunRegistry.get(review.runId);
    if (!snapshot) {
      if (review.status === "running" || review.status === "relaunching") {
        this.setWorkflowReviewState({
          status: "missing",
          origin: "managed-subagent",
          runId: review.runId,
          attempt: review.attempt,
          summary: "Persisted review run is missing after restart.",
          failureReason: "Persisted review run is missing after restart.",
        });
        return true;
      }
      return false;
    }
    if (snapshot.domain !== "code-review") {
      return false;
    }

    if (snapshot.status === "running") {
      const stalled = Date.now() - snapshot.updatedAt >= REVIEW_STALL_TIMEOUT_MS;
      this.setWorkflowReviewState({
        status: stalled ? "stalled" : "running",
        origin: "managed-subagent",
        runId: snapshot.runId,
        attempt: review.attempt,
        occurredAt: snapshot.updatedAt,
        summary:
          snapshot.summary ??
          (stalled ? "Review appears stalled after restart." : "Recovered review is still running."),
        failureReason: stalled ? "Review appears stalled after restart." : null,
        snapshot,
      });
      return true;
    }

    if (snapshot.status === "idle" || snapshot.status === "completed") {
      this.setWorkflowReviewState({
        status: "completed",
        origin: "managed-subagent",
        runId: snapshot.runId,
        attempt: review.attempt,
        occurredAt: snapshot.updatedAt,
        summary: snapshot.summary ?? review.summary ?? "Recovered review completed.",
        snapshot,
      });
      this.sealWorkSessionOnReviewCompletion(snapshot.summary ?? review.summary ?? null, snapshot.updatedAt);
      return true;
    }

    if (snapshot.status === "expired") {
      this.setWorkflowReviewState({
        status: "missing",
        origin: "managed-subagent",
        runId: snapshot.runId,
        attempt: review.attempt,
        occurredAt: snapshot.updatedAt,
        summary: snapshot.summary ?? "Recovered review result expired before it could be consumed.",
        failureReason: snapshot.summary ?? "Recovered review result expired before it could be consumed.",
        snapshot,
      });
      return true;
    }

    this.setWorkflowReviewState({
      status: "failed",
      origin: "managed-subagent",
      runId: snapshot.runId,
      attempt: review.attempt,
      occurredAt: snapshot.updatedAt,
      summary: snapshot.summary ?? "Recovered review failed.",
      failureReason: snapshot.summary ?? "Recovered review failed.",
      snapshot,
    });
    return true;
  }

  private handleReviewSubagentStatus(
    runId: string,
    domain: string,
    status: string,
    occurredAt: number,
    summary: string | null,
  ): void {
    if (domain !== "code-review" || this.workflowState.review.runId !== runId) {
      return;
    }
    if (this.activeWorkSession?.completedAt) {
      return;
    }
    const snapshot = this.subagentRunRegistry.get(runId);
    if (status === "running") {
      this.setWorkflowReviewState({
        status: "running",
        origin: "managed-subagent",
        runId,
        attempt: this.workflowState.review.attempt,
        occurredAt,
        summary: summary ?? "Review running.",
        snapshot,
      });
      this.syncRuntimeState();
      return;
    }
    if (status === "idle" || status === "completed") {
      this.setWorkflowReviewState({
        status: "completed",
        origin: "managed-subagent",
        runId,
        attempt: this.workflowState.review.attempt,
        occurredAt,
        summary: summary ?? "Review completed.",
        snapshot,
      });
      this.sealWorkSessionOnReviewCompletion(summary ?? "Review completed.", occurredAt);
      this.syncRuntimeState();
      return;
    }
    if (status === "expired") {
      this.setWorkflowReviewState({
        status: "missing",
        origin: "managed-subagent",
        runId,
        attempt: this.workflowState.review.attempt,
        occurredAt,
        summary: summary ?? "Review result expired before it could be consumed.",
        failureReason: summary ?? "Review result expired before it could be consumed.",
        snapshot,
      });
      this.syncRuntimeState();
      return;
    }
    if (status === "failed" || status === "partial" || status === "cancelled") {
      this.setWorkflowReviewState({
        status: "failed",
        origin: "managed-subagent",
        runId,
        attempt: this.workflowState.review.attempt,
        occurredAt,
        summary: summary ?? "Review failed.",
        failureReason: summary ?? "Review failed.",
        snapshot,
      });
      this.syncRuntimeState();
    }
  }

  private reconcileWorkflowPermissionBlocking(): void {
    const currentBlock = getEffectiveWorkflowBlock(this.workflowState);
    if (currentBlock?.kind !== "approval") {
      return;
    }

    const pendingRequestIds = this.getWorkflowPendingPermissionRequestIds();
    const currentPendingRequestIds = currentBlock.pendingRequestIds;
    const pendingIdsUnchanged =
      currentPendingRequestIds.length === pendingRequestIds.length &&
      currentPendingRequestIds.every((requestId, index) => requestId === pendingRequestIds[index]);

    if (pendingRequestIds.length === 0) {
      const updatedAt = Date.now();
      if (this.activeWorkSession && shouldRestoreWorkSessionWorkflowState(this.workflowState, this.activeWorkSession)) {
        const phaseHistory = clearOpenWorkflowPhaseEntryBlocking(
          this.workflowState.phaseHistory,
          this.workflowState.phase,
          updatedAt,
        );
        this.workflowState = {
          ...this.workflowState,
          updatedAt,
          blockedBy: null,
          phaseHistory,
        };
        this.syncWorkSessionWorkflowState(updatedAt);
        return;
      }
      const currentPhaseEntry =
        [...this.workflowState.phaseHistory].reverse().find((entry) => entry.phase === this.workflowState.phase) ??
        null;
      const nextStatus = currentPhaseEntry && (currentPhaseEntry.completedAt ?? null) !== null ? "complete" : "active";
      this.workflowState = {
        ...this.workflowState,
        status: nextStatus,
        updatedAt,
        blockedBy: null,
        phaseHistory: syncOpenWorkflowPhaseEntryBlocking(
          this.workflowState.phaseHistory,
          this.workflowState.phase,
          nextStatus,
          null,
          updatedAt,
        ),
      };
      return;
    }

    if (this.workflowState.status === "blocked" && pendingIdsUnchanged) {
      return;
    }

    const updatedAt = Date.now();
    const blockedBy = {
      ...currentBlock,
      pendingRequestIds,
    };
    this.workflowState = {
      ...this.workflowState,
      status: "blocked",
      updatedAt,
      blockedBy,
      phaseHistory: syncOpenWorkflowPhaseEntryBlocking(
        this.workflowState.phaseHistory,
        this.workflowState.phase,
        "blocked",
        blockedBy,
        updatedAt,
      ),
    };
  }

  private updateWorkflowStateForSessionEscalation(result: ProviderSessionEscalationResult): void {
    const occurredAt = Date.now();
    const pendingRequestIds = this.getWorkflowPendingPermissionRequestIds();
    this.workflowState = buildWorkflowStateForSessionEscalation({
      workflowState: this.workflowState,
      result,
      currentState: this.currentState,
      promptInFlight: this.promptInFlight,
      activeToolCallCount: this.activeToolCalls.size,
      pendingRequestIds,
      occurredAt,
      handoffId: randomUUID(),
    });
    this.runtimeUsageSummary = {
      ...this.runtimeUsageSummary,
      model: result.toModel,
      lastObservedAt: occurredAt,
      source: this.runtimeUsageSummary.source === "unknown" ? "estimated" : this.runtimeUsageSummary.source,
    };
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
      const workSessionDecision = decideWorkSessionMode({
        text,
        missionRunId: this.missionRunId,
        hasActiveWorkSession: this.activeWorkSession !== null,
      });
      if (workSessionDecision.mode === "work-session" && workSessionDecision.classification) {
        this.activateWorkSession(text, workSessionDecision.classification, {
          startsNewSession: workSessionDecision.startsNewSession,
        });
      } else if (this.activeWorkSession && workSessionDecision.mode === "conversational") {
        this.clearWorkSessionState();
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
      this.clearWorkSessionState();
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

  listPersistedPendingPermissionRequests(): PermissionRequestPayload[] {
    return this.runtimeStore.listPendingPermissionRequests();
  }

  resolvePermissionRequest(requestId: string, approved: boolean): boolean {
    const pending = this.pendingPermissionRequests.get(requestId);
    if (pending) {
      this.pendingPermissionRequests.delete(requestId);
      clearTimeout(pending.timeout);
      pending.resolve(approved ? approvePermissionOnce() : rejectPermission());
      return true;
    }

    // No live in-memory entry — likely the original tool call's call stack is
    // gone (backend restart, session reset, or a late click after the request
    // already resolved). Keep DB + UI in sync so the user's intent is recorded
    // and any stale prompt clears.
    return this.persistLatePermissionResolution(requestId, approved ? "approved" : "denied");
  }

  private persistLatePermissionResolution(requestId: string, status: "approved" | "denied" | "expired"): boolean {
    if (!this.runtimeStore.hasPersistedPermissionRequest(requestId)) {
      return false;
    }
    if (this.runtimeStore.isPermissionRequestStillPending(requestId)) {
      this.runtimeStore.resolvePermissionRequest(requestId, status);
      recordRuntimePermissionResolved(this.runtimeStore, this.getRuntimeSessionId(), {
        requestId,
        status,
        occurredAt: Date.now(),
      });
      this.applyWorkSessionApprovalOutcome(status);
    }
    this.bus.emit("assistant:permission-complete", requestId, status);
    this.syncRuntimeState();
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
    const isReviewRun = domain.id === "code-review";
    const nextReviewAttempt = isReviewRun ? this.workflowState.review.attempt + 1 : this.workflowState.review.attempt;
    if (isReviewRun && this.workflowState.review.runId) {
      this.setWorkflowReviewState({
        status: "relaunching",
        origin: "managed-subagent",
        runId: null,
        attempt: nextReviewAttempt,
        summary: "Relaunching review.",
      });
      this.syncRuntimeState();
    }

    try {
      const launch = this.createSubagentRunner(domain, options.workingDirectory).launch(args);
      const handle = this.subagentRunRegistry.track(domain.id, args, launch);
      if (isReviewRun) {
        this.setWorkflowReviewState({
          status: "running",
          origin: "managed-subagent",
          runId: handle.runId,
          attempt: nextReviewAttempt,
          summary: `Running review: ${args.task}`,
          snapshot: this.subagentRunRegistry.get(handle.runId),
        });
        this.syncRuntimeState();
      }
      return {
        handle,
        completion: this.subagentRunRegistry.waitFor(handle.runId, 24 * 60 * 60 * 1000),
      };
    } catch (error) {
      if (isReviewRun) {
        const summary = error instanceof Error ? error.message : "Review launch failed.";
        this.setWorkflowReviewState({
          status: "failed",
          origin: "managed-subagent",
          runId: null,
          attempt: nextReviewAttempt,
          summary,
          failureReason: summary,
        });
        this.syncRuntimeState();
      }
      throw error;
    }
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
      providerId: this.configuredProviderId,
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

  private async requestSessionEscalation(): Promise<ProviderSessionEscalationResult> {
    if (!isEscalationProvider(this.configuredProviderId)) {
      throw new AssistantError("Manual escalation is unavailable for the active provider.");
    }
    if (!this.session?.escalate) {
      throw new AssistantError("The active provider session cannot be escalated manually.");
    }
    const result = await this.session.escalate();
    this.updateWorkflowStateForSessionEscalation(result);
    this.syncRuntimeState();
    return result;
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

  /**
   * Phase 1.1 — forward live attempt activity into mission_events when the
   * station is bound to a mission run. Looks up the latest live attempt and
   * appends a typed event. No-op when the station is not mission-bound or the
   * memoryDb / run / attempt is missing.
   *
   * Tool calls and shell commands fire on the station's bus regardless; this
   * just mirrors the meaningful ones into the persistent mission timeline so
   * the renderer can show "now playing" and the auto post-mortem can read them.
   */
  private recordMissionAttemptEvent<T extends "attempt-action" | "attempt-shell-command" | "attempt-awaiting-permission" | "attempt-permission-resolved">(
    eventType: T,
    metadata: import("@spira/shared").MissionEventMetadataMap[T],
  ): void {
    const memoryDb = this.memoryDb;
    if (!memoryDb || !this.missionRunId) {
      return;
    }
    const run = memoryDb.getTicketRun(this.missionRunId);
    if (!run) {
      return;
    }
    const latestAttempt =
      [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;
    if (!latestAttempt) {
      return;
    }
    try {
      const record = memoryDb.appendMissionEvent({
        runId: run.runId,
        attemptId: latestAttempt.attemptId,
        stage: run.missionPhase,
        eventType,
        metadata: metadata as Record<string, unknown>,
      });
      // Push to the station bus so StationRegistry can relay to the transport.
      // The renderer prepends to its per-run mission timeline buffer (Phase 1.2).
      this.bus.emit("missions:run-event-recorded", {
        id: record.id,
        runId: record.runId,
        attemptId: record.attemptId,
        stage: record.stage as import("@spira/shared").TicketRunMissionEventSummary["stage"],
        eventType: record.eventType,
        metadata: record.metadata,
        occurredAt: record.occurredAt,
      });
    } catch (error) {
      // Don't let a telemetry write fault the underlying tool call.
      logger.warn(
        { err: error, runId: run.runId, eventType },
        "Failed to record mission attempt event",
      );
    }
  }

  private static readonly SHELL_LIKE_TOOL_NAMES = new Set([
    "Bash",
    "PowerShell",
    "spira_run_powershell",
    "spira_start_powershell",
    "spira_write_powershell",
  ]);

  /**
   * Resolves the latest attempt on the bound mission run. Returns null if the station is
   * not mission-bound or the run/attempts are missing. Centralised so the four event hooks
   * in the tool-call lifecycle don't each repeat the same lookup pattern.
   */
  private getLatestMissionAttempt():
    | { attemptId: string; sequence: number; status: string }
    | null {
    if (!this.missionRunId || !this.memoryDb) {
      return null;
    }
    const run = this.memoryDb.getTicketRun(this.missionRunId);
    return run?.attempts.at(-1) ?? null;
  }

  private summariseToolTarget(args: unknown): string | null {
    if (!args || typeof args !== "object") {
      return null;
    }
    const record = args as Record<string, unknown>;
    const candidate =
      typeof record.file_path === "string"
        ? record.file_path
        : typeof record.path === "string"
          ? record.path
          : typeof record.target === "string"
            ? record.target
            : typeof record.url === "string"
              ? record.url
              : typeof record.pattern === "string"
                ? record.pattern
                : typeof record.command === "string"
                  ? record.command
                  : null;
    if (!candidate) {
      return null;
    }
    return candidate.length > 80 ? `${candidate.slice(0, 77)}...` : candidate;
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
    const eventType = event.type as string;
    const reviewLockedWorkSession =
      this.activeWorkSession &&
      !this.activeWorkSession.completedAt &&
      isWorkSessionReadyForReviewHelper(this.activeWorkSession) &&
      (this.workflowState.review.status === "running" || this.workflowState.review.status === "relaunching");
    if (
      (this.activeWorkSession?.completedAt || reviewLockedWorkSession) &&
      (eventType === "assistant.delta" ||
        eventType === "assistant.message" ||
        eventType === "tool.execution_start" ||
        eventType === "tool.execution_complete")
    ) {
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
      buildToolRecord: (activeToolCall, completeEvent) => ({
        callId: completeEvent.data.toolCallId,
        toolName: activeToolCall?.toolName ?? "unknown",
        args: getToolArgsRecord(activeToolCall?.args),
        success: !(completeEvent.data.success === false || Boolean(completeEvent.data.error)),
        result: completeEvent.data.result,
        errorMessage: completeEvent.data.error?.message ?? null,
      }),
      onAssistantDelta: (deltaEvent, occurredAt) => {
        recordRuntimeAssistantMessageDelta(this.runtimeStore, this.getRuntimeSessionId(), {
          messageId: deltaEvent.data.messageId,
          deltaContent: deltaEvent.data.deltaContent,
          occurredAt,
        });
        this.bus.emit("assistant:delta", deltaEvent.data.messageId, deltaEvent.data.deltaContent);
      },
      onAssistantMessage: (messageEvent, fullText, occurredAt) => {
        this.updateWorkSession((snapshot) => {
          if (snapshot.completedAt) {
            return null;
          }
          let nextSnapshot = snapshot;
          if (snapshot.currentPhase === "discover") {
            nextSnapshot = setWorkSessionPhase(
              nextSnapshot,
              "discover",
              "complete",
              occurredAt,
              "Repository context discovered.",
            );
            nextSnapshot = setWorkSessionPhase(
              nextSnapshot,
              "summarise",
              "active",
              occurredAt,
              "Summarising repository findings.",
            );
            nextSnapshot = {
              ...nextSnapshot,
              currentPhase: "summarise",
            };
          } else if (snapshot.currentPhase === "summarise") {
            nextSnapshot = setWorkSessionPhase(
              nextSnapshot,
              "summarise",
              "complete",
              occurredAt,
              "Repository findings summarised.",
            );
            nextSnapshot = setWorkSessionPhase(
              nextSnapshot,
              "plan",
              "active",
              occurredAt,
              compactAssistantSummary(fullText),
            );
            nextSnapshot = {
              ...nextSnapshot,
              currentPhase: "plan",
              planSummary: fullText,
            };
          } else if (snapshot.currentPhase === "plan") {
            nextSnapshot = {
              ...nextSnapshot,
              planSummary: snapshot.planSummary ?? fullText,
              summary: compactAssistantSummary(fullText),
            };
          }
          return nextSnapshot;
        }, occurredAt);
        this.syncRuntimeState();
        recordRuntimeAssistantMessage(this.runtimeStore, this.getRuntimeSessionId(), {
          messageId: messageEvent.data.messageId,
          content: fullText,
          occurredAt,
        });
        this.lastRuntimeAssistantMessageTimestamp = occurredAt;
        this.bus.emit("assistant:response-end", {
          messageId: messageEvent.data.messageId,
          text: fullText,
          timestamp: occurredAt,
          autoSpeak: this.nextResponseAutoSpeak,
          ...(this.getCurrentAssistantModel() ? { model: this.getCurrentAssistantModel() } : {}),
        });
        this.nextResponseAutoSpeak = true;
        this.syncRuntimeState();
      },
      onToolExecutionStart: (startEvent, _activeToolCall, occurredAt) => {
        this.observedToolActivity = true;
        this.updateWorkSession((snapshot) => {
          if (snapshot.completedAt) {
            return null;
          }
          if (
            isWorkSessionReadyForReviewHelper(snapshot) &&
            (this.workflowState.review.status === "running" || this.workflowState.review.status === "relaunching")
          ) {
            return null;
          }
          if (snapshot.currentPhase === "discover") {
            return {
              ...snapshot,
              summary: `Discovering repository context with ${startEvent.data.toolName}.`,
            };
          }
          const toolArgs = getToolArgsRecord(startEvent.data.arguments);
          if (
            (snapshot.currentPhase === "plan" ||
              snapshot.currentPhase === "implement" ||
              (snapshot.currentPhase === "validate" && snapshot.pendingValidationShellId === null)) &&
            this.isWorkSessionImplementationTool(startEvent.data.toolName)
          ) {
            return startWorkSessionImplementationHelper(snapshot, startEvent.data.toolName, toolArgs, occurredAt);
          }
          if (
            snapshot.currentPhase === "validate" &&
            startEvent.data.toolName === "read_powershell" &&
            this.isWorkSessionValidationTool(startEvent.data.toolName, toolArgs, snapshot)
          ) {
            return {
              ...snapshot,
              summary: `Reading validation output: ${snapshot.pendingValidationCommand ?? "validation"}.`,
            };
          }
          if (
            ((snapshot.currentPhase === "implement" && !snapshot.stalledReason) ||
              (snapshot.currentPhase === "validate" &&
                snapshot.pendingValidationShellId === null &&
                !snapshot.stalledReason)) &&
            this.isWorkSessionValidationTool(startEvent.data.toolName, toolArgs, snapshot)
          ) {
            return startWorkSessionValidationHelper(snapshot, startEvent.data.toolName, toolArgs, occurredAt);
          }
          if (snapshot.currentPhase === "validate") {
            return {
              ...snapshot,
              summary: `Running validation with ${startEvent.data.toolName}.`,
            };
          }
          return {
            ...snapshot,
            summary:
              snapshot.currentPhase === "implement"
                ? `Continuing implementation with ${startEvent.data.toolName}.`
                : snapshot.summary,
          };
        }, occurredAt);
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
        // Phase 1.1 — emit a "now playing" mission event for shell-like tools so long-running
        // commands give the operator a visible signal before they complete. Other tools wait
        // for completion to keep volume sane.
        if (StationSessionManager.SHELL_LIKE_TOOL_NAMES.has(startEvent.data.toolName)) {
          const latestAttempt = this.getLatestMissionAttempt();
          if (latestAttempt) {
            this.recordMissionAttemptEvent("attempt-shell-command", {
              attemptId: latestAttempt.attemptId,
              command: this.summariseToolTarget(startEvent.data.arguments) ?? startEvent.data.toolName,
              cwd: null,
              durationMs: null,
              exitCode: null,
              status: "running",
            });
          }
        }
      },
      onToolExecutionComplete: (completeEvent, toolRecord, occurredAt) => {
        this.observedToolActivity = true;
        this.updateWorkSession((snapshot) => {
          if (snapshot.completedAt) {
            return null;
          }
          if (
            isWorkSessionReadyForReviewHelper(snapshot) &&
            (this.workflowState.review.status === "running" || this.workflowState.review.status === "relaunching")
          ) {
            return null;
          }
          if (snapshot.currentPhase !== "discover") {
            if (snapshot.currentPhase === "implement" && this.isWorkSessionImplementationTool(toolRecord.toolName)) {
              return this.recordWorkSessionPatchAttempt(snapshot, toolRecord, occurredAt);
            }
            if (
              snapshot.currentPhase === "validate" &&
              this.isWorkSessionValidationTool(toolRecord.toolName, toolRecord.args, snapshot)
            ) {
              if (snapshot.stalledReason && snapshot.pendingValidationShellId === null) {
                return snapshot;
              }
              return recordWorkSessionValidationResultHelper(snapshot, toolRecord, occurredAt);
            }
            return snapshot;
          }
          let nextSnapshot = setWorkSessionPhase(
            snapshot,
            "discover",
            "complete",
            occurredAt,
            "Repository context discovered.",
          );
          nextSnapshot = setWorkSessionPhase(
            nextSnapshot,
            "summarise",
            "active",
            occurredAt,
            "Summarising repository findings.",
          );
          return nextSnapshot;
        }, occurredAt);
        this.syncRuntimeState();
        recordRuntimeToolExecutionCompleted(this.runtimeStore, this.getRuntimeSessionId(), {
          toolCallId: completeEvent.data.toolCallId,
          success: !(completeEvent.data.success === false || Boolean(completeEvent.data.error)),
          result: completeEvent.data.result,
          errorMessage: completeEvent.data.error?.message,
          occurredAt,
        });
        this.bus.emit("assistant:tool-result", completeEvent.data.toolCallId, completeEvent.data.result ?? null);
        // Phase 1.1 — record completion as a mission timeline event so post-mortem and
        // "now playing" surfaces have a canonical record of what the agent just did.
        {
          const latestAttempt = this.getLatestMissionAttempt();
          if (latestAttempt) {
            const startedAtMs = (toolRecord as { startedAt?: number } | null)?.startedAt;
            const durationMs =
              typeof startedAtMs === "number" && Number.isFinite(startedAtMs) ? occurredAt - startedAtMs : null;
            const target = this.summariseToolTarget((toolRecord as { args?: unknown } | null)?.args);
            const succeeded = !(completeEvent.data.success === false || Boolean(completeEvent.data.error));
            const status = succeeded ? "success" : "error";
            if (StationSessionManager.SHELL_LIKE_TOOL_NAMES.has(toolRecord.toolName)) {
              this.recordMissionAttemptEvent("attempt-shell-command", {
                attemptId: latestAttempt.attemptId,
                command: target ?? toolRecord.toolName,
                cwd: null,
                durationMs,
                exitCode: null,
                status: succeeded ? "passed" : "failed",
              });
            } else {
              this.recordMissionAttemptEvent("attempt-action", {
                attemptId: latestAttempt.attemptId,
                action: toolRecord.toolName,
                target,
                durationMs,
                status,
              });
            }
          }
        }
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
        if (
          usage.model &&
          this.lastRuntimeAssistantMessageId &&
          this.latestAssistantMessageText &&
          this.lastRuntimeAssistantMessageTimestamp !== null
        ) {
          this.bus.emit("assistant:message-model", {
            messageId: this.lastRuntimeAssistantMessageId,
            text: this.latestAssistantMessageText,
            timestamp: this.lastRuntimeAssistantMessageTimestamp,
            model: usage.model,
          });
        }
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

    const autoApprove = this.isAutoApprovePermissionsEnabled();

    return await executeRuntimePermissionRequest({
      runtimeStore: this.runtimeStore,
      runtimeSessionId: this.getRuntimeSessionId(),
      payload,
      now: () => Date.now(),
      onRequested: (permissionPayload) => {
        this.noteTurnActivity();
        this.bus.emit("assistant:permission-request", permissionPayload);
        this.runtimeStore.persistPermissionRequest(permissionPayload);
        // Phase 1.1 — surface permission gating in the mission timeline so a long pause
        // for approval is visible in "now playing" rather than looking like a stall.
        {
          const latestAttempt = this.getLatestMissionAttempt();
          if (latestAttempt) {
            this.recordMissionAttemptEvent("attempt-awaiting-permission", {
              attemptId: latestAttempt.attemptId,
              requestId: permissionPayload.requestId,
              label: `${permissionPayload.serverName}/${permissionPayload.toolName}`,
            });
          }
        }
      },
      onResolved: (status) => {
        this.noteTurnActivity();
        this.lastPermissionResolvedAt = Date.now();
        this.runtimeStore.resolvePermissionRequest(requestId, status);
        this.applyWorkSessionApprovalOutcome(status);
        this.syncRuntimeState();
        this.bus.emit("assistant:permission-complete", requestId, status);
        // Phase 1.1 — close the loop on the awaiting-permission event so the timeline
        // shows the resolution and the post-mortem can compute "time spent on approval".
        {
          const latestAttempt = this.getLatestMissionAttempt();
          if (latestAttempt) {
            this.recordMissionAttemptEvent("attempt-permission-resolved", {
              attemptId: latestAttempt.attemptId,
              requestId,
              result: status,
            });
          }
        }
      },
      decide: () =>
        autoApprove
          ? Promise.resolve(approvePermissionOnce())
          : new Promise<ProviderPermissionResult>((resolve) => {
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
    this.reconcileWorkflowPermissionBlocking();
    return syncRuntimeStateHelper(this.getRuntimePersistenceContext());
  }

  private getRuntimeSessionId(): string | null {
    return getRuntimeSessionIdHelper({
      stationId: this.stationId,
    });
  }

  private getProviderCapabilities() {
    return this.client?.capabilities ?? getDefaultProviderCapabilities(this.configuredProviderId);
  }

  private persistRuntimeSessionContract(
    hostManifestHash: string,
    projectionHash: string,
    overrides: Partial<RuntimeSessionContract> = {},
  ): RuntimeSessionContract | null {
    return persistRuntimeSessionContractHelper(
      this.getRuntimePersistenceContext(),
      hostManifestHash,
      projectionHash,
      overrides,
    );
  }

  private appendRuntimeLedgerEventIfSession(
    event: Omit<RuntimeLedgerEvent, "sessionId"> | null,
    options: { syncState?: boolean } = {},
  ): void {
    appendRuntimeLedgerEventIfSessionHelper(
      this.getRuntimePersistenceContext(),
      event,
      () => {
        this.syncRuntimeState();
      },
      options,
    );
  }

  private recordRuntimeUserMessage(messageId: string, content: string): void {
    recordRuntimeUserMessageHelper(
      this.getRuntimePersistenceContext(),
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
    return createRuntimeCheckpointHelper(this.getRuntimePersistenceContext(), kind, summary, () =>
      this.syncRuntimeState(),
    );
  }

  private buildRuntimeRecoverySection() {
    return buildRuntimeRecoverySectionHelper({
      runtimeStore: this.runtimeStore,
      stationId: this.stationId,
      setActiveRecoverySource: (source) => {
        this.activeRecoverySource = source;
      },
    });
  }

  private getHostContinuitySeed(
    providerId: ProviderId,
    hostManifestHash: string,
    projectionHash: string,
  ): ProviderHostContinuityState | null {
    return getHostContinuitySeedHelper(
      {
        stationId: this.stationId,
        runtimeStore: this.runtimeStore,
        resumableHostContinuityState: this.resumableHostContinuityState,
        resumableHostContinuityHostManifestHash: this.resumableHostContinuityHostManifestHash,
        resumableHostContinuityProjectionHash: this.resumableHostContinuityProjectionHash,
        getCurrentSystemMessageHash: () => this.getCurrentSystemMessageHash(),
        getCurrentToolManifest: (provider) => this.getCurrentToolManifest(provider),
      },
      providerId,
      hostManifestHash,
      projectionHash,
    );
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
      workflowState: this.workflowState,
      sessionOrigin: this.sessionOrigin,
      lastRuntimeUserMessageId: this.lastRuntimeUserMessageId,
      lastRuntimeAssistantMessageId: this.lastRuntimeAssistantMessageId,
      pendingPermissionRequests: this.pendingPermissionRequests,
      lastPermissionResolvedAt: this.lastPermissionResolvedAt,
      lastCancellationCompletedAt: this.lastCancellationCompletedAt,
      hostContinuityState: this.hostContinuityState,
      resumableHostContinuityState: this.resumableHostContinuityState,
      resumableHostContinuityHostManifestHash: this.resumableHostContinuityHostManifestHash,
      resumableHostContinuityProjectionHash: this.resumableHostContinuityProjectionHash,
      activeRecoverySource: this.activeRecoverySource,
      client: this.client,
      reconcileWorkflowPermissionBlocking: () => this.reconcileWorkflowPermissionBlocking(),
      getProviderCapabilities: () => this.getProviderCapabilities(),
      getCurrentToolManifest: (provider?: Pick<ProviderClient, "providerId" | "capabilities">) =>
        this.getCurrentToolManifest(provider),
      getCurrentSystemMessageHash: () => this.getCurrentSystemMessageHash(),
      setActiveRecoverySource: (source: "host-checkpoint" | "continuity-preamble" | "host-transcript" | null) => {
        this.activeRecoverySource = source;
      },
    };
  }

  private getCurrentToolManifest(provider?: Pick<ProviderClient, "providerId" | "capabilities">) {
    return getCurrentToolManifestHelper(
      {
        toolAggregator: this.toolAggregator,
        configuredProviderId: this.configuredProviderId,
        client: this.client,
        getToolBridgeOptions: () => this.getToolBridgeOptions(),
      },
      provider,
    );
  }

  private getCurrentToolSignature(): string {
    return getCurrentToolSignatureHelper({
      toolAggregator: this.toolAggregator,
      client: this.client,
      getToolBridgeOptions: () => this.getToolBridgeOptions(),
      getCurrentToolManifest: (provider) => this.getCurrentToolManifest(provider),
    });
  }

  private getToolBridgeOptions(): ToolBridgeOptions {
    return getToolBridgeOptionsHelper({
      env: this.env,
      toolAggregator: this.toolAggregator,
      workingDirectory: this.workingDirectory,
      sessionStorage: this.sessionStorage,
      runtimeStore: this.runtimeStore,
      stationId: this.stationId,
      missionRunId: this.missionRunId ?? null,
      configuredProviderId: this.configuredProviderId,
      providerOverride: this.providerOverride,
      currentState: this.currentState,
      activeSessionId: this.activeSessionId,
      client: this.client,
      session: this.session,
      initializingSession: this.initializingSession,
      allowUpgradeTools: this.allowUpgradeTools,
      listMissionServices: this.listMissionServices,
      startMissionService: this.startMissionService,
      stopMissionService: this.stopMissionService,
      listMissionProofs: this.listMissionProofs,
      runMissionProof: this.runMissionProof,
      getMissionContext: this.getMissionContext,
      getMissionWorkflowState: this.getMissionWorkflowState,
      saveMissionClassification: this.saveMissionClassification,
      saveMissionPlan: this.saveMissionPlan,
      setMissionPhase: this.setMissionPhase,
      recordMissionValidation: this.recordMissionValidation,
      setMissionProofStrategy: this.setMissionProofStrategy,
      recordMissionProofResult: this.recordMissionProofResult,
      saveMissionSummary: this.saveMissionSummary,
      subagentRegistry: this.subagentRegistry,
      subagentRunRegistry: this.subagentRunRegistry,
      requestUpgradeProposal: this.requestUpgradeProposal,
      applyHotCapabilityUpgrade: this.applyHotCapabilityUpgrade,
      requestSessionEscalation: () => this.requestSessionEscalation(),
      getSubagentRunner: (domainId, workingDirectory) => this.getSubagentRunner(domainId, workingDirectory),
      getRuntimeSessionId: () => this.getRuntimeSessionId(),
      registeredToolSignature: this.registeredToolSignature,
      pendingToolRefreshSignature: this.pendingToolRefreshSignature,
      refreshingSessionForToolChanges: this.refreshingSessionForToolChanges,
      deletePersistedSession: (sessionId, providerId) => this.deletePersistedSession(sessionId, providerId),
      getStalePersistedSessionCleanupProviderIds: (persistedSessionId, runtimeState, currentProviderId) =>
        this.getStalePersistedSessionCleanupProviderIds(persistedSessionId, runtimeState, currentProviderId),
      clearHostContinuityCaches: () => this.clearHostContinuityCaches(),
      clearBoundSessionIdentity: () => this.clearBoundSessionIdentity(),
      disconnectSession: () => this.disconnectSession(),
      syncRuntimeState: () => {
        this.syncRuntimeState();
      },
      setRegisteredToolSignature: (signature) => {
        this.registeredToolSignature = signature;
      },
      setPendingToolRefreshSignature: (signature) => {
        this.pendingToolRefreshSignature = signature;
      },
      setRefreshingSessionForToolChanges: (promise) => {
        this.refreshingSessionForToolChanges = promise;
      },
    });
  }

  private getSubagentRunner(domainId: string, workingDirectory?: string): SubagentRunner {
    const key = getSubagentRunnerKey(domainId, workingDirectory);
    const existingRunner = this.subagentRunners.get(key);
    if (existingRunner) {
      return existingRunner;
    }

    const domain = getDelegationDomain(this.subagentRegistry, domainId);
    if (!domain) {
      throw new AssistantError(`Unknown subagent domain ${domainId}`);
    }

    const runner = this.createSubagentRunner(domain, workingDirectory);
    this.subagentRunners.set(key, runner);
    return runner;
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
    const domain = getDelegationDomain(this.subagentRegistry, snapshot.domain);
    if (!domain) {
      return null;
    }

    const recoveredWorkingDirectory = (snapshot as SubagentRunSnapshot & { workingDirectory?: string })
      .workingDirectory;
    const key = getSubagentRunnerKey(domain.id, recoveredWorkingDirectory ?? this.workingDirectory ?? undefined);
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

  private async refreshSessionForToolChanges(): Promise<void> {
    await refreshSessionForToolChangesHelper({
      env: this.env,
      toolAggregator: this.toolAggregator,
      workingDirectory: this.workingDirectory,
      sessionStorage: this.sessionStorage,
      runtimeStore: this.runtimeStore,
      stationId: this.stationId,
      missionRunId: this.missionRunId ?? null,
      configuredProviderId: this.configuredProviderId,
      providerOverride: this.providerOverride,
      currentState: this.currentState,
      activeSessionId: this.activeSessionId,
      client: this.client,
      session: this.session,
      initializingSession: this.initializingSession,
      allowUpgradeTools: this.allowUpgradeTools,
      listMissionServices: this.listMissionServices,
      startMissionService: this.startMissionService,
      stopMissionService: this.stopMissionService,
      listMissionProofs: this.listMissionProofs,
      runMissionProof: this.runMissionProof,
      getMissionContext: this.getMissionContext,
      getMissionWorkflowState: this.getMissionWorkflowState,
      saveMissionClassification: this.saveMissionClassification,
      saveMissionPlan: this.saveMissionPlan,
      setMissionPhase: this.setMissionPhase,
      recordMissionValidation: this.recordMissionValidation,
      setMissionProofStrategy: this.setMissionProofStrategy,
      recordMissionProofResult: this.recordMissionProofResult,
      saveMissionSummary: this.saveMissionSummary,
      subagentRegistry: this.subagentRegistry,
      subagentRunRegistry: this.subagentRunRegistry,
      requestUpgradeProposal: this.requestUpgradeProposal,
      applyHotCapabilityUpgrade: this.applyHotCapabilityUpgrade,
      requestSessionEscalation: () => this.requestSessionEscalation(),
      getSubagentRunner: (domainId, workingDirectory) => this.getSubagentRunner(domainId, workingDirectory),
      getRuntimeSessionId: () => this.getRuntimeSessionId(),
      registeredToolSignature: this.registeredToolSignature,
      pendingToolRefreshSignature: this.pendingToolRefreshSignature,
      refreshingSessionForToolChanges: this.refreshingSessionForToolChanges,
      deletePersistedSession: (sessionId, providerId) => this.deletePersistedSession(sessionId, providerId),
      getStalePersistedSessionCleanupProviderIds: (persistedSessionId, runtimeState, currentProviderId) =>
        this.getStalePersistedSessionCleanupProviderIds(persistedSessionId, runtimeState, currentProviderId),
      clearHostContinuityCaches: () => this.clearHostContinuityCaches(),
      clearBoundSessionIdentity: () => this.clearBoundSessionIdentity(),
      disconnectSession: () => this.disconnectSession(),
      syncRuntimeState: () => {
        this.syncRuntimeState();
      },
      setRegisteredToolSignature: (signature) => {
        this.registeredToolSignature = signature;
      },
      setPendingToolRefreshSignature: (signature) => {
        this.pendingToolRefreshSignature = signature;
      },
      setRefreshingSessionForToolChanges: (promise) => {
        this.refreshingSessionForToolChanges = promise;
      },
      getCurrentToolSignature: () => this.getCurrentToolSignature(),
    });
  }

  private async maybeRefreshSessionForToolChanges(): Promise<void> {
    await maybeRefreshSessionForToolChangesHelper({
      pendingToolRefreshSignature: this.pendingToolRefreshSignature,
      currentState: this.currentState,
      refreshSessionForToolChanges: () => this.refreshSessionForToolChanges(),
    });
  }

  private queueToolRefresh(): void {
    queueToolRefreshHelper(() => this.refreshSessionForToolChanges());
  }

  private queuePendingToolRefresh(): void {
    queuePendingToolRefreshHelper(() => this.maybeRefreshSessionForToolChanges());
  }
}
