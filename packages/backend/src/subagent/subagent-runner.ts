import { randomUUID } from "node:crypto";
import { SUBAGENT_SCOPE_IDS } from "@spira/shared";
import type {
  Env,
  McpTool,
  NormalizedStateChange,
  PermissionRequestPayload,
  SubagentArtifact,
  SubagentDelegationArgs,
  SubagentDeltaEvent,
  SubagentDomain,
  SubagentEnvelope,
  SubagentErrorRecord,
  SubagentRunSnapshot,
  SubagentScopeId,
  SubagentToolCallRecord,
} from "@spira/shared";
import { approvePermissionOnce, permissionUserNotAvailable } from "../runtime/permission-decisions.js";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import {
  getDefaultProviderCapabilities,
  normalizeProviderUsageSnapshot,
  shouldPersistProviderSession,
  shouldRequestNativeStreaming,
} from "../provider/capability-fallback.js";
import {
  createFreshProviderSession,
  createProviderClientForProvider,
  stopProviderClient,
  withTimeout,
} from "../provider/client-factory.js";
import { getConfiguredProviderId, getProviderLabel } from "../provider/provider-config.js";
import type {
  ProviderClient,
  ProviderId,
  ProviderPermissionRequest,
  ProviderPermissionResult,
  ProviderSession,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderUsageRecord,
  ProviderUsageSnapshot,
} from "../provider/types.js";
import { getProviderToolManifest } from "../runtime/capability-registry.js";
import { resolveSubagentProviderBinding } from "../runtime/provider-binding.js";
import { getStationRuntimeSessionId } from "../runtime/runtime-session-ids.js";
import {
  createRuntimeCheckpointPayload,
  createRuntimeLedgerEvent,
  type RuntimeCheckpointPayload,
  type RuntimeLedgerEvent,
  type RuntimeSessionContract,
  type RuntimeUsageSummary,
} from "../runtime/runtime-contract.js";
import {
  buildRuntimeRecoveryContext,
  buildRuntimeRecoveryPreambleFallback,
  buildRuntimeRecoverySystemSection,
  type RuntimeRecoveryContext,
} from "../runtime/runtime-recovery.js";
import {
  appendRuntimeLifecycleEvent,
  persistRuntimeCheckpointLifecycle,
  recordRuntimeAssistantMessage,
  recordRuntimeAssistantMessageDelta,
  recordRuntimeCancellationRequested,
  recordRuntimeCancellationCompleted,
  recordRuntimeProviderBound,
  recordRuntimeRecoveryCompleted,
  recordRuntimeToolExecutionCompleted,
  recordRuntimeToolExecutionStarted,
  recordRuntimeUsageObserved,
  recordRuntimeUserMessage,
} from "../runtime/runtime-lifecycle.js";
import { executeRuntimePermissionRequest } from "../runtime/runtime-permission-lifecycle.js";
import { getSubagentRuntimeSessionId } from "../runtime/runtime-session-ids.js";
import {
  buildRuntimeCancellationState,
  buildRuntimePermissionState,
  buildRuntimeTurnContract,
  completeRuntimeCancellation,
  requestRuntimeCancellation,
} from "../runtime/runtime-state-machine.js";
import { persistSharedRuntimeSessionState } from "../runtime/runtime-session-state.js";
import type { RuntimeStore } from "../runtime/runtime-store.js";
import {
  createRuntimeCheckpointFromContract,
  flushErroredToolExecutions,
  handleSharedTurnEvent,
  settleTurnCompletionIfReady,
  updateRuntimeUsageSummary,
} from "../runtime/runtime-turn-engine.js";
import { StreamAssembler } from "../runtime/stream-handler.js";
import { appRootDir } from "../util/app-paths.js";
import { CopilotError, formatErrorDetails } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import { setUnrefTimeout } from "../util/timers.js";
import { SubagentLockManager } from "./lock-manager.js";
import { filterSubagentDomainTools } from "./registry.js";

const logger = createLogger("subagent-runner");

const SESSION_INIT_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 20_000;
const COMPLETION_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 500;
const WRITE_LOCK_TTL_MS = 30_000;
const READ_ONLY_HOST_TOOL_NAMES = new Set([
  "view",
  "glob",
  "rg",
  "read_powershell",
  "list_powershell",
  "spira_session_get_plan",
  "spira_session_get_scratchpad",
  "spira_session_get_context",
]);
const READ_ONLY_HOST_CAPABILITY_IDS = [...READ_ONLY_HOST_TOOL_NAMES];

interface ActiveToolCall {
  toolName: string;
  serverId?: string;
  args?: Record<string, unknown>;
  startedAt: number;
}

interface RunContext {
  runId: string;
  roomId: `agent:${string}`;
  retryCount: number;
  startedAt: number;
  toolRecords: SubagentToolCallRecord[];
  stateChanges: NormalizedStateChange[];
  streamAssembler: StreamAssembler;
  activeToolCalls: Map<string, ActiveToolCall>;
  completionPromise: Promise<string>;
  completionSettled: boolean;
  resolveCompletion: (text: string) => void;
  rejectCompletion: (error: Error) => void;
  idleObserved: boolean;
  latestAssistantText?: string;
  latestUsage?: ProviderUsageSnapshot;
  clientPromise: Promise<ProviderClient> | null;
}

interface LiveRunState {
  runId: string;
  roomId: `agent:${string}`;
  runtimeSessionId: string;
  startedAt: number;
  writesAllowed: boolean;
  keepAlive: boolean;
  requestedModel: string | null;
  toolLookup: Map<string, McpTool>;
  providerOverride: ProviderId | null;
  pendingProviderSwitch: { providerId: ProviderId; reason: "user-requested" | "recovery" | "policy" } | null;
  client: ProviderClient | null;
  session: ProviderSession | null;
  ownsClient: boolean;
  providerSessionId: string | null;
  hostManifestHash: string | null;
  providerProjectionHash: string | null;
  lastUserMessageId: string | null;
  lastAssistantMessageId: string | null;
  latestAssistantMessageText: string | null;
  usageSummary: RuntimeUsageSummary;
  pendingPermissionRequestIds: string[];
  lastPermissionResolvedAt: number | null;
  cancellationRequestedAt: number | null;
  cancellationCompletedAt: number | null;
  runtimeRecoveryContext: RuntimeRecoveryContext | null;
  fallbackRecoveryPrompt: string | null;
  activeTurnPromise: Promise<SubagentEnvelope> | null;
  currentContext: RunContext | null;
  closed: boolean;
}

interface ParsedSubagentResponse {
  summary: string;
  payload: Record<string, unknown> | null;
  followupNeeded: boolean;
  artifacts: SubagentArtifact[];
  stateChanges: NormalizedStateChange[];
  errors: SubagentErrorRecord[];
}

interface SubagentRunnerOptions {
  bus: SpiraEventBus;
  env: Env;
  stationId?: string | null;
  toolAggregator: McpToolAggregator;
  domain: SubagentDomain;
  workingDirectory?: string;
  getClient?: () => Promise<ProviderClient>;
  initialProviderId?: ProviderId | null;
  now?: () => number;
  runIdFactory?: () => string;
  sessionIdFactory?: () => `${string}-${string}-${string}-${string}-${string}`;
  retryDelayMs?: number;
  onPermissionRequest?: (
    request: ProviderPermissionRequest,
    context: { runId: string; domain: SubagentDomain },
  ) => Promise<ProviderPermissionResult>;
  lockManager?: SubagentLockManager;
  runtimeStore?: RuntimeStore;
}

export interface SubagentRunLaunch {
  runId: string;
  roomId: `agent:${string}`;
  startedAt: number;
  allowWrites?: boolean;
  workingDirectory?: string;
  resultPromise: Promise<SubagentEnvelope>;
  write: (input: string) => Promise<SubagentEnvelope>;
  stop: () => Promise<void>;
}

