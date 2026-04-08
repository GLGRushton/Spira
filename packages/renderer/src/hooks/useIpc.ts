import { PROTOCOL_VERSION } from "@spira/shared";
import { useEffect } from "react";
import { useAssistantStore } from "../stores/assistant-store.js";
import { useAudioStore } from "../stores/audio-store.js";
import { PENDING_ASSISTANT_ID, useChatStore } from "../stores/chat-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { useMcpStore } from "../stores/mcp-store.js";
import { usePermissionStore } from "../stores/permission-store.js";
import { useSettingsStore } from "../stores/settings-store.js";
import { useUpgradeStore } from "../stores/upgrade-store.js";
import { useVisionStore } from "../stores/vision-store.js";

export function useIpc(): void {
  const setAssistantState = useAssistantStore((store) => store.setState);
  const addUserMessage = useChatStore((store) => store.addUserMessage);
  const startAssistantMessage = useChatStore((store) => store.startAssistantMessage);
  const appendDelta = useChatStore((store) => store.appendDelta);
  const finaliseMessage = useChatStore((store) => store.finaliseMessage);
  const completeMessage = useChatStore((store) => store.completeMessage);
  const clearStreamingState = useChatStore((store) => store.clearStreamingState);
  const addToolCall = useChatStore((store) => store.addToolCall);
  const updateToolResult = useChatStore((store) => store.updateToolResult);
  const setServers = useMcpStore((store) => store.setServers);
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
  const setProtocolMismatch = useUpgradeStore((store) => store.setProtocolMismatch);
  const clearProtocolMismatch = useUpgradeStore((store) => store.clearProtocolMismatch);
  const showUpgradeProposal = useUpgradeStore((store) => store.showProposal);
  const showUpgradeStatus = useUpgradeStore((store) => store.showStatus);

  useEffect(() => {
    let activeAssistantMessageId: string | null = null;
    const toolCallMessageIds = new Map<string, string>();

    void window.electronAPI.getConnectionStatus().then((status) => {
      setConnectionStatus(status);
    });

    const unsubscribers = [
      window.electronAPI.onMessage((message) => {
        if (message.type === "backend:hello") {
          clearStreamingState();
          clearPermissionRequests();
          clearAllActiveCaptures();
          if (message.protocolVersion === PROTOCOL_VERSION) {
            clearProtocolMismatch();
          } else {
            setProtocolMismatch(message.protocolVersion, message.backendBuildId);
          }
          activeAssistantMessageId = null;
          return;
        }

        if (message.type === "pong") {
          if (message.protocolVersion === PROTOCOL_VERSION) {
            clearProtocolMismatch();
          } else {
            setProtocolMismatch(message.protocolVersion, message.backendBuildId);
          }
          return;
        }

        if (message.type === "upgrade:proposal") {
          showUpgradeProposal(message.proposal, message.message);
          return;
        }

        if (message.type === "upgrade:status") {
          if (message.scope === "backend-reload") {
            const currentConnectionStatus = useConnectionStore.getState().status;
            if (message.status === "applying") {
              setConnectionStatus("upgrading");
            } else if (message.status === "completed" && currentConnectionStatus === "upgrading") {
              setConnectionStatus("connecting");
            } else if (message.status === "failed") {
              setConnectionStatus("disconnected");
            }
          }
          showUpgradeStatus(message);
        }
      }),
      window.electronAPI.onStateChange((state) => {
        setAssistantState(state);
      }),
      window.electronAPI.onChatDelta(({ conversationId, token }) => {
        if (conversationId !== activeAssistantMessageId) {
          activeAssistantMessageId = conversationId;
          if (toolCallMessageIds.size > 0) {
            for (const [callId, mappedMessageId] of toolCallMessageIds.entries()) {
              if (mappedMessageId === PENDING_ASSISTANT_ID) {
                toolCallMessageIds.set(callId, conversationId);
              }
            }
          }
          startAssistantMessage(conversationId);
        }

        appendDelta(conversationId, token);
      }),
      window.electronAPI.onChatMessage((message) => {
        if (message.role === "assistant") {
          finaliseMessage(message.id, message.content);
          activeAssistantMessageId = null;
          return;
        }

        if (message.role === "user") {
          addUserMessage(message.content);
        }
      }),
      window.electronAPI.onChatComplete(({ messageId }) => {
        completeMessage(messageId);
        if (activeAssistantMessageId === messageId) {
          activeAssistantMessageId = null;
        }
      }),
      window.electronAPI.onToolCall((payload) => {
        const messageId = activeAssistantMessageId ?? PENDING_ASSISTANT_ID;
        if (payload.name.startsWith("vision_")) {
          if (payload.status === "running" || payload.status === "pending") {
            setActiveCapture(payload.callId, payload.name, payload.args);
          } else {
            clearActiveCapture(payload.callId);
          }
        }

        if (payload.status === "running" || payload.status === "pending") {
          toolCallMessageIds.set(payload.callId, messageId);
          startAssistantMessage(messageId);
          addToolCall(messageId, {
            callId: payload.callId,
            name: payload.name,
            args: payload.args ?? {},
            details: payload.details,
            status: payload.status,
          });
          return;
        }

        const mappedMessageId = toolCallMessageIds.get(payload.callId) ?? messageId;
        updateToolResult(mappedMessageId, payload.name, {
          callId: payload.callId,
          status: payload.status,
          value: payload.details,
        });
        toolCallMessageIds.delete(payload.callId);
      }),
      window.electronAPI.onPermissionRequest((payload) => {
        addPermissionRequest(payload);
      }),
      window.electronAPI.onPermissionComplete(({ requestId }) => {
        removePermissionRequest(requestId);
      }),
      window.electronAPI.onMcpStatus((servers) => {
        setServers(servers);
      }),
      window.electronAPI.onAudioLevel((level) => {
        setAudioLevel(level);
      }),
      window.electronAPI.onTtsAmplitude((amplitude) => {
        setTtsAmplitude(amplitude);
      }),
      window.electronAPI.onVoiceTranscript((text) => {
        addUserMessage(text);
      }),
      window.electronAPI.onSettingsCurrent((settings) => {
        applySettings(settings);
      }),
      window.electronAPI.onConnectionStatus((status) => {
        setConnectionStatus(status);
        if (status !== "connected") {
          clearStreamingState();
          clearPermissionRequests();
          clearAllActiveCaptures();
        }
      }),
      window.electronAPI.onError((payload) => {
        console.error(`[Spira:${payload.source ?? "unknown"}:${payload.code}] ${payload.message}`, payload);
        if (payload.details) {
          console.error(payload.details);
        }
        if (payload.source !== "tts") {
          setAssistantState("error");
        }
        if (payload.code === "BACKEND_SOCKET_ERROR" || payload.code === "BACKEND_CRASHED") {
          setConnectionStatus("disconnected");
          clearPermissionRequests();
          clearAllActiveCaptures();
        }
      }),
    ];

    window.electronAPI.send({ type: "ping" });

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [
    addToolCall,
    addUserMessage,
    addPermissionRequest,
    appendDelta,
    applySettings,
    clearActiveCapture,
    clearAllActiveCaptures,
    clearStreamingState,
    clearProtocolMismatch,
    clearPermissionRequests,
    completeMessage,
    finaliseMessage,
    removePermissionRequest,
    setAssistantState,
    setActiveCapture,
    setAudioLevel,
    setConnectionStatus,
    setProtocolMismatch,
    setServers,
    setTtsAmplitude,
    showUpgradeProposal,
    showUpgradeStatus,
    startAssistantMessage,
    updateToolResult,
  ]);
}
