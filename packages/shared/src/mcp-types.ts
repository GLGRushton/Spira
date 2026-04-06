export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  autoRestart: boolean;
  maxRestarts?: number;
}

export interface McpServerStatus {
  id: string;
  name: string;
  state: "starting" | "connected" | "disconnected" | "error";
  toolCount: number;
  tools: string[];
  error?: string;
  uptimeMs?: number;
}