export interface RecoveredSubagentRunLaunch {
  write: (input: string) => Promise<SubagentEnvelope>;
  stop: () => Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const getPermissionToolName = (request: ProviderPermissionRequest): string | null =>
  "toolName" in request && typeof request.toolName === "string" ? request.toolName : null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const stripMarkdownCodeFence = (value: string): string => {
  const match = value.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? value.trim();
};

const toArtifacts = (value: unknown): SubagentArtifact[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const kind = asString(entry.kind);
    const id = asString(entry.id);
    if (!kind || !id) {
      return [];
    }

    return [
      {
        kind,
        id,
        ...(asString(entry.label) ? { label: asString(entry.label) } : {}),
        ...(asString(entry.path) ? { path: asString(entry.path) } : {}),
        ...(isRecord(entry.metadata) ? { metadata: entry.metadata } : {}),
      },
    ];
  });
};

const isSubagentScopeId = (value: string): value is SubagentScopeId =>
  (SUBAGENT_SCOPE_IDS as readonly string[]).includes(value);

const toStateChanges = (value: unknown, scope: SubagentDomain["id"]): NormalizedStateChange[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const targetType = asString(entry.targetType);
    const targetId = asString(entry.targetId);
    const action = asString(entry.action);
    if (!targetType || !targetId || !action) {
      return [];
    }

    const rawScope = asString(entry.scope);
    return [
      {
        scope: rawScope && isSubagentScopeId(rawScope) ? rawScope : scope,
        targetType,
        targetId,
        action,
        ...(asString(entry.toolName) ? { toolName: asString(entry.toolName) } : {}),
        ...(asString(entry.serverId) ? { serverId: asString(entry.serverId) } : {}),
        ...("before" in entry ? { before: entry.before } : {}),
        ...("after" in entry ? { after: entry.after } : {}),
      },
    ];
  });
};

const toErrors = (value: unknown): SubagentErrorRecord[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const message = asString(entry.message);
    if (!message) {
      return [];
    }

    return [
      {
        ...(asString(entry.code) ? { code: asString(entry.code) } : {}),
        message,
        ...(asString(entry.details) ? { details: asString(entry.details) } : {}),
      },
    ];
  });
};

const defaultParsedResponse = (text: string): ParsedSubagentResponse => ({
  summary: text.trim() || "Subagent completed.",
  payload: null,
  followupNeeded: false,
  artifacts: [],
  stateChanges: [],
  errors: [],
});

const parseSubagentResponse = (text: string, domain: SubagentDomain["id"]): ParsedSubagentResponse => {
  const cleanedText = stripMarkdownCodeFence(text);
  if (!cleanedText) {
    return defaultParsedResponse("Subagent completed.");
  }

  try {
    const parsed = JSON.parse(cleanedText) as unknown;
    if (!isRecord(parsed)) {
      return defaultParsedResponse(cleanedText);
    }

    return {
      summary: asString(parsed.summary) ?? cleanedText,
      payload: isRecord(parsed.payload) ? parsed.payload : null,
      followupNeeded: parsed.followupNeeded === true,
      artifacts: toArtifacts(parsed.artifacts),
      stateChanges: toStateChanges(parsed.stateChanges, domain),
      errors: toErrors(parsed.errors),
    };
  } catch {
    return defaultParsedResponse(cleanedText);
  }
};

const buildRecoveredPromptFallback = (snapshot: SubagentRunSnapshot): string => {
  const sections = [
    "[Recovered subagent context]",
    `Task: ${snapshot.task}`,
    snapshot.summary ? `Latest summary: ${snapshot.summary}` : null,
    snapshot.followupNeeded !== undefined ? `Follow-up needed: ${snapshot.followupNeeded ? "yes" : "no"}` : null,
    snapshot.envelope?.payload ? `Latest payload: ${JSON.stringify(snapshot.envelope.payload)}` : null,
    snapshot.toolCalls && snapshot.toolCalls.length > 0
      ? `Recent tool calls: ${snapshot.toolCalls
          .slice(-6)
          .map((toolCall) => `${toolCall.toolName} (${toolCall.status})`)
          .join(", ")}`
      : null,
    "Resume the run from this durable host-owned context rather than assuming provider session persistence.",
    "[End recovered subagent context]",
  ].filter((entry): entry is string => Boolean(entry));
  return sections.join("\n\n");
};

const collectErrorMessages = (error: unknown, depth = 0): string[] => {
  if (depth > 5 || error === null || error === undefined) {
    return [];
  }

  if (typeof error === "string") {
    return [error];
  }

  if (error instanceof Error) {
    const messages = [error.message];
    if ("cause" in error && error.cause !== undefined) {
      messages.push(...collectErrorMessages(error.cause, depth + 1));
    }
    return messages;
  }

  return [];
};

const isMissingSessionError = (error: unknown): boolean =>
  collectErrorMessages(error).some((message) => message.includes("Session not found:"));

const getToolLookup = (tools: readonly McpTool[]): Map<string, McpTool> =>
  new Map(tools.map((tool) => [tool.name, tool]));

export class SubagentRunner {
  private readonly now: () => number;
  private readonly runIdFactory: () => string;
  private readonly sessionIdFactory: () => `${string}-${string}-${string}-${string}-${string}`;
  private readonly retryDelayMs: number;
  private readonly lockManager: SubagentLockManager;
  private readonly liveRuns = new Map<string, LiveRunState>();
  private currentProviderOverride: ProviderId | null;

  constructor(private readonly options: SubagentRunnerOptions) {
    this.now = options.now ?? Date.now;
    this.runIdFactory = options.runIdFactory ?? randomUUID;
    this.sessionIdFactory = options.sessionIdFactory ?? randomUUID;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.lockManager = options.lockManager ?? new SubagentLockManager({ now: this.now });
    this.currentProviderOverride =
      options.initialProviderId && options.initialProviderId !== this.configuredProviderId ? options.initialProviderId : null;
  }

  private get configuredProviderId() {
    return getConfiguredProviderId(this.options.env);
  }

  private getEffectiveProviderId(liveRun: LiveRunState): ProviderId {
    return liveRun.client?.providerId ?? liveRun.providerOverride ?? this.currentProviderOverride ?? this.configuredProviderId;
  }

  private getProviderCapabilities(liveRun: LiveRunState) {
    return liveRun.client?.capabilities ?? getDefaultProviderCapabilities(this.getEffectiveProviderId(liveRun));
  }

  private getPersistedProviderBinding(
    snapshot: SubagentRunSnapshot,
    runtimeSession: RuntimeSessionContract | null | undefined,
  ) {
    const stationRuntimeSession =
      this.options.runtimeStore && this.options.stationId
        ? this.options.runtimeStore.getRuntimeSession(getStationRuntimeSessionId(this.options.stationId))
        : null;
    return resolveSubagentProviderBinding(snapshot, runtimeSession, stationRuntimeSession);
  }

  private getScopedDomainTools() {
    return filterSubagentDomainTools(this.options.domain, this.options.toolAggregator.getTools());
  }

  private getScopedToolAggregator(): McpToolAggregator {
    const scopedTools = this.getScopedDomainTools();
    const allowedToolNames = new Set(scopedTools.map((tool) => tool.name));
    return {
      getTools: () => scopedTools,
      getToolsForServerIds: (serverIds: readonly string[]) =>
        scopedTools.filter((tool) => serverIds.includes(tool.serverId) && allowedToolNames.has(tool.name)),
      executeTool: (name, args) => {
        if (!allowedToolNames.has(name)) {
          throw new CopilotError(`Tool ${name} is not available to ${this.options.domain.label}.`);
        }
        return this.options.toolAggregator.executeTool(name, args);
      },
    } as McpToolAggregator;
  }

