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
  SubagentDomain,
  SubagentEnvelope,
  SubagentRunHandle,
  SubagentRunSnapshot,
  UpgradeProposal,
} from "@spira/shared";
import { SUBAGENT_DOMAINS } from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { SubagentLockManager } from "../subagent/lock-manager.js";
import type { SubagentRegistry } from "../subagent/registry.js";
import { SubagentRunRegistry } from "../subagent/run-registry.js";
import { SubagentRunner } from "../subagent/subagent-runner.js";
import { CopilotError, formatErrorDetails } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import { setUnrefTimeout } from "../util/timers.js";
import { VOICE_RESPONSE_INSTRUCTIONS, buildOutgoingPrompt, createSessionConfig } from "./session-config.js";
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

export interface SessionPersistence {
  load(): string | null;
  save(sessionId: string | null): void;
}

interface SendPromptOptions {
  continuityPreamble?: string | null;
}

interface SessionManagerOptions {
  sessionPersistence?: SessionPersistence | null;
  subagentLockManager?: SubagentLockManager;
  subagentRegistry?: SubagentRegistry | null;
  additionalInstructions?: string | null;
  workingDirectory?: string | null;
  allowUpgradeTools?: boolean;
  listMissionServices?: ToolBridgeOptions["listMissionServices"];
  startMissionService?: ToolBridgeOptions["startMissionService"];
  stopMissionService?: ToolBridgeOptions["stopMissionService"];
  listMissionProofs?: ToolBridgeOptions["listMissionProofs"];
  runMissionProof?: ToolBridgeOptions["runMissionProof"];
}

