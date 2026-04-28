import { type ClientMessage, McpServerConfigSchema } from "@spira/shared";
import { z } from "zod";

const StringArraySchema = z.array(z.string());
const StringRecordSchema = z.record(z.string());
const OptionalStationIdSchema = z.string().optional();

const messageSchema = <TType extends string>(type: TType, shape: z.ZodRawShape = {}) =>
  z
    .object({
      type: z.literal(type),
      ...shape,
    })
    .strict();

const YouTrackStateMappingSchema = z
  .object({
    todo: StringArraySchema,
    inProgress: StringArraySchema,
  })
  .strict();

const StartTicketRunRequestSchema = z
  .object({
    ticketId: z.string(),
    ticketSummary: z.string(),
    ticketUrl: z.string(),
    projectKey: z.string(),
  })
  .strict();

const McpToolAccessPolicySchema = z
  .object({
    readOnlyToolNames: StringArraySchema.optional(),
    writeToolNames: StringArraySchema.optional(),
  })
  .strict();

const McpServerUpdateConfigSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    command: z.string().optional(),
    args: StringArraySchema.optional(),
    env: StringRecordSchema.optional(),
    url: z.string().optional(),
    headers: StringRecordSchema.optional(),
    toolAccess: McpToolAccessPolicySchema.optional(),
    enabled: z.boolean().optional(),
    autoRestart: z.boolean().optional(),
    maxRestarts: z.number().optional(),
  })
  .strict();

const PartialUserSettingsSchema = z
  .object({
    voiceEnabled: z.boolean().optional(),
    wakeWordEnabled: z.boolean().optional(),
    youTrackEnabled: z.boolean().optional(),
    ttsProvider: z.enum(["elevenlabs", "kokoro"]).optional(),
    whisperModel: z.enum(["tiny.en", "base.en", "small.en"]).optional(),
    wakeWordProvider: z.enum(["openwakeword", "porcupine", "none"]).optional(),
    openWakeWordThreshold: z.number().optional(),
    elevenLabsVoiceId: z.string().optional(),
    theme: z.literal("ffx").optional(),
  })
  .strict();

const SubagentCreateConfigSchema = z
  .object({
    id: z.string().optional(),
    label: z.string(),
    description: z.string().optional(),
    serverIds: StringArraySchema,
    allowedToolNames: StringArraySchema.nullable().optional(),
    allowWrites: z.boolean(),
    systemPrompt: z.string(),
    ready: z.boolean().optional(),
    delegationToolName: z.string().optional(),
  })
  .strict();

const SubagentUpdateConfigSchema = z
  .object({
    label: z.string().optional(),
    description: z.string().optional(),
    serverIds: StringArraySchema.optional(),
    allowedToolNames: StringArraySchema.nullable().optional(),
    allowWrites: z.boolean().optional(),
    systemPrompt: z.string().optional(),
    ready: z.boolean().optional(),
  })
  .strict();

