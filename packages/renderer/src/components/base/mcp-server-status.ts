import type { McpServerStatus } from "@spira/shared";

export const getMcpServerStateTone = (server: McpServerStatus): McpServerStatus["state"] =>
  !server.enabled ? "disconnected" : server.state;

export const getMcpServerStateLabel = (server: McpServerStatus): string =>
  !server.enabled ? "disabled" : server.state;
