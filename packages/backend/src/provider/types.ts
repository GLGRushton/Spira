export type ProviderId = "copilot" | "azure-openai";

export type ProviderAuthStatus = {
  isAuthenticated: boolean;
  authType?: string;
};

export type ProviderUsageSnapshot = {
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  estimatedCostUsd?: number | null;
  latencyMs?: number | null;
  source: "provider" | "estimated" | "unknown";
};

export type ProviderUsageRecord = {
  provider: ProviderId;
  stationId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  model?: ProviderUsageSnapshot["model"];
  inputTokens?: ProviderUsageSnapshot["inputTokens"];
  outputTokens?: ProviderUsageSnapshot["outputTokens"];
  totalTokens?: ProviderUsageSnapshot["totalTokens"];
  estimatedCostUsd?: ProviderUsageSnapshot["estimatedCostUsd"];
  latencyMs?: ProviderUsageSnapshot["latencyMs"];
  observedAt: number;
  source: ProviderUsageSnapshot["source"];
};

export type ProviderToolResultObject = {
  textResultForLlm: string;
  resultType: "success" | "failure";
  error?: string;
};

export type ProviderToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  skipPermission?: boolean;
  handler: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<ProviderToolResultObject>;
};

export type ProviderSystemMessageSection = {
  action: "replace" | "append";
  content: string;
};

export type ProviderSystemMessage = {
  mode: "customize";
  content: string;
  sections?: Record<string, ProviderSystemMessageSection>;
};

export type ProviderSessionEvent =
  | {
      type: "assistant.message_delta";
      data: {
        messageId: string;
        deltaContent: string;
      };
    }
  | {
      type: "assistant.message";
      data: {
        messageId: string;
        content: string;
      };
    }
  | {
      type: "assistant.usage";
      data: ProviderUsageSnapshot;
    }
  | {
      type: "tool.execution_start";
      data: {
        toolCallId: string;
        toolName: string;
        arguments?: Record<string, unknown>;
      };
    }
  | {
      type: "tool.execution_complete";
      data: {
        toolCallId: string;
        success?: boolean;
        result?: unknown;
        error?: {
          message?: string;
        };
      };
    }
  | {
      type: "session.error";
      data: {
        message: string;
        errorType?: string;
      } & Record<string, unknown>;
    }
  | {
      type: "session.idle";
      data: {
        usage?: ProviderUsageSnapshot;
      };
    };

export type ProviderPermissionRequest = {
  kind: string;
  toolCallId?: string;
  toolName?: string;
  serverName?: string;
  toolTitle?: string;
  args?: Record<string, unknown>;
  readOnly?: boolean;
  [key: string]: unknown;
};

export type ProviderPermissionResult =
  | { kind: "approve-once" }
  | { kind: "reject"; feedback?: string }
  | { kind: "user-not-available" };

export type ProviderSessionConfig = {
  clientName: string;
  infiniteSessions?: {
    enabled: boolean;
  };
  onEvent?: (event: ProviderSessionEvent) => void;
  onPermissionRequest?: (request: ProviderPermissionRequest) => Promise<ProviderPermissionResult>;
  streaming?: boolean;
  systemMessage: ProviderSystemMessage;
  workingDirectory: string;
  tools: ProviderToolDefinition[];
};

export type ProviderSession = {
  sessionId: string;
  send(payload: { prompt: string }): Promise<void>;
  abort?(): Promise<void>;
  disconnect(): Promise<void>;
};

export type ProviderSessionResumptionMode = "provider-managed" | "host-managed";
export type ProviderTurnCancellationMode = "provider-abort" | "disconnect-and-reset";
export type ProviderResponseStreamingMode = "native" | "host-buffered";
export type ProviderUsageReportingMode = "full" | "partial" | "none";

export type ProviderCapabilities = {
  persistentSessions: boolean;
  abortableTurns: boolean;
  sessionResumption: ProviderSessionResumptionMode;
  turnCancellation: ProviderTurnCancellationMode;
  responseStreaming: ProviderResponseStreamingMode;
  usageReporting: ProviderUsageReportingMode;
};

export type ProviderClient = {
  providerId: ProviderId;
  capabilities: ProviderCapabilities;
  createSession(config: ProviderSessionConfig & { sessionId: string }): Promise<ProviderSession>;
  resumeSession(sessionId: string, config: ProviderSessionConfig): Promise<ProviderSession>;
  deleteSession(sessionId: string): Promise<void>;
  getAuthStatus(): Promise<ProviderAuthStatus>;
  stop(): Promise<unknown[]>;
};
