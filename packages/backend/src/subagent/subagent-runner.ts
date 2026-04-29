import { randomUUID } from "node:crypto";
import { SUBAGENT_SCOPE_IDS } from "@spira/shared";
import type {
  Env,
  McpTool,
  NormalizedStateChange,
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
import { approvePermissionOnce, permissionUserNotAvailable } from "../copilot/permission-decisions.js";
import { StreamAssembler } from "../copilot/stream-handler.js";
import { getCopilotTools } from "../copilot/tool-bridge.js";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { createFreshProviderSession, createProviderClient, stopProviderClient, withTimeout } from "../provider/client-factory.js";
import {
  normalizeProviderUsageSnapshot,
  shouldPersistProviderSession,
  shouldRequestNativeStreaming,
} from "../provider/capability-fallback.js";
import { getConfiguredProviderId, getProviderLabel } from "../provider/provider-config.js";
import type {
  ProviderClient,
  ProviderPermissionRequest,
  ProviderPermissionResult,
  ProviderSession,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderUsageRecord,
  ProviderUsageSnapshot,
} from "../provider/types.js";
import { appRootDir } from "../util/app-paths.js";
import { CopilotError, formatErrorDetails } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import { setUnrefTimeout } from "../util/timers.js";
import { SubagentLockManager } from "./lock-manager.js";

const logger = createLogger("subagent-runner");

const SESSION_INIT_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 20_000;
const COMPLETION_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 500;
const WRITE_LOCK_TTL_MS = 30_000;

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
}

interface LiveRunState {
  runId: string;
  roomId: `agent:${string}`;
  startedAt: number;
  writesAllowed: boolean;
  keepAlive: boolean;
  toolLookup: Map<string, McpTool>;
  client: ProviderClient | null;
  session: ProviderSession | null;
  ownsClient: boolean;
  providerSessionId: string | null;
  recoveryPrompt: string | null;
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
  now?: () => number;
  runIdFactory?: () => string;
  sessionIdFactory?: () => `${string}-${string}-${string}-${string}-${string}`;
  retryDelayMs?: number;
  onPermissionRequest?: (
    request: ProviderPermissionRequest,
    context: { runId: string; domain: SubagentDomain },
  ) => Promise<ProviderPermissionResult>;
  lockManager?: SubagentLockManager;
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

const buildRecoveredPrompt = (snapshot: SubagentRunSnapshot): string => {
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

  constructor(private readonly options: SubagentRunnerOptions) {
    this.now = options.now ?? Date.now;
    this.runIdFactory = options.runIdFactory ?? randomUUID;
    this.sessionIdFactory = options.sessionIdFactory ?? randomUUID;
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    this.lockManager = options.lockManager ?? new SubagentLockManager({ now: this.now });
  }

  private get configuredProviderId() {
    return getConfiguredProviderId(this.options.env);
  }

  private get providerLabel(): string {
    return getProviderLabel(this.configuredProviderId);
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
    const scopedMcpTools = this.options.toolAggregator.getToolsForServerIds(this.options.domain.serverIds);
    const liveRun: LiveRunState = {
      runId,
      roomId,
      startedAt,
      writesAllowed,
      keepAlive: args.mode === "background",
      toolLookup: getToolLookup(scopedMcpTools),
      client: null,
      session: null,
      ownsClient: !this.options.getClient,
      providerSessionId: null,
      recoveryPrompt: null,
      activeTurnPromise: null,
      currentContext: null,
      closed: false,
    };
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

    const scopedMcpTools = this.options.toolAggregator.getToolsForServerIds(this.options.domain.serverIds);
    const writesAllowed = this.options.domain.allowWrites && snapshot.allowWrites === true;
    const liveRun: LiveRunState = {
      runId: snapshot.runId,
      roomId: snapshot.roomId,
      startedAt: snapshot.startedAt,
      writesAllowed,
      keepAlive: true,
      toolLookup: getToolLookup(scopedMcpTools),
      client: null,
      session: null,
      ownsClient: !this.options.getClient,
      providerSessionId: snapshot.providerSessionId ?? null,
      recoveryPrompt: buildRecoveredPrompt(snapshot),
      activeTurnPromise: null,
      currentContext: null,
      closed: false,
    };

    return {
      write: (input) =>
        this.writeToLiveRun(
          liveRun,
          {
            task: snapshot.task,
            mode: "background",
            ...(writesAllowed ? { allowWrites: true } : {}),
          },
          input,
        ),
      stop: () => this.stopLiveRun(liveRun),
    };
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
      };
    liveRun.currentContext = context;
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
        if (!liveRun.session) {
          throw new CopilotError("Subagent session is unavailable");
        }

        await withTimeout(liveRun.session.send({ prompt }), SEND_TIMEOUT_MS, "Timed out while sending a subagent task");
        const assistantText = await withTimeout(
          context.completionPromise,
          COMPLETION_TIMEOUT_MS,
          "Timed out while waiting for the subagent response",
        );

        const parsed = parseSubagentResponse(assistantText, this.options.domain.id);
        const completedAt = this.now();
        this.emitProviderUsage(this.buildUsageRecord(liveRun, context, completedAt));
        const envelope = this.buildEnvelope(args, context, completedAt, "completed", parsed);
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
        const willRetry = allowRetry && retryCount < 1;
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
          return this.startTurn(liveRun, args, prompt, retryCount + 1, allowRetry, true);
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

    const prompt = liveRun.recoveryPrompt ? `${liveRun.recoveryPrompt}\n\nFollow-up request:\n${input}` : input;
    liveRun.recoveryPrompt = null;
    return this.startTurn(liveRun, args, prompt, 0, false, false);
  }

