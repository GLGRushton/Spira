import { useEffect } from "react";
import { createChatEntityId, getChatSession, useChatStore } from "../stores/chat-store.js";
import { PRIMARY_STATION_ID, getStation, useStationStore } from "../stores/station-store.js";
import { registerChatHandlers } from "./ipc/register-chat-handlers.js";
import { activateSpiraUiRuntime, registerUiHandlers } from "./ipc/register-ui-handlers.js";
import type { IpcStationTrackerMap } from "./ipc/session-tracker.js";
import { useIpcActions } from "./ipc/use-ipc-actions.js";

export function useIpc(): void {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const actions = useIpcActions();

  useEffect(() => {
    const trackers: IpcStationTrackerMap = new Map();
    const runtimeState = { backendGeneration: null as number | null };
    const requestStationList = () => {
      window.electronAPI.send({ type: "station:list", requestId: `station-list-${createChatEntityId()}` });
    };

    actions.station.ensureStation(PRIMARY_STATION_ID);
    actions.chat.ensureStationSession(PRIMARY_STATION_ID);

    void window.electronAPI.getConnectionStatus().then((status) => {
      actions.connection.setConnectionStatus(status);
    });

    const unsubscribers = [
      ...registerChatHandlers(trackers, runtimeState, {
        hydrateConversation: actions.chat.hydrateConversation,
        ensureStationSession: actions.chat.ensureStationSession,
        removeStationSession: actions.chat.removeStationSession,
        setAssistantState: (state, stationId) => {
          actions.station.setStationState(stationId ?? PRIMARY_STATION_ID, state);
        },
        addUserMessage: actions.chat.addUserMessage,
        startAssistantMessage: actions.chat.startAssistantMessage,
        appendDelta: actions.chat.appendDelta,
        finaliseMessage: actions.chat.finaliseMessage,
        completeMessage: actions.chat.completeMessage,
        abortStreamingMessage: actions.chat.abortStreamingMessage,
        clearStreamingState: actions.chat.clearStreamingState,
        addToolCall: actions.chat.addToolCall,
        updateToolResult: actions.chat.updateToolResult,
        setActiveConversation: actions.chat.setActiveConversation,
        setAborting: actions.chat.setAborting,
        setResetConfirming: actions.chat.setResetConfirming,
        setResetting: actions.chat.setResetting,
        setSessionNotice: actions.chat.setSessionNotice,
        hydrateStations: actions.station.hydrateStations,
        upsertStation: actions.station.upsertStation,
        setStationConversation: actions.station.setStationConversation,
        setActiveStation: actions.station.setActiveStation,
        removeStation: actions.station.removeStation,
        markStationActivity: actions.station.markStationActivity,
        clearRoomState: actions.room.clearRoomState,
        handleRoomToolCall: actions.room.handleRoomToolCall,
        clearPermissionRequests: actions.permission.clearPermissionRequests,
        clearAllActiveCaptures: actions.vision.clearAllActiveCaptures,
        setActiveCapture: actions.vision.setActiveCapture,
        clearActiveCapture: actions.vision.clearActiveCapture,
        clearBanner: actions.upgrade.clearBanner,
        setConnectionStatus: actions.connection.setConnectionStatus,
        setProtocolMismatch: actions.upgrade.setProtocolMismatch,
        clearProtocolMismatch: actions.upgrade.clearProtocolMismatch,
        requestStationList,
      }),
      ...registerUiHandlers({
        setServers: actions.mcp.setServers,
        setSubagentCatalog: actions.subagent.setSubagentCatalog,
        syncRoomsFromServers: actions.room.syncRoomsFromServers,
        addPermissionRequest: actions.permission.addPermissionRequest,
        removePermissionRequest: actions.permission.removePermissionRequest,
        showUpgradeProposal: actions.upgrade.showUpgradeProposal,
        showUpgradeStatus: actions.upgrade.showUpgradeStatus,
        setAudioLevel: actions.audio.setAudioLevel,
        setTtsAmplitude: actions.audio.setTtsAmplitude,
        applySettings: actions.settings.applySettings,
        setConnectionStatus: actions.connection.setConnectionStatus,
        clearStreamingState: actions.chat.clearStreamingState,
        setAborting: actions.chat.setAborting,
        setResetConfirming: actions.chat.setResetConfirming,
        setResetting: actions.chat.setResetting,
        clearPermissionRequests: actions.permission.clearPermissionRequests,
        clearAllActiveCaptures: actions.vision.clearAllActiveCaptures,
        clearRoomState: actions.room.clearRoomState,
        handleSubagentStarted: actions.room.handleSubagentStarted,
        handleSubagentToolCall: actions.room.handleSubagentToolCall,
        handleSubagentToolResult: actions.room.handleSubagentToolResult,
        handleSubagentDelta: actions.room.handleSubagentDelta,
        handleSubagentStatus: actions.room.handleSubagentStatus,
        handleSubagentCompleted: actions.room.handleSubagentCompleted,
        handleSubagentError: actions.room.handleSubagentError,
        handleSubagentLockAcquired: actions.room.handleSubagentLockAcquired,
        handleSubagentLockDenied: actions.room.handleSubagentLockDenied,
        handleSubagentLockReleased: actions.room.handleSubagentLockReleased,
      }),
    ];

    requestStationList();
    window.electronAPI.send({ type: "ping" });
    const deactivateSpiraUiRuntime = activateSpiraUiRuntime();

    const pruneInterval = window.setInterval(() => {
      actions.room.pruneRoomFlights();
    }, 1000);

    return () => {
      deactivateSpiraUiRuntime();
      window.clearInterval(pruneInterval);
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [
    actions.audio,
    actions.chat,
    actions.connection,
    actions.mcp,
    actions.permission,
    actions.room,
    actions.settings,
    actions.station,
    actions.subagent,
    actions.upgrade,
    actions.vision,
  ]);

  const activeSession = useChatStore((store) => getChatSession(store, activeStationId));
  const activeStation = useStationStore((store) => getStation(store, activeStationId));

  useEffect(() => {
    actions.station.ensureStation(activeStationId, {
      conversationId: activeStation.conversationId,
      title: activeStation.title,
    });
    actions.chat.ensureStationSession(activeStationId);

    if (activeSession.messages.length > 0 || !activeStation.conversationId) {
      return;
    }

    let cancelled = false;
    void window.electronAPI.getConversation(activeStation.conversationId).then((conversation) => {
      if (cancelled || !conversation || conversation.id !== activeStation.conversationId) {
        return;
      }

      actions.chat.hydrateConversation(conversation, activeStationId);
      actions.chat.setActiveConversation(conversation.id, conversation.title, activeStationId);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeSession.messages.length,
    activeStation.conversationId,
    activeStation.title,
    activeStationId,
    actions.chat,
    actions.station,
  ]);
}
