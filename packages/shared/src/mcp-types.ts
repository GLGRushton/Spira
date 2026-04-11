export type McpServerSource = "builtin" | "user";

export interface McpServerConfig {
  id: string;
  name: string;
  description?: string;
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  autoRestart: boolean;
  maxRestarts?: number;
  source?: McpServerSource;
}

export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolExecution {
  taskSupport?: "optional" | "required" | "forbidden";
}

export interface McpTool {
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: McpToolAnnotations;
  execution?: McpToolExecution;
}

export interface McpServerDiagnostics {
  failureCount: number;
  lastFailureAt?: number;
  lastError?: string;
  remediationHint?: string;
  recentStderr: string[];
}

export interface McpServerStatus {
  id: string;
  name: string;
  description?: string;
  source?: McpServerSource;
  enabled: boolean;
  state: "starting" | "connected" | "disconnected" | "error";
  toolCount: number;
  tools: string[];
  error?: string;
  diagnostics: McpServerDiagnostics;
  lastConnectedAt?: number;
  uptimeMs?: number;
}