export interface ManagedSubagentLaunch {
  handle: SubagentRunHandle;
  completion: Promise<SubagentRunSnapshot | null>;
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

const isMissionServicePermissionRequest = (
  request: PermissionRequest,
): request is PermissionRequest & {
  kind: "custom-tool";
  toolName: "spira_start_mission_service" | "spira_stop_mission_service" | "spira_run_mission_proof";
  toolCallId?: string;
  args?: Record<string, unknown>;
} =>
  request.kind === "custom-tool" &&
  (request.toolName === "spira_start_mission_service" ||
    request.toolName === "spira_stop_mission_service" ||
    request.toolName === "spira_run_mission_proof");

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
  private readonly subagentLockManager: SubagentLockManager;
  private readonly subagentRunRegistry: SubagentRunRegistry;
  private readonly subagentRunners = new Map<string, SubagentRunner>();
  private readonly subagentRegistry: SubagentRegistry | null;
  private readonly additionalInstructions: string | null;
  private readonly workingDirectory: string | null;
  private readonly allowUpgradeTools: boolean;
  private readonly listMissionServices: ToolBridgeOptions["listMissionServices"];
  private readonly startMissionService: ToolBridgeOptions["startMissionService"];
  private readonly stopMissionService: ToolBridgeOptions["stopMissionService"];
  private readonly listMissionProofs: ToolBridgeOptions["listMissionProofs"];
  private readonly runMissionProof: ToolBridgeOptions["runMissionProof"];

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly env: Env,
    private readonly toolAggregator: McpToolAggregator,
    private readonly requestUpgradeProposal?: (proposal: UpgradeProposal) => Promise<void> | void,
    private readonly applyHotCapabilityUpgrade?: () => Promise<void> | void,
    options: SessionManagerOptions = {},
  ) {
    this.sessionPersistence = options.sessionPersistence ?? null;
    this.subagentLockManager = options.subagentLockManager ?? new SubagentLockManager();
    this.subagentRunRegistry = new SubagentRunRegistry({ bus: this.bus });
    this.subagentRegistry = options.subagentRegistry ?? null;
    this.additionalInstructions = options.additionalInstructions?.trim() || null;
    this.workingDirectory = options.workingDirectory?.trim() || null;
    this.allowUpgradeTools = options.allowUpgradeTools ?? true;
    this.listMissionServices = options.listMissionServices;
    this.startMissionService = options.startMissionService;
    this.stopMissionService = options.stopMissionService;
    this.listMissionProofs = options.listMissionProofs;
    this.runMissionProof = options.runMissionProof;
    this.activeSessionId = this.sessionPersistence?.load() ?? null;
    this.bus.on("mcp:servers-changed", () => {
      void this.refreshSessionForToolChanges();
    });
    this.bus.on("subagent:catalog-changed", () => {
      this.subagentRunners.clear();
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

  launchManagedSubagent(
    domain: SubagentDomain,
    args: SubagentDelegationArgs,
    options: { workingDirectory?: string } = {},
  ): ManagedSubagentLaunch {
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
        void session.disconnect().catch((error) => {
          logger.warn(
            { error, sessionId: session.sessionId },
            "Failed to disconnect superseded GitHub Copilot session",
          );
        });
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
      sessionPromise
        .then((resolvedSession) =>
          resolvedSession.disconnect().catch((disconnectError) => {
            logger.warn(
              { error: disconnectError, sessionId: resolvedSession.sessionId },
              "Failed to disconnect GitHub Copilot session after initialization failure",
            );
          }),
        )
        .catch((sessionError) => {
          logger.debug({ error: sessionError }, "Ignored failed session initialization cleanup");
        });
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
    return buildOutgoingPrompt(text, continuityPreamble, hadLiveSession, this.sessionOrigin);
  }

  private getSessionConfig(): Omit<SessionConfig, "sessionId"> {
    const toolBridgeOptions = this.getToolBridgeOptions();
    return createSessionConfig({
      env: this.env,
      onEvent: (event) => {
        this.handleSessionEvent(event);
      },
      onPermissionRequest: (request) => this.handlePermissionRequest(request),
      additionalInstructions: this.additionalInstructions,
      toolAggregator: this.toolAggregator,
      toolBridgeOptions,
      workingDirectory: this.workingDirectory,
    });
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
      } catch (error) {
        logger.debug({ error }, "Ignored failed in-flight GitHub Copilot session cleanup");
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
    const visionPermission = isVisionPermissionRequest(request);
    const missionServicePermission = isMissionServicePermissionRequest(request);
    if (!visionPermission && !missionServicePermission) {
      return { kind: "approved" };
    }

    if (!this.session) {
      return { kind: "denied-no-approval-rule-and-could-not-request-from-user" };
    }

    const requestId = randomUUID();
    const payload: PermissionRequestPayload = {
      requestId,
      kind: visionPermission ? "mcp" : "custom-tool",
      toolCallId: typeof request.toolCallId === "string" ? request.toolCallId : undefined,
      serverName: visionPermission ? request.serverName : "Spira mission runtime",
      toolName: request.toolName,
      toolTitle: visionPermission
        ? typeof request.toolTitle === "string" && request.toolTitle.length > 0
          ? request.toolTitle
          : request.toolName
        : getMissionServiceToolTitle(request.toolName),
      args: request.args,
      readOnly: visionPermission ? request.readOnly === true : false,
    };

    this.bus.emit("copilot:permission-request", payload);

    return await new Promise<PermissionRequestResult>((resolve) => {
      const timeout = setUnrefTimeout(() => {
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

  private getToolBridgeOptions(): ToolBridgeOptions {
    const subagentsEnabled = this.env.SPIRA_SUBAGENTS_ENABLED;
    const readyDelegationDomains = this.getDelegationDomains();
    const connectedDelegationDomains = readyDelegationDomains.filter(
      (domain) => this.getDelegationDomainTools(domain.id, this.toolAggregator.getTools()).length,
    );
    return {
      ...(this.allowUpgradeTools
        ? {
            requestUpgradeProposal: this.requestUpgradeProposal,
            applyHotCapabilityUpgrade: this.applyHotCapabilityUpgrade,
          }
        : {}),
      ...(this.listMissionServices ? { listMissionServices: this.listMissionServices } : {}),
      ...(this.startMissionService ? { startMissionService: this.startMissionService } : {}),
      ...(this.stopMissionService ? { stopMissionService: this.stopMissionService } : {}),
      ...(this.listMissionProofs ? { listMissionProofs: this.listMissionProofs } : {}),
      ...(this.runMissionProof ? { runMissionProof: this.runMissionProof } : {}),
      ...(subagentsEnabled
        ? {
            excludeServerIds: this.getDelegatedServerIds(),
            delegationDomains: connectedDelegationDomains,
            delegateToDomain: async (
              domainId: string,
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

  private getSubagentRunner(domainId: string): SubagentRunner {
    const existingRunner = this.subagentRunners.get(domainId);
    if (existingRunner) {
      return existingRunner;
    }

    const domain = this.getDelegationDomain(domainId);
    if (!domain) {
      throw new CopilotError(`Unknown subagent domain ${domainId}`);
    }

    const runner = this.createSubagentRunner(domain);
    this.subagentRunners.set(domainId, runner);
    return runner;
  }

  private createSubagentRunner(domain: SubagentDomain, workingDirectory?: string): SubagentRunner {
    return new SubagentRunner({
      bus: this.bus,
      env: this.env,
      toolAggregator: this.toolAggregator,
      domain,
      workingDirectory,
      getClient: () => this.getOrCreateClient(),
      onPermissionRequest: (request) => this.handlePermissionRequest(request),
      lockManager: this.subagentLockManager,
    });
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