  private getToolManifest(liveRun: LiveRunState) {
    return getProviderToolManifest({
      aggregator: this.getScopedToolAggregator(),
      options: {
        workingDirectory: this.options.workingDirectory ?? appRootDir,
        runtimeStore: this.options.runtimeStore,
        runtimeSessionId: liveRun.runtimeSessionId,
        stationId: this.options.stationId ?? null,
        includeHostTools: this.options.domain.allowHostTools === true,
        filterHostTool: (tool) => liveRun.writesAllowed || READ_ONLY_HOST_TOOL_NAMES.has(tool.name),
        wrapToolExecution: (tool, toolArgs, execute) => {
          if (!liveRun.currentContext) {
            throw new CopilotError("Delegated subagent run is not ready to execute tools");
          }
          return this.executeToolWithPolicy(liveRun.currentContext, tool, toolArgs, execute, liveRun.writesAllowed);
        },
      },
      providerId: this.getEffectiveProviderId(liveRun),
      capabilities: this.getProviderCapabilities(liveRun),
      preserveCapabilityIds:
        this.getEffectiveProviderId(liveRun) === "copilot" &&
        this.options.domain.allowHostTools === true &&
        liveRun.writesAllowed === false
          ? READ_ONLY_HOST_CAPABILITY_IDS
          : undefined,
    });
  }

  async run(args: SubagentDelegationArgs): Promise<SubagentEnvelope> {
    // Keep the sync compatibility path while background-mode delegation rolls out.
    return this.launch(args).resultPromise;
  }

  launch(args: SubagentDelegationArgs): SubagentRunLaunch {
    const runId = this.runIdFactory();
    const roomId = `agent:subagent-${runId}` as const;
    const startedAt = this.now();
    const writesAllowed = this.options.domain.allowWrites && args.allowWrites === true;
    const scopedMcpTools = this.getScopedDomainTools();
    const liveRun: LiveRunState = {
      runId,
      roomId,
      runtimeSessionId: getSubagentRuntimeSessionId(runId),
      startedAt,
      writesAllowed,
      keepAlive: args.mode === "background",
      requestedModel: args.model?.trim() || null,
      toolLookup: getToolLookup(scopedMcpTools),
      providerOverride: this.currentProviderOverride,
      pendingProviderSwitch: null,
      client: null,
      session: null,
      ownsClient: !this.options.getClient,
      providerSessionId: null,
      hostManifestHash: null,
      providerProjectionHash: null,
      lastUserMessageId: null,
      lastAssistantMessageId: null,
      latestAssistantMessageText: null,
      usageSummary: {
        model: args.model?.trim() || null,
        totalTokens: null,
        lastObservedAt: null,
        source: "unknown",
      },
      pendingPermissionRequestIds: [],
      lastPermissionResolvedAt: null,
      cancellationRequestedAt: null,
      cancellationCompletedAt: null,
      runtimeRecoveryContext: null,
      fallbackRecoveryPrompt: null,
      activeTurnPromise: null,
      currentContext: null,
      closed: false,
    };
    this.liveRuns.set(runId, liveRun);
    const resultPromise = this.startTurn(liveRun, args, this.buildPrompt(args), 0, true, true);
    return {
      runId,
      roomId,
      startedAt,
      allowWrites: writesAllowed,
      workingDirectory: this.options.workingDirectory ?? appRootDir,
      resultPromise,
      write: (input) => this.writeToLiveRun(liveRun, args, input),
      stop: () => this.stopLiveRun(liveRun),
    };
  }

  recover(snapshot: SubagentRunSnapshot): RecoveredSubagentRunLaunch | null {
    if (snapshot.status !== "idle") {
      return null;
    }

    const scopedMcpTools = this.getScopedDomainTools();
    const writesAllowed = this.options.domain.allowWrites && snapshot.allowWrites === true;
    const persistedRuntimeSession = this.options.runtimeStore?.getRuntimeSession(getSubagentRuntimeSessionId(snapshot.runId));
    const persistedProviderBinding = this.getPersistedProviderBinding(snapshot, persistedRuntimeSession);
    const persistedProviderId = persistedProviderBinding.providerId;
    const runtimeRecoveryContext = persistedRuntimeSession
      ? buildRuntimeRecoveryContext({
          runtimeSession: persistedRuntimeSession,
          checkpoint: this.options.runtimeStore?.getLatestRuntimeCheckpoint(getSubagentRuntimeSessionId(snapshot.runId)) ?? null,
          ledgerEvents: this.options.runtimeStore?.listRuntimeLedgerEvents(getSubagentRuntimeSessionId(snapshot.runId)) ?? [],
        })
      : null;
    const liveRun: LiveRunState = {
      runId: snapshot.runId,
      roomId: snapshot.roomId,
      runtimeSessionId: getSubagentRuntimeSessionId(snapshot.runId),
      startedAt: snapshot.startedAt,
      writesAllowed,
      keepAlive: true,
      requestedModel: snapshot.requestedModel?.trim() || null,
      toolLookup: getToolLookup(scopedMcpTools),
      providerOverride: persistedProviderId ?? this.currentProviderOverride,
      pendingProviderSwitch: null,
      client: null,
      session: null,
      ownsClient: !this.options.getClient,
      providerSessionId: persistedProviderBinding.providerSessionId,
      hostManifestHash: persistedProviderBinding.hostManifestHash,
      providerProjectionHash: persistedProviderBinding.providerProjectionHash,
      lastUserMessageId: null,
      lastAssistantMessageId: null,
      latestAssistantMessageText: null,
      usageSummary: {
        model: snapshot.observedModel ?? snapshot.requestedModel?.trim() ?? null,
        totalTokens: null,
        lastObservedAt: null,
        source: "unknown",
      },
      pendingPermissionRequestIds: [],
      lastPermissionResolvedAt: null,
      cancellationRequestedAt: null,
      cancellationCompletedAt: null,
      runtimeRecoveryContext,
      fallbackRecoveryPrompt: runtimeRecoveryContext ? null : buildRecoveredPromptFallback(snapshot),
      activeTurnPromise: null,
      currentContext: null,
      closed: false,
    };
    this.liveRuns.set(snapshot.runId, liveRun);
    const manifest = this.getToolManifest(liveRun);
    if (
      !persistedProviderBinding.hostManifestHash ||
      !persistedProviderBinding.providerProjectionHash ||
      persistedProviderBinding.hostManifestHash !== manifest.hostManifestHash ||
      persistedProviderBinding.providerProjectionHash !== manifest.projectionHash
    ) {
      if (!runtimeRecoveryContext) {
        this.liveRuns.delete(snapshot.runId);
        return null;
      }
      liveRun.hostManifestHash = null;
      liveRun.providerProjectionHash = null;
    }

    return {
      write: (input) =>
        this.writeToLiveRun(
          liveRun,
          {
            task: snapshot.task,
            ...(snapshot.requestedModel ? { model: snapshot.requestedModel } : {}),
            mode: "background",
            ...(writesAllowed ? { allowWrites: true } : {}),
          },
          input,
        ),
      stop: () => this.stopLiveRun(liveRun),
    };
  }

  async switchProvider(
    providerId: ProviderId,
    reason: "user-requested" | "recovery" | "policy" = "user-requested",
  ): Promise<void> {
    this.currentProviderOverride = providerId !== this.configuredProviderId ? providerId : null;
    for (const liveRun of this.liveRuns.values()) {
      if (liveRun.activeTurnPromise) {
        liveRun.pendingProviderSwitch = { providerId, reason };
        continue;
      }
      await this.applyProviderSwitch(liveRun, providerId, reason);
    }
  }

