import { randomUUID } from "node:crypto";
import {
  type CanUseTool,
  type Options,
  type PermissionResult,
  type Query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKResultMessage,
  type SDKUserMessage,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import type { Logger } from "pino";
import { ClaudeAgentError } from "../../util/errors.js";
import type {
  ProviderAuthStatus,
  ProviderClient,
  ProviderHostContinuityMessage,
  ProviderHostContinuityState,
  ProviderPermissionRequest,
  ProviderPermissionResult,
  ProviderSession,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderSystemMessage,
  ProviderToolDefinition,
  ProviderUsageSnapshot,
} from "../types.js";
import { buildSpiraSdkMcpServer } from "./mcp-tools.js";

const SPIRA_MCP_SERVER_NAME = "spira-tools";

const silentLogger: Pick<Logger, "info" | "warn"> = {
  info: () => undefined,
  warn: () => undefined,
};

const flattenSystemMessage = (message: ProviderSystemMessage): string => {
  const sections = Object.entries(message.sections ?? {})
    .map(([key, section]) => `${key}:\n${section.content}`)
    .filter((entry) => entry.trim().length > 0);
  return [message.content, ...sections].filter((entry) => entry.trim().length > 0).join("\n\n");
};

const toUsageSnapshot = (result: SDKResultMessage): ProviderUsageSnapshot => {
  const usage = result.usage;
  const inputTokens = typeof usage?.input_tokens === "number" ? usage.input_tokens : null;
  const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : null;
  const totalTokens = inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null;
  const modelEntries = Object.entries(result.modelUsage ?? {});
  const fallbackModel = modelEntries[0]?.[0] ?? null;
  return {
    model: fallbackModel,
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: typeof result.total_cost_usd === "number" ? result.total_cost_usd : null,
    latencyMs: typeof result.duration_ms === "number" ? result.duration_ms : null,
    source: usage ? "provider" : "unknown",
  };
};

type AssistantContentBlock = { type?: string; [key: string]: unknown };

const collectAssistantText = (message: SDKAssistantMessage): string => {
  const blocks = message.message.content as unknown as AssistantContentBlock[] | string | undefined;
  if (typeof blocks === "string") {
    return blocks;
  }
  if (!Array.isArray(blocks)) {
    return "";
  }
  return blocks
    .filter(
      (block): block is AssistantContentBlock & { text: string } =>
        block?.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("");
};

const collectAssistantToolUses = (
  message: SDKAssistantMessage,
): Array<{ id: string; name: string; input: Record<string, unknown> }> => {
  const blocks = message.message.content as unknown as AssistantContentBlock[] | string | undefined;
  if (!Array.isArray(blocks)) {
    return [];
  }
  return blocks
    .filter(
      (block): block is AssistantContentBlock & { id: string; name: string; input?: Record<string, unknown> } =>
        block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string",
    )
    .map((block) => ({ id: block.id, name: block.name, input: block.input ?? {} }));
};

const stripMcpPrefix = (toolName: string): string => {
  const prefix = `mcp__${SPIRA_MCP_SERVER_NAME}__`;
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
};

type TurnContext = {
  emit: (event: ProviderSessionEvent) => void;
  resolve: () => void;
  reject: (error: Error) => void;
  onPermissionRequest?: ProviderSessionConfig["onPermissionRequest"];
  tools: readonly ProviderToolDefinition[];
  abortController: AbortController;
  finished: boolean;
  pendingResultMessageId: string | null;
};

const buildPermissionRequest = (
  tool: ProviderToolDefinition | undefined,
  toolName: string,
  toolUseId: string,
  args: Record<string, unknown>,
): ProviderPermissionRequest => {
  const definition = tool;
  if (!definition) {
    return {
      kind: "custom-tool",
      toolCallId: toolUseId,
      toolName,
      toolTitle: toolName,
      args,
      readOnly: false,
    };
  }
  return {
    kind: "custom-tool",
    toolCallId: toolUseId,
    toolName: definition.name,
    toolTitle: definition.description,
    args,
    readOnly: definition.skipPermission === true,
  };
};

const toSdkPermissionResult = (result: ProviderPermissionResult, args: Record<string, unknown>): PermissionResult => {
  switch (result.kind) {
    case "approve-once":
      return { behavior: "allow", updatedInput: args };
    case "reject":
      return {
        behavior: "deny",
        message: result.feedback?.trim() || "Permission denied by Spira.",
      };
    case "user-not-available":
      return {
        behavior: "deny",
        message: "User is not available to approve this tool right now.",
      };
  }
};

const buildCanUseTool =
  (tools: readonly ProviderToolDefinition[], context: TurnContext): CanUseTool =>
  async (toolName, input) => {
    const baseName = stripMcpPrefix(toolName);
    const definition = tools.find((entry) => entry.name === baseName);
    const args = (input ?? {}) as Record<string, unknown>;

    if (definition?.skipPermission) {
      return { behavior: "allow", updatedInput: args };
    }

    if (!context.onPermissionRequest) {
      return { behavior: "allow", updatedInput: args };
    }

    const request = buildPermissionRequest(definition, baseName, randomUUID(), args);
    const decision = await context.onPermissionRequest(request);
    return toSdkPermissionResult(decision, args);
  };

class ClaudeAgentProviderSession implements ProviderSession {
  private activeQuery: Query | null = null;
  private disconnected = false;
  private readonly hostMessages: ProviderHostContinuityMessage[] = [];
  private hasInitiatedSdkSession: boolean;
  /**
   * Tracks the last model the SDK reported for an assistant turn. We compare against
   * `currentModel` to detect the post-compaction "stuck on Haiku" SDK bug — after a
   * compact_boundary event the SDK can silently keep using the compactor model
   * instead of the configured one. When we detect drift we re-pin via setModel.
   */
  private lastReportedModel: string | null = null;

  constructor(
    public readonly sessionId: string,
    private readonly config: ProviderSessionConfig,
    private readonly logger: Pick<Logger, "info" | "warn">,
    private currentModel: string | null,
  ) {
    if (config.hostContinuity?.providerId === "claude-agent") {
      this.hostMessages.push(...config.hostContinuity.messages);
      this.hasInitiatedSdkSession = config.hostContinuity.messages.length > 0;
    } else {
      this.hostMessages.push({ role: "system", content: flattenSystemMessage(config.systemMessage) });
      this.hasInitiatedSdkSession = false;
    }
  }

  async send(payload: { prompt: string }): Promise<void> {
    if (this.disconnected) {
      throw new ClaudeAgentError("Session not found: disconnected");
    }

    const startedAt = Date.now();
    this.hostMessages.push({ role: "user", content: payload.prompt });
    this.publishHostContinuity();

    this.logger.info(
      {
        providerId: "claude-agent",
        sessionId: this.sessionId,
        model: this.currentModel ?? null,
        promptLength: payload.prompt.length,
      },
      "Dispatching prompt through provider",
    );

    await new Promise<void>((resolvePromise, rejectPromise) => {
      const abortController = new AbortController();
      const context: TurnContext = {
        emit: (event) => {
          if (this.disconnected || abortController.signal.aborted) {
            return;
          }
          this.config.onEvent?.(event);
        },
        resolve: () => {
          if (context.finished) return;
          context.finished = true;
          resolvePromise();
        },
        reject: (error) => {
          if (context.finished) return;
          context.finished = true;
          rejectPromise(error);
        },
        onPermissionRequest: this.config.onPermissionRequest,
        tools: this.config.tools,
        abortController,
        finished: false,
        pendingResultMessageId: null,
      };

      const sdkOptions: Options = {
        cwd: this.config.workingDirectory,
        ...(this.currentModel ? { model: this.currentModel } : {}),
        systemPrompt: flattenSystemMessage(this.config.systemMessage),
        tools: [],
        mcpServers: {
          [SPIRA_MCP_SERVER_NAME]: buildSpiraSdkMcpServer(SPIRA_MCP_SERVER_NAME, this.config.tools),
        },
        canUseTool: buildCanUseTool(this.config.tools, context),
        ...(this.hasInitiatedSdkSession ? { resume: this.sessionId } : { sessionId: this.sessionId }),
        permissionMode: "default",
        includePartialMessages: this.config.streaming === true,
        abortController,
      };
      this.hasInitiatedSdkSession = true;

      const sdkPrompt: AsyncIterable<SDKUserMessage> = (async function* () {
        yield {
          type: "user",
          message: { role: "user", content: payload.prompt },
          parent_tool_use_id: null,
        };
      })();

      let runningQuery: Query;
      try {
        runningQuery = query({ prompt: sdkPrompt, options: sdkOptions });
      } catch (error) {
        context.reject(this.toClaudeAgentError(error));
        return;
      }

      this.activeQuery = runningQuery;
      void this.consumeQuery(runningQuery, context, startedAt);
    });
  }

  private async consumeQuery(runningQuery: Query, context: TurnContext, startedAt: number): Promise<void> {
    try {
      for await (const message of runningQuery) {
        if (this.disconnected || context.abortController.signal.aborted) {
          break;
        }
        this.handleSdkMessage(message, context, startedAt);
        if (context.finished) {
          break;
        }
      }
      if (!context.finished) {
        context.resolve();
      }
    } catch (error) {
      this.logger.warn({ error, providerId: "claude-agent", sessionId: this.sessionId }, "Claude Agent turn failed");
      context.reject(this.toClaudeAgentError(error));
    } finally {
      if (this.activeQuery === runningQuery) {
        this.activeQuery = null;
      }
    }
  }

  private handleSdkMessage(message: SDKMessage, context: TurnContext, startedAt: number): void {
    switch (message.type) {
      case "assistant": {
        const assistant = message;
        // SDK bug workaround: track the per-turn model the SDK reports and re-pin if it
        // drifted away from `currentModel`. This catches cases where compact_boundary
        // either wasn't fired or fired before our setModel could land.
        const reportedModel = (assistant.message as { model?: string } | undefined)?.model ?? null;
        if (reportedModel) {
          this.lastReportedModel = reportedModel;
          if (this.currentModel && reportedModel !== this.currentModel) {
            this.repinModelIfDrifted("assistant-drift", reportedModel);
          }
        }
        const text = collectAssistantText(assistant);
        const toolUses = collectAssistantToolUses(assistant);
        const messageId = assistant.uuid;

        if (text.trim()) {
          context.emit({
            type: "assistant.message_delta",
            data: { messageId, deltaContent: text },
          });
          context.emit({
            type: "assistant.message",
            data: { messageId, content: text },
          });
        }

        if (toolUses.length > 0) {
          this.hostMessages.push({
            role: "assistant",
            content: text || null,
            toolCalls: toolUses.map((entry) => ({
              id: entry.id,
              name: stripMcpPrefix(entry.name),
              arguments: JSON.stringify(entry.input ?? {}),
            })),
          });
          for (const toolUse of toolUses) {
            context.emit({
              type: "tool.execution_start",
              data: {
                toolCallId: toolUse.id,
                toolName: stripMcpPrefix(toolUse.name),
                arguments: toolUse.input,
              },
            });
          }
        } else if (text.trim()) {
          this.hostMessages.push({ role: "assistant", content: text });
        }
        this.publishHostContinuity();
        return;
      }
      case "user": {
        if (!("isReplay" in message)) {
          const blocks = (message.message?.content ?? []) as Array<{
            type?: string;
            tool_use_id?: string;
            content?: unknown;
            is_error?: boolean;
          }>;
          for (const block of blocks) {
            if (block?.type === "tool_result" && typeof block.tool_use_id === "string") {
              const textResult = Array.isArray(block.content)
                ? (block.content as Array<{ type?: string; text?: string }>)
                    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
                    .map((entry) => entry.text ?? "")
                    .join("")
                : typeof block.content === "string"
                  ? block.content
                  : "";
              context.emit({
                type: "tool.execution_complete",
                data: {
                  toolCallId: block.tool_use_id,
                  success: !block.is_error,
                  result: textResult,
                  ...(block.is_error
                    ? { error: { message: typeof textResult === "string" ? textResult : "Tool failed" } }
                    : {}),
                },
              });
              this.hostMessages.push({
                role: "tool",
                toolCallId: block.tool_use_id,
                content: textResult,
              });
            }
          }
          this.publishHostContinuity();
        }
        return;
      }
      case "result": {
        const result = message;
        const usage = toUsageSnapshot(result);
        const elapsed = Math.max(0, Date.now() - startedAt);
        const finalUsage: ProviderUsageSnapshot = {
          ...usage,
          latencyMs: usage.latencyMs ?? elapsed,
        };
        context.emit({ type: "assistant.usage", data: finalUsage });
        if (result.subtype === "success") {
          if (result.result?.trim()) {
            this.hostMessages.push({ role: "assistant", content: result.result });
            this.publishHostContinuity();
          }
          context.emit({ type: "session.idle", data: { usage: finalUsage } });
          context.resolve();
        } else {
          const message = result.errors?.[0] ?? `Claude Agent turn failed (${result.subtype}).`;
          context.emit({
            type: "session.error",
            data: { message, errorType: result.subtype },
          });
          context.reject(new ClaudeAgentError(message));
        }
        return;
      }
      case "system": {
        if (message.subtype === "init") {
          this.logger.info(
            {
              providerId: "claude-agent",
              sessionId: this.sessionId,
              model: message.model,
              apiKeySource: message.apiKeySource,
            },
            "Claude Agent session initialized",
          );
        } else if (message.subtype === "compact_boundary") {
          // SDK bug workaround: after auto-compaction the SDK can silently keep using
          // the compactor model (Haiku) for subsequent turns instead of the configured
          // main model. Re-pin the model immediately so the resumed turn lands on Opus
          // again. The setModel call only takes effect while a query is active, so we
          // also defensively re-check on the next assistant message (see below).
          const meta = (message as { compact_metadata?: { trigger?: string; pre_tokens?: number; post_tokens?: number } })
            .compact_metadata;
          this.logger.info(
            {
              providerId: "claude-agent",
              sessionId: this.sessionId,
              configuredModel: this.currentModel,
              trigger: meta?.trigger ?? null,
              preTokens: meta?.pre_tokens ?? null,
              postTokens: meta?.post_tokens ?? null,
            },
            "Claude Agent session compacted; re-pinning configured model",
          );
          this.repinModelIfDrifted("compact_boundary");
        }
        return;
      }
      default:
        return;
    }
  }

  private toClaudeAgentError(error: unknown): ClaudeAgentError {
    if (error instanceof ClaudeAgentError) {
      return error;
    }
    if (error instanceof Error) {
      return new ClaudeAgentError(error.message, error);
    }
    return new ClaudeAgentError(String(error));
  }

  private publishHostContinuity(): void {
    const snapshot: ProviderHostContinuityState = {
      providerId: "claude-agent",
      model: this.currentModel,
      messages: this.hostMessages.map((entry) => entry),
      updatedAt: Date.now(),
    };
    this.config.onHostContinuitySnapshot?.(snapshot);
  }

  setModel(model: string): Promise<void> {
    const trimmed = model.trim();
    if (!trimmed) {
      return Promise.reject(new ClaudeAgentError("Claude Agent requires a non-empty model."));
    }
    this.currentModel = trimmed;
    this.publishHostContinuity();
    return this.activeQuery ? this.activeQuery.setModel(trimmed) : Promise.resolve();
  }

  /**
   * Re-pins the configured model on the active SDK query when we detect drift.
   * Used to work around the Claude Agent SDK bug where a compact_boundary event
   * leaves the session running on the compactor model (Haiku) for subsequent
   * turns instead of returning to the configured main model.
   *
   * Best-effort; if there's no active query or the SDK rejects the call, we log
   * and move on — the next turn will retry via the same drift detection.
   */
  private repinModelIfDrifted(reason: "compact_boundary" | "assistant-drift", reportedModel?: string): void {
    if (!this.currentModel) {
      return;
    }
    if (!this.activeQuery) {
      return;
    }
    this.logger.warn(
      {
        providerId: "claude-agent",
        sessionId: this.sessionId,
        reason,
        configuredModel: this.currentModel,
        reportedModel: reportedModel ?? this.lastReportedModel,
      },
      "Re-pinning Claude Agent model after detected drift",
    );
    void this.activeQuery.setModel(this.currentModel).catch((error) => {
      this.logger.warn(
        {
          providerId: "claude-agent",
          sessionId: this.sessionId,
          reason,
          err: error,
        },
        "Failed to re-pin Claude Agent model; the next turn will retry",
      );
    });
  }

  async abort(): Promise<void> {
    const active = this.activeQuery;
    if (active) {
      try {
        await active.interrupt();
      } catch (error) {
        this.logger.warn({ error }, "Claude Agent interrupt failed; closing query");
        active.close();
      }
    }
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    const active = this.activeQuery;
    this.activeQuery = null;
    if (active) {
      try {
        await active.interrupt();
      } catch {
        // best effort
      }
      active.close();
    }
  }
}

export class ClaudeAgentProviderClient implements ProviderClient {
  readonly providerId = "claude-agent" as const;
  readonly capabilities = {
    persistentSessions: true,
    abortableTurns: true,
    sessionResumption: "provider-managed",
    turnCancellation: "provider-abort",
    responseStreaming: "native",
    usageReporting: "full",
    toolManifestMode: "projected",
    modelSelection: "session-scoped",
    toolCalling: "native",
  } as const;

  private readonly sessions = new Map<string, ClaudeAgentProviderSession>();

  constructor(
    private readonly defaultModel: string | null,
    private readonly logger: Pick<Logger, "info" | "warn"> = silentLogger,
  ) {}

  createSession(config: ProviderSessionConfig & { sessionId: string }): Promise<ProviderSession> {
    const session = new ClaudeAgentProviderSession(
      config.sessionId,
      config,
      this.logger,
      config.model ?? this.defaultModel ?? null,
    );
    this.sessions.set(config.sessionId, session);
    return Promise.resolve(session);
  }

  resumeSession(sessionId: string, config: ProviderSessionConfig): Promise<ProviderSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return Promise.resolve(existing);
    }
    const session = new ClaudeAgentProviderSession(
      sessionId,
      config,
      this.logger,
      config.model ?? config.hostContinuity?.model ?? this.defaultModel ?? null,
    );
    this.sessions.set(sessionId, session);
    return Promise.resolve(session);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ClaudeAgentError(`Session not found: ${sessionId}`);
    }
    await session.disconnect();
    this.sessions.delete(sessionId);
  }

  getAuthStatus(): Promise<ProviderAuthStatus> {
    return Promise.resolve({ isAuthenticated: true, authType: "subscription" });
  }

  async stop(): Promise<unknown[]> {
    const errors: unknown[] = [];
    for (const session of this.sessions.values()) {
      try {
        await session.disconnect();
      } catch (error) {
        errors.push(error);
      }
    }
    this.sessions.clear();
    return errors;
  }
}
