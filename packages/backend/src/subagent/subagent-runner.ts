import { randomUUID } from "node:crypto";
import type {
  CopilotClient,
  CopilotSession,
  PermissionRequest,
  PermissionRequestResult,
  SessionConfig,
  SessionEvent,
} from "@github/copilot-sdk";
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
  SubagentScopeId,
  SubagentToolCallRecord,
} from "@spira/shared";
import {
  createCopilotClient,
  createFreshCopilotSession,
  stopCopilotClient,
  withTimeout,
} from "../copilot/session-factory.js";
import { StreamAssembler } from "../copilot/stream-handler.js";
import { getCopilotTools } from "../copilot/tool-bridge.js";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
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
}

interface LiveRunState {
  runId: string;
  roomId: `agent:${string}`;
  startedAt: number;
  writesAllowed: boolean;
  keepAlive: boolean;
  toolLookup: Map<string, McpTool>;
  client: CopilotClient | null;
  session: CopilotSession | null;
  ownsClient: boolean;
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
  toolAggregator: McpToolAggregator;
  domain: SubagentDomain;
  getClient?: () => Promise<CopilotClient>;
  now?: () => number;
  runIdFactory?: () => string;
  sessionIdFactory?: () => `${string}-${string}-${string}-${string}-${string}`;
  retryDelayMs?: number;
  onPermissionRequest?: (
    request: PermissionRequest,
    context: { runId: string; domain: SubagentDomain },
  ) => Promise<PermissionRequestResult>;
  lockManager?: SubagentLockManager;
}

export interface SubagentRunLaunch {
  runId: string;
  roomId: `agent:${string}`;
  startedAt: number;
  resultPromise: Promise<SubagentEnvelope>;
  write: (input: string) => Promise<SubagentEnvelope>;
  stop: () => Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

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
      activeTurnPromise: null,
      currentContext: null,
      closed: false,
    };
    const resultPromise = this.startTurn(liveRun, args, this.buildPrompt(args), 0, true, true);
    return {
      runId,
      roomId,
      startedAt,
      resultPromise,
      write: (input) => this.writeToLiveRun(liveRun, args, input),
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
    if (!liveRun.keepAlive || !liveRun.session) {
      throw new CopilotError("Delegated subagent run cannot accept follow-up input");
    }

    return this.startTurn(liveRun, args, input, 0, false, false);
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
      : (await createCopilotClient(this.options.env, logger)).client;

    liveRun.session = await withTimeout(
      createFreshCopilotSession(
        liveRun.client,
        this.getSessionConfig(liveRun, liveRun.writesAllowed, liveRun.toolLookup),
        this.sessionIdFactory(),
      ),
      SESSION_INIT_TIMEOUT_MS,
      "Timed out while connecting a subagent to GitHub Copilot",
    );
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
        await stopCopilotClient(client, logger).catch((stopError) => {
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
  ): Omit<SessionConfig, "sessionId"> {
    return {
      clientName: "Spira",
      infiniteSessions: {
        enabled: true,
      },
      onEvent: (event) => {
        if (liveRun.currentContext) {
          this.handleSessionEvent(liveRun.currentContext, toolLookup, event);
        }
      },
      onPermissionRequest: (request) =>
        liveRun.currentContext
          ? this.handlePermissionRequest(liveRun.currentContext, request)
          : Promise.resolve({ kind: "approved" }),
      streaming: true,
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
      workingDirectory: appRootDir,
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

  private handleSessionEvent(context: RunContext, toolLookup: Map<string, McpTool>, event: SessionEvent): void {
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
        this.resolveCompletionIfReady(context);
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
    if (tool.annotations?.readOnlyHint === true) {
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

  private handlePermissionRequest(context: RunContext, request: PermissionRequest): Promise<PermissionRequestResult> {
    if (this.options.onPermissionRequest) {
      return this.options.onPermissionRequest(request, { runId: context.runId, domain: this.options.domain });
    }

    if (request.kind === "mcp" && typeof request.toolName === "string" && request.toolName.startsWith("vision_")) {
      return Promise.resolve({ kind: "denied-no-approval-rule-and-could-not-request-from-user" });
    }

    return Promise.resolve({ kind: "approved" });
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
