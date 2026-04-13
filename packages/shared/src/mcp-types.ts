export type McpServerSource = "builtin" | "user";

export interface McpToolAccessPolicy {
  readOnlyToolNames?: string[];
  writeToolNames?: string[];
}

interface McpServerConfigBase {
  id: string;
  name: string;
  description?: string;
  toolAccess?: McpToolAccessPolicy;
  enabled: boolean;
  autoRestart: boolean;
  maxRestarts?: number;
  source?: McpServerSource;
}

export interface StdioMcpServerConfig extends McpServerConfigBase {
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface StreamableHttpMcpServerConfig extends McpServerConfigBase {
  transport: "streamable-http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioMcpServerConfig | StreamableHttpMcpServerConfig;

export interface McpServerUpdateConfig {
  name?: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  toolAccess?: McpToolAccessPolicy;
  enabled?: boolean;
  autoRestart?: boolean;
  maxRestarts?: number;
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

export type McpToolAccessMode = "read" | "write";

export interface McpToolAccess {
  mode: McpToolAccessMode;
  source: "policy" | "annotation" | "default";
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
  access?: McpToolAccess;
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
  toolAccess?: McpToolAccessPolicy;
  enabled: boolean;
  state: "starting" | "connected" | "disconnected" | "error";
  toolCount: number;
  tools: string[];
  error?: string;
  diagnostics: McpServerDiagnostics;
  lastConnectedAt?: number;
  uptimeMs?: number;
}

const normalizeToolNameList = (value?: string[]): string[] => [
  ...new Set((value ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
];

export const normalizeMcpToolAccessPolicy = (policy?: McpToolAccessPolicy | null): McpToolAccessPolicy | undefined => {
  if (!policy) {
    return undefined;
  }

  const readOnlyToolNames = normalizeToolNameList(policy.readOnlyToolNames);
  const writeToolNames = normalizeToolNameList(policy.writeToolNames);
  if (readOnlyToolNames.length === 0 && writeToolNames.length === 0) {
    return undefined;
  }

  const writeSet = new Set(writeToolNames);
  const readOnly = readOnlyToolNames.filter((toolName) => !writeSet.has(toolName));
  return {
    ...(readOnly.length > 0 ? { readOnlyToolNames: readOnly } : {}),
    ...(writeToolNames.length > 0 ? { writeToolNames } : {}),
  };
};

export const resolveMcpToolAccess = (
  toolName: string,
  annotations?: McpToolAnnotations,
  policy?: McpToolAccessPolicy | null,
): McpToolAccess => {
  const normalizedPolicy = normalizeMcpToolAccessPolicy(policy);
  if (normalizedPolicy?.writeToolNames?.includes(toolName)) {
    return { mode: "write", source: "policy" };
  }
  if (normalizedPolicy?.readOnlyToolNames?.includes(toolName)) {
    return { mode: "read", source: "policy" };
  }
  if (annotations?.destructiveHint === true) {
    return { mode: "write", source: "annotation" };
  }
  if (annotations?.readOnlyHint === true) {
    return { mode: "read", source: "annotation" };
  }
  return { mode: "write", source: "default" };
};
