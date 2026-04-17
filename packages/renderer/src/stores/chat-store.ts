import type {
  ConversationMessage as SharedChatMessage,
  ToolCallEntry as SharedToolCallEntry,
  StationId,
  StoredConversation,
} from "@spira/shared";
import { create } from "zustand";
import { PRIMARY_STATION_ID, useStationStore } from "./station-store.js";

export type ChatMessage = SharedChatMessage;
export type ToolCallEntry = SharedToolCallEntry;

export interface ChatSessionNotice {
  kind: "info" | "warning";
  message: string;
}

export interface ChatSessionState {
  messages: ChatMessage[];
  activeConversationId: string | null;
  activeConversationTitle: string | null;
  historyWasTrimmed: boolean;
  draft: string;
  composerFocusToken: number;
  sessionNotice: ChatSessionNotice | null;
  isStreaming: boolean;
  isAborting: boolean;
  isResetConfirming: boolean;
  isResetting: boolean;
}

interface ChatStore {
  sessions: Record<StationId, ChatSessionState>;
  ensureStationSession: (stationId?: StationId) => void;
  removeStationSession: (stationId: StationId) => void;
  hydrateMessages: (messages: ChatMessage[], stationId?: StationId) => void;
  hydrateConversation: (conversation: StoredConversation | null, stationId?: StationId) => void;
  setActiveConversation: (conversationId: string | null, title?: string | null, stationId?: StationId) => void;
  addUserMessage: (text: string, stationId?: StationId) => void;
  startAssistantMessage: (id: string, stationId?: StationId) => void;
  appendDelta: (id: string, delta: string, stationId?: StationId) => void;
  finaliseMessage: (id: string, content: string, autoSpeak?: boolean, stationId?: StationId) => void;
  completeMessage: (id: string, stationId?: StationId) => void;
  abortStreamingMessage: (stationId?: StationId) => void;
  clearStreamingState: (stationId?: StationId) => void;
  addToolCall: (messageId: string, entry: ToolCallEntry, stationId?: StationId) => void;
  updateToolResult: (messageId: string, toolName: string, result: unknown, stationId?: StationId) => void;
  setDraft: (draft: string, stationId?: StationId) => void;
  requestComposerFocus: (stationId?: StationId) => void;
  setSessionNotice: (notice: ChatSessionNotice | null, stationId?: StationId) => void;
  setResetConfirming: (isResetConfirming: boolean, stationId?: StationId) => void;
  setAborting: (isAborting: boolean, stationId?: StationId) => void;
  setResetting: (isResetting: boolean, stationId?: StationId) => void;
  clearMessages: (stationId?: StationId) => void;
}

const MAX_MESSAGES = 500;
export const PENDING_ASSISTANT_ID = "pending-assistant";

const hasVisibleToolActivity = (message: ChatMessage): boolean =>
  (message.toolCalls ?? []).some((toolCall) => toolCall.status === "pending" || toolCall.status === "running");

const hasMeaningfulAssistantState = (message: ChatMessage): boolean =>
  message.role !== "assistant" ||
  message.content.trim().length > 0 ||
  hasVisibleToolActivity(message) ||
  message.wasAborted === true;

const trimMessages = (messages: ChatMessage[]): { messages: ChatMessage[]; wasTrimmed: boolean } => {
  const meaningfulMessages = messages.filter(hasMeaningfulAssistantState);
  return {
    messages: meaningfulMessages.slice(-MAX_MESSAGES),
    wasTrimmed: meaningfulMessages.length > MAX_MESSAGES,
  };
};

export const getLatestCompletedAssistantMessage = (messages: ChatMessage[]): ChatMessage | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && !message.isStreaming) {
      return message;
    }
  }

  return undefined;
};

export const getAwaitingAssistantQuestion = (messages: ChatMessage[]): ChatMessage | undefined => {
  const assistantMessage = getLatestCompletedAssistantMessage(messages);
  if (!assistantMessage) {
    return undefined;
  }

  const assistantIndex = messages.findIndex((message) => message.id === assistantMessage.id);
  if (assistantIndex < 0) {
    return undefined;
  }

  let foundUserMessage = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      foundUserMessage = true;
      if (index > assistantIndex) {
        return undefined;
      }
      break;
    }
  }

  return foundUserMessage && assistantMessage.content.trim().endsWith("?") ? assistantMessage : undefined;
};