  private async applyProviderSwitch(
    liveRun: LiveRunState,
    providerId: ProviderId,
    reason: "user-requested" | "recovery" | "policy",
  ): Promise<void> {
    const fromProviderId = this.getEffectiveProviderId(liveRun);
    if (fromProviderId === providerId) {
      liveRun.pendingProviderSwitch = null;
      return;
    }
    const checkpoint = this.createRuntimeCheckpoint(
      liveRun,
      "session-summary",
      `Switching provider from ${getProviderLabel(fromProviderId)} to ${getProviderLabel(providerId)}.`,
    );
    if (liveRun.session) {
      await liveRun.session.disconnect().catch(() => undefined);
      liveRun.session = null;
    }
    await this.deleteProviderManagedSession(liveRun.client, liveRun.providerSessionId, liveRun.runId, liveRun.roomId);
    if (liveRun.ownsClient && liveRun.client) {
      await stopProviderClient(liveRun.client, logger).catch(() => undefined);
    }
    liveRun.client = null;
    liveRun.providerOverride = providerId;
    liveRun.pendingProviderSwitch = null;
    liveRun.providerSessionId = null;
    liveRun.hostManifestHash = null;
    liveRun.providerProjectionHash = null;
    this.options.bus.emit("subagent:runtime-sync", {
      runId: liveRun.runId,
      roomId: liveRun.roomId,
      allowWrites: liveRun.writesAllowed,
      providerId,
      providerSessionId: null,
      hostManifestHash: null,
      providerProjectionHash: null,
    });
    const switchedAt = this.now();
    const manifest = this.getToolManifest(liveRun);
    const switchRecord = {
      switchId: randomUUID(),
      fromProviderId,
      toProviderId: providerId,
      switchedAt,
      reason,
      hostManifestHash: manifest.hostManifestHash,
      projectionHash: manifest.projectionHash,
      checkpointId: checkpoint?.checkpointId ?? null,
    } as const;
    const existing = this.options.runtimeStore?.getRuntimeSession(liveRun.runtimeSessionId);
    const contract = this.persistRuntimeSession(liveRun, {
      providerSwitches: [...(existing?.providerSwitches ?? []), switchRecord],
    });
    this.appendRuntimeLedgerEvent(liveRun, {
      eventId: switchRecord.switchId,
      occurredAt: switchedAt,
      type: "provider.switched",
      payload: {
        ...switchRecord,
        checkpointId: switchRecord.checkpointId ?? contract?.checkpointRef?.checkpointId ?? null,
      },
    });
  }

  private async startTurn(
    liveRun: LiveRunState,
    args: SubagentDelegationArgs,
    prompt: string,
    retryCount: number,
    allowRetry: boolean,
    announceStart: boolean,
  ): Promise<SubagentEnvelope> {
    let resolveCompletion: (text: string) => void = () => {};
    let rejectCompletion: (error: Error) => void = () => {};
    const completionPromise = new Promise<string>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const context: RunContext = {
      runId: liveRun.runId,
      roomId: liveRun.roomId,
      retryCount,
      startedAt: liveRun.startedAt,
      toolRecords: [],
      stateChanges: [],
      streamAssembler: new StreamAssembler(),
      activeToolCalls: new Map(),
      completionPromise,
      completionSettled: false,
      resolveCompletion,
      rejectCompletion,
      idleObserved: false,
      latestUsage: undefined,
      clientPromise: this.options.getClient ? this.options.getClient() : null,
    };
    liveRun.currentContext = context;
    this.persistRuntimeSession(liveRun);
    liveRun.lastUserMessageId = randomUUID();
    liveRun.latestAssistantMessageText = null;
    this.recordRuntimeUserMessage(liveRun, liveRun.lastUserMessageId, prompt);
    if (announceStart) {
      this.options.bus.emit("subagent:started", {
        runId: liveRun.runId,
        roomId: liveRun.roomId,
        domain: this.options.domain.id,
        label: this.options.domain.label,
        task: args.task,
        attempt: retryCount + 1,
        startedAt: liveRun.startedAt,
        allowWrites: liveRun.writesAllowed,
      });
    }

    let turnPromise: Promise<SubagentEnvelope> | null = null;
    turnPromise = (async () => {
      try {
        await this.ensureLiveSession(liveRun, context);
        if (liveRun.closed) {
          await this.cleanupLiveSession(liveRun);
          throw new CopilotError("Subagent run cancelled.");
        }
        if (!liveRun.session) {
          throw new CopilotError("Subagent session is unavailable");
        }

        await withTimeout(liveRun.session.send({ prompt }), SEND_TIMEOUT_MS, "Timed out while sending a subagent task");
        if (liveRun.runtimeRecoveryContext) {
          recordRuntimeRecoveryCompleted(this.options.runtimeStore, liveRun.runtimeSessionId, {
            recoveredFrom: liveRun.runtimeRecoveryContext.source,
            success: true,
            occurredAt: this.now(),
          });
          liveRun.runtimeRecoveryContext = null;
        }
        const assistantText = await withTimeout(
          context.completionPromise,
          COMPLETION_TIMEOUT_MS,
          "Timed out while waiting for the subagent response",
        );

        const parsed = parseSubagentResponse(assistantText, this.options.domain.id);
        const completedAt = this.now();
        this.emitProviderUsage(this.buildUsageRecord(liveRun, context, completedAt));
        const envelope = this.buildEnvelope(args, context, completedAt, "completed", parsed);
        this.persistRuntimeSession(liveRun);
        this.createRuntimeCheckpoint(liveRun, "turn-snapshot", liveRun.latestAssistantMessageText ?? envelope.summary);
        this.options.bus.emit("subagent:completed", {
          runId: liveRun.runId,
          roomId: liveRun.roomId,
          domain: this.options.domain.id,
          label: this.options.domain.label,
          completedAt,
          envelope,
        });
        return envelope;
      } catch (error) {
        const errorRecord: SubagentErrorRecord = {
          ...(error instanceof CopilotError ? { code: error.code } : {}),
          message: error instanceof Error ? error.message : "Subagent execution failed",
          ...(error instanceof Error ? { details: formatErrorDetails(error) } : {}),
        };
        const willRetry = !liveRun.closed && allowRetry && retryCount < 1;
        const occurredAt = this.now();
        this.options.bus.emit("subagent:error", {
          runId: liveRun.runId,
          roomId: liveRun.roomId,
          domain: this.options.domain.id,
          label: this.options.domain.label,
          attempt: retryCount + 1,
          error: errorRecord,
          willRetry,
          occurredAt,
        });
        logger.error(
          { err: error, runId: liveRun.runId, roomId: liveRun.roomId, domain: this.options.domain.id, retryCount },
          "Subagent execution failed",
        );

        if (willRetry) {
          await this.cleanupLiveSession(liveRun);
          await new Promise<void>((resolve) => {
            setUnrefTimeout(resolve, this.retryDelayMs);
          });
          if (liveRun.closed) {
            liveRun.closed = true;
            const completedAt = this.now();
            this.emitProviderUsage(this.buildUsageRecord(liveRun, context, completedAt));
            const envelope = this.buildEnvelope(args, context, completedAt, "failed", {
              summary: "Subagent run cancelled.",
              payload: null,
              followupNeeded: false,
              artifacts: [],
              stateChanges: [],
              errors: [],
            });
            this.persistRuntimeSession(liveRun);
            this.createRuntimeCheckpoint(liveRun, "turn-snapshot", envelope.summary);
            this.options.bus.emit("subagent:completed", {
              runId: liveRun.runId,
              roomId: liveRun.roomId,
              domain: this.options.domain.id,
              label: this.options.domain.label,
              completedAt,
              envelope,
            });
            return envelope;
          }
          return this.startTurn(liveRun, args, prompt, retryCount + 1, allowRetry, true);
        }

        if (liveRun.closed) {
          const completedAt = this.now();
          this.emitProviderUsage(this.buildUsageRecord(liveRun, context, completedAt));
          const envelope = this.buildEnvelope(args, context, completedAt, "failed", {
            summary: "Subagent run cancelled.",
            payload: null,
            followupNeeded: false,
            artifacts: [],
            stateChanges: [],
            errors: [],
          });
          this.persistRuntimeSession(liveRun);
          this.createRuntimeCheckpoint(liveRun, "turn-snapshot", envelope.summary);
          this.options.bus.emit("subagent:completed", {
            runId: liveRun.runId,
            roomId: liveRun.roomId,
            domain: this.options.domain.id,
            label: this.options.domain.label,
            completedAt,
            envelope,
          });
          return envelope;
        }

        liveRun.closed = true;
        const completedAt = this.now();
        this.emitProviderUsage(this.buildUsageRecord(liveRun, context, completedAt));
        const envelope = this.buildEnvelope(
          args,
          context,
          completedAt,
          context.toolRecords.length > 0 ? "partial" : "failed",
          {
            summary: errorRecord.message,
            payload: null,
            followupNeeded: true,
            artifacts: [],
            stateChanges: [],
            errors: [errorRecord],
          },
        );
        this.persistRuntimeSession(liveRun);
        this.createRuntimeCheckpoint(liveRun, "turn-snapshot", envelope.summary);
        this.options.bus.emit("subagent:completed", {
          runId: liveRun.runId,
          roomId: liveRun.roomId,
          domain: this.options.domain.id,
          label: this.options.domain.label,
          completedAt,
          envelope,
        });
        return envelope;
      } finally {
        this.lockManager.releaseByRunId(liveRun.runId);
        context.streamAssembler.clear();
        if (liveRun.activeTurnPromise === turnPromise) {
          liveRun.activeTurnPromise = null;
        }
        if (liveRun.currentContext === context) {
          liveRun.currentContext = null;
        }
        if (!liveRun.closed && !liveRun.activeTurnPromise && liveRun.pendingProviderSwitch) {
          await this.applyProviderSwitch(
            liveRun,
            liveRun.pendingProviderSwitch.providerId,
            liveRun.pendingProviderSwitch.reason,
          );
        }
        if (!liveRun.keepAlive || liveRun.closed) {
          await this.cleanupLiveSession(liveRun);
        }
      }
    })();

    liveRun.activeTurnPromise = turnPromise;
    return turnPromise;
  }

