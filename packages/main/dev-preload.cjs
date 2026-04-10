const { contextBridge, ipcRenderer } = require("electron");

const WINDOW_CONTROL_CHANNEL = "spira:window-control";
const CONNECTION_STATUS_CHANNEL = "spira:connection-status";
const CONNECTION_STATUS_GET_CHANNEL = "connection-status:get";
const SETTINGS_GET_CHANNEL = "settings:get";
const SETTINGS_SET_CHANNEL = "settings:set";
const RECENT_CONVERSATION_GET_CHANNEL = "conversation:recent:get";
const CONVERSATIONS_LIST_CHANNEL = "conversation:list";
const CONVERSATION_GET_CHANNEL = "conversation:get";
const CONVERSATION_SEARCH_CHANNEL = "conversation:search";
const CONVERSATION_MARK_VIEWED_CHANNEL = "conversation:mark-viewed";
const CONVERSATION_ARCHIVE_CHANNEL = "conversation:archive";
const RUNTIME_CONFIG_GET_CHANNEL = "runtime-config:get";
const RUNTIME_CONFIG_SET_CHANNEL = "runtime-config:set";
const UPGRADE_RESPONSE_CHANNEL = "upgrade:respond";
const RENDERER_FATAL_CHANNEL = "renderer:fatal";

const serverMessageListeners = new Set();
const latestServerMessages = new Map();
const NON_REPLAYABLE_SERVER_MESSAGES = new Set([
  "chat:abort-complete",
  "chat:reset-complete",
  "chat:new-session-complete",
]);

ipcRenderer.on("spira:from-backend", (_event, message) => {
  if (!NON_REPLAYABLE_SERVER_MESSAGES.has(message.type)) {
    latestServerMessages.set(message.type, message);
  }
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
  sendMessage(text, conversationId) {
    electronAPI.send({ type: "chat:send", text, conversationId });
  },
  abortChat() {
    electronAPI.send({ type: "chat:abort" });
  },
  resetChat() {
    electronAPI.send({ type: "chat:reset" });
  },
  startNewChat(conversationId) {
    electronAPI.send({ type: "chat:new-session", conversationId });
  },
  toggleVoice() {
    electronAPI.send({ type: "voice:toggle" });
  },
  updateSettings(settings) {
    electronAPI.send({ type: "settings:update", settings });
  },
  setMcpServerEnabled(serverId, enabled) {
    electronAPI.send({ type: "mcp:set-enabled", serverId, enabled });
  },
  getSettings() {
    return ipcRenderer.invoke(SETTINGS_GET_CHANNEL);
  },
  getConnectionStatus() {
    return ipcRenderer.invoke(CONNECTION_STATUS_GET_CHANNEL);
  },
  getRecentConversation() {
    return ipcRenderer.invoke(RECENT_CONVERSATION_GET_CHANNEL);
  },
  listConversations(limit, offset) {
    return ipcRenderer.invoke(CONVERSATIONS_LIST_CHANNEL, { limit, offset });
  },
  getConversation(conversationId) {
    return ipcRenderer.invoke(CONVERSATION_GET_CHANNEL, { conversationId });
  },
  searchConversations(query, limit) {
    return ipcRenderer.invoke(CONVERSATION_SEARCH_CHANNEL, { query, limit });
  },
  markConversationViewed(conversationId) {
    return ipcRenderer.invoke(CONVERSATION_MARK_VIEWED_CHANNEL, { conversationId });
  },
  archiveConversation(conversationId) {
    return ipcRenderer.invoke(CONVERSATION_ARCHIVE_CHANNEL, { conversationId });
  },
  getRuntimeConfig() {
    return ipcRenderer.invoke(RUNTIME_CONFIG_GET_CHANNEL);
  },
  setRuntimeConfig(update) {
    return ipcRenderer.invoke(RUNTIME_CONFIG_SET_CHANNEL, update);
  },
  setSettings(data) {
    return ipcRenderer.invoke(SETTINGS_SET_CHANNEL, data);
  },
  respondToUpgradeProposal(proposalId, approved) {
    return ipcRenderer.invoke(UPGRADE_RESPONSE_CHANNEL, { proposalId, approved });
  },
  reportRendererFatal(payload) {
    ipcRenderer.send(RENDERER_FATAL_CHANNEL, payload);
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
  onChatAbortComplete(handler) {
    return onServerMessage("chat:abort-complete", () => {
      handler();
    });
  },
  onChatResetComplete(handler) {
    return onServerMessage("chat:reset-complete", () => {
      handler();
    });
  },
  onChatNewSessionComplete(handler) {
    return onServerMessage("chat:new-session-complete", (message) => {
      handler({ preservedToMemory: message.preservedToMemory });
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
  onUpgradeProposal(handler) {
    return onServerMessage("upgrade:proposal", (message) => {
      handler({ proposal: message.proposal, message: message.message });
    });
  },
  onUpgradeStatus(handler) {
    return onServerMessage("upgrade:status", (message) => {
      const { type: _type, ...status } = message;
      handler(status);
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
