import type { ConnectionStatus, ElectronApi, RendererFatalPayload, ServerMessage } from "@spira/shared";
import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

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
const YOUTRACK_STATUS_GET_CHANNEL = "youtrack:status:get";
const YOUTRACK_TICKETS_LIST_CHANNEL = "youtrack:tickets:list";
const YOUTRACK_PROJECTS_SEARCH_CHANNEL = "youtrack:projects:search";
const PROJECT_REPO_MAPPINGS_GET_CHANNEL = "projects:mappings:get";
const PROJECT_WORKSPACE_ROOT_SET_CHANNEL = "projects:workspace-root:set";
const PROJECT_REPO_MAPPING_SET_CHANNEL = "projects:mapping:set";
const DIRECTORY_PICK_CHANNEL = "dialog:pick-directory";
const RUNTIME_CONFIG_GET_CHANNEL = "runtime-config:get";
const RUNTIME_CONFIG_SET_CHANNEL = "runtime-config:set";
const UPGRADE_RESPONSE_CHANNEL = "upgrade:respond";
const RENDERER_FATAL_CHANNEL = "renderer:fatal";

type WindowControlAction = "minimize" | "maximize" | "close";

const serverMessageListeners = new Set<(message: ServerMessage) => void>();
// TODO(multi-session): replay cache is currently keyed only by message type.
// Before enabling concurrent station streaming, make this cache station-aware.
const latestServerMessages = new Map<ServerMessage["type"], ServerMessage>();
const NON_REPLAYABLE_SERVER_MESSAGES = new Set<ServerMessage["type"]>([
  "station:created",
  "station:closed",
  "station:list:result",
  "chat:abort-complete",
  "chat:reset-complete",
  "chat:new-session-complete",
]);

ipcRenderer.on("spira:from-backend", (_event: IpcRendererEvent, message: ServerMessage) => {
  if (!NON_REPLAYABLE_SERVER_MESSAGES.has(message.type)) {
    latestServerMessages.set(message.type, message);
  }
  for (const listener of serverMessageListeners) {
    listener(message);
  }
});

const onServerMessage = <T extends ServerMessage["type"]>(
  type: T,
  handler: (message: Extract<ServerMessage, { type: T }>) => void,
): (() => void) => {
  const unsubscribe = electronAPI.onMessage((message) => {
    if (message.type === type) {
      handler(message as Extract<ServerMessage, { type: T }>);
    }
  });

  const cached = latestServerMessages.get(type);
  if (cached) {
    handler(cached as Extract<ServerMessage, { type: T }>);
  }

  return unsubscribe;
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
  sendMessage(text, conversationId, stationId) {
    electronAPI.send({ type: "chat:send", text, conversationId, stationId });
  },
  abortChat(stationId) {
    electronAPI.send({ type: "chat:abort", stationId });
  },
  resetChat(stationId) {
    electronAPI.send({ type: "chat:reset", stationId });
  },
  startNewChat(conversationId, stationId) {
    electronAPI.send({ type: "chat:new-session", conversationId, stationId });
  },
  toggleVoice() {
    electronAPI.send({ type: "voice:toggle" });
  },
  updateSettings(settings) {
    electronAPI.send({ type: "settings:update", settings });
  },
  addMcpServer(config) {
    electronAPI.send({ type: "mcp:add-server", config });
  },
  updateMcpServer(serverId, patch) {
    electronAPI.send({ type: "mcp:update-server", serverId, patch });
  },
  removeMcpServer(serverId) {
    electronAPI.send({ type: "mcp:remove-server", serverId });
  },
  setMcpServerEnabled(serverId, enabled) {
    electronAPI.send({ type: "mcp:set-enabled", serverId, enabled });
  },
  createSubagent(config) {
    electronAPI.send({ type: "subagent:create", config });
  },
  updateSubagent(agentId, patch) {
    electronAPI.send({ type: "subagent:update", agentId, patch });
  },
  removeSubagent(agentId) {
    electronAPI.send({ type: "subagent:remove", agentId });
  },
  setSubagentReady(agentId, ready) {
    electronAPI.send({ type: "subagent:set-ready", agentId, ready });
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
  getYouTrackStatus() {
    return ipcRenderer.invoke(YOUTRACK_STATUS_GET_CHANNEL);
  },
  listYouTrackTickets(limit) {
    return ipcRenderer.invoke(YOUTRACK_TICKETS_LIST_CHANNEL, { limit });
  },
  searchYouTrackProjects(query, limit) {
    return ipcRenderer.invoke(YOUTRACK_PROJECTS_SEARCH_CHANNEL, { query, limit });
  },
  getProjectRepoMappings() {
    return ipcRenderer.invoke(PROJECT_REPO_MAPPINGS_GET_CHANNEL);
  },
  setProjectWorkspaceRoot(workspaceRoot) {
    return ipcRenderer.invoke(PROJECT_WORKSPACE_ROOT_SET_CHANNEL, { workspaceRoot });
  },
  setProjectRepoMapping(projectKey, repoRelativePaths) {
    return ipcRenderer.invoke(PROJECT_REPO_MAPPING_SET_CHANNEL, { projectKey, repoRelativePaths });
  },
  pickDirectory(title) {
    return ipcRenderer.invoke(DIRECTORY_PICK_CHANNEL, { title });
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
  reportRendererFatal(payload: RendererFatalPayload) {
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
      handler({ state: message.state, stationId: message.stationId });
    });
  },
  onChatDelta(handler) {
    return onServerMessage("chat:token", (message) => {
      handler({ conversationId: message.conversationId, token: message.token, stationId: message.stationId });
    });
  },
  onChatMessage(handler) {
    return onServerMessage("chat:message", (message) => {
      handler({ message: message.message, stationId: message.stationId });
    });
  },
  onChatComplete(handler) {
    return onServerMessage("chat:complete", (message) => {
      handler({ conversationId: message.conversationId, messageId: message.messageId, stationId: message.stationId });
    });
  },
  onChatAbortComplete(handler) {
    return onServerMessage("chat:abort-complete", (message) => {
      handler({ stationId: message.stationId });
    });
  },
  onChatResetComplete(handler) {
    return onServerMessage("chat:reset-complete", (message) => {
      handler({ stationId: message.stationId });
    });
  },
  onChatNewSessionComplete(handler) {
    return onServerMessage("chat:new-session-complete", (message) => {
      handler({ preservedToMemory: message.preservedToMemory, stationId: message.stationId });
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
        stationId: message.stationId,
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
      handler({ requestId: message.requestId, result: message.result, stationId: message.stationId });
    });
  },
  onMcpStatus(handler) {
    return onServerMessage("mcp:status", (message) => {
      handler(message.servers);
    });
  },
  onSubagentCatalog(handler) {
    return onServerMessage("subagent:catalog", (message) => {
      handler(message.agents);
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
        stationId: message.stationId,
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
