import {
  SPIRA_UI_ACTION_TYPES,
  SPIRA_UI_CONTROL_BRIDGE_VERSION,
  SPIRA_UI_ROOT_VIEWS,
  SPIRA_UI_WAIT_CONDITION_TYPES,
  type SpiraUiBridgeCommand,
  type SpiraUiBridgeResult,
  type SpiraUiCapabilities,
} from "@spira/shared";
import { performSpiraUiAction } from "./control-actions.js";
import { buildSpiraUiChatTranscript, buildSpiraUiSnapshot } from "./control-snapshot.js";
import { waitForSpiraUiCondition } from "./control-waits.js";

let spiraUiControlReady = false;

const getCapabilities = (): SpiraUiCapabilities => ({
  bridgeVersion: SPIRA_UI_CONTROL_BRIDGE_VERSION,
  rootViews: [...SPIRA_UI_ROOT_VIEWS],
  actionTypes: [...SPIRA_UI_ACTION_TYPES],
  waitConditionTypes: [...SPIRA_UI_WAIT_CONDITION_TYPES],
});

export const setSpiraUiControlReady = (ready: boolean): void => {
  spiraUiControlReady = ready;
};

const handleSpiraUiCommand = async (command: SpiraUiBridgeCommand): Promise<SpiraUiBridgeResult> => {
  if (command.kind !== "ping" && command.kind !== "get-capabilities" && !spiraUiControlReady) {
    throw new Error("Renderer control runtime is unavailable.");
  }

  switch (command.kind) {
    case "ping":
      return {
        type: "pong",
        capabilities: getCapabilities(),
      };
    case "get-capabilities":
      return {
        type: "capabilities",
        capabilities: getCapabilities(),
      };
    case "get-snapshot":
      return {
        type: "snapshot",
        snapshot: buildSpiraUiSnapshot(),
      };
    case "get-chat-messages":
      return {
        type: "chat-messages",
        transcript: buildSpiraUiChatTranscript(command.limit),
      };
    case "perform-action":
      return {
        type: "action-result",
        action: command.action.type,
        snapshot: await performSpiraUiAction(command.action),
      };
    case "wait-for":
      return {
        type: "wait-result",
        ...(await waitForSpiraUiCondition(command.condition, {
          timeoutMs: command.timeoutMs,
          pollIntervalMs: command.pollIntervalMs,
        })),
      };
    default: {
      const exhaustiveCheck: never = command;
      throw new Error(`Unsupported UI bridge command: ${String(exhaustiveCheck)}`);
    }
  }
};

export const installSpiraUiControlRuntime = (): void => {
  window.__spiraUiControl = {
    handleRequest: handleSpiraUiCommand,
  };
};
