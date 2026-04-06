export type ChatMessage =
  | { id: string; role: "user" | "assistant"; content: string; timestamp: number }
  | { id: string; role: "tool"; content: string; timestamp: number; toolCallId: string };

export type ToolCallStatus = "pending" | "running" | "success" | "error";
