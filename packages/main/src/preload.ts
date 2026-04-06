import type { ConnectionStatus, ElectronApi, ServerMessage } from "@spira/shared";
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

const WINDOW_CONTROL_CHANNEL = "spira:window-control";
const CONNECTION_STATUS_CHANNEL = "spira:connection-status";

type WindowControlAction = "minimize" | "maximize" | "close";

const onServerMessage = <T extends ServerMessage["type"]>(
  type: T,
  handler: (message: Extract<ServerMessage, { type: T }>) => void,
): (() => void) => {
  return electronAPI.onMessage((message) => {
    if (message.type === type) {
      handler(message as Extract<ServerMessage, { type: T }>);
    }
  });
};

const onConnectionStatus = (handler: (status: ConnectionStatus) => void): (() => void) => {
  const listener = (_event: IpcRendererEvent, status: ConnectionStatus) => {
    handler(status);
  };

  ipcRenderer.on(CONNECTION_STATUS_CHANNEL, listener);
  return () => {
    ipcRenderer.off(CONNECTION_STATUS_CHANNEL, listener);
  };
};

const sendWindowControl = (action: WindowControlAction): void => {
  ipcRenderer.send(WINDOW_CONTROL_CHANNEL, action);
};

const electronAPI: ElectronApi = {
  send(message) {
    ipcRenderer.send("spira:to-backend", message);
  },
  sendMessage(text) {
    electronAPI.send({ type: "chat:send", text });
  },
  clearChat() {
    electronAPI.send({ type: "chat:clear" });
  },
  toggleVoice() {
    electronAPI.send({ type: "voice:toggle" });
  },
  updateSettings(settings) {
    electronAPI.send({ type: "settings:update", settings });
  },
  minimize() {
    sendWindowControl("minimize");
  },
  maximize() {
    sendWindowControl("maximize");
  },
  close() {
    sendWindowControl("close");
  },
  onMessage(handler) {
    const listener = (_event: IpcRendererEvent, message: ServerMessage) => {
      handler(message);
    };

    ipcRenderer.on("spira:from-backend", listener);
    return () => {
      ipcRenderer.off("spira:from-backend", listener);
    };
  },
  onStateChange(handler) {
    return onServerMessage("state:change", (message) => {
      handler(message.state);
    });
  },
  onChatDelta(handler) {
    return onServerMessage("chat:token", (message) => {
      handler({ conversationId: message.conversationId, token: message.token });
    });
  },
  onChatMessage(handler) {
    return onServerMessage("chat:message", (message) => {
      handler(message.message);
    });
  },
  onChatComplete(handler) {
    return onServerMessage("chat:complete", (message) => {
      handler({ conversationId: message.conversationId, messageId: message.messageId });
    });
  },
  onToolCall(handler) {
    return onServerMessage("tool:call", (message) => {
      handler({
        callId: message.callId,
        name: message.name,
        status: message.status,
        args: message.args,
        details: message.details,
      });
    });
  },
  onMcpStatus(handler) {
    return onServerMessage("mcp:status", (message) => {
      handler(message.servers);
    });
  },
  onAudioLevel(handler) {
    return onServerMessage("audio:level", (message) => {
      handler(message.level);
    });
  },
  onTtsAmplitude(handler) {
    return onServerMessage("tts:amplitude", (message) => {
      handler(message.amplitude);
    });
  },
  onVoiceTranscript(handler) {
    return onServerMessage("voice:transcript", (message) => {
      handler(message.text);
    });
  },
  onError(handler) {
    return onServerMessage("error", (message) => {
      handler({ code: message.code, message: message.message });
    });
  },
  onSettingsCurrent(handler) {
    return onServerMessage("settings:current", (message) => {
      handler(message.settings);
    });
  },
  onConnectionStatus,
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
