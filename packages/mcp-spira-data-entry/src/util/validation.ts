import { z } from "zod";

const SourceSchema = z.enum(["builtin", "user"]);
const ToolAccessSchema = z
  .object({
    readOnlyToolNames: z.array(z.string().trim().min(1)).optional(),
    writeToolNames: z.array(z.string().trim().min(1)).optional(),
  })
  .optional();

export const EmptySchema = z.object({});

export const McpServerListSchema = z.object({
  source: SourceSchema.optional(),
});

export const McpServerQuerySchema = z.object({
  serverId: z.string().trim().min(1).max(200),
});

export const CreateMcpServerSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  command: z.string().trim().min(1).max(500),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  toolAccess: ToolAccessSchema,
  enabled: z.boolean().default(true),
  autoRestart: z.boolean().default(true),
  maxRestarts: z.number().int().min(0).max(10).default(3),
});

export const UpdateMcpServerSchema = z
  .object({
    serverId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(500).optional(),
    command: z.string().trim().min(1).max(500).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    toolAccess: ToolAccessSchema,
    enabled: z.boolean().optional(),
    autoRestart: z.boolean().optional(),
    maxRestarts: z.number().int().min(0).max(10).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.command !== undefined ||
      value.args !== undefined ||
      value.env !== undefined ||
      value.toolAccess !== undefined ||
      value.enabled !== undefined ||
      value.autoRestart !== undefined ||
      value.maxRestarts !== undefined,
    "Provide at least one MCP server field to update.",
  );

export const SubagentListSchema = z.object({
  source: SourceSchema.optional(),
});

export const SubagentQuerySchema = z.object({
  agentId: z.string().trim().min(1).max(200),
});

export const CreateSubagentSchema = z.object({
  id: z.string().trim().min(1).max(200).optional(),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  serverIds: z.array(z.string().trim().min(1)).min(1),
  allowedToolNames: z.array(z.string().trim().min(1)).nullable().optional().default(null),
  allowWrites: z.boolean().default(false),
  systemPrompt: z.string().trim().min(1).max(20_000),
  ready: z.boolean().default(true),
  delegationToolName: z.string().trim().min(1).max(200).optional(),
});

export const UpdateSubagentSchema = z
  .object({
    agentId: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).optional(),
    serverIds: z.array(z.string().trim().min(1)).min(1).optional(),
    allowedToolNames: z.array(z.string().trim().min(1)).nullable().optional(),
    allowWrites: z.boolean().optional(),
    systemPrompt: z.string().trim().min(1).max(20_000).optional(),
    ready: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.description !== undefined ||
      value.serverIds !== undefined ||
      value.allowedToolNames !== undefined ||
      value.allowWrites !== undefined ||
      value.systemPrompt !== undefined ||
      value.ready !== undefined,
    "Provide at least one subagent field to update.",
  );
