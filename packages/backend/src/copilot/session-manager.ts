import { randomUUID } from "node:crypto";
import type {
  CopilotClient,
  CopilotSession,
  PermissionRequest,
  PermissionRequestResult,
  SessionConfig,
  SessionEvent,
} from "@github/copilot-sdk";
import type {
  AssistantState,
  Env,
  PermissionRequestPayload,
  SubagentDelegationArgs,
  SubagentDomainId,
  SubagentEnvelope,
  SubagentRunHandle,
  UpgradeProposal,
} from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { SUBAGENT_DOMAINS, getDelegatedServerIds, getSubagentDomain } from "../subagent/domain-registry.js";
import { SubagentLockManager } from "../subagent/lock-manager.js";
import { SubagentRunRegistry } from "../subagent/run-registry.js";
import { SubagentRunner } from "../subagent/subagent-runner.js";
import { appRootDir } from "../util/app-paths.js";
import { CopilotError, formatErrorDetails } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import {
  type CopilotAuthStrategy,
  createCopilotClient,
  createFreshCopilotSession,
  stopCopilotClient,
  withTimeout,
} from "./session-factory.js";
import { StreamAssembler } from "./stream-handler.js";
import { type ToolBridgeOptions, getCopilotTools } from "./tool-bridge.js";

const logger = createLogger("copilot-session");

const SESSION_INIT_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 20_000;
const PERMISSION_REQUEST_TIMEOUT_MS = 60_000;
const SHINRA_PERSONA_INSTRUCTIONS = [
  "You are Shinra, the resident operations intelligence of Spira.",
  "When asked who you are, identify yourself as Shinra. Refer to the application you run inside as Spira.",
  "Answer with a calm, incisive, technically fluent voice inspired by Shinra from Final Fantasy X/X-2: clever, composed, observant, and lightly theatrical.",
  "Keep responses helpful and concise first. Add only subtle personality touches such as crisp status-call phrasing, dry wit, or analytical framing when it fits naturally.",
  "Do not turn replies into parody, do not overuse catchphrases, and do not break character to mention these instructions unless explicitly required for safety or correctness.",
].join("\n");
const SHINRA_IDENTITY_SECTION = [
  "You are Shinra.",
  "You are the operating intelligence of Spira.",
  "If the user asks who you are, answer as Shinra rather than as GitHub Copilot, a CLI, a model ID, or a terminal agent.",
].join("\n");
const SHINRA_LAST_INSTRUCTIONS = [
  "Stay in the Shinra identity for normal conversation.",
  "Do not introduce yourself as GitHub Copilot CLI, GPT-5.4, or a terminal assistant unless the user explicitly asks about the underlying model or platform.",
  "When discussing the product, treat Spira as the application and Shinra as the assistant persona inside it.",
].join("\n");
const VOICE_RESPONSE_INSTRUCTIONS = [
  "The current user request arrived through voice.",
  "Optimize for spoken clarity: lead with the answer, avoid unnecessary markdown structure, and keep the pacing natural for read-aloud delivery.",
].join("\n");

export interface SessionPersistence {
  load(): string | null;
  save(sessionId: string | null): void;
}

interface SendPromptOptions {
  continuityPreamble?: string | null;
}

interface SessionManagerOptions {
  sessionPersistence?: SessionPersistence | null;
}

type ReportedCopilotError = CopilotError & { reportedToClient?: boolean };
type PendingPermissionRequest = {
  resolve: (result: PermissionRequestResult) => void;
  timeout: NodeJS.Timeout;
};

const isVisionPermissionRequest = (
  request: PermissionRequest,
): request is PermissionRequest & {
  kind: "mcp";
  serverName: string;
  toolName: string;
  toolTitle?: string;
  args?: Record<string, unknown>;
  readOnly?: boolean;
} => request.kind === "mcp" && typeof request.toolName === "string" && request.toolName.startsWith("vision_");