  private async writeToLiveRun(
    liveRun: LiveRunState,
    args: SubagentDelegationArgs,
    input: string,
  ): Promise<SubagentEnvelope> {
    if (liveRun.closed) {
      throw new CopilotError("Delegated subagent run is no longer active");
    }
    if (liveRun.activeTurnPromise) {
      throw new CopilotError("Delegated subagent run is still working on a previous turn");
    }
    if (!liveRun.keepAlive) {
      throw new CopilotError("Delegated subagent run cannot accept follow-up input");
    }

    const prompt = liveRun.fallbackRecoveryPrompt ? `${liveRun.fallbackRecoveryPrompt}\n\nFollow-up request:\n${input}` : input;
    liveRun.fallbackRecoveryPrompt = null;
    return this.startTurn(liveRun, args, prompt, 0, false, false);
  }

  private async stopLiveRun(liveRun: LiveRunState): Promise<void> {
    const requestedAt = this.now();
    const requestedCancellation = requestRuntimeCancellation(requestedAt);
    liveRun.cancellationRequestedAt = requestedCancellation.requestedAt;
    liveRun.cancellationCompletedAt = requestedCancellation.completedAt;
    this.persistRuntimeSession(liveRun);
    recordRuntimeCancellationRequested(this.options.runtimeStore, liveRun.runtimeSessionId, {
      mode: this.getProviderCapabilities(liveRun).turnCancellation,
      requestedAt,
    });
    liveRun.closed = true;
    const occurredAt = this.now();
    const completedCancellation = completeRuntimeCancellation(occurredAt);
    liveRun.cancellationRequestedAt = completedCancellation.requestedAt;
    liveRun.cancellationCompletedAt = completedCancellation.completedAt;
    recordRuntimeCancellationCompleted(this.options.runtimeStore, liveRun.runtimeSessionId, {
      mode: this.getProviderCapabilities(liveRun).turnCancellation,
      completedAt: occurredAt,
    });
    this.persistRuntimeSession(liveRun);
    await this.cleanupLiveSession(liveRun);
  }

  private async ensureLiveSession(liveRun: LiveRunState, _context: RunContext): Promise<void> {
    if (liveRun.client?.providerId && liveRun.client.providerId !== this.getEffectiveProviderId(liveRun)) {
      await this.cleanupLiveSession(liveRun);
    }
    if (!liveRun.client) {
      liveRun.client = _context.clientPromise
        ? await _context.clientPromise
        : this.options.getClient
          ? await this.options.getClient()
        : (await createProviderClientForProvider(this.options.env, this.getEffectiveProviderId(liveRun), logger)).client;
    }
    const client = liveRun.client;
    if (!client) {
      throw new CopilotError("Delegated subagent run could not acquire a provider client");
    }
    const providerLabel = getProviderLabel(this.getEffectiveProviderId(liveRun));
    const manifest = this.getToolManifest(liveRun);
    const manifestChanged =
      liveRun.hostManifestHash !== manifest.hostManifestHash ||
      liveRun.providerProjectionHash !== manifest.projectionHash;
    if (liveRun.session && !manifestChanged) {
      return;
    }
    if (manifestChanged) {
      if (liveRun.session) {
        await liveRun.session.disconnect().catch((disconnectError) => {
          logger.warn(
            { error: disconnectError, runId: liveRun.runId, roomId: liveRun.roomId },
            "Failed to disconnect stale subagent session after capability projection drift",
          );
        });
        liveRun.session = null;
      }
      await this.deleteProviderManagedSession(liveRun.client, liveRun.providerSessionId, liveRun.runId, liveRun.roomId);
      liveRun.providerSessionId = null;
    }
    const sessionConfig = this.getSessionConfig(liveRun, liveRun.writesAllowed, liveRun.toolLookup, manifest);
    const createSession = () => createFreshProviderSession(client, sessionConfig, this.sessionIdFactory());

    try {
      liveRun.session = await withTimeout(
        shouldPersistProviderSession(client.capabilities) && liveRun.providerSessionId
          ? client.resumeSession(liveRun.providerSessionId, sessionConfig)
          : createSession(),
        SESSION_INIT_TIMEOUT_MS,
        `Timed out while connecting a subagent to ${providerLabel}`,
      );
    } catch (error) {
      if (!liveRun.providerSessionId || !isMissingSessionError(error)) {
        throw error;
      }

      liveRun.providerSessionId = null;
      liveRun.session = await withTimeout(
        createSession(),
        SESSION_INIT_TIMEOUT_MS,
        `Timed out while reconnecting a subagent to ${providerLabel}`,
      );
    }
    if (liveRun.closed) {
      await this.cleanupLiveSession(liveRun);
      throw new CopilotError("Subagent run cancelled.");
    }
    await this.applyRequestedModel(liveRun);
    liveRun.hostManifestHash = manifest.hostManifestHash;
    liveRun.providerProjectionHash = manifest.projectionHash;
    liveRun.providerSessionId = shouldPersistProviderSession(client.capabilities) ? liveRun.session.sessionId : null;
    const contract = this.persistRuntimeSession(liveRun);
    this.options.bus.emit("subagent:runtime-sync", {
      runId: liveRun.runId,
      roomId: liveRun.roomId,
      allowWrites: liveRun.writesAllowed,
      providerId: client.providerId,
      providerSessionId: liveRun.providerSessionId,
      hostManifestHash: liveRun.hostManifestHash,
      providerProjectionHash: liveRun.providerProjectionHash,
    });
    recordRuntimeProviderBound(this.options.runtimeStore, liveRun.runtimeSessionId, {
      bindingRevision: contract?.providerBinding.bindingRevision ?? 0,
      providerId: client.providerId,
      providerSessionId: liveRun.providerSessionId,
      hostManifestHash: liveRun.hostManifestHash ?? "",
      projectionHash: liveRun.providerProjectionHash ?? "",
      checkpointId: contract?.checkpointRef?.checkpointId ?? null,
      occurredAt: Date.now(),
    });
  }

