import { createRequire } from "node:module";
import path from "node:path";
import { CopilotClient, type CopilotSession, type SessionEvent, approveAll } from "@github/copilot-sdk";
import type { AssistantState, Env } from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { appRootDir } from "../util/app-paths.js";
import { CopilotError, formatErrorDetails } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";
import { createLogger } from "../util/logger.js";
import { StreamAssembler } from "./stream-handler.js";
import { registerTools } from "./tool-bridge.js";

const logger = createLogger("copilot-session");
const require = createRequire(import.meta.url);

const SESSION_INIT_TIMEOUT_MS = 20_000;
const SEND_TIMEOUT_MS = 20_000;
const COPILOT_AUTH_ENV_KEYS = ["COPILOT_SDK_AUTH_TOKEN", "GITHUB_ACCESS_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"] as const;
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

type ReportedCopilotError = CopilotError & { reportedToClient?: boolean };
type CopilotAuthStrategy = "logged-in-user" | "github-token";

export class CopilotSessionManager {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private initializingSession: Promise<CopilotSession> | null = null;
  private readonly streamAssembler = new StreamAssembler();
  private currentState: AssistantState = "idle";
  private authStrategy: CopilotAuthStrategy | null = null;

  constructor(
    private readonly bus: SpiraEventBus,
    private readonly env: Env,
    private readonly toolAggregator: McpToolAggregator,
  ) {}

  async sendMessage(text: string): Promise<void> {
    try {
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
    try {
      await this.disconnectSession();
      this.streamAssembler.clear();
      this.transitionTo("idle");
    } catch (error) {
      throw this.reportAndWrapError(error, "Failed to clear the GitHub Copilot session");
    }
  }

  async shutdown(): Promise<void> {
    await this.disconnectSession();
    await this.disposeClient();
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

    const sessionPromise = client.createSession({
      clientName: "Spira",
      onEvent: (event) => {
        this.handleSessionEvent(event);
      },
      onPermissionRequest: approveAll,
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
            content:
              "Prefer short, clear answers. Use the name Shinra naturally when self-identifying, but keep the focus on solving the user's task.",
          },
          last_instructions: {
            action: "append",
            content: SHINRA_LAST_INSTRUCTIONS,
          },
        },
        content: SHINRA_PERSONA_INSTRUCTIONS,
      },
      workingDirectory: appRootDir,
    });

    let session: CopilotSession;
    try {
      session = await this.withTimeout(
        sessionPromise,
        SESSION_INIT_TIMEOUT_MS,
        "Timed out while connecting to GitHub Copilot",
      );
    } catch (error) {
      this.session = null;
      sessionPromise.then((resolvedSession) => void resolvedSession.disconnect().catch(() => {})).catch(() => {});
      throw error;
    }

    registerTools(session, this.toolAggregator);
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
        this.bus.emit("copilot:response-end", { messageId: event.data.messageId, text: fullText });
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
        // Invalidate the session so the next sendMessage creates a fresh one
        this.session = null;
        this.streamAssembler.clear();
        this.bus.emit(
          "copilot:error",
          "COPILOT_SESSION_ERROR",
          event.data.message,
          formatErrorDetails(event.data),
          "copilot",
        );
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
    const cliPath = this.resolveCliPath();
    const loggedInClient = new CopilotClient({
      cliPath,
      env: this.getSanitizedCopilotEnv(),
      useLoggedInUser: true,
      useStdio: true,
    });

    try {
      await loggedInClient.start();
      const authStatus = await loggedInClient.getAuthStatus();

      if (authStatus.isAuthenticated) {
        logger.info(
          { authType: authStatus.authType ?? "unknown", strategy: "logged-in-user" },
          "Using logged-in Copilot authentication",
        );
        return { client: loggedInClient, strategy: "logged-in-user" };
      }
    } catch (error) {
      logger.warn({ error }, "Logged-in Copilot authentication check failed");
    }

    await this.stopClient(loggedInClient);

    if (this.env.GITHUB_TOKEN.trim()) {
      const tokenClient = new CopilotClient({
        cliPath,
        env: this.getSanitizedCopilotEnv(),
        githubToken: this.env.GITHUB_TOKEN,
        useStdio: true,
      });

      try {
        await tokenClient.start();
        const authStatus = await tokenClient.getAuthStatus();
        logger.info(
          { authType: authStatus.authType ?? "unknown", strategy: "github-token" },
          "Using token-based Copilot authentication",
        );
        return { client: tokenClient, strategy: "github-token" };
      } catch (error) {
        logger.warn({ error }, "Token-based Copilot authentication check failed");
        await this.stopClient(tokenClient);
      }
    }

    throw new CopilotError("GitHub Copilot is not authenticated. Run /login in the Copilot CLI.");
  }

  private getSanitizedCopilotEnv(): NodeJS.ProcessEnv {
    const sanitizedEnv = { ...process.env };
    for (const key of COPILOT_AUTH_ENV_KEYS) {
      delete sanitizedEnv[key];
    }
    return sanitizedEnv;
  }

  private resolveCliPath(): string | undefined {
    try {
      if (process.platform === "win32") {
        const packageName = process.arch === "arm64" ? "@github/copilot-win32-arm64" : "@github/copilot-win32-x64";
        const packageJsonPath = require.resolve(`${packageName}/package.json`);
        return path.join(path.dirname(packageJsonPath), "copilot.exe");
      }

      return undefined;
    } catch (error) {
      logger.warn(
        { error, platform: process.platform, arch: process.arch },
        "Falling back to default Copilot CLI path",
      );
      return undefined;
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
    try {
      const stopErrors = await client.stop();
      if (stopErrors.length > 0) {
        logger.warn({ stopErrors }, "GitHub Copilot client stopped with cleanup errors");
      }
    } catch (error) {
      logger.warn({ error }, "Failed to stop GitHub Copilot client cleanly");
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
