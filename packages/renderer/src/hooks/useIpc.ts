import { useEffect } from "react";
import { useAudioStore } from "../stores/audio-store.js";
import { createChatEntityId, getChatSession, useChatStore } from "../stores/chat-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { useMcpStore } from "../stores/mcp-store.js";
import { usePermissionStore } from "../stores/permission-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import { PRIMARY_STATION_ID, getStation, useStationStore } from "../stores/station-store.js";
import { useUpgradeStore } from "../stores/upgrade-store.js";
import { useVisionStore } from "../stores/vision-store.js";
import { registerChatHandlers } from "./ipc/register-chat-handlers.js";
import { activateSpiraUiRuntime, registerUiHandlers } from "./ipc/register-ui-handlers.js";
import type { IpcStationTrackerMap } from "./ipc/session-tracker.js";

export function useIpc(): void {
  const hydrateStations = useStationStore((store) => store.hydrateStations);
  const upsertStation = useStationStore((store) => store.upsertStation);
  const ensureStation = useStationStore((store) => store.ensureStation);
  const removeStation = useStationStore((store) => store.removeStation);
  const setActiveStation = useStationStore((store) => store.setActiveStation);
  const setStationConversation = useStationStore((store) => store.setStationConversation);
  const setStationState = useStationStore((store) => store.setStationState);
  const markStationActivity = useStationStore((store) => store.markActivity);
  const activeStationId = useStationStore((store) => store.activeStationId);
  const addUserMessage = useChatStore((store) => store.addUserMessage);
  const ensureStationSession = useChatStore((store) => store.ensureStationSession);
  const removeStationSession = useChatStore((store) => store.removeStationSession);
  const hydrateConversation = useChatStore((store) => store.hydrateConversation);
  const startAssistantMessage = useChatStore((store) => store.startAssistantMessage);
  const appendDelta = useChatStore((store) => store.appendDelta);
  const finaliseMessage = useChatStore((store) => store.finaliseMessage);
  const completeMessage = useChatStore((store) => store.completeMessage);
  const abortStreamingMessage = useChatStore((store) => store.abortStreamingMessage);
  const clearStreamingState = useChatStore((store) => store.clearStreamingState);
  const addToolCall = useChatStore((store) => store.addToolCall);
  const updateToolResult = useChatStore((store) => store.updateToolResult);
  const setActiveConversation = useChatStore((store) => store.setActiveConversation);
  const setAborting = useChatStore((store) => store.setAborting);
  const setResetConfirming = useChatStore((store) => store.setResetConfirming);
  const setResetting = useChatStore((store) => store.setResetting);
  const setSessionNotice = useChatStore((store) => store.setSessionNotice);
  const setServers = useMcpStore((store) => store.setServers);
  const clearRoomState = useRoomStore((store) => store.clearAll);
  const syncRoomsFromServers = useRoomStore((store) => store.syncServers);
  const handleRoomToolCall = useRoomStore((store) => store.handleToolCall);
  const handleSubagentStarted = useRoomStore((store) => store.handleSubagentStarted);
  const handleSubagentToolCall = useRoomStore((store) => store.handleSubagentToolCall);
  const handleSubagentToolResult = useRoomStore((store) => store.handleSubagentToolResult);
  const handleSubagentDelta = useRoomStore((store) => store.handleSubagentDelta);
  const handleSubagentStatus = useRoomStore((store) => store.handleSubagentStatus);
  const handleSubagentCompleted = useRoomStore((store) => store.handleSubagentCompleted);
  const handleSubagentError = useRoomStore((store) => store.handleSubagentError);
  const handleSubagentLockAcquired = useRoomStore((store) => store.handleSubagentLockAcquired);
  const handleSubagentLockDenied = useRoomStore((store) => store.handleSubagentLockDenied);
  const handleSubagentLockReleased = useRoomStore((store) => store.handleSubagentLockReleased);
  const pruneRoomFlights = useRoomStore((store) => store.pruneFlights);
  const setAudioLevel = useAudioStore((store) => store.setAudioLevel);
  const setTtsAmplitude = useAudioStore((store) => store.setTtsAmplitude);
  const applySettings = useSettingsStore((store) => store.applySettings);
  const setConnectionStatus = useConnectionStore((store) => store.setStatus);
  const addPermissionRequest = usePermissionStore((store) => store.addRequest);
  const removePermissionRequest = usePermissionStore((store) => store.removeRequest);
  const clearPermissionRequests = usePermissionStore((store) => store.clearRequests);
  const setActiveCapture = useVisionStore((store) => store.setActiveCapture);
  const clearActiveCapture = useVisionStore((store) => store.clearActiveCapture);
  const clearAllActiveCaptures = useVisionStore((store) => store.clearAllActiveCaptures);
  const clearBanner = useUpgradeStore((store) => store.clearBanner);
  const setProtocolMismatch = useUpgradeStore((store) => store.setProtocolMismatch);
  const clearProtocolMismatch = useUpgradeStore((store) => store.clearProtocolMismatch);
  const showUpgradeProposal = useUpgradeStore((store) => store.showProposal);
  const showUpgradeStatus = useUpgradeStore((store) => store.showStatus);

  useEffect(() => {
    const trackers: IpcStationTrackerMap = new Map();
    const runtimeState = { backendGeneration: null as number | null };
    const requestStationList = () => {
      window.electronAPI.send({ type: "station:list", requestId: `station-list-${createChatEntityId()}` });
    };

    ensureStation(PRIMARY_STATION_ID);
    ensureStationSession(PRIMARY_STATION_ID);

    void window.electronAPI.getConnectionStatus().then((status) => {
      setConnectionStatus(status);
    });

    const unsubscribers = [
      ...registerChatHandlers(trackers, runtimeState, {
        hydrateConversation,
        ensureStationSession,
        removeStationSession,
        setAssistantState: (state, stationId) => {
          setStationState(stationId ?? PRIMARY_STATION_ID, state);
        },
        addUserMessage,
        startAssistantMessage,
        appendDelta,
        finaliseMessage,
        completeMessage,
        abortStreamingMessage,
        clearStreamingState,
        addToolCall,
        updateToolResult,
        setActiveConversation,
        setAborting,
        setResetConfirming,
        setResetting,
        setSessionNotice,
        hydrateStations,
        upsertStation,
        setStationConversation,
        setActiveStation,
        removeStation,
        markStationActivity,
        clearRoomState,
        handleRoomToolCall,
        clearPermissionRequests,
        clearAllActiveCaptures,
        setActiveCapture,
        clearActiveCapture,
        clearBanner,
        setConnectionStatus,
        setProtocolMismatch,
        clearProtocolMismatch,
        requestStationList,
      }),
      ...registerUiHandlers({
        setServers,
        syncRoomsFromServers,
        addPermissionRequest,
        removePermissionRequest,
        showUpgradeProposal,
        showUpgradeStatus,
        setAudioLevel,
        setTtsAmplitude,
        applySettings,
        setConnectionStatus,
        clearStreamingState,
        setAborting,
        setResetConfirming,
        setResetting,
        clearPermissionRequests,
        clearAllActiveCaptures,
        clearRoomState,
        handleSubagentStarted,
        handleSubagentToolCall,
        handleSubagentToolResult,
        handleSubagentDelta,
        handleSubagentStatus,
        handleSubagentCompleted,
        handleSubagentError,
        handleSubagentLockAcquired,
        handleSubagentLockDenied,
        handleSubagentLockReleased,
      }),
    ];

    requestStationList();
    window.electronAPI.send({ type: "ping" });
    const deactivateSpiraUiRuntime = activateSpiraUiRuntime();

    const pruneInterval = window.setInterval(() => {
      pruneRoomFlights();
    }, 1000);

    return () => {
      deactivateSpiraUiRuntime();
      window.clearInterval(pruneInterval);
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [
    addPermissionRequest,
    addToolCall,
    addUserMessage,
    abortStreamingMessage,
    applySettings,
    appendDelta,
    clearAllActiveCaptures,
    clearActiveCapture,
    clearBanner,
    clearStreamingState,
    clearProtocolMismatch,
    clearPermissionRequests,
    clearRoomState,
    completeMessage,
    ensureStation,
    ensureStationSession,
    hydrateConversation,
    finaliseMessage,
    hydrateStations,
    markStationActivity,
    removeStation,
    removeStationSession,
    removePermissionRequest,
    setActiveStation,
    setStationConversation,
    setActiveConversation,
    setActiveCapture,
    setAborting,
    setAudioLevel,
    setConnectionStatus,
    setStationState,
    setResetConfirming,
    setResetting,
    setSessionNotice,
    syncRoomsFromServers,
    setProtocolMismatch,
    setServers,
    setTtsAmplitude,
    showUpgradeProposal,
    showUpgradeStatus,
    startAssistantMessage,
    updateToolResult,
    upsertStation,
    handleRoomToolCall,
    handleSubagentDelta,
    handleSubagentStatus,
    handleSubagentCompleted,
    handleSubagentError,
    handleSubagentLockAcquired,
    handleSubagentLockDenied,
    handleSubagentLockReleased,
    handleSubagentStarted,
    handleSubagentToolCall,
    handleSubagentToolResult,
    pruneRoomFlights,
  ]);

  const activeSession = useChatStore((store) => getChatSession(store, activeStationId));
  const activeStation = useStationStore((store) => getStation(store, activeStationId));

  useEffect(() => {
    ensureStation(activeStationId, {
      conversationId: activeStation.conversationId,
      title: activeStation.title,
    });
    ensureStationSession(activeStationId);

    if (activeSession.messages.length > 0 || !activeStation.conversationId) {
      return;
    }

    let cancelled = false;
    void window.electronAPI.getConversation(activeStation.conversationId).then((conversation) => {
      if (cancelled || !conversation || conversation.id !== activeStation.conversationId) {
        return;
      }

      hydrateConversation(conversation, activeStationId);
      setActiveConversation(conversation.id, conversation.title, activeStationId);
    });

    return () => {
      cancelled = true;
    };
  }, [
    activeSession.messages.length,
    activeStation.conversationId,
    activeStation.title,
    activeStationId,
    ensureStation,
    ensureStationSession,
    hydrateConversation,
    setActiveConversation,
  ]);
}