export const createEmptyChatSessionState = (): ChatSessionState => ({
  messages: [],
  activeConversationId: null,
  activeConversationTitle: null,
  historyWasTrimmed: false,
  draft: "",
  composerFocusToken: 0,
  sessionNotice: null,
  isStreaming: false,
  isAborting: false,
  isResetConfirming: false,
  isResetting: false,
});

export const createChatEntityId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createAssistantMessage = (id: string): ChatMessage => ({
  id,
  role: "assistant",
  content: "",
  isStreaming: true,
  toolCalls: [],
  timestamp: Date.now(),
});

const normalizeMessages = (messages: ChatMessage[]): { messages: ChatMessage[]; wasTrimmed: boolean } => {
  const trimmed = trimMessages(messages);
  return {
    messages: trimmed.messages.map((message) => ({
      ...message,
      isStreaming: false,
    })),
    wasTrimmed: trimmed.wasTrimmed,
  };
};

const getTrimmedSessionUpdate = (
  session: ChatSessionState,
  messages: ChatMessage[],
): Pick<ChatSessionState, "messages" | "historyWasTrimmed"> => {
  const trimmed = trimMessages(messages);
  return {
    messages: trimmed.messages,
    historyWasTrimmed: session.historyWasTrimmed || trimmed.wasTrimmed,
  };
};

const getNormalizedSessionUpdate = (
  messages: ChatMessage[],
): Pick<ChatSessionState, "messages" | "historyWasTrimmed"> => {
  const normalized = normalizeMessages(messages);
  return {
    messages: normalized.messages,
    historyWasTrimmed: normalized.wasTrimmed,
  };
};

const ensureAssistantMessage = (messages: ChatMessage[], id: string): ChatMessage[] => {
  if (messages.some((message) => message.id === id)) {
    return messages;
  }

  const placeholderIndex = messages.findIndex((message) => message.id === PENDING_ASSISTANT_ID);
  if (placeholderIndex >= 0) {
    return messages.map((message, index) => {
      if (index !== placeholderIndex) {
        return message;
      }

      return {
        ...message,
        id,
      };
    });
  }

  return [...messages, createAssistantMessage(id)];
};

const updateMessage = (
  messages: ChatMessage[],
  messageId: string,
  update: (message: ChatMessage) => ChatMessage,
): ChatMessage[] =>
  messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    return update(message);
  });

const resolveStationId = (stationId?: StationId): StationId => stationId ?? useStationStore.getState().activeStationId;

export const getChatSession = (store: Pick<ChatStore, "sessions">, stationId?: StationId): ChatSessionState =>
  store.sessions[resolveStationId(stationId)] ?? createEmptyChatSessionState();

const updateSessionState = (
  state: ChatStore,
  stationId: StationId,
  updater: (session: ChatSessionState) => ChatSessionState,
): Pick<ChatStore, "sessions"> => ({
  sessions: {
    ...state.sessions,
    [stationId]: updater(getChatSession(state, stationId)),
  },
});

