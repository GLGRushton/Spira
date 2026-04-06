export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolCallId?: string;
}

export type ToolCallStatus = "pending" | "running" | "success" | "error";
