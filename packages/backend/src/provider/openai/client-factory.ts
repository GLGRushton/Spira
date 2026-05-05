import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import { ProviderError } from "../../util/errors.js";
import { getDefaultProviderCapabilities } from "../capability-fallback.js";
import type { ProviderAuthStatus, ProviderClient, ProviderSession, ProviderSessionConfig } from "../types.js";
import {
  type OpenAiClientConfig,
  type OpenAiProviderId,
  type OpenAiSessionState,
  abortOpenAiTurn,
  createOpenAiSessionState,
  escalateOpenAiSession,
  normalizeOpenAiBaseUrl,
  publishOpenAiHostContinuity,
  resolveOpenAiConfig,
  setOpenAiSessionModel,
} from "./session-state.js";
import { runOpenAiTurn } from "./turn-runner.js";

const silentLogger: Pick<Logger, "info"> = {
  info: () => undefined,
};

export type OpenAiAuthStrategy = "openai-api-key";

class OpenAiProviderSession implements ProviderSession {
  private disconnected = false;

  constructor(
    private readonly state: OpenAiSessionState,
    private readonly config: ProviderSessionConfig,
    private readonly client: OpenAiProviderClient,
  ) {}

  get sessionId(): string {
    return this.state.sessionId;
  }

  async send(payload: { prompt: string }): Promise<void> {
    if (this.disconnected) {
      throw new ProviderError("Session not found: disconnected");
    }

    await this.client.runTurn(this.state, this.config, payload.prompt);
  }

  setModel(model: string): Promise<void> {
    if (this.disconnected) {
      throw new ProviderError("Session not found: disconnected");
    }
    setOpenAiSessionModel(this.state, model);
    return Promise.resolve();
  }

  escalate() {
    if (this.disconnected) {
      throw new ProviderError("Session not found: disconnected");
    }
    return Promise.resolve({
      providerId: this.state.providerId,
      ...escalateOpenAiSession(this.state),
    });
  }

  abort(): Promise<void> {
    abortOpenAiTurn(this.state);
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.disconnected = true;
    return this.abort();
  }
}

export class OpenAiProviderClient implements ProviderClient {
  readonly providerId: OpenAiProviderId;
  readonly capabilities;
  private readonly sessions = new Map<string, OpenAiSessionState>();

  constructor(
    private readonly config: OpenAiClientConfig,
    private readonly logger: Pick<Logger, "info"> = silentLogger,
  ) {
    this.providerId = config.providerId ?? "openai";
    this.capabilities = getDefaultProviderCapabilities(this.providerId);
  }

  async createSession(config: ProviderSessionConfig & { sessionId: string }): Promise<ProviderSession> {
    const state = createOpenAiSessionState(
      config,
      this.providerId,
      config.model ?? this.config.defaultModel,
      this.config.escalationModel ?? null,
    );
    publishOpenAiHostContinuity(state);
    this.sessions.set(config.sessionId, state);
    return new OpenAiProviderSession(state, config, this);
  }

  async resumeSession(sessionId: string, config: ProviderSessionConfig): Promise<ProviderSession> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new ProviderError(`Session not found: ${sessionId}`);
    }

    state.onHostContinuitySnapshot = config.onHostContinuitySnapshot ?? null;
    state.currentModel = config.hostContinuity?.model ?? config.model ?? state.currentModel ?? this.config.defaultModel;
    publishOpenAiHostContinuity(state);
    return new OpenAiProviderSession(state, config, this);
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.sessions.delete(sessionId)) {
      throw new ProviderError(`Session not found: ${sessionId}`);
    }
  }

  getAuthStatus(): Promise<ProviderAuthStatus> {
    return Promise.resolve({
      isAuthenticated: true,
      authType: "api-key",
    });
  }

  stop(): Promise<unknown[]> {
    this.sessions.clear();
    return Promise.resolve([]);
  }

  async runTurn(state: OpenAiSessionState, config: ProviderSessionConfig, prompt: string): Promise<void> {
    await runOpenAiTurn(this.config, state, config, prompt, this.logger);
  }
}

export const createOpenAiProviderClient = async (
  env: Env,
  logger: Pick<Logger, "info">,
  providerId: OpenAiProviderId = "openai",
): Promise<{ client: OpenAiProviderClient; strategy: OpenAiAuthStrategy }> => {
  const clientConfig = resolveOpenAiConfig(providerId, env);
  const client = new OpenAiProviderClient(clientConfig, logger);
  logger.info(
    {
      providerId: client.providerId,
      baseUrl: normalizeOpenAiBaseUrl(env.OPENAI_BASE_URL),
      defaultModel: clientConfig.defaultModel,
      ...(clientConfig.escalationModel ? { escalationModel: clientConfig.escalationModel } : {}),
      strategy: "openai-api-key",
    },
    "Using OpenAI provider authentication",
  );
  return {
    client,
    strategy: "openai-api-key",
  };
};
