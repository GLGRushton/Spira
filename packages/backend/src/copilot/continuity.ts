import type { ConversationRecord, MemoryEntryRecord, SpiraMemoryDatabase } from "@spira/memory-db";

const MAX_MEMORY_ENTRIES = 6;
const MAX_CONVERSATION_MESSAGES = 8;
const MAX_ENTRY_LENGTH = 240;
const MAX_MESSAGE_LENGTH = 320;
const MAX_PREAMBLE_LENGTH = 3_000;

const truncate = (value: string, maxLength: number): string => {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
};

const collectRelevantMemories = (
  database: SpiraMemoryDatabase,
  query: string,
  conversationId: string | null | undefined,
): MemoryEntryRecord[] => {
  const recent = database.listMemoryEntries(MAX_MEMORY_ENTRIES * 2);
  const related = conversationId ? recent.filter((entry) => entry.sourceConversationId === conversationId) : [];
  const searched = query.trim() ? database.searchMemoryEntries(query, MAX_MEMORY_ENTRIES) : [];
  const combined = [...related, ...searched, ...recent];
  const seen = new Set<string>();

  return combined.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }

    seen.add(entry.id);
    return true;
  });
};

const getConversationLines = (conversation: ConversationRecord): string[] =>
  conversation.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map(
      (message) => `${message.role === "user" ? "User" : "Shinra"}: ${truncate(message.content, MAX_MESSAGE_LENGTH)}`,
    )
    .filter((line) => line.length > 0);

export const buildContinuityPreamble = (options: {
  database: SpiraMemoryDatabase | null;
  conversationId?: string | null;
  query: string;
}): string | null => {
  const { database, conversationId, query } = options;
  if (!database) {
    return null;
  }

  const conversation = conversationId ? database.getConversation(conversationId) : null;
  const memoryEntries = collectRelevantMemories(database, query, conversationId).slice(0, MAX_MEMORY_ENTRIES);
  const sections: string[] = [];

  if (memoryEntries.length > 0) {
    sections.push(
      [
        "Remembered context:",
        ...memoryEntries.map((entry) => `- (${entry.category}) ${truncate(entry.content, MAX_ENTRY_LENGTH)}`),
      ].join("\n"),
    );
  }

  if (conversation) {
    const conversationLines = getConversationLines(conversation);
    if (conversationLines.length > 0) {
      sections.push(
        [
          `Recovered conversation thread${conversation.title ? `: ${truncate(conversation.title, 80)}` : ""}`,
          ...conversationLines,
        ].join("\n"),
      );
    }
  }

  if (sections.length === 0) {
    return null;
  }

  return truncate(
    [
      "[Recovered context]",
      "Session resume was unavailable, so continue using this durable local context.",
      ...sections,
      "[End recovered context]",
    ].join("\n\n"),
    MAX_PREAMBLE_LENGTH,
  );
};

export const buildConversationMemoryContent = (conversation: ConversationRecord): string | null => {
  const conversationLines = getConversationLines(conversation);
  if (conversationLines.length === 0) {
    return null;
  }

  const heading = conversation.title
    ? `Saved context from conversation "${truncate(conversation.title, 80)}".`
    : "Saved context from a prior conversation.";

  return truncate([heading, ...conversationLines].join("\n"), MAX_PREAMBLE_LENGTH);
};