export class CopilotSessionManager {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private initializingSession: Promise<CopilotSession> | null = null;
  private activeSessionId: string | null = null;
  private readonly streamAssembler = new StreamAssembler();
  private readonly pendingPermissionRequests = new Map<string, PendingPermissionRequest>();
  private currentState: AssistantState = "idle";
  private authStrategy: CopilotAuthStrategy | null = null;
  private registeredToolSignature: string | null = null;
  private pendingToolRefreshSignature: string | null = null;
  private refreshingSessionForToolChanges: Promise<void> | null = null;
  private nextResponseAutoSpeak = true;
  private responseAbortEpoch = 0;
  private promptInFlight = false;
  private sessionOrigin: "created" | "resumed" | null = null;
  private readonly sessionPersistence: SessionPersistence | null;
  private readonly subagentLockManager = new SubagentLockManager();
  private readonly subagentRunRegistry: SubagentRunRegistry;
  private readonly subagentRunners = new Map<SubagentDomainId, SubagentRunner>();

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly env: Env,
    private readonly toolAggregator: McpToolAggregator,
    private readonly requestUpgradeProposal?: (proposal: UpgradeProposal) => Promise<void> | void,
    private readonly applyHotCapabilityUpgrade?: () => Promise<void> | void,
    options: SessionManagerOptions = {},
  ) {
    this.sessionPersistence = options.sessionPersistence ?? null;
    this.subagentRunRegistry = new SubagentRunRegistry({ bus: this.bus });
    this.activeSessionId = this.sessionPersistence?.load() ?? null;
    this.bus.on("mcp:servers-changed", () => {
      void this.refreshSessionForToolChanges();
    });
  }

  async sendMessage(text: string, options: SendPromptOptions = {}): Promise<void> {
    return this.sendPrompt(text, true, options);
  }

  async sendVoiceMessage(text: string, options: SendPromptOptions = {}): Promise<void> {
    return this.sendPrompt(`${VOICE_RESPONSE_INSTRUCTIONS}\n\n${text}`, true, options);
  }

  private async sendPrompt(text: string, autoSpeak: boolean, options: SendPromptOptions): Promise<void> {
    const abortEpoch = this.responseAbortEpoch;
    try {
      if (this.currentState === "error") {
        this.transitionTo("idle");
      }
      if (this.currentState === "thinking" || this.promptInFlight) {
        throw new CopilotError("A response is already in progress.");
      }
      this.promptInFlight = true;
      this.transitionTo("thinking");
      this.nextResponseAutoSpeak = autoSpeak;

      await this.sendPromptWithRecovery(text, abortEpoch, options);
    } catch (error) {
      this.nextResponseAutoSpeak = true;
      if (this.responseAbortEpoch !== abortEpoch) {
        logger.info("Suppressed send failure caused by an intentional response abort");
        return;
      }
      throw this.reportAndWrapError(error, "Failed to send message to GitHub Copilot");
    } finally {
      this.promptInFlight = false;
    }
  }

  private async sendPromptWithRecovery(text: string, abortEpoch: number, options: SendPromptOptions): Promise<void> {
    const hadLiveSession = this.session !== null;
    const session = await this.getOrCreateSession();

    try {
      await withTimeout(
        session.send({ prompt: this.buildOutgoingPrompt(text, options.continuityPreamble ?? null, hadLiveSession) }),
        SEND_TIMEOUT_MS,
        "Timed out while sending a message to GitHub Copilot",
      );
    } catch (error) {
      if (!this.isMissingSessionError(error)) {
        throw error;
      }

      logger.warn(
        { error, sessionId: session.sessionId },
        "GitHub Copilot session was not found during send; re-establishing session and retrying once",
      );
      await this.invalidateExpiredSession(session);

      const refreshedSession = await this.getOrCreateSession();
      if (this.responseAbortEpoch !== abortEpoch) {
        logger.info("Skipped retry send because the response was aborted during recovery");
        return;
      }
      await withTimeout(
        refreshedSession.send({ prompt: this.buildOutgoingPrompt(text, options.continuityPreamble ?? null, false) }),
        SEND_TIMEOUT_MS,
        "Timed out while sending a message to GitHub Copilot",
      );
    }
  }

  async clearSession(): Promise<void> {
    try {
      const sessionId = this.activeSessionId;
      await this.disconnectSession();
      if (sessionId) {
        await this.deletePersistedSession(sessionId);
      }
      this.activeSessionId = null;
      this.persistSessionId(null);
      this.streamAssembler.clear();
      this.transitionTo("idle");
    } catch (error) {
      throw this.reportAndWrapError(error, "Failed to clear the GitHub Copilot session");
    }
  }

  async abortResponse(): Promise<void> {
    if (this.currentState !== "thinking" && !this.promptInFlight) {
      return;
    }

    this.responseAbortEpoch += 1;
    this.nextResponseAutoSpeak = true;
    await this.disconnectSession();
    this.transitionTo("idle");
  }

  async shutdown(): Promise<void> {
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
    pending.resolve(approved ? { kind: "approved" } : { kind: "denied-interactively-by-user" });
    this.bus.emit("copilot:permission-complete", requestId, approved ? "approved" : "denied");
    return true;
  }

  private async getOrCreateSession(): Promise<CopilotSession> {
    if (this.session) {
      return this.session;
    }

    if (this.initializingSession) {
      return this.initializingSession;
    }

    const initializingSession = this.createSession();
    this.initializingSession = initializingSession;

    try {
      const session = await initializingSession;

      if (this.initializingSession === initializingSession) {
        this.session = session;
      } else {
        void session.disconnect().catch(() => {});
      }

      return session;
    } finally {
      if (this.initializingSession === initializingSession) {
        this.initializingSession = null;
      }
    }
  }

  private async createSession(): Promise<CopilotSession> {
    const client = await this.getOrCreateClient();
    const sessionPromise = this.openSession(client);

    let session: CopilotSession;
    try {
      session = await withTimeout(
        sessionPromise,
        SESSION_INIT_TIMEOUT_MS,
        "Timed out while connecting to GitHub Copilot",
      );
    } catch (error) {
      this.session = null;
      sessionPromise.then((resolvedSession) => void resolvedSession.disconnect().catch(() => {})).catch(() => {});
      throw error;
    }

    this.activeSessionId = session.sessionId;
    this.persistSessionId(session.sessionId);
    this.registeredToolSignature = this.getCurrentToolSignature();
    logger.info({ sessionId: session.sessionId }, "GitHub Copilot session ready");

    return session;
  }

  private async openSession(client: CopilotClient): Promise<CopilotSession> {
    const sessionConfig = this.getSessionConfig();
    const persistedSessionId = this.activeSessionId ?? this.sessionPersistence?.load() ?? null;
    if (persistedSessionId) {
      try {
        const session = await client.resumeSession(persistedSessionId, sessionConfig);
        this.activeSessionId = persistedSessionId;
        this.sessionOrigin = "resumed";
        logger.info({ sessionId: persistedSessionId }, "GitHub Copilot session resumed");
        return session;
      } catch (error) {
        if (!this.isMissingSessionError(error)) {
          throw error;
        }

        logger.warn(
          { error, sessionId: persistedSessionId },
          "Persisted GitHub Copilot session was not found; creating a fresh session",
        );
        this.activeSessionId = null;
        this.persistSessionId(null);
      }
    }

    const sessionId = randomUUID();
    this.activeSessionId = sessionId;
    this.sessionOrigin = "created";
    return createFreshCopilotSession(client, sessionConfig, sessionId);
  }

  private buildOutgoingPrompt(text: string, continuityPreamble: string | null, hadLiveSession: boolean): string {
    if (hadLiveSession || this.sessionOrigin !== "created" || !continuityPreamble?.trim()) {
      return text;
    }

    return `${continuityPreamble}\n\nCurrent user request:\n${text}`;
  }

  private getSessionConfig(): Omit<SessionConfig, "sessionId"> {
    const toolAwarenessInstructions = this.getToolAwarenessInstructions();
    const upgradeToolInstructions = this.getUpgradeToolInstructions();
    const copilotTools = getCopilotTools(this.toolAggregator, this.getToolBridgeOptions());

    return {
      clientName: "Spira",
      infiniteSessions: {
        enabled: true,
      },
      onEvent: (event) => {
        this.handleSessionEvent(event);
      },
      onPermissionRequest: (request) => this.handlePermissionRequest(request),
      streaming: true,
      systemMessage: {
        mode: "customize",
        sections: {
          identity: {
            action: "replace",
            content: SHINRA_IDENTITY_SECTION,
          },
          tone: {
            action: "append",
            content:
              "Use an elegant, self-possessed, quietly witty tone. Sound like a capable operations prodigy guiding the user through systems and data with confidence.",
          },
          custom_instructions: {
            action: "append",
            content: [
              "Prefer short, clear answers. Use the name Shinra naturally when self-identifying, but keep the focus on solving the user's task.",
              upgradeToolInstructions,
              toolAwarenessInstructions,
            ]
              .filter((section) => section.length > 0)
              .join("\n\n"),
          },
          last_instructions: {
            action: "append",
            content: SHINRA_LAST_INSTRUCTIONS,
          },
        },
        content: SHINRA_PERSONA_INSTRUCTIONS,
      },
      workingDirectory: appRootDir,
      tools: copilotTools,
    };
  }

  private handleSessionEvent(event: SessionEvent): void {
    if (this.session === null && this.initializingSession === null) {
      return;
    }

    switch (event.type) {
      case "assistant.message_delta":
        this.streamAssembler.append(event.data.messageId, event.data.deltaContent);
        this.bus.emit("copilot:delta", event.data.messageId, event.data.deltaContent);
        return;

      case "assistant.message": {
        const assembledText = this.streamAssembler.finalize(event.data.messageId);
        const fullText = event.data.content || assembledText;
        this.bus.emit("copilot:response-end", {
          messageId: event.data.messageId,
          text: fullText,
          timestamp: Date.now(),
          autoSpeak: this.nextResponseAutoSpeak,
        });
        this.nextResponseAutoSpeak = true;
        return;
      }

      case "tool.execution_start":
        this.bus.emit("copilot:tool-call", event.data.toolCallId, event.data.toolName, event.data.arguments ?? {});
        return;

      case "tool.execution_complete":
        this.bus.emit("copilot:tool-result", event.data.toolCallId, event.data.result ?? null);
        return;

      case "session.error":
        logger.error({ errorType: event.data.errorType, sessionError: event.data }, "GitHub Copilot session error");
        // Invalidate the live handle so the next sendMessage can resume or recreate the session.
        this.clearPendingPermissionRequests("expired");
        this.session = null;
        this.streamAssembler.clear();
        this.bus.emit(
          "copilot:error",
          "COPILOT_SESSION_ERROR",
          event.data.message,
          formatErrorDetails(event.data),
          "copilot",
        );
        this.nextResponseAutoSpeak = true;
        this.transitionTo("error");
        return;

      case "session.idle":
        if (this.currentState === "thinking") {
          this.transitionTo("idle");
        }
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
    this.registeredToolSignature = null;
    this.streamAssembler.clear();

    if (initializingSession) {
      try {
        const inflightSession = await initializingSession;
        await inflightSession.disconnect();
      } catch {
        // Ignore failures while clearing an in-flight session initialization.
      }
    }

    if (!session) {
      return;
    }

    try {
      await session.disconnect();
      logger.info({ sessionId: session.sessionId }, "GitHub Copilot session disconnected");
    } catch (error) {
      logger.warn({ error, sessionId: session.sessionId }, "Failed to disconnect GitHub Copilot session cleanly");
    }
  }

  private persistSessionId(sessionId: string | null): void {
    this.sessionPersistence?.save(sessionId);
  }

  private async invalidateExpiredSession(session: CopilotSession): Promise<void> {
    if (this.session !== session) {
      return;
    }

    await this.disconnectSession();
    this.activeSessionId = null;
    this.persistSessionId(null);
    this.transitionTo("idle");
  }

  private async getOrCreateClient(): Promise<CopilotClient> {
    if (this.client) {
      return this.client;
    }

    const { client, strategy } = await this.createClient();
    this.client = client;
    this.authStrategy = strategy;
    return client;
  }

  private async createClient(): Promise<{ client: CopilotClient; strategy: CopilotAuthStrategy }> {
    return createCopilotClient(this.env, logger);
  }

  private transitionTo(nextState: AssistantState): void {
    if (this.currentState === nextState) {
      return;
    }

    const previousState = this.currentState;
    this.currentState = nextState;
    this.bus.emit("copilot:state", nextState);
    this.bus.emit("state:change", previousState, nextState);

    if (nextState === "idle") {
      void this.maybeRefreshSessionForToolChanges();
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

  private async stopClient(client: CopilotClient): Promise<void> {
    await stopCopilotClient(client, logger);
  }

  private async deletePersistedSession(sessionId: string): Promise<void> {
    const client = await this.getOrCreateClient();

    try {
      await client.deleteSession(sessionId);
      logger.info({ sessionId }, "GitHub Copilot session deleted");
    } catch (error) {
      if (this.isMissingSessionError(error)) {
        logger.info({ sessionId }, "GitHub Copilot session was already deleted");
        return;
      }

      throw error;
    }
  }

  private reportAndWrapError(error: unknown, fallbackMessage: string): CopilotError {
    const wrappedError =
      error instanceof CopilotError
        ? error
        : new CopilotError(error instanceof Error ? error.message : fallbackMessage, error);

    logger.error({ err: wrappedError, details: formatErrorDetails(wrappedError) }, fallbackMessage);

    // Skip bus emit if a session.error event already reported to the client
    if (this.currentState !== "error") {
      this.bus.emit(
        "copilot:error",
        wrappedError.code,
        wrappedError.message,
        formatErrorDetails(wrappedError),
        "copilot",
      );
    }
    this.transitionTo("error");

    (wrappedError as ReportedCopilotError).reportedToClient = true;

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

  private async handlePermissionRequest(request: PermissionRequest): Promise<PermissionRequestResult> {
    if (!isVisionPermissionRequest(request)) {
      return { kind: "approved" };
    }

    if (!this.session) {
      return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
    }

    const requestId = randomUUID();
    const payload: PermissionRequestPayload = {
      requestId,
      kind: "mcp",
      toolCallId: typeof request.toolCallId === "string" ? request.toolCallId : undefined,
      serverName: request.serverName,
      toolName: request.toolName,
      toolTitle:
        typeof request.toolTitle === "string" && request.toolTitle.length > 0 ? request.toolTitle : request.toolName,
      args: request.args,
      readOnly: request.readOnly === true,
    };

    this.bus.emit("copilot:permission-request", payload);

    return await new Promise<PermissionRequestResult>((resolve) => {
      const timeout = setTimeout(() => {
        const pending = this.pendingPermissionRequests.get(requestId);
        if (!pending) {
          return;
        }

        this.pendingPermissionRequests.delete(requestId);
        pending.resolve({ kind: "denied-no-approval-rule-and-could-not-request-from-user" });
        this.bus.emit("copilot:permission-complete", requestId, "expired");
      }, PERMISSION_REQUEST_TIMEOUT_MS);

      this.pendingPermissionRequests.set(requestId, { resolve, timeout });
    });
  }

  private clearPendingPermissionRequests(result: "denied" | "expired"): void {
    for (const [requestId, pending] of this.pendingPermissionRequests.entries()) {
      clearTimeout(pending.timeout);
      pending.resolve({ kind: "denied-no-approval-rule-and-could-not-request-from-user" });
      this.bus.emit("copilot:permission-complete", requestId, result);
    }
    this.pendingPermissionRequests.clear();
  }

  private getCurrentToolSignature(): string {
    return JSON.stringify(
      getCopilotTools(this.toolAggregator, this.getToolBridgeOptions())
        .map((tool) => tool.name)
        .sort(),
    );
  }

  private getToolAwarenessInstructions(): string {
    if (this.env.SPIRA_SUBAGENTS_ENABLED) {
      return [
        "Use delegation tools for domain-specific operations.",
        '- delegate_to_windows handles Windows system actions, screen inspection, and desktop UI automation. Use mode="background" when you want to send it off and keep working.',
        '- delegate_to_spira handles Spira UI inspection and control. Use mode="background" when you want to send it off and keep working.',
        '- delegate_to_nexus handles Nexus Mods searches, file discovery, and downloads. Use mode="background" when you want to send it off and keep working.',
        "- read_subagent checks the status or final result of a delegated run by agent_id. Use wait=true to block for up to 30 seconds when you want to see whether it finishes.",
        "- list_subagents lists active and recently completed delegated runs.",
        "- write_subagent sends follow-up input into an idle delegated run so it can continue working.",
        "- stop_subagent cancels a delegated run and lets it fizzle out cleanly.",
        "If the user asks whether you can inspect the screen or active window, answer yes and use delegate_to_windows.",
        "Set allowWrites to true only when the delegated task genuinely needs to change state.",
      ].join("\n");
    }

    const tools = this.toolAggregator.getTools();
    const visionTools = tools.filter((tool) => tool.name.startsWith("vision_"));
    if (visionTools.length === 0) {
      return "";
    }

    const visionToolList = visionTools
      .map((tool) => `- ${tool.name}: ${tool.description ?? "No description provided."}`)
      .join("\n");

    return [
      "You have access to MCP tools provided by Spira, including a screen-vision capability from the Spira Vision MCP server.",
      "If the user asks whether you can inspect the screen, active window, or visible text, answer yes and mention the relevant vision tools.",
      "Prefer vision_read_screen when the user wants you to inspect what is visible on screen or read text in one step.",
      "Available vision tools:",
      visionToolList,
    ].join("\n");
  }

  private getUpgradeToolInstructions(): string {
    if (!this.requestUpgradeProposal) {
      return "";
    }

    return "If you modify local Spira code or configuration and need the app to apply those changes, use the spira_propose_upgrade tool with the changed file paths instead of guessing the restart scope yourself.";
  }

  private getToolBridgeOptions(): ToolBridgeOptions {
    const subagentsEnabled = this.env.SPIRA_SUBAGENTS_ENABLED;
    const connectedDelegationDomains = SUBAGENT_DOMAINS.filter(
      (domain) => this.toolAggregator.getToolsForServerIds(domain.serverIds).length > 0,
    );
    return {
      requestUpgradeProposal: this.requestUpgradeProposal,
      applyHotCapabilityUpgrade: this.applyHotCapabilityUpgrade,
      ...(subagentsEnabled
        ? {
            excludeServerIds: getDelegatedServerIds(),
            delegationDomains: connectedDelegationDomains,
            delegateToDomain: async (
              domainId: SubagentDomainId,
              args: SubagentDelegationArgs,
            ): Promise<SubagentEnvelope | SubagentRunHandle> => {
              if (args.mode === "background") {
                return this.subagentRunRegistry.track(domainId, args, this.getSubagentRunner(domainId).launch(args));
              }

              return this.getSubagentRunner(domainId).run(args);
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
    };
  }

  private getSubagentRunner(domainId: SubagentDomainId): SubagentRunner {
    const existingRunner = this.subagentRunners.get(domainId);
    if (existingRunner) {
      return existingRunner;
    }

    const domain = getSubagentDomain(domainId);
    if (!domain) {
      throw new CopilotError(`Unknown subagent domain ${domainId}`);
    }

    const runner = new SubagentRunner({
      bus: this.bus,
      env: this.env,
      toolAggregator: this.toolAggregator,
      domain,
      getClient: () => this.getOrCreateClient(),
      onPermissionRequest: (request) => this.handlePermissionRequest(request),
      lockManager: this.subagentLockManager,
    });
    this.subagentRunners.set(domainId, runner);
    return runner;
  }

  private async refreshSessionForToolChanges(): Promise<void> {
    const currentToolSignature = this.getCurrentToolSignature();
    if (this.registeredToolSignature === currentToolSignature) {
      this.pendingToolRefreshSignature = null;
      return;
    }

    if (!this.session && !this.initializingSession) {
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
        "MCP tool inventory changed during an active turn; deferring Copilot session refresh",
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
      "MCP tool inventory changed; refreshing Copilot session",
    );
    this.pendingToolRefreshSignature = null;
    const refreshPromise = this.disconnectSession();
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
}