  private async stopLiveRun(liveRun: LiveRunState): Promise<void> {
    liveRun.closed = true;
    await this.cleanupLiveSession(liveRun);
  }

  private async ensureLiveSession(liveRun: LiveRunState, _context: RunContext): Promise<void> {
    if (liveRun.session) {
      return;
    }

    liveRun.client = this.options.getClient
      ? await this.options.getClient()
      : (await createProviderClient(this.options.env, logger)).client;
    const sessionConfig = this.getSessionConfig(liveRun, liveRun.writesAllowed, liveRun.toolLookup);
    const createSession = () => createFreshProviderSession(liveRun.client!, sessionConfig, this.sessionIdFactory());

    try {
      liveRun.session = await withTimeout(
        shouldPersistProviderSession(liveRun.client.capabilities) && liveRun.providerSessionId
          ? liveRun.client.resumeSession(liveRun.providerSessionId, sessionConfig)
          : createSession(),
        SESSION_INIT_TIMEOUT_MS,
        `Timed out while connecting a subagent to ${this.providerLabel}`,
      );
    } catch (error) {
      if (!liveRun.providerSessionId || !isMissingSessionError(error)) {
        throw error;
      }

      liveRun.providerSessionId = null;
      liveRun.session = await withTimeout(
        createSession(),
        SESSION_INIT_TIMEOUT_MS,
        `Timed out while reconnecting a subagent to ${this.providerLabel}`,
      );
    }
    liveRun.providerSessionId = shouldPersistProviderSession(liveRun.client.capabilities) ? liveRun.session.sessionId : null;
    this.options.bus.emit("subagent:runtime-sync", {
      runId: liveRun.runId,
      roomId: liveRun.roomId,
      allowWrites: liveRun.writesAllowed,
      providerSessionId: liveRun.providerSessionId,
    });
  }

  private async cleanupLiveSession(liveRun: LiveRunState): Promise<void> {
    try {
      const session = liveRun.session;
      const client = liveRun.client;
      liveRun.session = null;
      liveRun.client = null;

      if (session) {
        await session.disconnect().catch((disconnectError) => {
          logger.warn(
            { error: disconnectError, runId: liveRun.runId, roomId: liveRun.roomId },
            "Failed to disconnect subagent session cleanly",
          );
        });
      }
      if (liveRun.ownsClient && client) {
        await stopProviderClient(client, logger).catch((stopError) => {
          logger.warn(
            { error: stopError, runId: liveRun.runId, roomId: liveRun.roomId },
            "Failed to stop subagent client cleanly",
          );
        });
      }
    } catch (error) {
      logger.warn({ error, runId: liveRun.runId, roomId: liveRun.roomId }, "Failed to clean up subagent live session");
    }
  }

