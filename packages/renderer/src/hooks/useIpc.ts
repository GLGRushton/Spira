import { useEffect } from "react";
import { useAssistantStore } from "../stores/assistant-store.js";
import { useAudioStore } from "../stores/audio-store.js";
import { PENDING_ASSISTANT_ID, useChatStore } from "../stores/chat-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { useMcpStore } from "../stores/mcp-store.js";
import { useSettingsStore } from "../stores/settings-store.js";

export function useIpc(): void {
  const setAssistantState = useAssistantStore((store) => store.setState);
  const addUserMessage = useChatStore((store) => store.addUserMessage);
  const startAssistantMessage = useChatStore((store) => store.startAssistantMessage);
  const appendDelta = useChatStore((store) => store.appendDelta);
  const finaliseMessage = useChatStore((store) => store.finaliseMessage);
  const completeMessage = useChatStore((store) => store.completeMessage);
  const addToolCall = useChatStore((store) => store.addToolCall);
  const updateToolResult = useChatStore((store) => store.updateToolResult);
  const setServers = useMcpStore((store) => store.setServers);
  const setAudioLevel = useAudioStore((store) => store.setAudioLevel);
  const setTtsAmplitude = useAudioStore((store) => store.setTtsAmplitude);
  const applySettings = useSettingsStore((store) => store.applySettings);
  const setConnectionStatus = useConnectionStore((store) => store.setStatus);

  useEffect(() => {
    let activeAssistantMessageId: string | null = null;
    const toolCallMessageIds = new Map<string, string>();

    const unsubscribers = [
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
      }),
      window.electronAPI.onError(({ code, message }) => {
        console.error(`[Spira:${code}] ${message}`);
        setAssistantState("error");
        if (code === "BACKEND_SOCKET_ERROR" || code === "BACKEND_CRASHED") {
          setConnectionStatus("disconnected");
        }
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [
    addToolCall,
    addUserMessage,
    appendDelta,
    applySettings,
    completeMessage,
    finaliseMessage,
    setAssistantState,
    setAudioLevel,
    setConnectionStatus,
    setServers,
    setTtsAmplitude,
    startAssistantMessage,
    updateToolResult,
  ]);
}
