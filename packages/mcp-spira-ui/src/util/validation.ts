export { EmptySchema } from "@spira/mcp-util/validation";
import { z } from "zod";
export const RootViewSchema = z.enum(["ship", "bridge", "barracks", "mcp", "agents", "settings"]);
export const AgentRoomIdSchema = z
  .string()
  .trim()
  .regex(/^agent:.+/u)
  .transform((roomId) => roomId as `agent:${string}`);

export const ChatMessagesSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});

export const NavigateSchema = z.object({
  view: RootViewSchema,
});

export const OpenMcpServerSchema = z.object({
  serverId: z.string().trim().min(1).max(200),
});

export const McpServerQuerySchema = z.object({
  serverId: z.string().trim().min(1).max(200),
});

export const AgentRoomQuerySchema = z.object({
  roomId: AgentRoomIdSchema,
});

export const OpenAgentRoomSchema = z.object({
  roomId: AgentRoomIdSchema,
});

export const SetDraftSchema = z.object({
  draft: z.string().max(20_000),
  append: z.boolean().default(false),
});

export const SendChatSchema = z.object({
  text: z.string().max(20_000).optional(),
});

export const UpdateSettingsSchema = z.object({
  settings: z
    .object({
      voiceEnabled: z.boolean().optional(),
      wakeWordEnabled: z.boolean().optional(),
      ttsProvider: z.enum(["elevenlabs", "kokoro"]).optional(),
      whisperModel: z.enum(["tiny.en", "base.en", "small.en"]).optional(),
      wakeWordProvider: z.enum(["openwakeword", "porcupine", "none"]).optional(),
      openWakeWordThreshold: z.number().min(0).max(1).optional(),
      elevenLabsVoiceId: z.string().max(200).optional(),
      theme: z.literal("ffx").optional(),
    })
    .refine((value) => Object.keys(value).length > 0, "Provide at least one settings field."),
});

export const TtsProviderSchema = z.object({
  provider: z.enum(["elevenlabs", "kokoro"]),
});

export const PermissionResponseSchema = z.object({
  requestId: z.string().trim().min(1).max(200),
  approved: z.boolean(),
});

export const UpgradeResponseSchema = z.object({
  proposalId: z.string().trim().min(1).max(200),
  approved: z.boolean(),
});

const WaitActiveViewSchema = z.object({
  type: z.literal("active-view"),
  view: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .transform((view) => view as import("@spira/shared").SpiraUiView),
});

const WaitAssistantStateSchema = z.object({
  type: z.literal("assistant-state"),
  state: z.enum(["idle", "listening", "transcribing", "thinking", "speaking", "error"]),
});

const WaitConnectionStatusSchema = z.object({
  type: z.literal("connection-status"),
  status: z.enum(["connecting", "connected", "disconnected", "upgrading"]),
});

const WaitStreamingSchema = z.object({
  type: z.literal("streaming"),
  value: z.boolean(),
});

const WaitPermissionRequestSchema = z.object({
  type: z.literal("permission-request"),
  present: z.boolean(),
  requestId: z.string().trim().min(1).max(200).optional(),
  toolName: z.string().trim().min(1).max(200).optional(),
});

const WaitUpgradeBannerSchema = z.object({
  type: z.literal("upgrade-banner"),
  present: z.boolean(),
  proposalId: z.string().trim().min(1).max(200).optional(),
});

const WaitMcpServerStateSchema = z.object({
  type: z.literal("mcp-server-state"),
  serverId: z.string().trim().min(1).max(200),
  state: z.enum(["starting", "connected", "disconnected", "error"]),
});

const WaitAgentRoomSchema = z.object({
  type: z.literal("agent-room"),
  roomId: AgentRoomIdSchema,
  present: z.boolean(),
});

export const SpiraUiWaitConditionSchema = z.discriminatedUnion("type", [
  WaitActiveViewSchema,
  WaitAssistantStateSchema,
  WaitConnectionStatusSchema,
  WaitStreamingSchema,
  WaitPermissionRequestSchema,
  WaitUpgradeBannerSchema,
  WaitMcpServerStateSchema,
  WaitAgentRoomSchema,
]);

export const SpiraUiWaitForSchema = z.object({
  condition: SpiraUiWaitConditionSchema,
  timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
  pollIntervalMs: z.number().int().min(50).max(10_000).default(200),
});