  private getSessionConfig(
    liveRun: LiveRunState,
    writesAllowed: boolean,
    toolLookup: Map<string, McpTool>,
  ): Omit<ProviderSessionConfig, "sessionId"> {
    return {
      clientName: "Spira",
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
          ? this.handlePermissionRequest(liveRun.currentContext, request)
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
        },
      },
      workingDirectory: this.options.workingDirectory ?? appRootDir,
      tools: getCopilotTools(this.options.toolAggregator, {
        includeServerIds: this.options.domain.serverIds,
        wrapToolExecution: (tool, toolArgs, execute) => {
          if (!liveRun.currentContext) {
            throw new CopilotError("Delegated subagent run is not ready to execute tools");
          }
          return this.executeToolWithPolicy(liveRun.currentContext, tool, toolArgs, execute, writesAllowed);
        },
      }),
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
    switch (event.type) {
      case "assistant.message_delta":
        context.streamAssembler.append(event.data.messageId, event.data.deltaContent);
        this.options.bus.emit("subagent:delta", {
          runId: context.runId,
          roomId: context.roomId,
          messageId: event.data.messageId,
          delta: event.data.deltaContent,
        } satisfies SubagentDeltaEvent);
        return;

      case "assistant.message": {
        context.latestAssistantText =
          event.data.content || context.streamAssembler.finalize(event.data.messageId) || "";
        this.resolveCompletionIfReady(context);
        return;
      }

      case "tool.execution_start": {
        const startedAt = this.now();
        const tool = toolLookup.get(event.data.toolName);
        context.activeToolCalls.set(event.data.toolCallId, {
          toolName: event.data.toolName,
          serverId: tool?.serverId,
          args: event.data.arguments ?? {},
          startedAt,
        });
        this.options.bus.emit("subagent:tool-call", {
          runId: context.runId,
          roomId: context.roomId,
          callId: event.data.toolCallId,
          toolName: event.data.toolName,
          serverId: tool?.serverId,
          args: event.data.arguments ?? {},
          startedAt,
        });
        return;
      }

      case "tool.execution_complete": {
        const completedAt = this.now();
        const activeToolCall = context.activeToolCalls.get(event.data.toolCallId);
        const toolRecord: SubagentToolCallRecord = {
          callId: event.data.toolCallId,
          toolName: activeToolCall?.toolName ?? "unknown",
          ...(activeToolCall?.serverId ? { serverId: activeToolCall.serverId } : {}),
          ...(activeToolCall?.args ? { args: activeToolCall.args } : {}),
          ...(event.data.result !== undefined ? { result: event.data.result } : {}),
          status: event.data.success === false || event.data.error ? "error" : "success",
          startedAt: activeToolCall?.startedAt ?? completedAt,
          completedAt,
          durationMs: completedAt - (activeToolCall?.startedAt ?? completedAt),
          ...(event.data.error?.message ? { details: event.data.error.message } : {}),
        };
        context.toolRecords.push(toolRecord);
        context.activeToolCalls.delete(event.data.toolCallId);
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
          completedAt,
          durationMs: toolRecord.durationMs ?? 0,
        });
        this.resolveCompletionIfReady(context);
        return;
      }

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

      case "session.idle":
        context.idleObserved = true;
        context.latestUsage = liveRun.client
          ? normalizeProviderUsageSnapshot(liveRun.client.capabilities, event.data.usage ?? context.latestUsage)
          : event.data.usage;
        this.resolveCompletionIfReady(context);
        return;

      case "assistant.usage":
        context.latestUsage = liveRun.client
          ? normalizeProviderUsageSnapshot(liveRun.client.capabilities, event.data)
          : event.data;
        return;

      default:
        return;
    }
  }

  private resolveCompletionIfReady(context: RunContext): void {
    if (context.completionSettled || !context.idleObserved || context.activeToolCalls.size > 0) {
      return;
    }

    const latestAssistantText = context.latestAssistantText;
    if (latestAssistantText === undefined) {
      return;
    }

    context.completionSettled = true;
    context.resolveCompletion(latestAssistantText);
  }

  private flushActiveToolCallsAsErrors(context: RunContext, message: string): void {
    const completedAt = this.now();
    for (const [callId, activeToolCall] of context.activeToolCalls.entries()) {
      const toolRecord: SubagentToolCallRecord = {
        callId,
        toolName: activeToolCall.toolName,
        ...(activeToolCall.serverId ? { serverId: activeToolCall.serverId } : {}),
        ...(activeToolCall.args ? { args: activeToolCall.args } : {}),
        status: "error",
        startedAt: activeToolCall.startedAt,
        completedAt,
        durationMs: completedAt - activeToolCall.startedAt,
        details: message,
      };
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
    context.activeToolCalls.clear();
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
    context: RunContext,
    request: ProviderPermissionRequest,
  ): Promise<ProviderPermissionResult> {
    if (this.options.onPermissionRequest) {
      return this.options.onPermissionRequest(request, { runId: context.runId, domain: this.options.domain });
    }

    const toolName = getPermissionToolName(request);
    if (request.kind === "mcp" && toolName !== null && toolName.startsWith("vision_")) {
      return Promise.resolve(permissionUserNotAvailable());
    }

    return Promise.resolve(approvePermissionOnce());
  }

  private emitProviderUsage(record: ProviderUsageRecord): void {
    this.options.bus.emit("provider:usage", record);
    logger.info({ usage: record, runId: record.runId }, "Provider usage observed for subagent run");
  }

  private buildUsageRecord(liveRun: LiveRunState, context: RunContext, observedAt: number): ProviderUsageRecord {
    return {
      provider: liveRun.client?.providerId ?? this.configuredProviderId,
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