  private async applyRequestedModel(liveRun: LiveRunState): Promise<void> {
    const requestedModel = liveRun.requestedModel?.trim();
    if (!requestedModel || !liveRun.session?.setModel) {
      return;
    }

    await withTimeout(
      liveRun.session.setModel(requestedModel),
      SESSION_INIT_TIMEOUT_MS,
      `Timed out while selecting subagent model ${requestedModel}`,
    );
  }

  private async cleanupLiveSession(liveRun: LiveRunState): Promise<void> {
    try {
      const session = liveRun.session;
      const client = liveRun.client;
      const providerSessionId =
        liveRun.providerSessionId ?? (client && session && shouldPersistProviderSession(client.capabilities) ? session.sessionId : null);
      liveRun.session = null;
      liveRun.client = null;
      liveRun.providerSessionId = null;

      if (session) {
        await session.disconnect().catch((disconnectError) => {
          logger.warn(
            { error: disconnectError, runId: liveRun.runId, roomId: liveRun.roomId },
            "Failed to disconnect subagent session cleanly",
          );
        });
      }
      await this.deleteProviderManagedSession(client, providerSessionId, liveRun.runId, liveRun.roomId);
      if (liveRun.ownsClient && client) {
        await stopProviderClient(client, logger).catch((stopError) => {
          logger.warn(
            { error: stopError, runId: liveRun.runId, roomId: liveRun.roomId },
            "Failed to stop subagent client cleanly",
          );
        });
      }
      if (liveRun.closed || !liveRun.keepAlive) {
        this.liveRuns.delete(liveRun.runId);
      }
    } catch (error) {
      logger.warn({ error, runId: liveRun.runId, roomId: liveRun.roomId }, "Failed to clean up subagent live session");
    }
  }

  private async deleteProviderManagedSession(
    client: ProviderClient | null,
    sessionId: string | null,
    runId: string,
    roomId: string,
  ): Promise<void> {
    if (!client || !sessionId || !shouldPersistProviderSession(client.capabilities)) {
      return;
    }
    try {
      await client.deleteSession(sessionId);
      this.options.runtimeStore?.clearPendingProviderSessionCleanup(client.providerId, sessionId);
    } catch (error) {
      if (isMissingSessionError(error)) {
        this.options.runtimeStore?.clearPendingProviderSessionCleanup(client.providerId, sessionId);
        return;
      }
      this.options.runtimeStore?.queueProviderSessionCleanup(client.providerId, sessionId);
      if (this.options.runtimeStore) {
        void this.options.runtimeStore.drainPendingProviderSessionCleanup(this.options.env);
      }
      logger.warn(
        { error, runId, roomId, sessionId, providerId: client.providerId },
        "Failed to delete stale provider-managed subagent session",
      );
    }
  }

  private getSessionConfig(
    liveRun: LiveRunState,
    writesAllowed: boolean,
    toolLookup: Map<string, McpTool>,
    manifest = this.getToolManifest(liveRun),
  ): Omit<ProviderSessionConfig, "sessionId"> {
    const runtimeRecoverySection = liveRun.runtimeRecoveryContext
      ? buildRuntimeRecoverySystemSection(liveRun.runtimeRecoveryContext)
      : null;
    return {
      clientName: "Spira",
      ...(liveRun.requestedModel ? { model: liveRun.requestedModel } : {}),
      infiniteSessions: {
        enabled: true,
      },
      onEvent: (event) => {
        if (liveRun.currentContext) {
          this.handleSessionEvent(liveRun, liveRun.currentContext, toolLookup, event);
        }
      },
      onPermissionRequest: (request) =>
        liveRun.currentContext
          ? this.handlePermissionRequest(liveRun, liveRun.currentContext, request)
          : Promise.resolve(approvePermissionOnce()),
      streaming: liveRun.client ? shouldRequestNativeStreaming(liveRun.client.capabilities) : true,
      systemMessage: {
        mode: "customize",
        content: [
          "You are a stateless domain specialist working on Shinra's behalf inside Spira.",
          `Your assigned domain is ${this.options.domain.label}.`,
          "Use only the tools you have been given.",
          writesAllowed
            ? "You may perform state-changing actions when needed."
            : "Prefer read-only actions. If a state-changing action is required, describe the obstacle in your result summary.",
        ].join("\n"),
        sections: {
          custom_instructions: {
            action: "append",
            content: [
              this.options.domain.systemPrompt,
              "Return a JSON object with keys: summary (string), optional payload (object or null), optional followupNeeded (boolean), optional artifacts (array), optional stateChanges (array), optional errors (array).",
              "Do not wrap the JSON in markdown fences.",
            ]
              .filter((entry) => entry.length > 0)
              .join("\n\n"),
          },
          ...(runtimeRecoverySection ? { runtime_recovery: runtimeRecoverySection } : {}),
        },
      },
      workingDirectory: this.options.workingDirectory ?? appRootDir,
      tools: manifest.tools,
    };
  }

  private buildPrompt(args: SubagentDelegationArgs): string {
    if (!args.context?.trim()) {
      return args.task;
    }

    return `Context:\n${args.context.trim()}\n\nTask:\n${args.task}`;
  }

