import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import { ProviderError } from "../../util/errors.js";
import { getDefaultProviderCapabilities } from "../capability-fallback.js";
import type { ProviderAuthStatus, ProviderClient, ProviderSession, ProviderSessionConfig } from "../types.js";
import {
  type AzureOpenAiClientConfig,
  type AzureOpenAiProviderId,
  type AzureOpenAiSessionState,
  abortAzureTurn,
  createAzureOpenAiSessionState,
  escalateAzureSession,
  publishAzureHostContinuity,
  resolveAzureConfig,
  resolveAzureCurrentDeployment,
  trimTrailingSlashes,
} from "./session-state.js";
import { runAzureOpenAiTurn } from "./turn-runner.js";

const silentLogger: Pick<Logger, "info"> = {
  info: () => undefined,
};

export type AzureOpenAiAuthStrategy = "azure-openai-key";

class AzureOpenAiProviderSession implements ProviderSession {
  private disconnected = false;

  constructor(
    private readonly state: AzureOpenAiSessionState,
    private readonly config: ProviderSessionConfig,
    private readonly client: AzureOpenAiProviderClient,
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

  escalate() {
    if (this.disconnected) {
      throw new ProviderError("Session not found: disconnected");
    }
    return Promise.resolve({
      providerId: this.state.providerId,
      ...escalateAzureSession(this.state),
    });
  }

  abort(): Promise<void> {
    abortAzureTurn(this.state);
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    this.disconnected = true;
    return this.abort();
  }
}

export class AzureOpenAiProviderClient implements ProviderClient {
  readonly providerId: AzureOpenAiProviderId;
  readonly capabilities;
  private readonly sessions = new Map<string, AzureOpenAiSessionState>();

  constructor(
    private readonly config: AzureOpenAiClientConfig,
    private readonly logger: Pick<Logger, "info"> = silentLogger,
  ) {
    this.providerId = config.providerId ?? "azure-openai";
    this.capabilities = getDefaultProviderCapabilities(this.providerId);
  }

  async createSession(config: ProviderSessionConfig & { sessionId: string }): Promise<ProviderSession> {
    const state = createAzureOpenAiSessionState(
      config,
      this.providerId,
      this.config.deployment,
      this.config.modelLabel ?? null,
      this.config.escalationDeployment ?? null,
      this.config.escalationModelLabel ?? null,
    );
    publishAzureHostContinuity(state);
    this.sessions.set(config.sessionId, state);
    return new AzureOpenAiProviderSession(state, config, this);
  }

  async resumeSession(sessionId: string, config: ProviderSessionConfig): Promise<ProviderSession> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new ProviderError(`Session not found: ${sessionId}`);
    }

    state.onHostContinuitySnapshot = config.onHostContinuitySnapshot ?? null;
    state.hostContinuityModel = config.hostContinuity?.model ?? config.model ?? this.config.modelLabel ?? null;
    state.currentDeployment =
      config.hostContinuity?.deployment?.trim() ||
      state.currentDeployment ||
      resolveAzureCurrentDeployment(
        this.providerId,
        state.hostContinuityModel ?? this.config.deployment,
        this.config.deployment,
        this.config.modelLabel ?? null,
        this.config.escalationDeployment ?? null,
        this.config.escalationModelLabel ?? null,
      );
    publishAzureHostContinuity(state);
    return new AzureOpenAiProviderSession(state, config, this);
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

  async runTurn(state: AzureOpenAiSessionState, config: ProviderSessionConfig, prompt: string): Promise<void> {
    await runAzureOpenAiTurn(this.config, state, config, prompt, this.logger);
  }
}

export const createAzureOpenAiProviderClient = async (
  env: Env,
  logger: Pick<Logger, "info">,
  providerId: AzureOpenAiProviderId = "azure-openai",
): Promise<{ client: AzureOpenAiProviderClient; strategy: AzureOpenAiAuthStrategy }> => {
  const clientConfig = resolveAzureConfig(providerId, env);
  const client = new AzureOpenAiProviderClient(clientConfig, logger);
  logger.info(
    {
      providerId: client.providerId,
      endpoint: trimTrailingSlashes(env.AZURE_OPENAI_ENDPOINT?.trim() ?? ""),
      deployment: clientConfig.deployment,
      ...(clientConfig.escalationDeployment ? { escalationDeployment: clientConfig.escalationDeployment } : {}),
      strategy: "azure-openai-key",
    },
    "Using Azure OpenAI provider authentication",
  );
  return {
    client,
    strategy: "azure-openai-key",
  };
};
