import { z } from "zod";

export const MemoryCategorySchema = z.enum(["user-preference", "fact", "task-context", "correction"]);

export const ConversationListSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
});

export const ConversationQuerySchema = z.object({
  conversationId: z.string().trim().min(1).max(200),
});

export const ConversationSearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
});

export const MemoryListSchema = z.object({
  limit: z.number().int().min(1).max(50).default(10),
  category: MemoryCategorySchema.optional(),
});

export const MemorySearchSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50).default(10),
  category: MemoryCategorySchema.optional(),
});

export const RememberMemorySchema = z.object({
  content: z.string().trim().min(1).max(2_000),
  category: MemoryCategorySchema.default("task-context"),
  sourceConversationId: z.string().trim().min(1).max(200).optional(),
  sourceMessageId: z.string().trim().min(1).max(200).optional(),
});

export const UpdateMemorySchema = z
  .object({
    memoryId: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(2_000).optional(),
    category: MemoryCategorySchema.optional(),
  })
  .refine((value) => value.content !== undefined || value.category !== undefined, {
    message: "Provide content or category to update the memory entry.",
  });

export const ForgetMemorySchema = z.object({
  memoryId: z.string().trim().min(1).max(200),
});
