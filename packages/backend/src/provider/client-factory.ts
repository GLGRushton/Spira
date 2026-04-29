import { randomUUID } from "node:crypto";
import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import { ProviderError } from "../util/errors.js";
import { setUnrefTimeout } from "../util/timers.js";
import { createAzureOpenAiProviderClient, type AzureOpenAiAuthStrategy } from "./azure-openai/client-factory.js";
import { createCopilotProviderClient, type CopilotAuthStrategy } from "./copilot/client-factory.js";
import { getConfiguredProviderId } from "./provider-config.js";
import type { ProviderClient, ProviderSession, ProviderSessionConfig } from "./types.js";

export type ProviderAuthStrategy = CopilotAuthStrategy | AzureOpenAiAuthStrategy;

export const createProviderClient = async (
  env: Env,
  logger: Pick<Logger, "info" | "warn">,
): Promise<{ client: ProviderClient; strategy: ProviderAuthStrategy }> => {
  switch (getConfiguredProviderId(env)) {
    case "azure-openai":
      return createAzureOpenAiProviderClient(env, logger);
    case "copilot":
    default:
      return createCopilotProviderClient(env, logger);
  }
};

export const stopProviderClient = async (
  client: ProviderClient,
  logger: Pick<Logger, "warn">,
): Promise<void> => {
  try {
    const stopErrors = await client.stop();
    if (stopErrors.length > 0) {
      logger.warn({ stopErrors, providerId: client.providerId }, "Provider client stopped with cleanup errors");
    }
  } catch (error) {
    logger.warn({ error, providerId: client.providerId }, "Failed to stop provider client cleanly");
  }
};

export const createFreshProviderSession = (
  client: ProviderClient,
  sessionConfig: Omit<ProviderSessionConfig, "sessionId">,
  sessionId = randomUUID(),
): Promise<ProviderSession> =>
  client.createSession({
    ...sessionConfig,
    sessionId,
  });

export const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setUnrefTimeout(() => {
          reject(new ProviderError(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
