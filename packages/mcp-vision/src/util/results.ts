import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const formatText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

export const successResult = <TPayload extends object>(payload: TPayload, text?: string): CallToolResult => ({
  content: [{ type: "text", text: text ?? formatText(payload) }],
  structuredContent: payload as Record<string, unknown>,
});

export const errorResult = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  structuredContent: { error: message },
  isError: true,
});
