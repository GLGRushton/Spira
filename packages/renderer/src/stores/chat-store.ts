import { create } from "zustand";

export interface ToolCallEntry {
  callId?: string;
  name: string;
  args: unknown;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  details?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallEntry[];
  timestamp: number;
}

interface ChatStore {
  messages: ChatMessage[];
  isStreaming: boolean;
  addUserMessage: (text: string) => void;
  startAssistantMessage: (id: string) => void;
  appendDelta: (id: string, delta: string) => void;
  finaliseMessage: (id: string, content: string) => void;
  completeMessage: (id: string) => void;
  clearStreamingState: () => void;
  addToolCall: (messageId: string, entry: ToolCallEntry) => void;
  updateToolResult: (messageId: string, toolName: string, result: unknown) => void;
  clearMessages: () => void;
}

export const PENDING_ASSISTANT_ID = "pending-assistant";
const MAX_MESSAGES = 500;
const CHAT_STORAGE_KEY = "spira-chat-v1";

const createMessageId = (): string => {
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
  messages.slice(-MAX_MESSAGES).map((message) => ({
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

const loadPersistedMessages = (): ChatMessage[] => {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as { messages?: ChatMessage[] };
    return normalizeMessages(parsed.messages ?? []);
  } catch (error) {
    console.warn("Failed to read chat session storage", error);
    return [];
  }
};

const persistMessages = (messages: ChatMessage[]): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({
        messages: normalizeMessages(messages),
      }),
    );
  } catch (error) {
    console.warn("Failed to persist chat session storage", error);
  }
};

const clearPersistedMessages = (): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
  } catch (error) {
    console.warn("Failed to clear chat session storage", error);
  }
};

export const useChatStore = create<ChatStore>((set) => ({
  messages: loadPersistedMessages(),
  isStreaming: false,
  addUserMessage: (text) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    set((state) => {
      const next = [
        ...state.messages,
        {
          id: createMessageId(),
          role: "user" as const,
          content: trimmed,
          timestamp: Date.now(),
        },
      ];
      const messages = next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
      persistMessages(messages);
      return { messages };
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
  finaliseMessage: (id, content) => {
    set((state) => {
      const ensuredMessages = ensureAssistantMessage(state.messages, id);
      const messages = updateMessage(ensuredMessages, id, (message) => ({
        ...message,
        content,
        isStreaming: false,
      }));
      persistMessages(messages);
      return {
        messages,
        isStreaming: false,
      };
    });
  },
  completeMessage: (id) => {
    set((state) => {
      const messages = updateMessage(state.messages, id, (message) => ({
        ...message,
        isStreaming: false,
      }));
      persistMessages(messages);
      return {
        messages,
        isStreaming: false,
      };
    });
  },
  clearStreamingState: () => {
    set((state) => {
      const messages = normalizeMessages(state.messages);
      persistMessages(messages);
      return {
        messages,
        isStreaming: false,
      };
    });
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
      persistMessages(messages);
      return {
        messages,
      };
    });
  },
  updateToolResult: (messageId, toolName, result) => {
    set((state) => {
      const messages = updateMessage(state.messages, messageId, (message) => {
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
      });
      persistMessages(messages);
      return {
        messages,
      };
    });
  },
  clearMessages: () => {
    clearPersistedMessages();
    set({ messages: [], isStreaming: false });
  },
}));