const ClientMessageSchema = z.discriminatedUnion("type", [
  messageSchema("station:create", { label: z.string().optional() }),
  messageSchema("station:close", { stationId: z.string() }),
  messageSchema("station:list", { requestId: z.string() }),
  messageSchema("chat:send", {
    text: z.string(),
    conversationId: z.string().optional(),
    stationId: OptionalStationIdSchema,
  }),
  messageSchema("chat:abort", { stationId: OptionalStationIdSchema }),
  messageSchema("chat:reset", { stationId: OptionalStationIdSchema }),
  messageSchema("chat:new-session", {
    conversationId: z.string().optional(),
    stationId: OptionalStationIdSchema,
  }),
  messageSchema("conversation:recent:get", { requestId: z.string() }),
  messageSchema("conversation:list", {
    requestId: z.string(),
    limit: z.number().optional(),
    offset: z.number().optional(),
  }),
  messageSchema("conversation:get", {
    requestId: z.string(),
    conversationId: z.string(),
  }),
  messageSchema("conversation:search", {
    requestId: z.string(),
    query: z.string(),
    limit: z.number().optional(),
  }),
  messageSchema("conversation:mark-viewed", {
    requestId: z.string(),
    conversationId: z.string(),
  }),
  messageSchema("conversation:archive", {
    requestId: z.string(),
    conversationId: z.string(),
  }),
  messageSchema("youtrack:status:get", {
    requestId: z.string(),
    enabled: z.boolean(),
  }),
  messageSchema("youtrack:tickets:list", {
    requestId: z.string(),
    enabled: z.boolean(),
    limit: z.number().optional(),
  }),
  messageSchema("youtrack:projects:search", {
    requestId: z.string(),
    enabled: z.boolean(),
    query: z.string(),
    limit: z.number().optional(),
  }),
  messageSchema("youtrack:state-mapping:set", {
    requestId: z.string(),
    enabled: z.boolean(),
    mapping: YouTrackStateMappingSchema,
  }),
  messageSchema("projects:snapshot:get", { requestId: z.string() }),
  messageSchema("projects:workspace-root:set", {
    requestId: z.string(),
    workspaceRoot: z.string().nullable(),
  }),
  messageSchema("projects:mapping:set", {
    requestId: z.string(),
    projectKey: z.string(),
    repoRelativePaths: StringArraySchema,
  }),
  messageSchema("missions:runs:get", { requestId: z.string() }),
  messageSchema("missions:ticket-run:start", {
    requestId: z.string(),
    ticket: StartTicketRunRequestSchema,
  }),
  messageSchema("missions:ticket-run:sync", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:work:start", {
    requestId: z.string(),
    runId: z.string(),
    prompt: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:work:continue", {
    requestId: z.string(),
    runId: z.string(),
    prompt: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:work:cancel", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:complete", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:proofs:get", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:timeline:get", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:repo-intelligence:get", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:repo-intelligence:approve", {
    requestId: z.string(),
    runId: z.string(),
    entryId: z.string(),
  }),
  messageSchema("missions:ticket-run:proof:run", {
    requestId: z.string(),
    runId: z.string(),
    profileId: z.string(),
  }),
  messageSchema("missions:ticket-run:delete", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:review-snapshot:get", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:git-state:get", {
    requestId: z.string(),
    runId: z.string(),
    repoRelativePath: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:submodule-git-state:get", {
    requestId: z.string(),
    runId: z.string(),
    canonicalUrl: z.string(),
  }),
  messageSchema("missions:ticket-run:commit-draft:generate", {
    requestId: z.string(),
    runId: z.string(),
    repoRelativePath: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:submodule:commit-draft:generate", {
    requestId: z.string(),
    runId: z.string(),
    canonicalUrl: z.string(),
  }),
  messageSchema("missions:ticket-run:commit-draft:set", {
    requestId: z.string(),
    runId: z.string(),
    message: z.string(),
    repoRelativePath: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:submodule:commit-draft:set", {
    requestId: z.string(),
    runId: z.string(),
    canonicalUrl: z.string(),
    message: z.string(),
  }),
  messageSchema("missions:ticket-run:commit", {
    requestId: z.string(),
    runId: z.string(),
    message: z.string(),
    repoRelativePath: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:submodule:commit", {
    requestId: z.string(),
    runId: z.string(),
    canonicalUrl: z.string(),
    message: z.string(),
  }),
  messageSchema("missions:ticket-run:publish", {
    requestId: z.string(),
    runId: z.string(),
    repoRelativePath: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:submodule:publish", {
    requestId: z.string(),
    runId: z.string(),
    canonicalUrl: z.string(),
  }),
  messageSchema("missions:ticket-run:push", {
    requestId: z.string(),
    runId: z.string(),
    repoRelativePath: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:submodule:push", {
    requestId: z.string(),
    runId: z.string(),
    canonicalUrl: z.string(),
  }),
  messageSchema("missions:ticket-run:pull-request:create", {
    requestId: z.string(),
    runId: z.string(),
    repoRelativePath: z.string().optional(),
  }),
  messageSchema("missions:ticket-run:submodule:pull-request:create", {
    requestId: z.string(),
    runId: z.string(),
    canonicalUrl: z.string(),
  }),
  messageSchema("missions:ticket-run:services:get", {
    requestId: z.string(),
    runId: z.string(),
  }),
  messageSchema("missions:ticket-run:service:start", {
    requestId: z.string(),
    runId: z.string(),
    profileId: z.string(),
  }),
  messageSchema("missions:ticket-run:service:stop", {
    requestId: z.string(),
    runId: z.string(),
    serviceId: z.string(),
  }),
  messageSchema("tts:speak", { text: z.string() }),
  messageSchema("tts:stop"),
  messageSchema("voice:toggle"),
  messageSchema("voice:push-to-talk", { active: z.boolean() }),
  messageSchema("voice:mute"),
  messageSchema("voice:unmute"),
  messageSchema("settings:update", { settings: PartialUserSettingsSchema }),
  messageSchema("permission:respond", {
    requestId: z.string(),
    approved: z.boolean(),
  }),
  messageSchema("mcp:add-server", { config: McpServerConfigSchema }),
  messageSchema("mcp:update-server", {
    serverId: z.string(),
    patch: McpServerUpdateConfigSchema,
  }),
  messageSchema("mcp:remove-server", { serverId: z.string() }),
  messageSchema("mcp:set-enabled", {
    serverId: z.string(),
    enabled: z.boolean(),
  }),
  messageSchema("subagent:create", { config: SubagentCreateConfigSchema }),
  messageSchema("subagent:update", {
    agentId: z.string(),
    patch: SubagentUpdateConfigSchema,
  }),
  messageSchema("subagent:remove", { agentId: z.string() }),
  messageSchema("subagent:set-ready", {
    agentId: z.string(),
    ready: z.boolean(),
  }),
  messageSchema("handshake", {
    protocolVersion: z.number(),
    rendererBuildId: z.string(),
  }),
  messageSchema("ping"),
]);

const formatValidationIssue = (issue: z.ZodIssue): string => {
  const path = issue.path.join(".");
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
};

export const parseClientMessagePayload = (
  raw: string,
): { message: ClientMessage; errorDetails?: never } | { message: null; errorDetails: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      message: null,
      errorDetails: `Invalid JSON: ${String(error)}`,
    };
  }

  const result = ClientMessageSchema.safeParse(parsed);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return {
      message: null,
      errorDetails: firstIssue ? formatValidationIssue(firstIssue) : "Invalid client message payload.",
    };
  }

  return {
    message: result.data as ClientMessage,
  };
};
