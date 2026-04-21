import { z } from "zod";

type EnvInput = Record<string, string | undefined>;
const defaultEnvInput: EnvInput = (globalThis as { process?: { env?: EnvInput } }).process?.env ?? {};
const BooleanEnvFlagSchema = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const McpToolAccessPolicySchema = z
  .object({
    readOnlyToolNames: z.array(z.string().trim().min(1)).optional(),
    writeToolNames: z.array(z.string().trim().min(1)).optional(),
  })
  .optional();

const McpServerConfigBaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "Lowercase alphanumeric and hyphens only"),
  name: z.string().min(1),
  description: z.string().optional(),
  toolAccess: McpToolAccessPolicySchema,
  enabled: z.boolean(),
  autoRestart: z.boolean(),
  maxRestarts: z.number().int().min(0).max(10).optional().default(3),
  source: z.enum(["builtin", "user"]).optional(),
});

const StdioMcpServerConfigSchema = McpServerConfigBaseSchema.extend({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
});

const StreamableHttpMcpServerConfigSchema = McpServerConfigBaseSchema.extend({
  transport: z.literal("streamable-http"),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion("transport", [
  StdioMcpServerConfigSchema,
  StreamableHttpMcpServerConfigSchema,
]);

export const McpServersFileSchema = z.object({
  $schema: z.string().optional(),
  servers: z.array(McpServerConfigSchema),
});

/** Validates environment variables loaded from .env */
export const EnvSchema = z.object({
  GITHUB_TOKEN: z.string().default(""),
  MISSION_GITHUB_TOKEN: z.string().optional(),
  YOUTRACK_BASE_URL: z.string().optional(),
  YOUTRACK_TOKEN: z.string().optional(),
  SQL_SERVER_SERVER: z.string().optional(),
  SQL_SERVER_PORT: z.string().optional(),
  SQL_SERVER_USERNAME: z.string().optional(),
  SQL_SERVER_PASSWORD: z.string().optional(),
  SQL_SERVER_ENCRYPT: z.string().optional(),
  SQL_SERVER_TRUST_SERVER_CERTIFICATE: z.string().optional(),
  SQL_SERVER_ALLOWED_DATABASES: z.string().optional(),
  SQL_SERVER_ROW_LIMIT: z.string().optional(),
  SQL_SERVER_TIMEOUT_MS: z.string().optional(),
  PICOVOICE_ACCESS_KEY: z.string().optional(),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),
  KOKORO_MODEL_ID: z.string().optional(),
  KOKORO_VOICE: z.string().optional(),
  KOKORO_DTYPE: z.enum(["fp32", "fp16", "q8", "q4", "q4f16"]).optional(),
  KOKORO_SPEED: z.coerce.number().positive().optional(),
  PIPER_EXECUTABLE: z.string().optional(),
  PIPER_MODEL: z.string().optional(),
  SPIRA_PORT: z.coerce.number().int().positive().default(9720),
  WHISPER_MODEL: z.enum(["tiny.en", "base.en", "small.en"]).default("base.en"),
  WAKE_WORD_PROVIDER: z.enum(["openwakeword", "porcupine", "none"]).default("openwakeword"),
  WAKE_WORD_MODEL: z.string().default("assets/wake-word/shinra.ppn"),
  OPENWAKEWORD_RUNTIME_DIR: z.string().default("assets/wake-word/openwakeword-runtime"),
  OPENWAKEWORD_WORKER_PATH: z.string().default("assets/wake-word/openwakeword/worker.py"),
  OPENWAKEWORD_MODEL_PATH: z.string().optional(),
  OPENWAKEWORD_MODEL_NAME: z.string().default("hey_jarvis"),
  OPENWAKEWORD_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  SPIRA_SUBAGENTS_ENABLED: BooleanEnvFlagSchema,
});

export type Env = z.infer<typeof EnvSchema>;
export type McpServersFile = z.infer<typeof McpServersFileSchema>;

export const parseEnv = (input: EnvInput = defaultEnvInput): Env => EnvSchema.parse(input);