  private handleSessionEvent(
    liveRun: LiveRunState,
    context: RunContext,
    toolLookup: Map<string, McpTool>,
    event: ProviderSessionEvent,
  ): void {
    const sharedTurnState = {
      streamAssembler: context.streamAssembler,
      activeToolCalls: context.activeToolCalls,
      latestUsage: context.latestUsage,
      latestAssistantText: context.latestAssistantText,
      lastAssistantMessageId: liveRun.lastAssistantMessageId,
      idleObserved: context.idleObserved,
    };
    const handled = handleSharedTurnEvent({
      state: sharedTurnState,
      event,
      now: () => this.now(),
      normalizeUsage: (snapshot) =>
        liveRun.client ? normalizeProviderUsageSnapshot(liveRun.client.capabilities, snapshot) : (snapshot as ProviderUsageSnapshot),
      createActiveToolCall: (startEvent, occurredAt) => {
        const tool = toolLookup.get(startEvent.data.toolName);
        return {
          toolName: startEvent.data.toolName,
          serverId: tool?.serverId,
          args: startEvent.data.arguments ?? {},
          startedAt: occurredAt,
        };
      },
      buildToolRecord: (activeToolCall, completeEvent, occurredAt): SubagentToolCallRecord => ({
        callId: completeEvent.data.toolCallId,
        toolName: activeToolCall?.toolName ?? "unknown",
        ...(activeToolCall?.serverId ? { serverId: activeToolCall.serverId } : {}),
        ...(activeToolCall?.args ? { args: activeToolCall.args } : {}),
        ...(completeEvent.data.result !== undefined ? { result: completeEvent.data.result } : {}),
        status: completeEvent.data.success === false || completeEvent.data.error ? "error" : "success",
        startedAt: activeToolCall?.startedAt ?? occurredAt,
        completedAt: occurredAt,
        durationMs: occurredAt - (activeToolCall?.startedAt ?? occurredAt),
        ...(completeEvent.data.error?.message ? { details: completeEvent.data.error.message } : {}),
      }),
      onAssistantDelta: (deltaEvent, occurredAt) => {
        recordRuntimeAssistantMessageDelta(this.options.runtimeStore, liveRun.runtimeSessionId, {
          messageId: deltaEvent.data.messageId,
          deltaContent: deltaEvent.data.deltaContent,
          occurredAt,
        });
        this.options.bus.emit("subagent:delta", {
          runId: context.runId,
          roomId: context.roomId,
          messageId: deltaEvent.data.messageId,
          delta: deltaEvent.data.deltaContent,
        } satisfies SubagentDeltaEvent);
      },
      onAssistantMessage: (messageEvent, fullText, occurredAt) => {
        liveRun.latestAssistantMessageText = fullText;
        recordRuntimeAssistantMessage(this.options.runtimeStore, liveRun.runtimeSessionId, {
          messageId: messageEvent.data.messageId,
          content: fullText,
          occurredAt,
        });
      },
      onToolExecutionStart: (startEvent, activeToolCall, occurredAt) => {
        this.persistRuntimeSession(liveRun);
        recordRuntimeToolExecutionStarted(this.options.runtimeStore, liveRun.runtimeSessionId, {
          toolCallId: startEvent.data.toolCallId,
          toolName: startEvent.data.toolName,
          arguments: startEvent.data.arguments,
          occurredAt,
        });
        this.options.bus.emit("subagent:tool-call", {
          runId: context.runId,
          roomId: context.roomId,
          callId: startEvent.data.toolCallId,
          toolName: startEvent.data.toolName,
          serverId: activeToolCall.serverId,
          args: startEvent.data.arguments ?? {},
          startedAt: occurredAt,
        });
      },
      onToolExecutionComplete: (completeEvent, toolRecord, occurredAt) => {
        context.toolRecords.push(toolRecord);
        this.persistRuntimeSession(liveRun);
        recordRuntimeToolExecutionCompleted(this.options.runtimeStore, liveRun.runtimeSessionId, {
          toolCallId: completeEvent.data.toolCallId,
          toolName: toolRecord.toolName,
          success: toolRecord.status !== "error",
          result: toolRecord.result,
          errorMessage: toolRecord.details,
          occurredAt,
        });
        this.options.bus.emit("subagent:tool-result", {
          runId: context.runId,
          roomId: context.roomId,
          callId: toolRecord.callId,
          toolName: toolRecord.toolName,
          serverId: toolRecord.serverId,
          status: toolRecord.status,
          result: toolRecord.result,
          details: toolRecord.details,
          startedAt: toolRecord.startedAt,
          completedAt: occurredAt,
          durationMs: toolRecord.durationMs ?? 0,
        });
      },
      onAssistantUsage: (usage, _usageEvent, occurredAt) => {
        liveRun.usageSummary = updateRuntimeUsageSummary(liveRun.usageSummary, usage, occurredAt);
      },
      onSessionIdle: (usage, _idleEvent, occurredAt) => {
        liveRun.usageSummary = updateRuntimeUsageSummary(liveRun.usageSummary, usage, occurredAt);
        this.persistRuntimeSession(liveRun);
      },
      onTurnReady: (assistantText) => {
        if (!context.completionSettled) {
          context.completionSettled = true;
          context.resolveCompletion(assistantText);
        }
      },
    });
    if (handled) {
      context.latestUsage = sharedTurnState.latestUsage;
      context.latestAssistantText = sharedTurnState.latestAssistantText;
      context.idleObserved = sharedTurnState.idleObserved;
      liveRun.lastAssistantMessageId = sharedTurnState.lastAssistantMessageId;
      liveRun.latestAssistantMessageText = sharedTurnState.latestAssistantText ?? liveRun.latestAssistantMessageText;
      return;
    }

    switch (event.type) {
      case "session.error":
        logger.error(
          { runId: context.runId, roomId: context.roomId, sessionError: event.data },
          "Subagent session error",
        );
        this.flushActiveToolCallsAsErrors(context, event.data.message);
        if (!context.completionSettled) {
          context.completionSettled = true;
          context.rejectCompletion(new CopilotError(event.data.message));
        }
        return;

      default:
        return;
    }
  }

  private resolveCompletionIfReady(context: RunContext): void {
    context.completionSettled = settleTurnCompletionIfReady({
      completionSettled: context.completionSettled,
      latestAssistantText: context.latestAssistantText,
      idleObserved: context.idleObserved,
      activeToolCallCount: context.activeToolCalls.size,
      settle: (assistantText) => context.resolveCompletion(assistantText),
    });
  }

  private flushActiveToolCallsAsErrors(context: RunContext, message: string): void {
    const completedAt = this.now();
    for (const toolRecord of flushErroredToolExecutions(
      context.activeToolCalls,
      (callId, activeToolCall): SubagentToolCallRecord => ({
        callId,
        toolName: activeToolCall.toolName,
        ...(activeToolCall.serverId ? { serverId: activeToolCall.serverId } : {}),
        ...(activeToolCall.args ? { args: activeToolCall.args } : {}),
        status: "error",
        startedAt: activeToolCall.startedAt,
        completedAt,
        durationMs: completedAt - activeToolCall.startedAt,
        details: message,
      }),
    )) {
      context.toolRecords.push(toolRecord);
      this.options.bus.emit("subagent:tool-result", {
        runId: context.runId,
        roomId: context.roomId,
        callId: toolRecord.callId,
        toolName: toolRecord.toolName,
        serverId: toolRecord.serverId,
        status: toolRecord.status,
        details: toolRecord.details,
        startedAt: toolRecord.startedAt,
        completedAt,
        durationMs: toolRecord.durationMs ?? 0,
      });
    }
  }

  private async executeToolWithPolicy(
    context: RunContext,
    tool: McpTool,
    args: unknown,
    execute: () => Promise<unknown>,
    writesAllowed: boolean,
  ): Promise<unknown> {
    if (tool.access?.mode === "read") {
      return execute();
    }

    if (!writesAllowed) {
      throw new CopilotError(
        `State-changing tool ${tool.name} requires allowWrites to be true for ${this.options.domain.label}.`,
      );
    }

    const request = this.buildWriteIntent(context, tool, args);
    const decision = this.lockManager.requestIntent(request);
    if ("reason" in decision) {
      this.options.bus.emit("subagent:lock-denied", {
        roomId: context.roomId,
        runId: context.runId,
        request,
        denial: decision,
      });
      throw new CopilotError(decision.reason);
    }

    this.options.bus.emit("subagent:lock-acquired", {
      roomId: context.roomId,
      runId: context.runId,
      request,
      grant: decision,
    });

    try {
      return await execute();
    } finally {
      this.lockManager.releaseIntent(request.intentId);
      this.options.bus.emit("subagent:lock-released", {
        roomId: context.roomId,
        intentId: request.intentId,
        runId: context.runId,
        releasedAt: this.now(),
      });
    }
  }

  private buildWriteIntent(context: RunContext, tool: McpTool, args: unknown) {
    const now = this.now();
    const normalizedArgs = isRecord(args) ? args : {};
    const targetEntries = [
      "path",
      "filePath",
      "targetDirectory",
      "name",
      "title",
      "processName",
      "handle",
      "memoryId",
      "roomId",
      "serverId",
      "proposalId",
      "requestId",
      "modId",
      "fileId",
      "view",
    ]
      .map((key) => [key, normalizedArgs[key]] as const)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => `${key}=${String(value)}`);

