import type { SpiraUiSnapshot, SpiraUiWaitCondition } from "@spira/shared";
import { buildSpiraUiSnapshot } from "./control-snapshot.js";

const wait = async (delayMs: number): Promise<void> =>
  await new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });

const hasPermissionRequest = (
  snapshot: SpiraUiSnapshot,
  condition: Extract<SpiraUiWaitCondition, { type: "permission-request" }>,
): boolean =>
  snapshot.permissions.some((request) => {
    if (condition.requestId && request.requestId !== condition.requestId) {
      return false;
    }
    if (condition.toolName && request.toolName !== condition.toolName) {
      return false;
    }
    return true;
  });

const matchesCondition = (snapshot: SpiraUiSnapshot, condition: SpiraUiWaitCondition): boolean => {
  switch (condition.type) {
    case "active-view":
      return snapshot.activeView === condition.view;
    case "assistant-state":
      return snapshot.assistantState === condition.state;
    case "connection-status":
      return snapshot.connectionStatus === condition.status;
    case "streaming":
      return snapshot.chat.isStreaming === condition.value;
    case "permission-request":
      return hasPermissionRequest(snapshot, condition) === condition.present;
    case "upgrade-banner": {
      const banner = snapshot.upgradeBanner;
      const isPresent = Boolean(banner && (!condition.proposalId || banner.proposalId === condition.proposalId));
      return isPresent === condition.present;
    }
    case "mcp-server-state":
      return snapshot.mcpServers.some((server) => server.id === condition.serverId && server.state === condition.state);
    case "agent-room":
      return snapshot.agentRooms.some((room) => room.roomId === condition.roomId) === condition.present;
    default: {
      const exhaustiveCheck: never = condition;
      throw new Error(`Unsupported wait condition: ${String(exhaustiveCheck)}`);
    }
  }
};

export const waitForSpiraUiCondition = async (
  condition: SpiraUiWaitCondition,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<{ condition: SpiraUiWaitCondition; elapsedMs: number; snapshot: SpiraUiSnapshot }> => {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const startedAt = Date.now();

  for (;;) {
    const snapshot = buildSpiraUiSnapshot();
    if (matchesCondition(snapshot, condition)) {
      return {
        condition,
        elapsedMs: Date.now() - startedAt,
        snapshot,
      };
    }

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for condition "${condition.type}" after ${timeoutMs}ms.`);
    }

    await wait(pollIntervalMs);
  }
};
