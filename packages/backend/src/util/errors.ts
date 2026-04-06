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