    return {
      intentId: randomUUID(),
      runId: context.runId,
      domain: this.options.domain.id,
      targetType: tool.serverId ?? "unknown",
      targetId: targetEntries.length > 0 ? targetEntries.join("|") : tool.name,
      action: tool.name,
      toolName: tool.name,
      serverId: tool.serverId,
      requestedAt: now,
      expiresAt: now + WRITE_LOCK_TTL_MS,
    };
  }

  private handlePermissionRequest(
    liveRun: LiveRunState,
    context: RunContext,
    request: ProviderPermissionRequest,
  ): Promise<ProviderPermissionResult> {
    const requestId = randomUUID();
    const payload: PermissionRequestPayload = {
      requestId,
      ...(this.options.stationId ? { stationId: this.options.stationId } : {}),
      kind: request.kind === "mcp" ? "mcp" : "custom-tool",
      toolCallId: typeof request.toolCallId === "string" ? request.toolCallId : undefined,
      serverName: typeof request.serverName === "string" ? request.serverName : "Subagent runtime",
      toolName: request.toolName ?? "unknown",
      toolTitle: typeof request.toolTitle === "string" ? request.toolTitle : request.toolName ?? "unknown",
      args: request.args,
      readOnly: request.readOnly === true,
    };
    return executeRuntimePermissionRequest({
      runtimeStore: this.options.runtimeStore,
      runtimeSessionId: getSubagentRuntimeSessionId(context.runId),
      payload,
      now: () => this.now(),
      onRequested: () => {
        liveRun.pendingPermissionRequestIds.push(requestId);
        this.persistRuntimeSession(liveRun);
      },
      onResolved: () => {
        liveRun.pendingPermissionRequestIds = liveRun.pendingPermissionRequestIds.filter((pendingId) => pendingId !== requestId);
        liveRun.lastPermissionResolvedAt = this.now();
        this.persistRuntimeSession(liveRun);
      },
      decide: async () => {
        if (this.options.onPermissionRequest) {
          return await this.options.onPermissionRequest(request, { runId: context.runId, domain: this.options.domain });
        }

        const toolName = getPermissionToolName(request);
        if (request.kind === "mcp" && toolName !== null && toolName.startsWith("vision_")) {
          return permissionUserNotAvailable();
        }

        return approvePermissionOnce();
      },
    });
  }

  private emitProviderUsage(record: ProviderUsageRecord): void {
    this.options.bus.emit("provider:usage", record);
    recordRuntimeUsageObserved(this.options.runtimeStore, record.runId ? getSubagentRuntimeSessionId(record.runId) : null, {
      model: record.model ?? null,
      totalTokens: record.totalTokens ?? null,
      source: record.source,
      observedAt: record.observedAt,
    });
    logger.info({ usage: record, runId: record.runId }, "Provider usage observed for subagent run");
  }

  private buildUsageRecord(liveRun: LiveRunState, context: RunContext, observedAt: number): ProviderUsageRecord {
    return {
      provider: this.getEffectiveProviderId(liveRun),
      stationId: this.options.stationId ?? null,
      sessionId: liveRun.session?.sessionId ?? null,
      runId: liveRun.runId,
      model: context.latestUsage?.model ?? null,
      inputTokens: context.latestUsage?.inputTokens ?? null,
      outputTokens: context.latestUsage?.outputTokens ?? null,
      totalTokens: context.latestUsage?.totalTokens ?? null,
      estimatedCostUsd: context.latestUsage?.estimatedCostUsd ?? null,
      latencyMs: context.latestUsage?.latencyMs ?? observedAt - context.startedAt,
      observedAt,
      source:
        context.latestUsage?.source ??
        (liveRun.client ? normalizeProviderUsageSnapshot(liveRun.client.capabilities, null).source : "unknown"),
    };
  }

  private persistRuntimeSession(
    liveRun: LiveRunState,
    overrides: Partial<Pick<RuntimeSessionContract, "providerSwitches">> = {},
  ): RuntimeSessionContract | null {
    if (!this.options.runtimeStore) {
      return null;
    }
    const existing = this.options.runtimeStore.getRuntimeSession(liveRun.runtimeSessionId);
    const providerCapabilities = this.getProviderCapabilities(liveRun);
    const activeToolCallIds = liveRun.currentContext ? [...liveRun.currentContext.activeToolCalls.keys()] : [];
    return persistSharedRuntimeSessionState(this.options.runtimeStore, {
      runtimeSessionId: liveRun.runtimeSessionId,
      stationId: this.options.stationId ?? null,
      runId: liveRun.runId,
      kind: liveRun.keepAlive ? "background" : "subagent",
      scope: {
        stationId: this.options.stationId ?? null,
        runId: liveRun.runId,
        roomId: liveRun.roomId,
      },
      workingDirectory: this.options.workingDirectory ?? appRootDir,
      hostManifestHash: liveRun.hostManifestHash ?? existing?.hostManifestHash ?? "unbound",
      providerProjectionHash: liveRun.providerProjectionHash ?? existing?.providerProjectionHash ?? "unbound",
      providerId: this.getEffectiveProviderId(liveRun),
      providerCapabilities,
      providerSessionId: liveRun.providerSessionId,
      model: liveRun.usageSummary.model ?? liveRun.requestedModel ?? null,
      artifactRefs: existing?.artifactRefs,
      checkpointRef: existing?.checkpointRef ?? null,
      turnState: buildRuntimeTurnContract({
        isThinking: Boolean(liveRun.currentContext),
        activeToolCallIds,
        lastUserMessageId: liveRun.lastUserMessageId,
        lastAssistantMessageId: liveRun.lastAssistantMessageId,
        waitingForPermission: liveRun.pendingPermissionRequestIds.length > 0,
        isCompleted: liveRun.closed,
      }),
      permissionState: buildRuntimePermissionState({
        pendingRequestIds: liveRun.pendingPermissionRequestIds,
        lastResolvedAt: liveRun.lastPermissionResolvedAt,
      }),
      cancellationState: buildRuntimeCancellationState({
        requestedAt: liveRun.cancellationRequestedAt,
        completedAt: liveRun.cancellationCompletedAt,
        completed: liveRun.cancellationCompletedAt !== null,
      }),
      usageSummary: liveRun.usageSummary,
      providerSwitches: overrides.providerSwitches ?? existing?.providerSwitches ?? [],
      now: this.now(),
    });
  }

  private appendRuntimeLedgerEvent(
    liveRun: LiveRunState,
    event: Omit<RuntimeLedgerEvent, "sessionId">,
  ): void {
    this.appendRuntimeLedgerEventBySessionId(liveRun.runtimeSessionId, event);
  }

  private appendRuntimeLedgerEventBySessionId(
    runtimeSessionId: string | null,
    event: Omit<RuntimeLedgerEvent, "sessionId">,
  ): void {
    if (!runtimeSessionId || !this.options.runtimeStore) {
      return;
    }
    appendRuntimeLifecycleEvent(this.options.runtimeStore, runtimeSessionId, event);
  }

  private recordRuntimeUserMessage(liveRun: LiveRunState, messageId: string, content: string): void {
    recordRuntimeUserMessage(this.options.runtimeStore, liveRun.runtimeSessionId, {
      messageId,
      content,
      occurredAt: this.now(),
    });
  }

  private createRuntimeCheckpoint(
    liveRun: LiveRunState,
    kind: RuntimeCheckpointPayload["kind"],
    summary: string,
  ): RuntimeCheckpointPayload | null {
    if (!this.options.runtimeStore) {
      return null;
    }
    const contract = this.persistRuntimeSession(liveRun);
    if (!contract) {
      return null;
    }
    const checkpoint = createRuntimeCheckpointFromContract({
      checkpointId: randomUUID(),
      kind,
      createdAt: this.now(),
      summary,
      defaultSummary: "Subagent runtime checkpoint.",
      contract,
    });
    return persistRuntimeCheckpointLifecycle(this.options.runtimeStore, {
      runtimeSessionId: liveRun.runtimeSessionId,
      checkpoint,
      scope: {
        stationId: this.options.stationId ?? null,
        runId: liveRun.runId,
      },
      persistCheckpointRef: (checkpointRef) =>
        this.options.runtimeStore?.persistRuntimeSession({
          runtimeSessionId: liveRun.runtimeSessionId,
          stationId: this.options.stationId ?? null,
          runId: liveRun.runId,
          kind: liveRun.keepAlive ? "background" : "subagent",
          contract: {
            ...contract,
            checkpointRef,
          },
        }) ?? null,
    });
  }

  private buildEnvelope(
    args: SubagentDelegationArgs,
    context: RunContext,
    completedAt: number,
    status: SubagentEnvelope["status"],
    parsed: ParsedSubagentResponse,
  ): SubagentEnvelope {
    return {
      runId: context.runId,
      domain: this.options.domain.id,
      task: args.task,
      status,
      retryCount: context.retryCount,
      startedAt: context.startedAt,
      completedAt,
      durationMs: completedAt - context.startedAt,
      followupNeeded: parsed.followupNeeded,
      summary: parsed.summary,
      artifacts: parsed.artifacts,
      stateChanges: [...context.stateChanges, ...parsed.stateChanges],
      toolCalls: context.toolRecords,
      errors: parsed.errors,
      payload: parsed.payload,
    };
  }
}