export const useChatStore = create<ChatStore>((set) => ({
  sessions: {
    [PRIMARY_STATION_ID]: createEmptyChatSessionState(),
  },
  ensureStationSession: (stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => {
      if (state.sessions[resolvedStationId]) {
        return state;
      }

      return updateSessionState(state, resolvedStationId, () => createEmptyChatSessionState());
    });
  },
  removeStationSession: (stationId) => {
    if (stationId === PRIMARY_STATION_ID) {
      return;
    }

    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[stationId];
      return { sessions };
    });
  },
  hydrateMessages: (messages, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        ...getNormalizedSessionUpdate(messages),
      })),
    );
  },
  hydrateConversation: (conversation, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        activeConversationId: conversation?.id ?? null,
        activeConversationTitle: conversation?.title ?? null,
        ...getNormalizedSessionUpdate(conversation?.messages ?? []),
        isStreaming: false,
        isAborting: false,
        isResetConfirming: false,
        isResetting: false,
      })),
    );
  },
  setActiveConversation: (activeConversationId, activeConversationTitle = null, stationId = undefined) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        activeConversationId,
        activeConversationTitle,
      })),
    );
  },
  addUserMessage: (text, stationId) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => {
        const next = [
          ...session.messages,
          {
            id: createChatEntityId(),
            role: "user" as const,
            content: trimmed,
            timestamp: Date.now(),
          },
        ];
        return {
          ...session,
          ...getTrimmedSessionUpdate(session, next),
        };
      }),
    );
  },
  startAssistantMessage: (id, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        messages: ensureAssistantMessage(session.messages, id),
        isStreaming: true,
      })),
    );
  },
  appendDelta: (id, delta, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => {
        const ensuredMessages = ensureAssistantMessage(session.messages, id);
        return {
          ...session,
          messages: updateMessage(ensuredMessages, id, (message) => ({
            ...message,
            content: `${message.content}${delta}`,
            isStreaming: true,
          })),
          isStreaming: true,
        };
      }),
    );
  },
  finaliseMessage: (id, content, autoSpeak, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => {
        const ensuredMessages = ensureAssistantMessage(session.messages, id);
        return {
          ...session,
          ...getTrimmedSessionUpdate(
            session,
            updateMessage(ensuredMessages, id, (message) => ({
              ...message,
              content,
              isStreaming: false,
              wasAborted: false,
              autoSpeak,
            })),
          ),
          isStreaming: false,
        };
      }),
    );
  },
  completeMessage: (id, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        ...getTrimmedSessionUpdate(
          session,
          updateMessage(session.messages, id, (message) => ({
            ...message,
            isStreaming: false,
            wasAborted: false,
          })),
        ),
        isStreaming: false,
      })),
    );
  },
  abortStreamingMessage: (stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        ...getTrimmedSessionUpdate(
          session,
          session.messages.map((message) => {
            if (message.role !== "assistant" || !message.isStreaming) {
              return message;
            }

            return {
              ...message,
              isStreaming: false,
              wasAborted: true,
            };
          }),
        ),
        isStreaming: false,
      })),
    );
  },
  clearStreamingState: (stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        ...getTrimmedSessionUpdate(session, normalizeMessages(session.messages).messages),
        isStreaming: false,
      })),
    );
  },
  addToolCall: (messageId, entry, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => {
        const ensuredMessages = ensureAssistantMessage(session.messages, messageId);
        const messages = updateMessage(ensuredMessages, messageId, (message) => {
          const toolCalls = message.toolCalls ?? [];
          const existingIndex = entry.callId ? toolCalls.findIndex((toolCall) => toolCall.callId === entry.callId) : -1;
          if (existingIndex >= 0) {
            return {
              ...message,
              toolCalls: toolCalls.map((toolCall, index) => {
                if (index !== existingIndex) {
                  return toolCall;
                }

                return {
                  ...toolCall,
                  ...entry,
                };
              }),
            };
          }

          return {
            ...message,
            toolCalls: [...toolCalls, entry],
          };
        });
        return {
          ...session,
          messages,
        };
      }),
    );
  },
  updateToolResult: (messageId, toolName, result, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        ...getTrimmedSessionUpdate(
          session,
          updateMessage(session.messages, messageId, (message) => {
            const toolCalls = message.toolCalls ?? [];
            const resultPayload =
              result && typeof result === "object"
                ? (result as { callId?: string; status?: ToolCallEntry["status"] })
                : undefined;
            const resultCallId = typeof resultPayload?.callId === "string" ? resultPayload.callId : undefined;
            const targetIndex = [...toolCalls]
              .reverse()
              .findIndex((toolCall) => (resultCallId ? toolCall.callId === resultCallId : toolCall.name === toolName));

            if (targetIndex < 0) {
              return message;
            }

            const index = toolCalls.length - 1 - targetIndex;
            return {
              ...message,
              toolCalls: toolCalls.map((toolCall, toolIndex) => {
                if (toolIndex !== index) {
                  return toolCall;
                }

                return {
                  ...toolCall,
                  result,
                  status: resultPayload?.status ?? "success",
                };
              }),
            };
          }),
        ),
      })),
    );
  },
  setDraft: (draft, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        draft,
      })),
    );
  },
  requestComposerFocus: (stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        composerFocusToken: session.composerFocusToken + 1,
      })),
    );
  },
  setSessionNotice: (sessionNotice, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        sessionNotice,
      })),
    );
  },
  setResetConfirming: (isResetConfirming, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        isResetConfirming,
      })),
    );
  },
  setAborting: (isAborting, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        isAborting,
      })),
    );
  },
  setResetting: (isResetting, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        isResetting,
      })),
    );
  },
  clearMessages: (stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) =>
      updateSessionState(state, resolvedStationId, (session) => ({
        ...session,
        messages: [],
        historyWasTrimmed: false,
        draft: "",
        isStreaming: false,
        isAborting: false,
        isResetConfirming: false,
      })),
    );
  },
}));
