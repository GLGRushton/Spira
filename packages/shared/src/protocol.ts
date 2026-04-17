import type { AssistantState } from "./assistant-state.js";
import type { ChatMessage, ToolCallStatus } from "./chat-types.js";
import type { ConversationSearchMatch, StoredConversation, StoredConversationSummary } from "./conversation-types.js";
import type { McpServerConfig, McpServerUpdateConfig } from "./mcp-types.js";
import type { McpServerStatus } from "./mcp-types.js";
import type { ProjectRepoMappingsSnapshot } from "./project-repo-types.js";
import type { MissionServiceSnapshot } from "./service-profile-types.js";
import type {
  SubagentCompletedEvent,
  SubagentCreateConfig,
  SubagentDeltaEvent,
  SubagentDomain,
  SubagentErrorEvent,
  SubagentLockAcquiredEvent,
  SubagentLockDeniedEvent,
  SubagentLockReleasedEvent,
  SubagentStartedEvent,
  SubagentStatusEvent,
  SubagentToolCallEvent,
  SubagentToolResultEvent,
} from "./subagent-types.js";
import type {
  CancelTicketRunWorkResult,
  CommitTicketRunResult,
  CompleteTicketRunResult,
  ContinueTicketRunWorkResult,
  CreateTicketRunPullRequestResult,
  GenerateTicketRunCommitDraftResult,
  RetryTicketRunSyncResult,
  SetTicketRunCommitDraftResult,
  StartTicketRunRequest,
  StartTicketRunResult,
  StartTicketRunWorkResult,
  SyncTicketRunRemoteResult,
  TicketRunGitStateResult,
  TicketRunSnapshot,
} from "./ticket-run-types.js";
import type { UpgradeProposal, UpgradeStatus } from "./upgrade.js";
import type {
  YouTrackProjectSummary,
  YouTrackStateMapping,
  YouTrackStatusSummary,
  YouTrackTicketSummary,
} from "./youtrack-types.js";

export interface ErrorPayload {
  code: string;
  message: string;
  source?: string;
  details?: string;
  stationId?: StationId;
}

export interface PermissionRequestPayload {
  requestId: string;
  stationId?: StationId;
  kind: "mcp" | "custom-tool";
  toolCallId?: string;
  serverName: string;
  toolName: string;
  toolTitle: string;
  args?: Record<string, unknown>;
  readOnly: boolean;
}

export type StationId = string;

export interface StationSummary {
  stationId: StationId;
  conversationId: string | null;
  label: string;
  title: string | null;
  state: AssistantState;
  createdAt: number;
  updatedAt: number;
  isStreaming: boolean;
}

export const PROTOCOL_VERSION = 16;

