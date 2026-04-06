import { CopilotClient, type CopilotSession, type SessionEvent, approveAll } from "@github/copilot-sdk";
import type { AssistantState, Env } from "@spira/shared";
import { CopilotError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import { StreamAssembler } from "./stream-handler.js";
import { registerTools } from "./tool-bridge.js";

const logger = createLogger("copilot-session");

const SESSION_INIT_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 20_000;

type ReportedCopilotError = CopilotError & { reportedToClient?: boolean };

export class CopilotSessionManager {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private initializingSession: Promise<CopilotSession> | null = null;
  private readonly streamAssembler = new StreamAssembler();
  private currentState: AssistantState = "idle";

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly env: Env,
  ) {}

  async sendMessage(text: string): Promise<void> {
    try {
      this.ensureTokenConfigured();
      if (this.currentState === "error") {
        this.transitionTo("idle");
      }
      this.transitionTo("thinking");

      const session = await this.getOrCreateSession();
      await this.withTimeout(
        session.send({ prompt: text }),
        SEND_TIMEOUT_MS,
        "Timed out while sending a message to GitHub Copilot",
      );
    } catch (error) {
      throw this.reportAndWrapError(error, "Failed to send message to GitHub Copilot");
    }
  }

  async clearSession(): Promise<void> {
    await this.disconnectSession();
    this.streamAssembler.clear();
    this.transitionTo("idle");
  }

  async shutdown(): Promise<void> {
    await this.disconnectSession();

    const client = this.client;
    this.client = null;

    if (!client) {
      return;
    }

    try {
      const stopErrors = await client.stop();
      if (stopErrors.length > 0) {
        logger.warn({ stopErrors }, "GitHub Copilot client stopped with cleanup errors");
      }
    } catch (error) {
      logger.warn({ error }, "Failed to stop GitHub Copilot client cleanly");
    }
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
    const isNewClient = this.client === null;
    const client =
      this.client ??
      new CopilotClient({
        githubToken: this.env.GITHUB_TOKEN,
        useStdio: true,
      });

    this.client = client;

    const sessionPromise = client.createSession({
      clientName: "Spira",
      onEvent: (event) => {
        this.handleSessionEvent(event);
      },
      onPermissionRequest: approveAll,
      streaming: true,
      workingDirectory: process.cwd(),
    });

    let session: CopilotSession;
    try {
      session = await this.withTimeout(
        sessionPromise,
        SESSION_INIT_TIMEOUT_MS,
        "Timed out while connecting to GitHub Copilot",
      );
    } catch (error) {
      // If we created the client in this call and session creation failed,
      // discard the client so the next attempt starts fresh.
      if (isNewClient) {
        this.client = null;
      }
      sessionPromise.then((resolvedSession) => void resolvedSession.disconnect().catch(() => {})).catch(() => {});
      throw error;
    }

    registerTools(session);
    logger.info({ sessionId: session.sessionId }, "GitHub Copilot session created");

    return session;
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
        this.bus.emit("copilot:response-end", event.data.messageId, fullText);
        return;
      }

      case "tool.execution_start":
        this.bus.emit("copilot:tool-call", event.data.toolCallId, event.data.toolName, event.data.arguments ?? {});
        return;

      case "tool.execution_complete":
        this.bus.emit("copilot:tool-result", event.data.toolCallId, event.data.result ?? null);
        return;

      case "session.error":
        logger.error({ errorType: event.data.errorType, message: event.data.message }, "GitHub Copilot session error");
        // Invalidate the session so the next sendMessage creates a fresh one
        this.session = null;
        this.streamAssembler.clear();
        this.bus.emit("copilot:error", "COPILOT_SESSION_ERROR", event.data.message);
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
    const session = this.session;
    const initializingSession = this.initializingSession;
    this.session = null;
    this.initializingSession = null;
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

  private transitionTo(nextState: AssistantState): void {
    if (this.currentState === nextState) {
      return;
    }

    const previousState = this.currentState;
    this.currentState = nextState;
    this.bus.emit("state:change", previousState, nextState);
  }

  private ensureTokenConfigured(): void {
    if (this.env.GITHUB_TOKEN.trim() !== "") {
      return;
    }

    throw new CopilotError("GITHUB_TOKEN is not configured. Set it before sending chat messages to GitHub Copilot.");
  }

  private reportAndWrapError(error: unknown, fallbackMessage: string): CopilotError {
    const wrappedError =
      error instanceof CopilotError
        ? error
        : new CopilotError(error instanceof Error ? error.message : fallbackMessage, error);

    logger.error({ error: wrappedError }, fallbackMessage);

    // Skip bus emit if a session.error event already reported to the client
    if (this.currentState !== "error") {
      this.bus.emit("copilot:error", wrappedError.code, wrappedError.message);
    }
    this.transitionTo("error");

    (wrappedError as ReportedCopilotError).reportedToClient = true;

    return wrappedError;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeoutId = setTimeout(() => {
            reject(new CopilotError(timeoutMessage));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
