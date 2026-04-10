import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyChatSessionState, getChatSession, useChatStore } from "./chat-store.js";
import { PRIMARY_STATION_ID } from "./station-store.js";

const resetChatStore = (): void => {
  useChatStore.setState({
    sessions: {
      [PRIMARY_STATION_ID]: createEmptyChatSessionState(),
    },
  });
};

describe("chat-store", () => {
  beforeEach(() => {
    resetChatStore();
  });

  it("drops completed assistant placeholders that never received content", () => {
    const chat = useChatStore.getState();

    chat.startAssistantMessage("assistant-1");
    chat.completeMessage("assistant-1");

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toEqual([]);
  });

  it("keeps tool-only placeholders visible only while work is still running", () => {
    const chat = useChatStore.getState();

    chat.addToolCall("assistant-1", {
      callId: "call-1",
      name: "view",
      args: {},
      status: "running",
    });
    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toHaveLength(1);

    chat.updateToolResult("assistant-1", "view", {
      callId: "call-1",
      status: "success",
      value: "done",
    });

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toEqual([]);
  });

  it("keeps assistant replies that contain content", () => {
    const chat = useChatStore.getState();

    chat.startAssistantMessage("assistant-1");
    chat.finaliseMessage("assistant-1", "Operational.", true);

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toMatchObject([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Operational.",
        isStreaming: false,
      },
    ]);
  });

  it("hydrates persisted messages as completed transcript entries", () => {
    useChatStore.getState().hydrateMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Recovered from disk.",
        isStreaming: true,
        timestamp: 1,
      },
    ]);

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toMatchObject([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Recovered from disk.",
        isStreaming: false,
        timestamp: 1,
      },
    ]);
  });

  it("drops empty persisted assistant placeholders during hydration", () => {
    useChatStore.getState().hydrateMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        isStreaming: false,
        timestamp: 1,
      },
    ]);

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toEqual([]);
  });

  it("keeps aborted assistant placeholders visible", () => {
    const chat = useChatStore.getState();

    chat.startAssistantMessage("assistant-1");
    chat.abortStreamingMessage();

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toMatchObject([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        isStreaming: false,
        wasAborted: true,
      },
    ]);
  });

  it("hydrates persisted user messages without altering their content", () => {
    useChatStore.getState().hydrateMessages([
      {
        id: "user-1",
        role: "user",
        content: "Still here.",
        timestamp: 1,
      },
    ]);

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID).messages).toEqual([
      {
        id: "user-1",
        role: "user",
        content: "Still here.",
        isStreaming: false,
        timestamp: 1,
      },
    ]);
  });

  it("hydrates stored conversations and tracks the active conversation metadata", () => {
    useChatStore.getState().hydrateConversation({
      id: "conversation-1",
      title: "Recovered thread",
      createdAt: 1,
      updatedAt: 2,
      lastMessageAt: 2,
      lastViewedAt: 2,
      messageCount: 1,
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Recovered from the archive.",
          timestamp: 2,
        },
      ],
    });

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID)).toMatchObject({
      activeConversationId: "conversation-1",
      activeConversationTitle: "Recovered thread",
      messages: [
        {
          id: "assistant-1",
          content: "Recovered from the archive.",
        },
      ],
    });
  });

  it("keeps station transcripts isolated", () => {
    const chat = useChatStore.getState();

    chat.addUserMessage("Primary thread", PRIMARY_STATION_ID);
    chat.addUserMessage("Bravo thread", "bravo");
    chat.setDraft("Primary draft", PRIMARY_STATION_ID);
    chat.setDraft("Bravo draft", "bravo");

    expect(getChatSession(useChatStore.getState(), PRIMARY_STATION_ID)).toMatchObject({
      draft: "Primary draft",
      messages: [{ content: "Primary thread" }],
    });
    expect(getChatSession(useChatStore.getState(), "bravo")).toMatchObject({
      draft: "Bravo draft",
      messages: [{ content: "Bravo thread" }],
    });
  });
});