export const TTS_PROVIDERS = ["elevenlabs", "kokoro"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
export const normalizeTtsProvider = (provider: string | null | undefined): TtsProvider =>
  provider === "elevenlabs" ? "elevenlabs" : "kokoro";
export const WAKE_WORD_PROVIDERS = ["openwakeword", "porcupine", "none"] as const;
export type WakeWordProviderSetting = (typeof WAKE_WORD_PROVIDERS)[number];
export const normalizeWakeWordProvider = (provider: string | null | undefined): WakeWordProviderSetting =>
  provider === "porcupine" || provider === "none" ? provider : "openwakeword";

export type ClientMessage =
  | { type: "station:create"; label?: string }
  | { type: "station:close"; stationId: StationId }
  | { type: "station:list"; requestId: string }
  | { type: "chat:send"; text: string; conversationId?: string; stationId?: StationId }
  | { type: "chat:abort"; stationId?: StationId }
  | { type: "chat:reset"; stationId?: StationId }
  | { type: "chat:new-session"; conversationId?: string; stationId?: StationId }
  | { type: "conversation:recent:get"; requestId: string }
  | { type: "conversation:list"; requestId: string; limit?: number; offset?: number }
  | { type: "conversation:get"; requestId: string; conversationId: string }
  | { type: "conversation:search"; requestId: string; query: string; limit?: number }
  | { type: "conversation:mark-viewed"; requestId: string; conversationId: string }
  | { type: "conversation:archive"; requestId: string; conversationId: string }
  | { type: "youtrack:status:get"; requestId: string; enabled: boolean }
  | { type: "youtrack:tickets:list"; requestId: string; enabled: boolean; limit?: number }
  | { type: "youtrack:projects:search"; requestId: string; enabled: boolean; query: string; limit?: number }
  | { type: "youtrack:state-mapping:set"; requestId: string; enabled: boolean; mapping: YouTrackStateMapping }
  | { type: "projects:snapshot:get"; requestId: string }
  | { type: "projects:workspace-root:set"; requestId: string; workspaceRoot: string | null }
  | { type: "projects:mapping:set"; requestId: string; projectKey: string; repoRelativePaths: string[] }
  | { type: "missions:runs:get"; requestId: string }
  | { type: "missions:ticket-run:start"; requestId: string; ticket: StartTicketRunRequest }
  | { type: "missions:ticket-run:sync"; requestId: string; runId: string }
  | { type: "missions:ticket-run:work:start"; requestId: string; runId: string }
  | { type: "missions:ticket-run:work:continue"; requestId: string; runId: string; prompt?: string }
  | { type: "missions:ticket-run:work:cancel"; requestId: string; runId: string }
  | { type: "missions:ticket-run:complete"; requestId: string; runId: string }
  | { type: "missions:ticket-run:git-state:get"; requestId: string; runId: string; repoRelativePath?: string }
  | { type: "missions:ticket-run:commit-draft:generate"; requestId: string; runId: string; repoRelativePath?: string }
  | {
      type: "missions:ticket-run:commit-draft:set";
      requestId: string;
      runId: string;
      message: string;
      repoRelativePath?: string;
    }
  | { type: "missions:ticket-run:commit"; requestId: string; runId: string; message: string; repoRelativePath?: string }
  | { type: "missions:ticket-run:publish"; requestId: string; runId: string; repoRelativePath?: string }
  | { type: "missions:ticket-run:push"; requestId: string; runId: string; repoRelativePath?: string }
  | { type: "missions:ticket-run:pull-request:create"; requestId: string; runId: string; repoRelativePath?: string }
  | { type: "missions:ticket-run:services:get"; requestId: string; runId: string }
  | { type: "missions:ticket-run:service:start"; requestId: string; runId: string; profileId: string }
  | { type: "missions:ticket-run:service:stop"; requestId: string; runId: string; serviceId: string }
  | { type: "tts:speak"; text: string }
  | { type: "tts:stop" }
  | { type: "voice:toggle" }
  | { type: "voice:push-to-talk"; active: boolean }
  | { type: "voice:mute" }
  | { type: "voice:unmute" }
  | { type: "settings:update"; settings: Partial<UserSettings> }
  | { type: "permission:respond"; requestId: string; approved: boolean }
  | { type: "mcp:add-server"; config: McpServerConfig }
  | { type: "mcp:update-server"; serverId: string; patch: McpServerUpdateConfig }
  | { type: "mcp:remove-server"; serverId: string }
  | { type: "mcp:set-enabled"; serverId: string; enabled: boolean }
  | {
      type: "subagent:create";
      config: SubagentCreateConfig;
    }
  | {
      type: "subagent:update";
      agentId: string;
      patch: Partial<Omit<SubagentDomain, "id" | "source" | "delegationToolName">>;
    }
  | { type: "subagent:remove"; agentId: string }
  | { type: "subagent:set-ready"; agentId: string; ready: boolean }
  | { type: "handshake"; protocolVersion: number; rendererBuildId: string }
  | { type: "ping" };

export type ServerMessage =
  | { type: "pong"; protocolVersion: number; backendBuildId: string }
  | { type: "backend:hello"; generation: number; protocolVersion: number; backendBuildId: string }
  | { type: "station:created"; station: StationSummary }
  | { type: "station:closed"; stationId: StationId }
  | { type: "station:list:result"; requestId: string; stations: StationSummary[] }
  | { type: "upgrade:proposal"; proposal: UpgradeProposal; message: string }
  | ({ type: "upgrade:status" } & UpgradeStatus)
  | { type: "state:change"; state: AssistantState; stationId?: StationId }
  | { type: "voice:muted"; muted: boolean }
  | { type: "chat:token"; token: string; conversationId: string; stationId?: StationId }
  | { type: "chat:complete"; conversationId: string; messageId: string; stationId?: StationId }
  | { type: "chat:abort-complete"; stationId?: StationId }
  | { type: "chat:reset-complete"; stationId?: StationId }
  | { type: "chat:new-session-complete"; preservedToMemory: boolean; stationId?: StationId }
  | { type: "chat:message"; message: ChatMessage; stationId?: StationId }
  | { type: "conversation:recent:result"; requestId: string; conversation: StoredConversation | null }
  | { type: "conversation:list:result"; requestId: string; conversations: StoredConversationSummary[] }
  | { type: "conversation:get:result"; requestId: string; conversation: StoredConversation | null }
  | { type: "conversation:search:result"; requestId: string; matches: ConversationSearchMatch[] }
  | { type: "conversation:mark-viewed:result"; requestId: string; success: boolean }
  | { type: "conversation:archive:result"; requestId: string; success: boolean }
  | { type: "youtrack:status:result"; requestId: string; status: YouTrackStatusSummary }
  | { type: "youtrack:tickets:list:result"; requestId: string; tickets: YouTrackTicketSummary[] }
  | { type: "youtrack:projects:search:result"; requestId: string; projects: YouTrackProjectSummary[] }
  | { type: "youtrack:state-mapping:set:result"; requestId: string; status: YouTrackStatusSummary }
  | { type: "projects:snapshot:result"; requestId: string; snapshot: ProjectRepoMappingsSnapshot }
  | { type: "missions:runs:result"; requestId: string; snapshot: TicketRunSnapshot }
  | {
      type: "missions:ticket-run:start:result";
      requestId: string;
      result: StartTicketRunResult;
    }
  | {
      type: "missions:ticket-run:sync:result";
      requestId: string;
      result: RetryTicketRunSyncResult;
    }
  | {
      type: "missions:ticket-run:work:start:result";
      requestId: string;
      result: StartTicketRunWorkResult;
    }
  | {
      type: "missions:ticket-run:work:continue:result";
      requestId: string;
      result: ContinueTicketRunWorkResult;
    }
  | {
      type: "missions:ticket-run:work:cancel:result";
      requestId: string;
      result: CancelTicketRunWorkResult;
    }
  | {
      type: "missions:ticket-run:complete:result";
      requestId: string;
      result: CompleteTicketRunResult;
    }
  | {
      type: "missions:ticket-run:git-state:result";
      requestId: string;
      result: TicketRunGitStateResult;
    }
  | {
      type: "missions:ticket-run:commit-draft:generate:result";
      requestId: string;
      result: GenerateTicketRunCommitDraftResult;
    }
  | {
      type: "missions:ticket-run:commit-draft:set:result";
      requestId: string;
      result: SetTicketRunCommitDraftResult;
    }
  | {
      type: "missions:ticket-run:commit:result";
      requestId: string;
      result: CommitTicketRunResult;
    }
  | {
      type: "missions:ticket-run:publish:result";
      requestId: string;
      result: SyncTicketRunRemoteResult;
    }
  | {
      type: "missions:ticket-run:push:result";
      requestId: string;
      result: SyncTicketRunRemoteResult;
    }
  | {
      type: "missions:ticket-run:pull-request:create:result";
      requestId: string;
      result: CreateTicketRunPullRequestResult;
    }
  | {
      type: "missions:ticket-run:services:get:result";
      requestId: string;
      services: MissionServiceSnapshot;
    }
  | {
      type: "missions:ticket-run:service:start:result";
      requestId: string;
      services: MissionServiceSnapshot;
    }
  | {
      type: "missions:ticket-run:service:stop:result";
      requestId: string;
      services: MissionServiceSnapshot;
    }
  | { type: "missions:runs:updated"; snapshot: TicketRunSnapshot }
  | { type: "missions:ticket-run:services:updated"; services: MissionServiceSnapshot }
  | ({ type: "youtrack:request-error"; requestId: string } & ErrorPayload)
  | ({ type: "projects:request-error"; requestId: string } & ErrorPayload)
  | ({ type: "missions:request-error"; requestId: string } & ErrorPayload)
  | ({ type: "conversation:request-error"; requestId: string } & ErrorPayload)
  | {
      type: "tool:call";
      callId: string;
      name: string;
      status: ToolCallStatus;
      args?: unknown;
      details?: string;
      stationId?: StationId;
    }
  | { type: "permission:request"; request: PermissionRequestPayload }
  | { type: "permission:complete"; requestId: string; result: "approved" | "denied" | "expired"; stationId?: StationId }
  | { type: "mcp:status"; servers: McpServerStatus[] }
  | { type: "subagent:catalog"; agents: SubagentDomain[] }
  | { type: "subagent:started"; event: SubagentStartedEvent; stationId?: StationId }
  | { type: "subagent:tool-call"; event: SubagentToolCallEvent; stationId?: StationId }
  | { type: "subagent:tool-result"; event: SubagentToolResultEvent; stationId?: StationId }
  | { type: "subagent:delta"; event: SubagentDeltaEvent; stationId?: StationId }
  | { type: "subagent:status"; event: SubagentStatusEvent; stationId?: StationId }
  | { type: "subagent:completed"; event: SubagentCompletedEvent; stationId?: StationId }
  | { type: "subagent:error"; event: SubagentErrorEvent; stationId?: StationId }
  | { type: "subagent:lock-acquired"; event: SubagentLockAcquiredEvent; stationId?: StationId }
  | { type: "subagent:lock-denied"; event: SubagentLockDeniedEvent; stationId?: StationId }
  | { type: "subagent:lock-released"; event: SubagentLockReleasedEvent; stationId?: StationId }
  | { type: "voice:transcript"; text: string }
  | { type: "audio:level"; level: number }
  | { type: "tts:amplitude"; amplitude: number }
  | { type: "tts:audio"; audioBase64: string; mimeType: "audio/wav" }
  | ({ type: "error" } & ErrorPayload)
  | { type: "settings:current"; settings: UserSettings };

export interface UserSettings {
  voiceEnabled: boolean;
  wakeWordEnabled: boolean;
  youTrackEnabled: boolean;
  ttsProvider: TtsProvider;
  whisperModel: "tiny.en" | "base.en" | "small.en";
  wakeWordProvider: WakeWordProviderSetting;
  openWakeWordThreshold: number;
  elevenLabsVoiceId: string;
  theme: "ffx";
}
