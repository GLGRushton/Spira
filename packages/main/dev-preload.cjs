const { contextBridge, ipcRenderer } = require("electron");

const WINDOW_CONTROL_CHANNEL = "spira:window-control";
const CONNECTION_STATUS_CHANNEL = "spira:connection-status";
const CONNECTION_STATUS_GET_CHANNEL = "connection-status:get";
const SETTINGS_GET_CHANNEL = "settings:get";
const SETTINGS_SET_CHANNEL = "settings:set";

const serverMessageListeners = new Set();
const latestServerMessages = new Map();

ipcRenderer.on("spira:from-backend", (_event, message) => {
  latestServerMessages.set(message.type, message);
  for (const listener of serverMessageListeners) {
    listener(message);
  }
});

function onServerMessage(type, handler) {
  const unsubscribe = electronAPI.onMessage((message) => {
    if (message.type === type) {
      handler(message);
    }
  });

  const cached = latestServerMessages.get(type);
  if (cached) {
    handler(cached);
  }

  return unsubscribe;
}

function onConnectionStatus(handler) {
  const listener = (_event, status) => {
    handler(status);
  };

  ipcRenderer.on(CONNECTION_STATUS_CHANNEL, listener);
  return () => {
    ipcRenderer.off(CONNECTION_STATUS_CHANNEL, listener);
  };
}

function sendWindowControl(action) {
  ipcRenderer.send(WINDOW_CONTROL_CHANNEL, action);
}

const electronAPI = {
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
  getSettings() {
    return ipcRenderer.invoke(SETTINGS_GET_CHANNEL);
  },
  getConnectionStatus() {
    return ipcRenderer.invoke(CONNECTION_STATUS_GET_CHANNEL);
  },
  setSettings(data) {
    return ipcRenderer.invoke(SETTINGS_SET_CHANNEL, data);
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
    serverMessageListeners.add(handler);
    return () => {
      serverMessageListeners.delete(handler);
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
  onPermissionRequest(handler) {
    return onServerMessage("permission:request", (message) => {
      handler(message.request);
    });
  },
  onPermissionComplete(handler) {
    return onServerMessage("permission:complete", (message) => {
      handler({ requestId: message.requestId, result: message.result });
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
      handler({
        code: message.code,
        message: message.message,
        details: message.details,
        source: message.source,
      });
    });
  },
  onSettingsCurrent(handler) {
    return onServerMessage("settings:current", (message) => {
      handler(message.settings);
    });
  },
  onConnectionStatus,
  onUpdateAvailable(callback) {
    ipcRenderer.on("update:available", (_event, info) => {
      callback(info);
    });
  },
  onUpdateDownloaded(callback) {
    ipcRenderer.on("update:downloaded", (_event, info) => {
      callback(info);
    });
  },
};

contextBridge.exposeInMainWorld("electronAPI", electronAPI);
