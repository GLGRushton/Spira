import { z } from "zod";

type EnvInput = Record<string, string | undefined>;
const defaultEnvInput: EnvInput = (globalThis as { process?: { env?: EnvInput } }).process?.env ?? {};

export const McpServerConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "Lowercase alphanumeric and hyphens only"),
  name: z.string().min(1),
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  enabled: z.boolean(),
  autoRestart: z.boolean(),
  maxRestarts: z.number().int().min(0).max(10).optional().default(3),
});

export const McpServersFileSchema = z.object({
  $schema: z.string().optional(),
  servers: z.array(McpServerConfigSchema),
});

/** Validates environment variables loaded from .env */
export const EnvSchema = z.object({
  GITHUB_TOKEN: z.string().default(""),
  PICOVOICE_ACCESS_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  SPIRA_PORT: z.coerce.number().int().positive().default(9720),
  WHISPER_MODEL: z.enum(["tiny.en", "base.en", "small.en"]).default("base.en"),
  WAKE_WORD_MODEL: z.string().default("assets/wake-word/shinra.ppn"),
});

export type Env = z.infer<typeof EnvSchema>;
export type McpServersFile = z.infer<typeof McpServersFileSchema>;

export const parseEnv = (input: EnvInput = defaultEnvInput): Env => EnvSchema.parse(input);
