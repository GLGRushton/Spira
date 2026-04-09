export interface ToolCallEntry {
  callId?: string;
  name: string;
  args: unknown;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  details?: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  wasAborted?: boolean;
  autoSpeak?: boolean;
  toolCalls?: ToolCallEntry[];
  timestamp: number;
}

export interface StoredConversationSummary {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number | null;
  lastViewedAt: number | null;
  messageCount: number;
}

export interface StoredConversation extends StoredConversationSummary {
  messages: ConversationMessage[];
}

export interface ConversationSearchMatch {
  conversationId: string;
  conversationTitle: string | null;
  messageId: string;
  role: "user" | "assistant" | "system";
  timestamp: number;
  snippet: string;
  score: number;
}
