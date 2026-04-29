import { randomUUID } from "node:crypto";
import type { Env } from "@spira/shared";
import type { Logger } from "pino";
import type { ProviderClient, ProviderSession, ProviderSessionConfig } from "../provider/types.js";
import { createCopilotProviderClient, type CopilotAuthStrategy } from "../provider/copilot/client-factory.js";
import { CopilotError } from "../util/errors.js";
import { setUnrefTimeout } from "../util/timers.js";

export type { CopilotAuthStrategy };

export const createCopilotClient = async (
  env: Env,
  logger: Pick<Logger, "info" | "warn">,
): Promise<{ client: ProviderClient; strategy: CopilotAuthStrategy }> => createCopilotProviderClient(env, logger);

export const stopCopilotClient = async (
  client: ProviderClient,
  logger: Pick<Logger, "warn">,
): Promise<void> => {
  try {
    const stopErrors = await client.stop();
    if (stopErrors.length > 0) {
      logger.warn({ stopErrors }, "GitHub Copilot client stopped with cleanup errors");
    }
  } catch (error) {
    logger.warn({ error }, "Failed to stop GitHub Copilot client cleanly");
  }
};

export const createFreshCopilotSession = (
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
          reject(new CopilotError(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
