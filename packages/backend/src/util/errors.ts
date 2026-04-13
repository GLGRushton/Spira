import type { ErrorPayload } from "@spira/shared";

export class SpiraError extends Error {
  public readonly code: string;

  constructor(code: string, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = new.target.name;
    this.code = code;
  }
}

export class ConfigError extends SpiraError {
  constructor(message: string, cause?: unknown) {
    super("CONFIG_ERROR", message, cause);
  }
}

export class TransportError extends SpiraError {
  constructor(message: string, cause?: unknown) {
    super("TRANSPORT_ERROR", message, cause);
  }
}

export class McpError extends SpiraError {
  constructor(message: string, cause?: unknown) {
    super("MCP_ERROR", message, cause);
  }
}

export class VoiceError extends SpiraError {
  constructor(message: string, cause?: unknown) {
    super("VOICE_ERROR", message, cause);
  }
}

export class CopilotError extends SpiraError {
  constructor(message: string, cause?: unknown) {
    super("COPILOT_ERROR", message, cause);
  }
}

export class YouTrackError extends SpiraError {
  constructor(message: string, cause?: unknown) {
    super("YOUTRACK_ERROR", message, cause);
  }
}

const MAX_ERROR_CAUSE_DEPTH = 5;

const stringifyUnknownError = (error: unknown): string => {
  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }

  if (error === null || error === undefined) {
    return String(error);
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return Object.prototype.toString.call(error);
  }
};

export const formatErrorDetails = (error: unknown, depth = 0): string => {
  if (depth >= MAX_ERROR_CAUSE_DEPTH) {
    return "Cause chain truncated";
  }

  if (error instanceof Error) {
    const lines = [`${error.name}: ${error.message}`];

    if (error instanceof SpiraError) {
      lines.push(`code: ${error.code}`);
    }

    if (error.stack) {
      lines.push(error.stack);
    }

    if ("cause" in error && error.cause !== undefined) {
      lines.push(`Caused by:\n${formatErrorDetails(error.cause, depth + 1)}`);
    }

    return lines.join("\n");
  }

  return stringifyUnknownError(error);
};

export const toErrorPayload = (
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
  source?: string,
): ErrorPayload => {
  return {
    code: error instanceof SpiraError ? error.code : fallbackCode,
    message: error instanceof Error && error.message ? error.message : fallbackMessage,
    details: formatErrorDetails(error),
    source,
  };
};
