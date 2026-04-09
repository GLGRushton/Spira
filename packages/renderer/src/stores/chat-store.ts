import type {
  ConversationMessage as SharedChatMessage,
  ToolCallEntry as SharedToolCallEntry,
  StoredConversation,
} from "@spira/shared";
import { create } from "zustand";

export type ChatMessage = SharedChatMessage;
export type ToolCallEntry = SharedToolCallEntry;

export interface ChatSessionNotice {
  kind: "info" | "warning";
  message: string;
}

const hasVisibleToolActivity = (message: ChatMessage): boolean =>
  (message.toolCalls ?? []).some((toolCall) => toolCall.status === "pending" || toolCall.status === "running");

const hasMeaningfulAssistantState = (message: ChatMessage): boolean =>
  message.role !== "assistant" ||
  message.content.trim().length > 0 ||
  hasVisibleToolActivity(message) ||
  message.wasAborted === true;

const trimMessages = (messages: ChatMessage[]): ChatMessage[] =>
  messages.slice(-MAX_MESSAGES).filter(hasMeaningfulAssistantState);

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

interface ChatStore {
  messages: ChatMessage[];
  activeConversationId: string | null;
  activeConversationTitle: string | null;
  draft: string;
  composerFocusToken: number;
  sessionNotice: ChatSessionNotice | null;
  isStreaming: boolean;
  isAborting: boolean;
  isResetConfirming: boolean;
  isResetting: boolean;
  hydrateMessages: (messages: ChatMessage[]) => void;
  hydrateConversation: (conversation: StoredConversation | null) => void;
  setActiveConversation: (conversationId: string | null, title?: string | null) => void;
  addUserMessage: (text: string) => void;
  startAssistantMessage: (id: string) => void;
  appendDelta: (id: string, delta: string) => void;
  finaliseMessage: (id: string, content: string, autoSpeak?: boolean) => void;
  completeMessage: (id: string) => void;
  abortStreamingMessage: () => void;
  clearStreamingState: () => void;
  addToolCall: (messageId: string, entry: ToolCallEntry) => void;
  updateToolResult: (messageId: string, toolName: string, result: unknown) => void;
  setDraft: (draft: string) => void;
  requestComposerFocus: () => void;
  setSessionNotice: (notice: ChatSessionNotice | null) => void;
  setResetConfirming: (isResetConfirming: boolean) => void;
  setAborting: (isAborting: boolean) => void;
  setResetting: (isResetting: boolean) => void;
  clearMessages: () => void;
}

export const PENDING_ASSISTANT_ID = "pending-assistant";
const MAX_MESSAGES = 500;

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

const normalizeMessages = (messages: ChatMessage[]): ChatMessage[] =>
  trimMessages(messages).map((message) => ({
    ...message,
    isStreaming: false,
  }));

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
): ChatMessage[] => {
  return messages.map((message) => {
    if (message.id !== messageId) {
      return message;
    }

    return update(message);
  });
};

export const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  activeConversationId: null,
  activeConversationTitle: null,
  draft: "",
  composerFocusToken: 0,
  sessionNotice: null,
  isStreaming: false,
  isAborting: false,
  isResetConfirming: false,
  isResetting: false,
  hydrateMessages: (messages) => {
    set({ messages: normalizeMessages(messages) });
  },
  hydrateConversation: (conversation) => {
    set({
      activeConversationId: conversation?.id ?? null,
      activeConversationTitle: conversation?.title ?? null,
      messages: normalizeMessages(conversation?.messages ?? []),
      isStreaming: false,
      isAborting: false,
      isResetConfirming: false,
      isResetting: false,
    });
  },
  setActiveConversation: (activeConversationId, activeConversationTitle = null) => {
    set({ activeConversationId, activeConversationTitle });
  },
  addUserMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    set((state) => {
      const next = [
        ...state.messages,
        {
          id: createChatEntityId(),
          role: "user" as const,
          content: trimmed,
          timestamp: Date.now(),
        },
      ];
      return { messages: trimMessages(next) };
    });
  },
  startAssistantMessage: (id) => {
    set((state) => ({
      messages: ensureAssistantMessage(state.messages, id),
      isStreaming: true,
    }));
  },
  appendDelta: (id, delta) => {
    set((state) => {
      const ensuredMessages = ensureAssistantMessage(state.messages, id);
      return {
        messages: updateMessage(ensuredMessages, id, (message) => ({
          ...message,
          content: `${message.content}${delta}`,
          isStreaming: true,
        })),
        isStreaming: true,
      };
    });
  },
  finaliseMessage: (id, content, autoSpeak) => {
    set((state) => {
      const ensuredMessages = ensureAssistantMessage(state.messages, id);
      const messages = trimMessages(
        updateMessage(ensuredMessages, id, (message) => ({
          ...message,
          content,
          isStreaming: false,
          wasAborted: false,
          autoSpeak,
        })),
      );
      return {
        messages,
        isStreaming: false,
      };
    });
  },
  completeMessage: (id) => {
    set((state) => {
      const messages = trimMessages(
        updateMessage(state.messages, id, (message) => ({
          ...message,
          isStreaming: false,
          wasAborted: false,
        })),
      );
      return {
        messages,
        isStreaming: false,
      };
    });
  },
  abortStreamingMessage: () => {
    set((state) => {
      const messages = trimMessages(
        state.messages.map((message) => {
          if (message.role !== "assistant" || !message.isStreaming) {
            return message;
          }

          return {
            ...message,
            isStreaming: false,
            wasAborted: true,
          };
        }),
      );
      return {
        messages,
        isStreaming: false,
      };
    });
  },
  clearStreamingState: () => {
    set((state) => ({
      messages: normalizeMessages(state.messages),
      isStreaming: false,
    }));
  },
  addToolCall: (messageId, entry) => {
    set((state) => {
      const ensuredMessages = ensureAssistantMessage(state.messages, messageId);
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
        messages,
      };
    });
  },
  updateToolResult: (messageId, toolName, result) => {
    set((state) => {
      const messages = trimMessages(
        updateMessage(state.messages, messageId, (message) => {
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
      );
      return {
        messages,
      };
    });
  },
  setDraft: (draft) => {
    set({ draft });
  },
  requestComposerFocus: () => {
    set((state) => ({ composerFocusToken: state.composerFocusToken + 1 }));
  },
  setSessionNotice: (sessionNotice) => {
    set({ sessionNotice });
  },
  setResetConfirming: (isResetConfirming) => {
    set({ isResetConfirming });
  },
  setAborting: (isAborting) => {
    set({ isAborting });
  },
  setResetting: (isResetting) => {
    set({ isResetting });
  },
  clearMessages: () => {
    set({
      messages: [],
      draft: "",
      isStreaming: false,
      isAborting: false,
      isResetConfirming: false,
    });
  },
}));
