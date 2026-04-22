import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  McpServerConfig,
  McpServerSource,
  SubagentDomain,
  SubagentSource,
  TicketRunAttemptStatus,
  TicketRunAttemptSummary,
  TicketRunCleanupState,
  TicketRunMissionClassification,
  TicketRunMissionClassificationKind,
  TicketRunMissionPhase,
  TicketRunMissionPlan,
  TicketRunMissionProofArtifactMode,
  TicketRunMissionProofStrategy,
  TicketRunMissionSummary,
  TicketRunMissionValidationKind,
  TicketRunMissionValidationRecord,
  TicketRunMissionValidationStatus,
  TicketRunPreviousPassContext,
  TicketRunProofArtifact,
  TicketRunProofArtifactKind,
  TicketRunProofRunStatus,
  TicketRunProofRunSummary,
  TicketRunProofStatus,
  TicketRunProofSummary,
  TicketRunSnapshot,
  TicketRunStatus,
  TicketRunSubmoduleParentRef,
  TicketRunSubmoduleSummary,
  TicketRunSummary,
  TicketRunWorktreeSummary,
  YouTrackStateMapping,
} from "@spira/shared";
import {
  TICKET_RUN_ATTEMPT_STATUSES,
  TICKET_RUN_CLEANUP_STATES,
  TICKET_RUN_MISSION_CLASSIFICATIONS,
  TICKET_RUN_MISSION_PHASES,
  TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES,
  TICKET_RUN_MISSION_VALIDATION_KINDS,
  TICKET_RUN_MISSION_VALIDATION_STATUSES,
  TICKET_RUN_PROOF_ARTIFACT_KINDS,
  TICKET_RUN_PROOF_RUN_STATUSES,
  TICKET_RUN_PROOF_STATUSES,
  TICKET_RUN_STATUSES,
  normalizeMcpToolAccessPolicy,
  normalizeYouTrackStateMapping,
  summarizeConversationTitle,
} from "@spira/shared";
import BetterSqlite3 from "better-sqlite3";

const SQLITE_BUSY_TIMEOUT_MS = 5_000;

const MEMORY_ENTRY_CATEGORIES = ["user-preference", "fact", "task-context", "correction"] as const;

export type ConversationRole = "user" | "assistant" | "system";
export type MemoryEntryCategory = (typeof MEMORY_ENTRY_CATEGORIES)[number];

export interface ConversationSummary {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt: number | null;
  lastViewedAt: number | null;
}

export interface ConversationToolCallRecord {
  callId: string | null;
  name: string;
  args: unknown;
  result: unknown;
  status: "pending" | "running" | "success" | "error" | null;
  details: string | null;
}

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  timestamp: number;
  wasAborted: boolean;
  autoSpeak: boolean;
  toolCalls: ConversationToolCallRecord[];
}

export interface ConversationRecord extends ConversationSummary {
  messages: ConversationMessageRecord[];
}

export interface ConversationSearchResult {
  conversationId: string;
  conversationTitle: string | null;
  messageId: string;
  role: ConversationRole;
  timestamp: number;
  snippet: string;
  score: number;
}

export interface MemoryEntryRecord {
  id: string;
  category: MemoryEntryCategory;
  content: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateConversationInput {
  id?: string;
  title?: string | null;
  createdAt?: number;
}

export interface AppendConversationMessageInput {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  timestamp: number;
  wasAborted?: boolean;
  autoSpeak?: boolean;
}

export interface UpsertToolCallInput {
  messageId: string;
  callId?: string | null;
  name: string;
  args?: unknown;
  result?: unknown;
  status?: "pending" | "running" | "success" | "error";
  details?: string | null;
}

export interface RememberMemoryInput {
  id?: string;
  category?: MemoryEntryCategory;
  content: string;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  createdAt?: number;
}

export interface UpdateMemoryInput {
  memoryId: string;
  category?: MemoryEntryCategory;
  content?: string;
}

export interface OpenSpiraMemoryDatabaseOptions {
  readonly?: boolean;
}

export type McpServerConfigRecord = McpServerConfig & {
  description: string;
  source: McpServerSource;
  createdAt: number;
  updatedAt: number;
};

export type UpsertMcpServerConfigInput = McpServerConfig & {
  description?: string;
  source: McpServerSource;
  createdAt?: number;
};

export interface SubagentConfigRecord extends SubagentDomain {
  source: SubagentSource;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertSubagentConfigInput extends SubagentDomain {
  createdAt?: number;
}

export interface ProjectRepoMappingRecord {
  projectKey: string;
  repoRelativePaths: string[];
  updatedAt: number;
}

export interface UpsertTicketRunWorktreeInput {
  repoRelativePath: string;
  repoAbsolutePath: string;
  worktreePath: string;
  branchName: string;
  commitMessageDraft?: string | null;
  cleanupState?: TicketRunCleanupState;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunSubmoduleInput {
  canonicalUrl: string;
  name: string;
  branchName: string;
  commitMessageDraft?: string | null;
  parentRefs: readonly TicketRunSubmoduleParentRef[];
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunInput {
  runId: string;
  stationId?: string | null;
  ticketId: string;
  ticketSummary: string;
  ticketUrl: string;
  projectKey: string;
  status: TicketRunStatus;
  statusMessage?: string | null;
  commitMessageDraft?: string | null;
  startedAt?: number;
  createdAt?: number;
  worktrees: readonly UpsertTicketRunWorktreeInput[];
  submodules?: readonly UpsertTicketRunSubmoduleInput[];
  attempts?: readonly UpsertTicketRunAttemptInput[];
  missionPhase?: TicketRunMissionPhase;
  missionPhaseUpdatedAt?: number;
  classification?: TicketRunMissionClassification | null;
  plan?: TicketRunMissionPlan | null;
  validations?: readonly UpsertTicketRunValidationInput[];
  proofStrategy?: UpsertTicketRunProofStrategyInput | null;
  missionSummary?: UpsertTicketRunMissionSummaryInput | null;
  previousPassContext?: TicketRunPreviousPassContext | null;
  proof?: UpsertTicketRunProofInput;
  proofRuns?: readonly UpsertTicketRunProofRunInput[];
}

export interface UpsertTicketRunAttemptInput {
  attemptId: string;
  subagentRunId?: string | null;
  sequence: number;
  status: TicketRunAttemptStatus;
  prompt?: string | null;
  summary?: string | null;
  followupNeeded?: boolean;
  startedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number | null;
}

export interface UpsertTicketRunProofInput {
  status?: TicketRunProofStatus;
  lastProofRunId?: string | null;
  lastProofProfileId?: string | null;
  lastProofAt?: number | null;
  lastProofSummary?: string | null;
  staleReason?: string | null;
}

export interface UpsertTicketRunValidationInput {
  validationId: string;
  kind: TicketRunMissionValidationKind;
  command: string;
  cwd: string;
  status: TicketRunMissionValidationStatus;
  summary?: string | null;
  artifacts?: readonly UpsertTicketRunProofArtifactInput[];
  startedAt?: number;
  completedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunProofStrategyInput {
  adapterId: string;
  repoRelativePath: string;
  scenarioPath?: string | null;
  scenarioName?: string | null;
  command: string;
  artifactMode: TicketRunMissionProofArtifactMode;
  rationale: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunMissionSummaryInput {
  completedWork: string;
  changedRepoRelativePaths: readonly string[];
  validationSummary?: string | null;
  proofSummary?: string | null;
  openQuestions?: readonly string[];
  followUps?: readonly string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface UpsertTicketRunProofArtifactInput {
  artifactId: string;
  kind: TicketRunProofArtifactKind;
  label: string;
  path: string;
  fileUrl: string;
}

export interface UpsertTicketRunProofRunInput {
  proofRunId: string;
  profileId: string;
  profileLabel: string;
  status: TicketRunProofRunStatus;
  summary?: string | null;
  startedAt?: number;
  completedAt?: number | null;
  exitCode?: number | null;
  command?: string | null;
  artifacts?: readonly UpsertTicketRunProofArtifactInput[];
}

interface MigrationDefinition {
  version: number;
  statements: string[];
}

interface ConversationSummaryRow {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt: number | null;
  lastViewedAt: number | null;
}

interface ConversationMessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  timestamp: number;
  wasAborted: number;
  autoSpeak: number;
}

interface ToolCallRow {
  messageId: string;
  callId: string | null;
  name: string;
  args: string | null;
  result: string | null;
  status: string | null;
  details: string | null;
}

interface ConversationSearchRow {
  conversationId: string;
  conversationTitle: string | null;
  messageId: string;
  role: string;
  timestamp: number;
  snippet: string;
  score: number;
}

interface MemoryEntryRow {
  id: string;
  category: string;
  content: string;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface SessionStateRow {
  value: string | null;
}

interface ProjectWorkspaceConfigRow {
  workspaceRoot: string | null;
}

interface ProjectRepoMappingRow {
  projectKey: string;
  repoRelativePath: string;
  updatedAt: number;
}

interface YouTrackStateMappingRow {
  todoJson: string;
  inProgressJson: string;
  updatedAt: number;
}

interface TicketRunRow {
  runId: string;
  stationId: string | null;
  ticketId: string;
  ticketSummary: string;
  ticketUrl: string;
  projectKey: string;
  status: string;
  statusMessage: string | null;
  commitMessageDraft: string | null;
  missionPhase: string;
  missionPhaseUpdatedAt: number;
  classificationJson: string | null;
  planJson: string | null;
  summaryJson: string | null;
  previousPassContextJson: string | null;
  proofStatus: string;
  lastProofRunId: string | null;
  lastProofProfileId: string | null;
  lastProofAt: number | null;
  lastProofSummary: string | null;
  proofStaleReason: string | null;
  startedAt: number;
  createdAt: number;
  updatedAt: number;
}

interface TicketRunValidationRow {
  validationId: string;
  runId: string;
  kind: string;
  command: string;
  cwd: string;
  status: string;
  summary: string | null;
  artifactsJson: string | null;
  startedAt: number;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface TicketRunProofStrategyRow {
  runId: string;
  adapterId: string;
  repoRelativePath: string;
  scenarioPath: string | null;
  scenarioName: string | null;
  command: string;
  artifactMode: string;
  rationale: string;
  metadataJson: string | null;
  createdAt: number;
  updatedAt: number;
}

interface TicketRunWorktreeRow {
  runId: string;
  repoRelativePath: string;
  repoAbsolutePath: string;
  worktreePath: string;
  branchName: string;
  commitMessageDraft: string | null;
  cleanupState: string;
  createdAt: number;
  updatedAt: number;
}

interface TicketRunAttemptRow {
  attemptId: string;
  runId: string;
  subagentRunId: string | null;
  sequence: number;
  status: string;
  prompt: string | null;
  summary: string | null;
  followupNeeded: number;
  startedAt: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

interface TicketRunSubmoduleRow {
  runId: string;
  canonicalUrl: string;
  name: string;
  branchName: string;
  commitMessageDraft: string | null;
  createdAt: number;
  updatedAt: number;
}

interface TicketRunSubmoduleParentRow {
  runId: string;
  canonicalUrl: string;
  parentRepoRelativePath: string;
  submodulePath: string;
  submoduleWorktreePath: string;
}

interface TicketRunProofRunRow {
  proofRunId: string;
  runId: string;
  profileId: string;
  profileLabel: string;
  status: string;
  summary: string | null;
  startedAt: number;
  completedAt: number | null;
  exitCode: number | null;
  command: string | null;
  artifactsJson: string | null;
}

interface McpServerConfigRow {
  id: string;
  name: string;
  description: string;
  source: string;
  transport: "stdio" | "streamable-http";
  command: string;
  argsJson: string;
  envJson: string | null;
  url: string | null;
  headersJson: string | null;
  toolAccessJson: string | null;
  enabled: number;
  autoRestart: number;
  maxRestarts: number;
  createdAt: number;
  updatedAt: number;
}

interface SubagentConfigRow {
  id: string;
  label: string;
  description: string;
  source: string;
  systemPrompt: string;
  delegationToolName: string;
  serverIdsJson: string;
  allowedToolNamesJson: string | null;
  allowWrites: number;
  ready: number;
  createdAt: number;
  updatedAt: number;
}

const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL DEFAULT '',
        was_aborted INTEGER NOT NULL DEFAULT 0,
        auto_speak INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_messages_conversation_timestamp ON messages(conversation_id, timestamp)",
      `CREATE TABLE tool_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        call_id TEXT,
        name TEXT NOT NULL,
        args TEXT,
        result TEXT,
        status TEXT CHECK(status IN ('pending', 'running', 'success', 'error')),
        details TEXT
      )`,
      "CREATE INDEX idx_tool_calls_message_id ON tool_calls(message_id)",
      `CREATE TABLE memory_entries (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL CHECK(category IN ('user-preference', 'fact', 'task-context', 'correction')),
        content TEXT NOT NULL,
        source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX idx_memory_entries_created_at ON memory_entries(created_at DESC)",
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid')`,
      "INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages",
      `CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END`,
      `CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE VIRTUAL TABLE memory_entries_fts USING fts5(content, content='memory_entries', content_rowid='rowid')`,
      "INSERT INTO memory_entries_fts(rowid, content) SELECT rowid, content FROM memory_entries",
      `CREATE TRIGGER memory_entries_fts_insert AFTER INSERT ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
      `CREATE TRIGGER memory_entries_fts_delete AFTER DELETE ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END`,
      `CREATE TRIGGER memory_entries_fts_update AFTER UPDATE OF content ON memory_entries BEGIN
        INSERT INTO memory_entries_fts(memory_entries_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO memory_entries_fts(rowid, content) VALUES (new.rowid, new.content);
      END`,
    ],
  },
  {
    version: 3,
    statements: [
      "ALTER TABLE conversations ADD COLUMN last_viewed_at INTEGER",
      "CREATE INDEX idx_conversations_last_viewed_at ON conversations(last_viewed_at DESC)",
    ],
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE session_state (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_session_state_updated_at ON session_state(updated_at DESC)",
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE mcp_server_configs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK(source IN ('builtin', 'user')),
        transport TEXT NOT NULL CHECK(transport IN ('stdio')),
        command TEXT NOT NULL,
        args_json TEXT NOT NULL,
        env_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_restart INTEGER NOT NULL DEFAULT 1,
        max_restarts INTEGER NOT NULL DEFAULT 3,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_mcp_server_configs_source ON mcp_server_configs(source, updated_at DESC)",
      `CREATE TABLE subagent_configs (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK(source IN ('builtin', 'user')),
        system_prompt TEXT NOT NULL DEFAULT '',
        delegation_tool_name TEXT NOT NULL UNIQUE,
        server_ids_json TEXT NOT NULL,
        allowed_tool_names_json TEXT,
        allow_writes INTEGER NOT NULL DEFAULT 1,
        ready INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_subagent_configs_source ON subagent_configs(source, updated_at DESC)",
      "CREATE INDEX idx_subagent_configs_ready ON subagent_configs(ready, updated_at DESC)",
    ],
  },
  {
    version: 6,
    statements: ["ALTER TABLE mcp_server_configs ADD COLUMN tool_access_json TEXT"],
  },
  {
    version: 7,
    statements: [
      `CREATE TABLE project_workspace_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        workspace_root TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE project_repo_mappings (
        project_key TEXT NOT NULL,
        repo_relative_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_key, repo_relative_path)
      )`,
      "CREATE INDEX idx_project_repo_mappings_project_key ON project_repo_mappings(project_key, updated_at DESC)",
    ],
  },
  {
    version: 8,
    statements: [
      `CREATE TABLE mcp_server_configs_v2 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL CHECK(source IN ('builtin', 'user')),
        transport TEXT NOT NULL CHECK(transport IN ('stdio', 'streamable-http')),
        command TEXT NOT NULL DEFAULT '',
        args_json TEXT NOT NULL DEFAULT '[]',
        env_json TEXT,
        url TEXT,
        headers_json TEXT,
        tool_access_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_restart INTEGER NOT NULL DEFAULT 1,
        max_restarts INTEGER NOT NULL DEFAULT 3,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `INSERT INTO mcp_server_configs_v2 (
         id,
         name,
         description,
         source,
         transport,
         command,
         args_json,
         env_json,
         url,
         headers_json,
         tool_access_json,
         enabled,
         auto_restart,
         max_restarts,
         created_at,
         updated_at
       )
       SELECT
         id,
         name,
         description,
         source,
         transport,
         command,
         args_json,
         env_json,
         NULL,
         NULL,
         tool_access_json,
         enabled,
         auto_restart,
         max_restarts,
         created_at,
         updated_at
       FROM mcp_server_configs`,
      "DROP TABLE mcp_server_configs",
      "ALTER TABLE mcp_server_configs_v2 RENAME TO mcp_server_configs",
      "CREATE INDEX idx_mcp_server_configs_source ON mcp_server_configs(source, updated_at DESC)",
    ],
  },
  {
    version: 9,
    statements: [
      `CREATE TABLE ticket_runs (
        run_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        ticket_summary TEXT NOT NULL,
        ticket_url TEXT NOT NULL,
        project_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('starting', 'ready', 'blocked', 'error', 'done')),
        status_message TEXT,
        started_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE ticket_run_worktrees (
        run_id TEXT NOT NULL,
        repo_relative_path TEXT NOT NULL,
        repo_absolute_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        cleanup_state TEXT NOT NULL CHECK(cleanup_state IN ('retained', 'removed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, repo_relative_path),
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      "CREATE INDEX idx_ticket_run_worktrees_cleanup_state ON ticket_run_worktrees(cleanup_state, updated_at DESC)",
    ],
  },
  {
    version: 10,
    statements: [
      "ALTER TABLE ticket_run_worktrees RENAME TO ticket_run_worktrees_v9",
      "ALTER TABLE ticket_runs RENAME TO ticket_runs_v9",
      "DROP INDEX IF EXISTS idx_ticket_run_worktrees_cleanup_state",
      "DROP INDEX IF EXISTS idx_ticket_runs_ticket_id",
      "DROP INDEX IF EXISTS idx_ticket_runs_status",
      `CREATE TABLE ticket_runs (
        run_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        ticket_summary TEXT NOT NULL,
        ticket_url TEXT NOT NULL,
        project_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('starting', 'ready', 'blocked', 'working', 'awaiting-review', 'error', 'done')),
        status_message TEXT,
        started_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `INSERT INTO ticket_runs (
        run_id,
        ticket_id,
        ticket_summary,
        ticket_url,
        project_key,
        status,
        status_message,
        started_at,
        created_at,
        updated_at
      )
      SELECT
        run_id,
        ticket_id,
        ticket_summary,
        ticket_url,
        project_key,
        status,
        status_message,
        started_at,
        created_at,
        updated_at
      FROM ticket_runs_v9`,
      "CREATE UNIQUE INDEX idx_ticket_runs_ticket_id ON ticket_runs(ticket_id)",
      "CREATE INDEX idx_ticket_runs_status ON ticket_runs(status, updated_at DESC)",
      `CREATE TABLE ticket_run_worktrees (
        run_id TEXT NOT NULL,
        repo_relative_path TEXT NOT NULL,
        repo_absolute_path TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        cleanup_state TEXT NOT NULL CHECK(cleanup_state IN ('retained', 'removed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, repo_relative_path),
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      `INSERT INTO ticket_run_worktrees (
        run_id,
        repo_relative_path,
        repo_absolute_path,
        worktree_path,
        branch_name,
        cleanup_state,
        created_at,
        updated_at
      )
      SELECT
        run_id,
        repo_relative_path,
        repo_absolute_path,
        worktree_path,
        branch_name,
        cleanup_state,
        created_at,
        updated_at
      FROM ticket_run_worktrees_v9`,
      `CREATE TABLE ticket_run_attempts (
        attempt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        subagent_run_id TEXT,
        sequence INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'cancelled')),
        prompt TEXT,
        summary TEXT,
        followup_needed INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      "DROP TABLE ticket_run_worktrees_v9",
      "DROP TABLE ticket_runs_v9",
      "CREATE UNIQUE INDEX idx_ticket_runs_ticket_id_v10 ON ticket_runs(ticket_id)",
      "CREATE INDEX idx_ticket_runs_status_v10 ON ticket_runs(status, updated_at DESC)",
      "CREATE INDEX idx_ticket_run_worktrees_cleanup_state_v10 ON ticket_run_worktrees(cleanup_state, updated_at DESC)",
      "CREATE UNIQUE INDEX idx_ticket_run_attempts_sequence_v10 ON ticket_run_attempts(run_id, sequence)",
      "CREATE INDEX idx_ticket_run_attempts_status_v10 ON ticket_run_attempts(status, updated_at DESC)",
      "CREATE INDEX idx_ticket_run_attempts_subagent_run_id_v10 ON ticket_run_attempts(subagent_run_id)",
    ],
  },
  {
    version: 11,
    statements: [
      "ALTER TABLE ticket_runs ADD COLUMN station_id TEXT",
      "CREATE INDEX idx_ticket_runs_station_id_v11 ON ticket_runs(station_id)",
    ],
  },
  {
    version: 12,
    statements: ["ALTER TABLE ticket_runs ADD COLUMN commit_message_draft TEXT"],
  },
  {
    version: 13,
    statements: [
      `CREATE TABLE youtrack_state_mapping_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        todo_json TEXT NOT NULL DEFAULT '[]',
        in_progress_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      )`,
    ],
  },
  {
    version: 14,
    statements: [
      "ALTER TABLE ticket_run_worktrees ADD COLUMN commit_message_draft TEXT",
      `UPDATE ticket_run_worktrees
       SET commit_message_draft = (
         SELECT ticket_runs.commit_message_draft
         FROM ticket_runs
         WHERE ticket_runs.run_id = ticket_run_worktrees.run_id
       )`,
    ],
  },
  {
    version: 15,
    statements: [
      `CREATE TABLE ticket_run_submodules (
        run_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        name TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        commit_message_draft TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, canonical_url),
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      "CREATE INDEX idx_ticket_run_submodules_updated_at_v15 ON ticket_run_submodules(updated_at DESC)",
      `CREATE TABLE ticket_run_submodule_parents (
        run_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        parent_repo_relative_path TEXT NOT NULL,
        submodule_path TEXT NOT NULL,
        submodule_worktree_path TEXT NOT NULL,
        PRIMARY KEY (run_id, canonical_url, parent_repo_relative_path, submodule_path),
        FOREIGN KEY(run_id, canonical_url) REFERENCES ticket_run_submodules(run_id, canonical_url) ON DELETE CASCADE
      )`,
      "CREATE INDEX idx_ticket_run_submodule_parents_parent_v15 ON ticket_run_submodule_parents(parent_repo_relative_path)",
    ],
  },
  {
    version: 16,
    statements: [
      "ALTER TABLE ticket_runs ADD COLUMN proof_status TEXT NOT NULL DEFAULT 'not-run' CHECK(proof_status IN ('not-run', 'running', 'passed', 'failed', 'stale'))",
      "ALTER TABLE ticket_runs ADD COLUMN last_proof_run_id TEXT",
      "ALTER TABLE ticket_runs ADD COLUMN last_proof_profile_id TEXT",
      "ALTER TABLE ticket_runs ADD COLUMN last_proof_at INTEGER",
      "ALTER TABLE ticket_runs ADD COLUMN last_proof_summary TEXT",
      "ALTER TABLE ticket_runs ADD COLUMN proof_stale_reason TEXT",
      `CREATE TABLE ticket_run_proof_runs (
        proof_run_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_label TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'passed', 'failed')),
        summary TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        exit_code INTEGER,
        command TEXT,
        artifacts_json TEXT,
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      "CREATE INDEX idx_ticket_run_proof_runs_run_id_v16 ON ticket_run_proof_runs(run_id, started_at DESC)",
    ],
  },
  {
    version: 17,
    statements: [
      "ALTER TABLE ticket_runs ADD COLUMN mission_phase TEXT NOT NULL DEFAULT 'classification' CHECK(mission_phase IN ('classification', 'plan', 'implement', 'validate', 'proof', 'summarize'))",
      "ALTER TABLE ticket_runs ADD COLUMN mission_phase_updated_at INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE ticket_runs ADD COLUMN classification_json TEXT",
      "ALTER TABLE ticket_runs ADD COLUMN plan_json TEXT",
      "ALTER TABLE ticket_runs ADD COLUMN summary_json TEXT",
      "UPDATE ticket_runs SET mission_phase_updated_at = updated_at WHERE mission_phase_updated_at = 0",
      `CREATE TABLE ticket_run_validations (
        validation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('build', 'unit-test')),
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'passed', 'failed', 'skipped')),
        summary TEXT,
        artifacts_json TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      "CREATE INDEX idx_ticket_run_validations_run_id_v17 ON ticket_run_validations(run_id, started_at DESC)",
      `CREATE TABLE ticket_run_proof_strategy (
        run_id TEXT PRIMARY KEY,
        adapter_id TEXT NOT NULL,
        repo_relative_path TEXT NOT NULL,
        scenario_path TEXT,
        scenario_name TEXT,
        command TEXT NOT NULL,
        artifact_mode TEXT NOT NULL CHECK(artifact_mode IN ('none', 'screenshot', 'video')),
        rationale TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      "CREATE INDEX idx_ticket_run_proof_strategy_adapter_id_v17 ON ticket_run_proof_strategy(adapter_id, updated_at DESC)",
    ],
  },
  {
    version: 18,
    statements: [
      "ALTER TABLE ticket_run_validations RENAME TO ticket_run_validations_v17",
      "DROP INDEX IF EXISTS idx_ticket_run_validations_run_id_v17",
      `CREATE TABLE ticket_run_validations (
        validation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('build', 'unit-test')),
        command TEXT NOT NULL,
        cwd TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'passed', 'failed', 'skipped')),
        summary TEXT,
        artifacts_json TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      `INSERT INTO ticket_run_validations (
        validation_id,
        run_id,
        kind,
        command,
        cwd,
        status,
        summary,
        artifacts_json,
        started_at,
        completed_at,
        created_at,
        updated_at
      )
      SELECT
        validation_id,
        run_id,
        kind,
        command,
        cwd,
        CASE WHEN status = 'running' THEN 'pending' ELSE status END,
        summary,
        artifacts_json,
        started_at,
        completed_at,
        created_at,
        updated_at
      FROM ticket_run_validations_v17`,
      "DROP TABLE ticket_run_validations_v17",
      "CREATE INDEX idx_ticket_run_validations_run_id_v18 ON ticket_run_validations(run_id, started_at DESC)",
    ],
  },
  {
    version: 19,
    statements: ["ALTER TABLE ticket_runs ADD COLUMN previous_pass_context_json TEXT"],
  },
];

type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

const toBoolean = (value: number): boolean => value === 1;

const tryParseJson = (value: string | null): unknown => {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const serializeJson = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
};

const normalizeTitle = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeText = (value: string | null | undefined): string => (typeof value === "string" ? value.trim() : "");

const parseStringArray = (value: string | null, fallback: string[] = []): string[] => {
  const parsed = tryParseJson(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : fallback;
};

const normalizeTicketRunSubmoduleParentRefs = (
  value: readonly TicketRunSubmoduleParentRef[] | null | undefined,
): TicketRunSubmoduleParentRef[] =>
  (value ?? [])
    .map((parentRef) => ({
      parentRepoRelativePath: parentRef.parentRepoRelativePath.trim(),
      submodulePath: parentRef.submodulePath.trim(),
      submoduleWorktreePath: parentRef.submoduleWorktreePath.trim(),
    }))
    .filter(
      (parentRef) =>
        parentRef.parentRepoRelativePath.length > 0 &&
        parentRef.submodulePath.length > 0 &&
        parentRef.submoduleWorktreePath.length > 0,
    );

const normalizeStringArray = (value: readonly string[] | null | undefined): string[] =>
  (value ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const toFtsQuery = (query: string): string => {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .map((token) => token.replace(/"/gu, '""'))
    .filter((token) => token.length > 0);

  return tokens.map((token) => `"${token}"`).join(" AND ");
};

function assertMemoryEntryCategory(category: string): asserts category is MemoryEntryCategory {
  if (!MEMORY_ENTRY_CATEGORIES.includes(category as MemoryEntryCategory)) {
    throw new Error(`Unsupported memory entry category: ${category}`);
  }
}

function assertMcpServerSource(source: string): asserts source is McpServerSource {
  if (source !== "builtin" && source !== "user") {
    throw new Error(`Unsupported MCP server source: ${source}`);
  }
}

function assertSubagentSource(source: string): asserts source is SubagentSource {
  if (source !== "builtin" && source !== "user") {
    throw new Error(`Unsupported subagent source: ${source}`);
  }
}

function assertTicketRunStatus(status: string): asserts status is TicketRunStatus {
  if (!TICKET_RUN_STATUSES.includes(status as TicketRunStatus)) {
    throw new Error(`Unsupported ticket run status: ${status}`);
  }
}

function assertTicketRunAttemptStatus(status: string): asserts status is TicketRunAttemptStatus {
  if (!TICKET_RUN_ATTEMPT_STATUSES.includes(status as TicketRunAttemptStatus)) {
    throw new Error(`Unsupported ticket run attempt status: ${status}`);
  }
}

function assertTicketRunCleanupState(state: string): asserts state is TicketRunCleanupState {
  if (!TICKET_RUN_CLEANUP_STATES.includes(state as TicketRunCleanupState)) {
    throw new Error(`Unsupported ticket run cleanup state: ${state}`);
  }
}

function assertTicketRunProofStatus(status: string): asserts status is TicketRunProofStatus {
  if (!TICKET_RUN_PROOF_STATUSES.includes(status as TicketRunProofStatus)) {
    throw new Error(`Unsupported ticket run proof status: ${status}`);
  }
}

function assertTicketRunMissionPhase(phase: string): asserts phase is TicketRunMissionPhase {
  if (!TICKET_RUN_MISSION_PHASES.includes(phase as TicketRunMissionPhase)) {
    throw new Error(`Unsupported ticket run mission phase: ${phase}`);
  }
}

function assertTicketRunMissionClassificationKind(kind: string): asserts kind is TicketRunMissionClassificationKind {
  if (!TICKET_RUN_MISSION_CLASSIFICATIONS.includes(kind as TicketRunMissionClassificationKind)) {
    throw new Error(`Unsupported ticket run mission classification kind: ${kind}`);
  }
}

function assertTicketRunMissionProofArtifactMode(mode: string): asserts mode is TicketRunMissionProofArtifactMode {
  if (!TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES.includes(mode as TicketRunMissionProofArtifactMode)) {
    throw new Error(`Unsupported ticket run mission proof artifact mode: ${mode}`);
  }
}

function assertTicketRunMissionValidationKind(kind: string): asserts kind is TicketRunMissionValidationKind {
  if (!TICKET_RUN_MISSION_VALIDATION_KINDS.includes(kind as TicketRunMissionValidationKind)) {
    throw new Error(`Unsupported ticket run mission validation kind: ${kind}`);
  }
}

function assertTicketRunMissionValidationStatus(status: string): asserts status is TicketRunMissionValidationStatus {
  if (!TICKET_RUN_MISSION_VALIDATION_STATUSES.includes(status as TicketRunMissionValidationStatus)) {
    throw new Error(`Unsupported ticket run mission validation status: ${status}`);
  }
}

function assertTicketRunProofRunStatus(status: string): asserts status is TicketRunProofRunStatus {
  if (!TICKET_RUN_PROOF_RUN_STATUSES.includes(status as TicketRunProofRunStatus)) {
    throw new Error(`Unsupported ticket run proof run status: ${status}`);
  }
}

function assertTicketRunProofArtifactKind(kind: string): asserts kind is TicketRunProofArtifactKind {
  if (!TICKET_RUN_PROOF_ARTIFACT_KINDS.includes(kind as TicketRunProofArtifactKind)) {
    throw new Error(`Unsupported ticket run proof artifact kind: ${kind}`);
  }
}

const mapMcpServerConfigRow = (row: McpServerConfigRow): McpServerConfigRecord => {
  assertMcpServerSource(row.source);
  const envValue = tryParseJson(row.envJson);
  const env =
    envValue && typeof envValue === "object" && !Array.isArray(envValue)
      ? Object.fromEntries(
          Object.entries(envValue).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
        )
      : {};
  const toolAccessValue = tryParseJson(row.toolAccessJson);
  const toolAccess =
    isRecord(toolAccessValue) && !Array.isArray(toolAccessValue)
      ? {
          ...(Array.isArray(toolAccessValue.readOnlyToolNames)
            ? {
                readOnlyToolNames: toolAccessValue.readOnlyToolNames.filter(
                  (value): value is string => typeof value === "string",
                ),
              }
            : {}),
          ...(Array.isArray(toolAccessValue.writeToolNames)
            ? {
                writeToolNames: toolAccessValue.writeToolNames.filter(
                  (value): value is string => typeof value === "string",
                ),
              }
            : {}),
        }
      : undefined;

  const common = {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    source: row.source,
    ...(normalizeMcpToolAccessPolicy(toolAccess) ? { toolAccess: normalizeMcpToolAccessPolicy(toolAccess) } : {}),
    enabled: toBoolean(row.enabled),
    autoRestart: toBoolean(row.autoRestart),
    maxRestarts: Number(row.maxRestarts),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  } as const;

  if (row.transport === "streamable-http") {
    const headersValue = tryParseJson(row.headersJson);
    const headers =
      headersValue && typeof headersValue === "object" && !Array.isArray(headersValue)
        ? Object.fromEntries(
            Object.entries(headersValue).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
          )
        : {};

    return {
      ...common,
      transport: "streamable-http",
      url: String(row.url ?? ""),
      headers,
    };
  }

  return {
    ...common,
    transport: "stdio",
    command: String(row.command),
    args: parseStringArray(row.argsJson),
    env,
  };
};

const mapSubagentConfigRow = (row: SubagentConfigRow): SubagentConfigRecord => {
  assertSubagentSource(row.source);
  return {
    id: String(row.id),
    label: String(row.label),
    description: String(row.description),
    source: row.source,
    serverIds: parseStringArray(row.serverIdsJson),
    allowedToolNames: row.allowedToolNamesJson === null ? null : parseStringArray(row.allowedToolNamesJson),
    delegationToolName: String(row.delegationToolName),
    allowWrites: toBoolean(row.allowWrites),
    systemPrompt: String(row.systemPrompt),
    ready: toBoolean(row.ready),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

const mapTicketRunWorktreeRow = (row: TicketRunWorktreeRow): TicketRunWorktreeSummary => {
  assertTicketRunCleanupState(row.cleanupState);
  return {
    repoRelativePath: String(row.repoRelativePath),
    repoAbsolutePath: String(row.repoAbsolutePath),
    worktreePath: String(row.worktreePath),
    branchName: String(row.branchName),
    commitMessageDraft: row.commitMessageDraft === null ? null : String(row.commitMessageDraft),
    cleanupState: row.cleanupState,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

const mapTicketRunAttemptRow = (row: TicketRunAttemptRow): TicketRunAttemptSummary => {
  assertTicketRunAttemptStatus(row.status);
  return {
    attemptId: String(row.attemptId),
    runId: String(row.runId),
    subagentRunId: row.subagentRunId === null ? null : String(row.subagentRunId),
    sequence: Number(row.sequence),
    status: row.status,
    prompt: row.prompt === null ? null : String(row.prompt),
    summary: row.summary === null ? null : String(row.summary),
    followupNeeded: toBoolean(row.followupNeeded),
    startedAt: Number(row.startedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    completedAt: row.completedAt === null ? null : Number(row.completedAt),
  };
};

const mapTicketRunProofSummary = (row: TicketRunRow): TicketRunProofSummary => {
  assertTicketRunProofStatus(row.proofStatus);
  return {
    status: row.proofStatus,
    lastProofRunId: row.lastProofRunId === null ? null : String(row.lastProofRunId),
    lastProofProfileId: row.lastProofProfileId === null ? null : String(row.lastProofProfileId),
    lastProofAt: row.lastProofAt === null ? null : Number(row.lastProofAt),
    lastProofSummary: row.lastProofSummary === null ? null : String(row.lastProofSummary),
    staleReason: row.proofStaleReason === null ? null : String(row.proofStaleReason),
  };
};

const mapTicketRunMissionClassification = (value: unknown): TicketRunMissionClassification | null => {
  if (!isRecord(value)) {
    return null;
  }
  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  const scopeSummary = typeof value.scopeSummary === "string" ? value.scopeSummary : "";
  if (!kind || !scopeSummary) {
    return null;
  }
  assertTicketRunMissionClassificationKind(kind);
  return {
    kind,
    scopeSummary,
    acceptanceCriteria: Array.isArray(value.acceptanceCriteria)
      ? value.acceptanceCriteria.filter((entry): entry is string => typeof entry === "string")
      : [],
    impactedRepoRelativePaths: Array.isArray(value.impactedRepoRelativePaths)
      ? value.impactedRepoRelativePaths.filter((entry): entry is string => typeof entry === "string")
      : [],
    risks: Array.isArray(value.risks) ? value.risks.filter((entry): entry is string => typeof entry === "string") : [],
    uiChange: value.uiChange === true,
    proofRequired: value.proofRequired === true,
    proofArtifactMode:
      typeof value.proofArtifactMode === "string" &&
      TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES.includes(value.proofArtifactMode as TicketRunMissionProofArtifactMode)
        ? (value.proofArtifactMode as TicketRunMissionProofArtifactMode)
        : "none",
    rationale: typeof value.rationale === "string" ? value.rationale : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
};

const mapTicketRunMissionPlan = (value: unknown): TicketRunMissionPlan | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    steps: Array.isArray(value.steps) ? value.steps.filter((entry): entry is string => typeof entry === "string") : [],
    touchedRepoRelativePaths: Array.isArray(value.touchedRepoRelativePaths)
      ? value.touchedRepoRelativePaths.filter((entry): entry is string => typeof entry === "string")
      : [],
    validationPlan: Array.isArray(value.validationPlan)
      ? value.validationPlan.filter((entry): entry is string => typeof entry === "string")
      : [],
    proofIntent: typeof value.proofIntent === "string" ? value.proofIntent : null,
    blockers: Array.isArray(value.blockers)
      ? value.blockers.filter((entry): entry is string => typeof entry === "string")
      : [],
    assumptions: Array.isArray(value.assumptions)
      ? value.assumptions.filter((entry): entry is string => typeof entry === "string")
      : [],
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
};

const mapTicketRunMissionSummary = (value: unknown): TicketRunMissionSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  const completedWork = typeof value.completedWork === "string" ? value.completedWork : "";
  if (!completedWork) {
    return null;
  }
  return {
    completedWork,
    changedRepoRelativePaths: Array.isArray(value.changedRepoRelativePaths)
      ? value.changedRepoRelativePaths.filter((entry): entry is string => typeof entry === "string")
      : [],
    validationSummary: typeof value.validationSummary === "string" ? value.validationSummary : null,
    proofSummary: typeof value.proofSummary === "string" ? value.proofSummary : null,
    openQuestions: Array.isArray(value.openQuestions)
      ? value.openQuestions.filter((entry): entry is string => typeof entry === "string")
      : [],
    followUps: Array.isArray(value.followUps)
      ? value.followUps.filter((entry): entry is string => typeof entry === "string")
      : [],
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
};

const mapTicketRunPreviousPassContext = (value: unknown): TicketRunPreviousPassContext | null => {
  if (!isRecord(value)) {
    return null;
  }

  const attemptId = typeof value.attemptId === "string" ? value.attemptId.trim() : "";
  const sequence = typeof value.sequence === "number" ? value.sequence : Number.NaN;
  const completedAt = typeof value.completedAt === "number" ? value.completedAt : Number.NaN;
  if (!attemptId || !Number.isFinite(sequence) || !Number.isFinite(completedAt)) {
    return null;
  }

  const proof = isRecord(value.proof)
    ? {
        status:
          typeof value.proof.status === "string" &&
          TICKET_RUN_PROOF_STATUSES.includes(value.proof.status as TicketRunProofStatus)
            ? (value.proof.status as TicketRunProofStatus)
            : "not-run",
        lastProofRunId: typeof value.proof.lastProofRunId === "string" ? value.proof.lastProofRunId : null,
        lastProofProfileId: typeof value.proof.lastProofProfileId === "string" ? value.proof.lastProofProfileId : null,
        lastProofAt: typeof value.proof.lastProofAt === "number" ? value.proof.lastProofAt : null,
        lastProofSummary: typeof value.proof.lastProofSummary === "string" ? value.proof.lastProofSummary : null,
        staleReason: typeof value.proof.staleReason === "string" ? value.proof.staleReason : null,
      }
    : {
        status: "not-run" as const,
        lastProofRunId: null,
        lastProofProfileId: null,
        lastProofAt: null,
        lastProofSummary: null,
        staleReason: null,
      };

  return {
    attemptId,
    sequence,
    completedAt,
    summary: typeof value.summary === "string" ? value.summary : null,
    classification: mapTicketRunMissionClassification(value.classification),
    plan: mapTicketRunMissionPlan(value.plan),
    validations: Array.isArray(value.validations)
      ? value.validations.flatMap((entry) => {
          if (!isRecord(entry)) {
            return [];
          }
          const validationId = typeof entry.validationId === "string" ? entry.validationId.trim() : "";
          const runId = typeof entry.runId === "string" ? entry.runId.trim() : "";
          const kind = typeof entry.kind === "string" ? entry.kind.trim() : "";
          const command = typeof entry.command === "string" ? entry.command.trim() : "";
          const cwd = typeof entry.cwd === "string" ? entry.cwd.trim() : "";
          const status = typeof entry.status === "string" ? entry.status.trim() : "";
          if (!validationId || !runId || !kind || !command || !cwd || !status) {
            return [];
          }
          assertTicketRunMissionValidationKind(kind);
          assertTicketRunMissionValidationStatus(status);
          return [
            {
              validationId,
              runId,
              kind,
              command,
              cwd,
              status,
              summary: typeof entry.summary === "string" ? entry.summary : null,
              artifacts: Array.isArray(entry.artifacts)
                ? entry.artifacts.flatMap((artifact) => {
                    const mapped = mapTicketRunProofArtifact(artifact);
                    return mapped ? [mapped] : [];
                  })
                : [],
              startedAt: typeof entry.startedAt === "number" ? entry.startedAt : 0,
              completedAt: typeof entry.completedAt === "number" ? entry.completedAt : null,
              createdAt: typeof entry.createdAt === "number" ? entry.createdAt : 0,
              updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0,
            } satisfies TicketRunMissionValidationRecord,
          ];
        })
      : [],
    proofStrategy: isRecord(value.proofStrategy)
      ? mapTicketRunProofStrategyRow({
          runId: typeof value.proofStrategy.runId === "string" ? value.proofStrategy.runId : "",
          adapterId: typeof value.proofStrategy.adapterId === "string" ? value.proofStrategy.adapterId : "",
          repoRelativePath:
            typeof value.proofStrategy.repoRelativePath === "string" ? value.proofStrategy.repoRelativePath : "",
          scenarioPath: typeof value.proofStrategy.scenarioPath === "string" ? value.proofStrategy.scenarioPath : null,
          scenarioName: typeof value.proofStrategy.scenarioName === "string" ? value.proofStrategy.scenarioName : null,
          command: typeof value.proofStrategy.command === "string" ? value.proofStrategy.command : "",
          artifactMode:
            typeof value.proofStrategy.artifactMode === "string" ? value.proofStrategy.artifactMode : "none",
          rationale: typeof value.proofStrategy.rationale === "string" ? value.proofStrategy.rationale : "",
          metadataJson: serializeJson(value.proofStrategy.metadata ?? null),
          createdAt: typeof value.proofStrategy.createdAt === "number" ? value.proofStrategy.createdAt : 0,
          updatedAt: typeof value.proofStrategy.updatedAt === "number" ? value.proofStrategy.updatedAt : 0,
        })
      : null,
    missionSummary: mapTicketRunMissionSummary(value.missionSummary),
    proof,
  };
};

const mapTicketRunProofArtifact = (value: unknown): TicketRunProofArtifact | null => {
  if (!isRecord(value)) {
    return null;
  }
  const artifactId = typeof value.artifactId === "string" ? value.artifactId.trim() : "";
  const kind = typeof value.kind === "string" ? value.kind.trim() : "";
  const label = typeof value.label === "string" ? value.label.trim() : "";
  const artifactPath = typeof value.path === "string" ? value.path.trim() : "";
  const fileUrl = typeof value.fileUrl === "string" ? value.fileUrl.trim() : "";
  if (!artifactId || !kind || !label || !artifactPath || !fileUrl) {
    return null;
  }
  assertTicketRunProofArtifactKind(kind);
  return {
    artifactId,
    kind,
    label,
    path: artifactPath,
    fileUrl,
  };
};

const mapTicketRunProofRunRow = (row: TicketRunProofRunRow): TicketRunProofRunSummary => {
  assertTicketRunProofRunStatus(row.status);
  const parsedArtifacts = tryParseJson(row.artifactsJson);
  const artifacts = Array.isArray(parsedArtifacts)
    ? parsedArtifacts.flatMap((entry) => {
        const artifact = mapTicketRunProofArtifact(entry);
        return artifact ? [artifact] : [];
      })
    : [];
  return {
    proofRunId: String(row.proofRunId),
    runId: String(row.runId),
    profileId: String(row.profileId),
    profileLabel: String(row.profileLabel),
    status: row.status,
    summary: row.summary === null ? null : String(row.summary),
    startedAt: Number(row.startedAt),
    completedAt: row.completedAt === null ? null : Number(row.completedAt),
    exitCode: row.exitCode === null ? null : Number(row.exitCode),
    command: row.command === null ? null : String(row.command),
    artifacts,
  };
};

const mapTicketRunValidationRow = (row: TicketRunValidationRow): TicketRunMissionValidationRecord => {
  assertTicketRunMissionValidationKind(row.kind);
  assertTicketRunMissionValidationStatus(row.status);
  const parsedArtifacts = tryParseJson(row.artifactsJson);
  const artifacts = Array.isArray(parsedArtifacts)
    ? parsedArtifacts.flatMap((entry) => {
        const artifact = mapTicketRunProofArtifact(entry);
        return artifact ? [artifact] : [];
      })
    : [];
  return {
    validationId: String(row.validationId),
    runId: String(row.runId),
    kind: row.kind,
    command: String(row.command),
    cwd: String(row.cwd),
    status: row.status,
    summary: row.summary === null ? null : String(row.summary),
    artifacts,
    startedAt: Number(row.startedAt),
    completedAt: row.completedAt === null ? null : Number(row.completedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

const mapTicketRunProofStrategyRow = (row: TicketRunProofStrategyRow): TicketRunMissionProofStrategy => {
  assertTicketRunMissionProofArtifactMode(row.artifactMode);
  const metadata = tryParseJson(row.metadataJson);
  return {
    runId: String(row.runId),
    adapterId: String(row.adapterId),
    repoRelativePath: String(row.repoRelativePath),
    scenarioPath: row.scenarioPath === null ? null : String(row.scenarioPath),
    scenarioName: row.scenarioName === null ? null : String(row.scenarioName),
    command: String(row.command),
    artifactMode: row.artifactMode,
    rationale: String(row.rationale),
    metadata: isRecord(metadata) ? metadata : null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

const mapTicketRunSubmoduleParentRow = (row: TicketRunSubmoduleParentRow): TicketRunSubmoduleParentRef => ({
  parentRepoRelativePath: String(row.parentRepoRelativePath),
  submodulePath: String(row.submodulePath),
  submoduleWorktreePath: String(row.submoduleWorktreePath),
});

const mapTicketRunSubmoduleRow = (
  row: TicketRunSubmoduleRow,
  parentRefs: readonly TicketRunSubmoduleParentRef[],
): TicketRunSubmoduleSummary => ({
  canonicalUrl: String(row.canonicalUrl),
  name: String(row.name),
  branchName: String(row.branchName),
  commitMessageDraft: row.commitMessageDraft === null ? null : String(row.commitMessageDraft),
  parentRefs: [...parentRefs],
  createdAt: Number(row.createdAt),
  updatedAt: Number(row.updatedAt),
});

const mapTicketRunRow = (
  row: TicketRunRow,
  worktrees: readonly TicketRunWorktreeSummary[],
  attempts: readonly TicketRunAttemptSummary[],
  submodules: readonly TicketRunSubmoduleSummary[],
  validations: readonly TicketRunMissionValidationRecord[],
  proofStrategy: TicketRunMissionProofStrategy | null,
  proofRuns: readonly TicketRunProofRunSummary[],
): TicketRunSummary => {
  assertTicketRunStatus(row.status);
  assertTicketRunMissionPhase(row.missionPhase);
  return {
    runId: String(row.runId),
    stationId: row.stationId === null ? null : String(row.stationId),
    ticketId: String(row.ticketId),
    ticketSummary: String(row.ticketSummary),
    ticketUrl: String(row.ticketUrl),
    projectKey: String(row.projectKey),
    status: row.status,
    statusMessage: row.statusMessage === null ? null : String(row.statusMessage),
    commitMessageDraft:
      row.commitMessageDraft === null ? (worktrees[0]?.commitMessageDraft ?? null) : String(row.commitMessageDraft),
    startedAt: Number(row.startedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    worktrees: [...worktrees],
    submodules: [...submodules],
    attempts: [...attempts],
    missionPhase: row.missionPhase,
    missionPhaseUpdatedAt: Number(row.missionPhaseUpdatedAt),
    classification: mapTicketRunMissionClassification(tryParseJson(row.classificationJson)),
    plan: mapTicketRunMissionPlan(tryParseJson(row.planJson)),
    validations: [...validations],
    proofStrategy,
    missionSummary: mapTicketRunMissionSummary(tryParseJson(row.summaryJson)),
    previousPassContext: mapTicketRunPreviousPassContext(tryParseJson(row.previousPassContextJson)),
    proof: mapTicketRunProofSummary(row),
    proofRuns: [...proofRuns],
  };
};

const configureDatabase = (db: SqliteDatabase, readonly: boolean): void => {
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  if (readonly) {
    db.pragma("query_only = ON");
    return;
  }

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
};

const applyMigrations = (db: SqliteDatabase): void => {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    return;
  }

  const migrate = db.transaction(() => {
    for (const migration of pending) {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.pragma(`user_version = ${migration.version}`);
    }
  });

  migrate();
};

export class SpiraMemoryDatabase {
  static open(databasePath: string, options: OpenSpiraMemoryDatabaseOptions = {}): SpiraMemoryDatabase {
    const readonly = options.readonly === true;
    if (!readonly) {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    const db = new BetterSqlite3(databasePath, readonly ? { readonly: true, fileMustExist: true } : undefined);
    configureDatabase(db, readonly);
    if (!readonly) {
      applyMigrations(db);
    }

    return new SpiraMemoryDatabase(db, databasePath, readonly);
  }

  private constructor(
    private readonly db: SqliteDatabase,
    readonly databasePath: string,
    readonly isReadonly: boolean,
  ) {}

  close(): void {
    this.db.close();
  }

  createConversation(input: CreateConversationInput = {}): string {
    this.assertWritable();
    const conversationId = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? Date.now();
    const title = normalizeTitle(input.title);
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, created_at, updated_at, last_viewed_at, archived)
         VALUES (@id, @title, @createdAt, @updatedAt, @lastViewedAt, 0)
         ON CONFLICT(id) DO UPDATE SET
            title = COALESCE(conversations.title, excluded.title),
            updated_at = MAX(conversations.updated_at, excluded.updated_at),
            last_viewed_at = COALESCE(excluded.last_viewed_at, conversations.last_viewed_at),
            archived = 0`,
      )
      .run({
        id: conversationId,
        title,
        createdAt,
        updatedAt: createdAt,
        lastViewedAt: createdAt,
      });
    return conversationId;
  }

  appendMessage(input: AppendConversationMessageInput): void {
    this.assertWritable();
    const title = input.role === "user" ? summarizeConversationTitle(input.content) : null;
    this.createConversation({
      id: input.conversationId,
      title,
      createdAt: input.timestamp,
    });

    this.db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, was_aborted, auto_speak, timestamp)
         VALUES (@id, @conversationId, @role, @content, @wasAborted, @autoSpeak, @timestamp)
         ON CONFLICT(id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           role = excluded.role,
           content = excluded.content,
           was_aborted = excluded.was_aborted,
           auto_speak = excluded.auto_speak,
           timestamp = excluded.timestamp`,
      )
      .run({
        id: input.id,
        conversationId: input.conversationId,
        role: input.role,
        content: input.content,
        wasAborted: input.wasAborted === true ? 1 : 0,
        autoSpeak: input.autoSpeak === true ? 1 : 0,
        timestamp: input.timestamp,
      });

    this.db
      .prepare("UPDATE conversations SET updated_at = MAX(updated_at, @updatedAt) WHERE id = @id")
      .run({ id: input.conversationId, updatedAt: input.timestamp });
    this.markConversationViewed(input.conversationId, input.timestamp);
  }

  upsertToolCall(input: UpsertToolCallInput): void {
    this.assertWritable();
    const existing = input.callId
      ? (this.db
          .prepare(
            `SELECT id
             FROM tool_calls
             WHERE message_id = @messageId AND call_id = @callId
             ORDER BY id DESC
             LIMIT 1`,
          )
          .get({
            messageId: input.messageId,
            callId: input.callId,
          }) as { id: number } | undefined)
      : (this.db
          .prepare(
            `SELECT id
             FROM tool_calls
             WHERE message_id = @messageId AND name = @name AND call_id IS NULL
             ORDER BY id DESC
             LIMIT 1`,
          )
          .get({
            messageId: input.messageId,
            name: input.name,
          }) as { id: number } | undefined);

    const payload = {
      id: existing?.id,
      messageId: input.messageId,
      callId: input.callId ?? null,
      name: input.name,
      args: serializeJson(input.args),
      result: serializeJson(input.result),
      status: input.status ?? null,
      details: input.details ?? null,
    };

    if (existing) {
      this.db
        .prepare(
          `UPDATE tool_calls
           SET call_id = @callId,
               name = @name,
               args = @args,
               result = @result,
               status = @status,
               details = @details
           WHERE id = @id`,
        )
        .run(payload);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO tool_calls (message_id, call_id, name, args, result, status, details)
         VALUES (@messageId, @callId, @name, @args, @result, @status, @details)`,
      )
      .run(payload);
  }

  listConversations(limit = 20, offset = 0): ConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.created_at AS createdAt,
           c.updated_at AS updatedAt,
           c.last_viewed_at AS lastViewedAt,
           COUNT(m.id) AS messageCount,
           MAX(m.timestamp) AS lastMessageAt
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id
          WHERE c.archived = 0
          GROUP BY c.id, c.title, c.created_at, c.updated_at, c.last_viewed_at
          ORDER BY COALESCE(c.last_viewed_at, MAX(m.timestamp), c.updated_at) DESC
          LIMIT @limit OFFSET @offset`,
      )
      .all({ limit, offset }) as unknown as ConversationSummaryRow[];

    return rows.map((row) => ({
      id: String(row.id),
      title: row.title === null ? null : String(row.title),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
      messageCount: Number(row.messageCount),
      lastMessageAt: row.lastMessageAt === null ? null : Number(row.lastMessageAt),
      lastViewedAt: row.lastViewedAt === null ? null : Number(row.lastViewedAt),
    }));
  }

  getConversation(conversationId: string): ConversationRecord | null {
    const summary = this.db
      .prepare(
        `SELECT
           c.id,
           c.title,
           c.created_at AS createdAt,
           c.updated_at AS updatedAt,
           c.last_viewed_at AS lastViewedAt,
           COUNT(m.id) AS messageCount,
           MAX(m.timestamp) AS lastMessageAt
          FROM conversations c
          LEFT JOIN messages m ON m.conversation_id = c.id
          WHERE c.id = @conversationId AND c.archived = 0
          GROUP BY c.id, c.title, c.created_at, c.updated_at, c.last_viewed_at`,
      )
      .get({ conversationId }) as ConversationSummaryRow | undefined;

    if (!summary) {
      return null;
    }

    const toolCallsByMessageId = new Map<string, ConversationToolCallRecord[]>();
    const toolCallRows = this.db
      .prepare(
        `SELECT
           message_id AS messageId,
           call_id AS callId,
           name,
           args,
           result,
           status,
           details
         FROM tool_calls
         WHERE message_id IN (
           SELECT id
           FROM messages
           WHERE conversation_id = @conversationId
         )
         ORDER BY id ASC`,
      )
      .all({ conversationId }) as unknown as ToolCallRow[];

    for (const row of toolCallRows) {
      const messageId = String(row.messageId);
      const toolCalls = toolCallsByMessageId.get(messageId) ?? [];
      toolCalls.push({
        callId: row.callId === null ? null : String(row.callId),
        name: String(row.name),
        args: tryParseJson(row.args),
        result: tryParseJson(row.result),
        status: row.status === null ? null : (String(row.status) as "pending" | "running" | "success" | "error"),
        details: row.details === null ? null : String(row.details),
      });
      toolCallsByMessageId.set(messageId, toolCalls);
    }

    const messages = (
      this.db
        .prepare(
          `SELECT
           id,
           conversation_id AS conversationId,
           role,
           content,
           timestamp,
           was_aborted AS wasAborted,
           auto_speak AS autoSpeak
         FROM messages
         WHERE conversation_id = @conversationId
         ORDER BY timestamp ASC, rowid ASC`,
        )
        .all({ conversationId }) as unknown as ConversationMessageRow[]
    ).map((row) => ({
      id: String(row.id),
      conversationId: String(row.conversationId),
      role: String(row.role) as ConversationRole,
      content: String(row.content),
      timestamp: Number(row.timestamp),
      wasAborted: toBoolean(Number(row.wasAborted)),
      autoSpeak: toBoolean(Number(row.autoSpeak)),
      toolCalls: toolCallsByMessageId.get(String(row.id)) ?? [],
    }));

    return {
      id: String(summary.id),
      title: summary.title === null ? null : String(summary.title),
      createdAt: Number(summary.createdAt),
      updatedAt: Number(summary.updatedAt),
      messageCount: Number(summary.messageCount),
      lastMessageAt: summary.lastMessageAt === null ? null : Number(summary.lastMessageAt),
      lastViewedAt: summary.lastViewedAt === null ? null : Number(summary.lastViewedAt),
      messages,
    };
  }

  getMostRecentConversation(): ConversationRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           c.id
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.archived = 0
         GROUP BY c.id, c.last_viewed_at, c.updated_at
         ORDER BY COALESCE(c.last_viewed_at, MAX(m.timestamp), c.updated_at) DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;

    if (!row) {
      return null;
    }

    return this.getConversation(String(row.id));
  }

  searchConversationMessages(query: string, limit = 10): ConversationSearchResult[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const rows = this.db
      .prepare(
        `SELECT
           m.conversation_id AS conversationId,
           c.title AS conversationTitle,
           m.id AS messageId,
           m.role AS role,
           m.timestamp AS timestamp,
           snippet(messages_fts, 0, '[', ']', ' ... ', 18) AS snippet,
           bm25(messages_fts) AS score
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         JOIN conversations c ON c.id = m.conversation_id
         WHERE messages_fts MATCH @query AND c.archived = 0
         ORDER BY score ASC, m.timestamp DESC
         LIMIT @limit`,
      )
      .all({ query: ftsQuery, limit }) as unknown as ConversationSearchRow[];

    return rows.map((row) => ({
      conversationId: String(row.conversationId),
      conversationTitle: row.conversationTitle === null ? null : String(row.conversationTitle),
      messageId: String(row.messageId),
      role: String(row.role) as ConversationRole,
      timestamp: Number(row.timestamp),
      snippet: String(row.snippet),
      score: Number(row.score),
    }));
  }

  markConversationViewed(conversationId: string, timestamp = Date.now()): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET last_viewed_at = @timestamp,
             updated_at = MAX(updated_at, @timestamp)
         WHERE id = @conversationId AND archived = 0`,
      )
      .run({ conversationId, timestamp });

    return result.changes > 0;
  }

  archiveConversation(conversationId: string, timestamp = Date.now()): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE conversations
         SET archived = 1,
             updated_at = MAX(updated_at, @timestamp)
         WHERE id = @conversationId AND archived = 0`,
      )
      .run({ conversationId, timestamp });

    return result.changes > 0;
  }

  getSessionState(key: string): string | null {
    const row = this.db
      .prepare(
        `SELECT
           value
         FROM session_state
         WHERE key = @key`,
      )
      .get({ key }) as SessionStateRow | undefined;

    if (!row) {
      return null;
    }

    return row.value === null ? null : String(row.value);
  }

  setSessionState(key: string, value: string | null): void {
    this.assertWritable();
    if (value === null) {
      this.db
        .prepare(
          `DELETE FROM session_state
           WHERE key = @key`,
        )
        .run({ key });
      return;
    }

    const normalizedValue = value.trim();
    if (!normalizedValue) {
      throw new Error("Session state values cannot be empty.");
    }

    const updatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO session_state (key, value, updated_at)
         VALUES (@key, @value, @updatedAt)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run({
        key,
        value: normalizedValue,
        updatedAt,
      });
  }

  getYouTrackStateMapping(): YouTrackStateMapping | null {
    const row = this.db
      .prepare(
        `SELECT
           todo_json AS todoJson,
           in_progress_json AS inProgressJson,
           updated_at AS updatedAt
         FROM youtrack_state_mapping_config
         WHERE id = 1`,
      )
      .get() as YouTrackStateMappingRow | undefined;

    if (!row) {
      return null;
    }

    return normalizeYouTrackStateMapping({
      todo: parseStringArray(row.todoJson),
      inProgress: parseStringArray(row.inProgressJson),
    });
  }

  setYouTrackStateMapping(mapping: YouTrackStateMapping): YouTrackStateMapping {
    this.assertWritable();
    const normalizedMapping = normalizeYouTrackStateMapping(mapping);
    const updatedAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO youtrack_state_mapping_config (id, todo_json, in_progress_json, updated_at)
         VALUES (1, @todoJson, @inProgressJson, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           todo_json = excluded.todo_json,
           in_progress_json = excluded.in_progress_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        todoJson: serializeJson(normalizedMapping.todo) ?? "[]",
        inProgressJson: serializeJson(normalizedMapping.inProgress) ?? "[]",
        updatedAt,
      });

    return normalizedMapping;
  }

  getProjectWorkspaceRoot(): string | null {
    const row = this.db
      .prepare(
        `SELECT
           workspace_root AS workspaceRoot
         FROM project_workspace_config
         WHERE id = 1`,
      )
      .get() as ProjectWorkspaceConfigRow | undefined;

    if (!row) {
      return null;
    }

    return row.workspaceRoot === null ? null : String(row.workspaceRoot);
  }

  setProjectWorkspaceRoot(workspaceRoot: string | null): void {
    this.assertWritable();
    const updatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO project_workspace_config (id, workspace_root, updated_at)
         VALUES (1, @workspaceRoot, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           workspace_root = excluded.workspace_root,
           updated_at = excluded.updated_at`,
      )
      .run({
        workspaceRoot,
        updatedAt,
      });
  }

  listProjectRepoMappings(): ProjectRepoMappingRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           updated_at AS updatedAt
         FROM project_repo_mappings
         ORDER BY project_key COLLATE NOCASE ASC, repo_relative_path COLLATE NOCASE ASC`,
      )
      .all() as unknown as ProjectRepoMappingRow[];

    const grouped = new Map<string, ProjectRepoMappingRecord>();
    for (const row of rows) {
      const existing = grouped.get(row.projectKey);
      if (existing) {
        existing.repoRelativePaths.push(String(row.repoRelativePath));
        existing.updatedAt = Math.max(existing.updatedAt, Number(row.updatedAt));
        continue;
      }

      grouped.set(row.projectKey, {
        projectKey: String(row.projectKey),
        repoRelativePaths: [String(row.repoRelativePath)],
        updatedAt: Number(row.updatedAt),
      });
    }

    return [...grouped.values()];
  }

  setProjectRepoMapping(projectKey: string, repoRelativePaths: readonly string[]): ProjectRepoMappingRecord {
    this.assertWritable();
    const normalizedProjectKey = projectKey.trim();
    if (!normalizedProjectKey) {
      throw new Error("Project key cannot be empty.");
    }

    const normalizedPaths = [...new Set(repoRelativePaths.map((pathEntry) => pathEntry.trim()).filter(Boolean))].sort(
      (left, right) => left.localeCompare(right),
    );
    const now = Date.now();

    const replace = this.db.transaction((paths: readonly string[]) => {
      this.db
        .prepare(
          `DELETE FROM project_repo_mappings
           WHERE project_key = @projectKey`,
        )
        .run({ projectKey: normalizedProjectKey });

      const insert = this.db.prepare(
        `INSERT INTO project_repo_mappings (
           project_key,
           repo_relative_path,
           created_at,
           updated_at
         ) VALUES (
           @projectKey,
           @repoRelativePath,
           @createdAt,
           @updatedAt
         )`,
      );

      for (const repoRelativePath of paths) {
        insert.run({
          projectKey: normalizedProjectKey,
          repoRelativePath,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    replace(normalizedPaths);

    return {
      projectKey: normalizedProjectKey,
      repoRelativePaths: normalizedPaths,
      updatedAt: now,
    };
  }

  listTicketRuns(): TicketRunSummary[] {
    const runRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           station_id AS stationId,
           ticket_id AS ticketId,
           ticket_summary AS ticketSummary,
           ticket_url AS ticketUrl,
            project_key AS projectKey,
            status,
            status_message AS statusMessage,
            commit_message_draft AS commitMessageDraft,
            mission_phase AS missionPhase,
            mission_phase_updated_at AS missionPhaseUpdatedAt,
           classification_json AS classificationJson,
           plan_json AS planJson,
           summary_json AS summaryJson,
           previous_pass_context_json AS previousPassContextJson,
           proof_status AS proofStatus,
            last_proof_run_id AS lastProofRunId,
            last_proof_profile_id AS lastProofProfileId,
           last_proof_at AS lastProofAt,
           last_proof_summary AS lastProofSummary,
           proof_stale_reason AS proofStaleReason,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_runs
         ORDER BY updated_at DESC, created_at DESC`,
      )
      .all() as unknown as TicketRunRow[];

    const worktreeRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           repo_relative_path AS repoRelativePath,
           repo_absolute_path AS repoAbsolutePath,
           worktree_path AS worktreePath,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           cleanup_state AS cleanupState,
           created_at AS createdAt,
           updated_at AS updatedAt
          FROM ticket_run_worktrees
          ORDER BY run_id ASC, repo_relative_path COLLATE NOCASE ASC`,
      )
      .all() as unknown as TicketRunWorktreeRow[];

    const worktreesByRun = new Map<string, TicketRunWorktreeSummary[]>();
    for (const row of worktreeRows) {
      const worktrees = worktreesByRun.get(row.runId) ?? [];
      worktrees.push(mapTicketRunWorktreeRow(row));
      worktreesByRun.set(row.runId, worktrees);
    }

    const attemptRows = this.db
      .prepare(
        `SELECT
           attempt_id AS attemptId,
           run_id AS runId,
           subagent_run_id AS subagentRunId,
           sequence,
           status,
           prompt,
           summary,
           followup_needed AS followupNeeded,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt,
           completed_at AS completedAt
         FROM ticket_run_attempts
         ORDER BY run_id ASC, sequence ASC`,
      )
      .all() as unknown as TicketRunAttemptRow[];

    const attemptsByRun = new Map<string, TicketRunAttemptSummary[]>();
    for (const row of attemptRows) {
      const attempts = attemptsByRun.get(row.runId) ?? [];
      attempts.push(mapTicketRunAttemptRow(row));
      attemptsByRun.set(row.runId, attempts);
    }

    const validationRows = this.db
      .prepare(
        `SELECT
           validation_id AS validationId,
           run_id AS runId,
           kind,
           command,
           cwd,
           status,
           summary,
           artifacts_json AS artifactsJson,
           started_at AS startedAt,
           completed_at AS completedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_validations
         ORDER BY run_id ASC, started_at DESC, created_at DESC`,
      )
      .all() as unknown as TicketRunValidationRow[];

    const validationsByRun = new Map<string, TicketRunMissionValidationRecord[]>();
    for (const row of validationRows) {
      const validations = validationsByRun.get(row.runId) ?? [];
      validations.push(mapTicketRunValidationRow(row));
      validationsByRun.set(row.runId, validations);
    }

    const proofStrategyRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           adapter_id AS adapterId,
           repo_relative_path AS repoRelativePath,
           scenario_path AS scenarioPath,
           scenario_name AS scenarioName,
           command,
           artifact_mode AS artifactMode,
           rationale,
           metadata_json AS metadataJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_proof_strategy`,
      )
      .all() as unknown as TicketRunProofStrategyRow[];

    const proofStrategyByRun = new Map<string, TicketRunMissionProofStrategy>();
    for (const row of proofStrategyRows) {
      proofStrategyByRun.set(row.runId, mapTicketRunProofStrategyRow(row));
    }

    const proofRunRows = this.db
      .prepare(
        `SELECT
           proof_run_id AS proofRunId,
           run_id AS runId,
           profile_id AS profileId,
           profile_label AS profileLabel,
           status,
           summary,
           started_at AS startedAt,
           completed_at AS completedAt,
           exit_code AS exitCode,
           command,
           artifacts_json AS artifactsJson
         FROM ticket_run_proof_runs
         ORDER BY run_id ASC, started_at DESC`,
      )
      .all() as unknown as TicketRunProofRunRow[];

    const proofRunsByRun = new Map<string, TicketRunProofRunSummary[]>();
    for (const row of proofRunRows) {
      const proofRuns = proofRunsByRun.get(row.runId) ?? [];
      proofRuns.push(mapTicketRunProofRunRow(row));
      proofRunsByRun.set(row.runId, proofRuns);
    }

    const submoduleRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           name,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_submodules
         ORDER BY run_id ASC, canonical_url COLLATE NOCASE ASC`,
      )
      .all() as unknown as TicketRunSubmoduleRow[];

    const submoduleParentRows = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           parent_repo_relative_path AS parentRepoRelativePath,
           submodule_path AS submodulePath,
           submodule_worktree_path AS submoduleWorktreePath
         FROM ticket_run_submodule_parents
         ORDER BY run_id ASC, canonical_url COLLATE NOCASE ASC, parent_repo_relative_path COLLATE NOCASE ASC, submodule_path COLLATE NOCASE ASC`,
      )
      .all() as unknown as TicketRunSubmoduleParentRow[];

    const submoduleParentRefsByKey = new Map<string, TicketRunSubmoduleParentRef[]>();
    for (const row of submoduleParentRows) {
      const key = `${row.runId}\u0000${row.canonicalUrl}`;
      const parentRefs = submoduleParentRefsByKey.get(key) ?? [];
      parentRefs.push(mapTicketRunSubmoduleParentRow(row));
      submoduleParentRefsByKey.set(key, parentRefs);
    }

    const submodulesByRun = new Map<string, TicketRunSubmoduleSummary[]>();
    for (const row of submoduleRows) {
      const key = `${row.runId}\u0000${row.canonicalUrl}`;
      const submodules = submodulesByRun.get(row.runId) ?? [];
      submodules.push(mapTicketRunSubmoduleRow(row, submoduleParentRefsByKey.get(key) ?? []));
      submodulesByRun.set(row.runId, submodules);
    }

    return runRows.map((row) =>
      mapTicketRunRow(
        row,
        worktreesByRun.get(row.runId) ?? [],
        attemptsByRun.get(row.runId) ?? [],
        submodulesByRun.get(row.runId) ?? [],
        validationsByRun.get(row.runId) ?? [],
        proofStrategyByRun.get(row.runId) ?? null,
        proofRunsByRun.get(row.runId) ?? [],
      ),
    );
  }

  getTicketRun(runId: string): TicketRunSummary | null {
    const row = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           station_id AS stationId,
           ticket_id AS ticketId,
           ticket_summary AS ticketSummary,
           ticket_url AS ticketUrl,
            project_key AS projectKey,
            status,
            status_message AS statusMessage,
            commit_message_draft AS commitMessageDraft,
            mission_phase AS missionPhase,
            mission_phase_updated_at AS missionPhaseUpdatedAt,
            classification_json AS classificationJson,
            plan_json AS planJson,
            summary_json AS summaryJson,
            proof_status AS proofStatus,
            last_proof_run_id AS lastProofRunId,
            last_proof_profile_id AS lastProofProfileId,
           last_proof_at AS lastProofAt,
           last_proof_summary AS lastProofSummary,
           proof_stale_reason AS proofStaleReason,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_runs
         WHERE run_id = @runId`,
      )
      .get({ runId }) as TicketRunRow | undefined;

    if (!row) {
      return null;
    }

    const worktrees = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           repo_relative_path AS repoRelativePath,
           repo_absolute_path AS repoAbsolutePath,
           worktree_path AS worktreePath,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           cleanup_state AS cleanupState,
           created_at AS createdAt,
           updated_at AS updatedAt
          FROM ticket_run_worktrees
          WHERE run_id = @runId
         ORDER BY repo_relative_path COLLATE NOCASE ASC`,
      )
      .all({ runId }) as unknown as TicketRunWorktreeRow[];

    const attempts = this.db
      .prepare(
        `SELECT
           attempt_id AS attemptId,
           run_id AS runId,
           subagent_run_id AS subagentRunId,
           sequence,
           status,
           prompt,
           summary,
           followup_needed AS followupNeeded,
           started_at AS startedAt,
           created_at AS createdAt,
           updated_at AS updatedAt,
           completed_at AS completedAt
         FROM ticket_run_attempts
         WHERE run_id = @runId
         ORDER BY sequence ASC`,
      )
      .all({ runId }) as unknown as TicketRunAttemptRow[];

    const validations = this.db
      .prepare(
        `SELECT
           validation_id AS validationId,
           run_id AS runId,
           kind,
           command,
           cwd,
           status,
           summary,
           artifacts_json AS artifactsJson,
           started_at AS startedAt,
           completed_at AS completedAt,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_validations
         WHERE run_id = @runId
         ORDER BY started_at DESC, created_at DESC`,
      )
      .all({ runId }) as unknown as TicketRunValidationRow[];

    const proofStrategy = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           adapter_id AS adapterId,
           repo_relative_path AS repoRelativePath,
           scenario_path AS scenarioPath,
           scenario_name AS scenarioName,
           command,
           artifact_mode AS artifactMode,
           rationale,
           metadata_json AS metadataJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_proof_strategy
         WHERE run_id = @runId`,
      )
      .get({ runId }) as TicketRunProofStrategyRow | undefined;

    const proofRuns = this.db
      .prepare(
        `SELECT
           proof_run_id AS proofRunId,
           run_id AS runId,
           profile_id AS profileId,
           profile_label AS profileLabel,
           status,
           summary,
           started_at AS startedAt,
           completed_at AS completedAt,
           exit_code AS exitCode,
           command,
           artifacts_json AS artifactsJson
         FROM ticket_run_proof_runs
         WHERE run_id = @runId
         ORDER BY started_at DESC`,
      )
      .all({ runId }) as unknown as TicketRunProofRunRow[];

    const submodules = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           name,
           branch_name AS branchName,
           commit_message_draft AS commitMessageDraft,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM ticket_run_submodules
         WHERE run_id = @runId
         ORDER BY canonical_url COLLATE NOCASE ASC`,
      )
      .all({ runId }) as unknown as TicketRunSubmoduleRow[];

    const submoduleParents = this.db
      .prepare(
        `SELECT
           run_id AS runId,
           canonical_url AS canonicalUrl,
           parent_repo_relative_path AS parentRepoRelativePath,
           submodule_path AS submodulePath,
           submodule_worktree_path AS submoduleWorktreePath
         FROM ticket_run_submodule_parents
         WHERE run_id = @runId
         ORDER BY canonical_url COLLATE NOCASE ASC, parent_repo_relative_path COLLATE NOCASE ASC, submodule_path COLLATE NOCASE ASC`,
      )
      .all({ runId }) as unknown as TicketRunSubmoduleParentRow[];

    const submoduleParentRefsByCanonicalUrl = new Map<string, TicketRunSubmoduleParentRef[]>();
    for (const parentRow of submoduleParents) {
      const parentRefs = submoduleParentRefsByCanonicalUrl.get(parentRow.canonicalUrl) ?? [];
      parentRefs.push(mapTicketRunSubmoduleParentRow(parentRow));
      submoduleParentRefsByCanonicalUrl.set(parentRow.canonicalUrl, parentRefs);
    }

    return mapTicketRunRow(
      row,
      worktrees.map((worktree) => mapTicketRunWorktreeRow(worktree)),
      attempts.map((attempt) => mapTicketRunAttemptRow(attempt)),
      submodules.map((submodule) =>
        mapTicketRunSubmoduleRow(submodule, submoduleParentRefsByCanonicalUrl.get(submodule.canonicalUrl) ?? []),
      ),
      validations.map((validation) => mapTicketRunValidationRow(validation)),
      proofStrategy ? mapTicketRunProofStrategyRow(proofStrategy) : null,
      proofRuns.map((proofRun) => mapTicketRunProofRunRow(proofRun)),
    );
  }

  getTicketRunByTicketId(ticketId: string): TicketRunSummary | null {
    const row = this.db
      .prepare(
        `SELECT
            run_id AS runId
          FROM ticket_runs
         WHERE ticket_id = @ticketId`,
      )
      .get({ ticketId }) as { runId: string } | undefined;

    return row ? this.getTicketRun(String(row.runId)) : null;
  }

  deleteTicketRun(runId: string): boolean {
    this.assertWritable();
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      throw new Error("Ticket runs require a non-empty run id to delete.");
    }

    return (
      this.db
        .prepare(
          `DELETE FROM ticket_runs
           WHERE run_id = @runId`,
        )
        .run({ runId: normalizedRunId }).changes > 0
    );
  }

  upsertTicketRun(input: UpsertTicketRunInput): TicketRunSummary {
    this.assertWritable();
    const runId = input.runId.trim();
    const stationId = normalizeTitle(input.stationId);
    const ticketId = input.ticketId.trim();
    const ticketSummary = input.ticketSummary.trim();
    const ticketUrl = input.ticketUrl.trim();
    const projectKey = input.projectKey.trim();
    if (!runId || !ticketId || !ticketSummary || !ticketUrl || !projectKey) {
      throw new Error("Ticket runs require non-empty run, ticket, summary, URL, and project key values.");
    }

    const now = Date.now();
    const createdAt = input.createdAt ?? now;
    const startedAt = input.startedAt ?? createdAt;
    const statusMessage = normalizeTitle(input.statusMessage);
    const status = input.status;
    assertTicketRunStatus(status);
    const normalizedWorktrees = input.worktrees.map((worktree) => {
      const repoRelativePath = worktree.repoRelativePath.trim();
      const repoAbsolutePath = worktree.repoAbsolutePath.trim();
      const worktreePath = worktree.worktreePath.trim();
      const branchName = worktree.branchName.trim();
      if (!repoRelativePath || !repoAbsolutePath || !worktreePath || !branchName) {
        throw new Error("Ticket run worktrees require repo path, absolute path, worktree path, and branch name.");
      }

      const cleanupState = worktree.cleanupState ?? "retained";
      const commitMessageDraft = normalizeTitle(worktree.commitMessageDraft);
      assertTicketRunCleanupState(cleanupState);
      return {
        repoRelativePath,
        repoAbsolutePath,
        worktreePath,
        branchName,
        commitMessageDraft,
        cleanupState,
        createdAt: worktree.createdAt ?? createdAt,
        updatedAt: worktree.updatedAt ?? now,
      };
    });
    const commitMessageDraft = normalizeTitle(
      input.commitMessageDraft ?? normalizedWorktrees[0]?.commitMessageDraft ?? null,
    );
    const normalizedSubmodules = (input.submodules ?? []).map((submodule) => {
      const canonicalUrl = submodule.canonicalUrl.trim();
      const name = submodule.name.trim();
      const branchName = submodule.branchName.trim();
      const commitMessageDraft = normalizeTitle(submodule.commitMessageDraft);
      const parentRefs = normalizeTicketRunSubmoduleParentRefs(submodule.parentRefs);
      if (!canonicalUrl || !name || !branchName || parentRefs.length === 0) {
        throw new Error("Ticket run submodules require a canonical URL, name, branch name, and parent refs.");
      }

      return {
        canonicalUrl,
        name,
        branchName,
        commitMessageDraft,
        parentRefs,
        createdAt: submodule.createdAt ?? createdAt,
        updatedAt: submodule.updatedAt ?? now,
      };
    });
    const normalizedAttempts = (input.attempts ?? []).map((attempt) => {
      const attemptId = attempt.attemptId.trim();
      const prompt = normalizeTitle(attempt.prompt);
      const summary = normalizeTitle(attempt.summary);
      if (!attemptId) {
        throw new Error("Ticket run attempts require a non-empty attempt id.");
      }
      assertTicketRunAttemptStatus(attempt.status);
      return {
        attemptId,
        subagentRunId: normalizeTitle(attempt.subagentRunId),
        sequence: attempt.sequence,
        status: attempt.status,
        prompt,
        summary,
        followupNeeded: attempt.followupNeeded ? 1 : 0,
        startedAt: attempt.startedAt ?? now,
        createdAt: attempt.createdAt ?? now,
        updatedAt: attempt.updatedAt ?? now,
        completedAt: attempt.completedAt ?? null,
      };
    });
    const missionPhase = input.missionPhase ?? "classification";
    assertTicketRunMissionPhase(missionPhase);
    const missionPhaseUpdatedAt = input.missionPhaseUpdatedAt ?? now;
    const normalizedClassification = input.classification
      ? {
          kind: input.classification.kind,
          scopeSummary: input.classification.scopeSummary.trim(),
          acceptanceCriteria: normalizeStringArray(input.classification.acceptanceCriteria),
          impactedRepoRelativePaths: normalizeStringArray(input.classification.impactedRepoRelativePaths),
          risks: normalizeStringArray(input.classification.risks),
          uiChange: input.classification.uiChange,
          proofRequired: input.classification.proofRequired,
          proofArtifactMode: input.classification.proofArtifactMode,
          rationale: normalizeTitle(input.classification.rationale),
          createdAt: input.classification.createdAt ?? now,
          updatedAt: input.classification.updatedAt ?? now,
        }
      : null;
    if (normalizedClassification) {
      assertTicketRunMissionClassificationKind(normalizedClassification.kind);
      assertTicketRunMissionProofArtifactMode(normalizedClassification.proofArtifactMode);
      if (!normalizedClassification.scopeSummary) {
        throw new Error("Ticket run classification requires a non-empty scope summary.");
      }
    }
    const normalizedPlan = input.plan
      ? {
          steps: normalizeStringArray(input.plan.steps),
          touchedRepoRelativePaths: normalizeStringArray(input.plan.touchedRepoRelativePaths),
          validationPlan: normalizeStringArray(input.plan.validationPlan),
          proofIntent: normalizeTitle(input.plan.proofIntent),
          blockers: normalizeStringArray(input.plan.blockers),
          assumptions: normalizeStringArray(input.plan.assumptions),
          createdAt: input.plan.createdAt ?? now,
          updatedAt: input.plan.updatedAt ?? now,
        }
      : null;
    const normalizedValidations = (input.validations ?? []).map((validation) => {
      const validationId = validation.validationId.trim();
      const command = validation.command.trim();
      const cwd = validation.cwd.trim();
      if (!validationId || !command || !cwd) {
        throw new Error("Ticket run validations require non-empty id, command, and cwd values.");
      }
      assertTicketRunMissionValidationKind(validation.kind);
      assertTicketRunMissionValidationStatus(validation.status);
      const artifacts = (validation.artifacts ?? []).map((artifact) => {
        const artifactId = artifact.artifactId.trim();
        const label = artifact.label.trim();
        const artifactPath = artifact.path.trim();
        const fileUrl = artifact.fileUrl.trim();
        if (!artifactId || !label || !artifactPath || !fileUrl) {
          throw new Error("Ticket run validation artifacts require non-empty id, label, path, and file URL values.");
        }
        assertTicketRunProofArtifactKind(artifact.kind);
        return {
          artifactId,
          kind: artifact.kind,
          label,
          path: artifactPath,
          fileUrl,
        };
      });
      return {
        validationId,
        kind: validation.kind,
        command,
        cwd,
        status: validation.status,
        summary: normalizeTitle(validation.summary),
        artifacts,
        startedAt: validation.startedAt ?? now,
        completedAt: validation.completedAt ?? null,
        createdAt: validation.createdAt ?? now,
        updatedAt: validation.updatedAt ?? now,
      };
    });
    const normalizedProofStrategy = input.proofStrategy
      ? {
          adapterId: input.proofStrategy.adapterId.trim(),
          repoRelativePath: input.proofStrategy.repoRelativePath.trim(),
          scenarioPath: normalizeTitle(input.proofStrategy.scenarioPath),
          scenarioName: normalizeTitle(input.proofStrategy.scenarioName),
          command: input.proofStrategy.command.trim(),
          artifactMode: input.proofStrategy.artifactMode,
          rationale: input.proofStrategy.rationale.trim(),
          metadata: input.proofStrategy.metadata ?? null,
          createdAt: input.proofStrategy.createdAt ?? now,
          updatedAt: input.proofStrategy.updatedAt ?? now,
        }
      : null;
    if (normalizedProofStrategy) {
      assertTicketRunMissionProofArtifactMode(normalizedProofStrategy.artifactMode);
      if (
        !normalizedProofStrategy.adapterId ||
        !normalizedProofStrategy.repoRelativePath ||
        !normalizedProofStrategy.command ||
        !normalizedProofStrategy.rationale
      ) {
        throw new Error(
          "Ticket run proof strategy requires non-empty adapter, repo path, command, and rationale values.",
        );
      }
    }
    const normalizedMissionSummary = input.missionSummary
      ? {
          completedWork: input.missionSummary.completedWork.trim(),
          changedRepoRelativePaths: normalizeStringArray(input.missionSummary.changedRepoRelativePaths),
          validationSummary: normalizeTitle(input.missionSummary.validationSummary),
          proofSummary: normalizeTitle(input.missionSummary.proofSummary),
          openQuestions: normalizeStringArray(input.missionSummary.openQuestions),
          followUps: normalizeStringArray(input.missionSummary.followUps),
          createdAt: input.missionSummary.createdAt ?? now,
          updatedAt: input.missionSummary.updatedAt ?? now,
        }
      : null;
    if (normalizedMissionSummary && !normalizedMissionSummary.completedWork) {
      throw new Error("Ticket run mission summary requires non-empty completed work text.");
    }
    const normalizedPreviousPassContext = input.previousPassContext
      ? {
          attemptId: input.previousPassContext.attemptId.trim(),
          sequence: input.previousPassContext.sequence,
          completedAt: input.previousPassContext.completedAt,
          summary: normalizeTitle(input.previousPassContext.summary),
          classification: input.previousPassContext.classification,
          plan: input.previousPassContext.plan,
          validations: input.previousPassContext.validations ?? [],
          proofStrategy: input.previousPassContext.proofStrategy,
          missionSummary: input.previousPassContext.missionSummary,
          proof: input.previousPassContext.proof,
        }
      : null;
    if (
      normalizedPreviousPassContext &&
      (!normalizedPreviousPassContext.attemptId ||
        !Number.isFinite(normalizedPreviousPassContext.sequence) ||
        !Number.isFinite(normalizedPreviousPassContext.completedAt))
    ) {
      throw new Error("Ticket run previous pass context requires attemptId, sequence, and completedAt.");
    }
    const proofInput = input.proof ?? {};
    const proofStatus = proofInput.status ?? "not-run";
    assertTicketRunProofStatus(proofStatus);
    const normalizedProof = {
      status: proofStatus,
      lastProofRunId: normalizeTitle(proofInput.lastProofRunId),
      lastProofProfileId: normalizeTitle(proofInput.lastProofProfileId),
      lastProofAt: proofInput.lastProofAt ?? null,
      lastProofSummary: normalizeTitle(proofInput.lastProofSummary),
      staleReason: normalizeTitle(proofInput.staleReason),
    };
    const normalizedProofRuns = (input.proofRuns ?? []).map((proofRun) => {
      const proofRunId = proofRun.proofRunId.trim();
      const profileId = proofRun.profileId.trim();
      const profileLabel = proofRun.profileLabel.trim();
      if (!proofRunId || !profileId || !profileLabel) {
        throw new Error("Ticket run proof runs require non-empty proof run, profile id, and profile label values.");
      }
      assertTicketRunProofRunStatus(proofRun.status);
      const artifacts = (proofRun.artifacts ?? []).map((artifact) => {
        const artifactId = artifact.artifactId.trim();
        const kind = artifact.kind;
        const label = artifact.label.trim();
        const artifactPath = artifact.path.trim();
        const fileUrl = artifact.fileUrl.trim();
        if (!artifactId || !label || !artifactPath || !fileUrl) {
          throw new Error("Ticket run proof artifacts require non-empty id, label, path, and file URL values.");
        }
        assertTicketRunProofArtifactKind(kind);
        return {
          artifactId,
          kind,
          label,
          path: artifactPath,
          fileUrl,
        };
      });
      return {
        proofRunId,
        profileId,
        profileLabel,
        status: proofRun.status,
        summary: normalizeTitle(proofRun.summary),
        startedAt: proofRun.startedAt ?? now,
        completedAt: proofRun.completedAt ?? null,
        exitCode: proofRun.exitCode ?? null,
        command: normalizeTitle(proofRun.command),
        artifacts,
      };
    });

    const replace = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO ticket_runs (
             run_id,
             station_id,
             ticket_id,
             ticket_summary,
             ticket_url,
              project_key,
              status,
              status_message,
              commit_message_draft,
              mission_phase,
              mission_phase_updated_at,
              classification_json,
              plan_json,
              summary_json,
              previous_pass_context_json,
              proof_status,
              last_proof_run_id,
              last_proof_profile_id,
             last_proof_at,
             last_proof_summary,
             proof_stale_reason,
             started_at,
             created_at,
             updated_at
           ) VALUES (
             @runId,
             @stationId,
             @ticketId,
             @ticketSummary,
             @ticketUrl,
              @projectKey,
              @status,
              @statusMessage,
              @commitMessageDraft,
              @missionPhase,
              @missionPhaseUpdatedAt,
              @classificationJson,
              @planJson,
              @summaryJson,
              @previousPassContextJson,
              @proofStatus,
              @lastProofRunId,
              @lastProofProfileId,
             @lastProofAt,
             @lastProofSummary,
             @proofStaleReason,
             @startedAt,
             @createdAt,
             @updatedAt
           )
           ON CONFLICT(run_id) DO UPDATE SET
              ticket_id = excluded.ticket_id,
              station_id = excluded.station_id,
              ticket_summary = excluded.ticket_summary,
             ticket_url = excluded.ticket_url,
                project_key = excluded.project_key,
                status = excluded.status,
                status_message = excluded.status_message,
                commit_message_draft = excluded.commit_message_draft,
                mission_phase = excluded.mission_phase,
                mission_phase_updated_at = excluded.mission_phase_updated_at,
                classification_json = excluded.classification_json,
                plan_json = excluded.plan_json,
                summary_json = excluded.summary_json,
                previous_pass_context_json = excluded.previous_pass_context_json,
                proof_status = excluded.proof_status,
                last_proof_run_id = excluded.last_proof_run_id,
                last_proof_profile_id = excluded.last_proof_profile_id,
               last_proof_at = excluded.last_proof_at,
               last_proof_summary = excluded.last_proof_summary,
               proof_stale_reason = excluded.proof_stale_reason,
               started_at = excluded.started_at,
               updated_at = excluded.updated_at`,
        )
        .run({
          runId,
          stationId,
          ticketId,
          ticketSummary,
          ticketUrl,
          projectKey,
          status,
          statusMessage,
          commitMessageDraft,
          missionPhase,
          missionPhaseUpdatedAt,
          classificationJson: serializeJson(normalizedClassification),
          planJson: serializeJson(normalizedPlan),
          summaryJson: serializeJson(normalizedMissionSummary),
          previousPassContextJson: serializeJson(normalizedPreviousPassContext),
          proofStatus: normalizedProof.status,
          lastProofRunId: normalizedProof.lastProofRunId,
          lastProofProfileId: normalizedProof.lastProofProfileId,
          lastProofAt: normalizedProof.lastProofAt,
          lastProofSummary: normalizedProof.lastProofSummary,
          proofStaleReason: normalizedProof.staleReason,
          startedAt,
          createdAt,
          updatedAt: now,
        });

      this.db
        .prepare(
          `DELETE FROM ticket_run_worktrees
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insert = this.db.prepare(
        `INSERT INTO ticket_run_worktrees (
           run_id,
           repo_relative_path,
           repo_absolute_path,
           worktree_path,
           branch_name,
           commit_message_draft,
           cleanup_state,
           created_at,
           updated_at
         ) VALUES (
           @runId,
           @repoRelativePath,
           @repoAbsolutePath,
           @worktreePath,
           @branchName,
           @commitMessageDraft,
           @cleanupState,
           @createdAt,
           @updatedAt
         )`,
      );

      for (const worktree of normalizedWorktrees) {
        insert.run({
          runId,
          ...worktree,
        });
      }

      this.db
        .prepare(
          `DELETE FROM ticket_run_submodules
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insertSubmodule = this.db.prepare(
        `INSERT INTO ticket_run_submodules (
           run_id,
           canonical_url,
           name,
           branch_name,
           commit_message_draft,
           created_at,
           updated_at
         ) VALUES (
           @runId,
           @canonicalUrl,
           @name,
           @branchName,
           @commitMessageDraft,
           @createdAt,
           @updatedAt
         )`,
      );

      const insertSubmoduleParent = this.db.prepare(
        `INSERT INTO ticket_run_submodule_parents (
           run_id,
           canonical_url,
           parent_repo_relative_path,
           submodule_path,
           submodule_worktree_path
         ) VALUES (
           @runId,
           @canonicalUrl,
           @parentRepoRelativePath,
           @submodulePath,
           @submoduleWorktreePath
         )`,
      );

      for (const submodule of normalizedSubmodules) {
        insertSubmodule.run({
          runId,
          canonicalUrl: submodule.canonicalUrl,
          name: submodule.name,
          branchName: submodule.branchName,
          commitMessageDraft: submodule.commitMessageDraft,
          createdAt: submodule.createdAt,
          updatedAt: submodule.updatedAt,
        });

        for (const parentRef of submodule.parentRefs) {
          insertSubmoduleParent.run({
            runId,
            canonicalUrl: submodule.canonicalUrl,
            ...parentRef,
          });
        }
      }

      this.db
        .prepare(
          `DELETE FROM ticket_run_attempts
           WHERE run_id = @runId`,
        )
        .run({ runId });

      this.db
        .prepare(
          `DELETE FROM ticket_run_validations
           WHERE run_id = @runId`,
        )
        .run({ runId });

      this.db
        .prepare(
          `DELETE FROM ticket_run_proof_strategy
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insertAttempt = this.db.prepare(
        `INSERT INTO ticket_run_attempts (
           attempt_id,
           run_id,
           subagent_run_id,
           sequence,
           status,
           prompt,
           summary,
           followup_needed,
           started_at,
           created_at,
           updated_at,
           completed_at
         ) VALUES (
           @attemptId,
           @runId,
           @subagentRunId,
           @sequence,
           @status,
           @prompt,
           @summary,
           @followupNeeded,
           @startedAt,
           @createdAt,
           @updatedAt,
           @completedAt
         )`,
      );

      for (const attempt of normalizedAttempts) {
        insertAttempt.run({
          runId,
          ...attempt,
        });
      }

      const insertValidation = this.db.prepare(
        `INSERT INTO ticket_run_validations (
           validation_id,
           run_id,
           kind,
           command,
           cwd,
           status,
           summary,
           artifacts_json,
           started_at,
           completed_at,
           created_at,
           updated_at
         ) VALUES (
           @validationId,
           @runId,
           @kind,
           @command,
           @cwd,
           @status,
           @summary,
           @artifactsJson,
           @startedAt,
           @completedAt,
           @createdAt,
           @updatedAt
         )`,
      );

      for (const validation of normalizedValidations) {
        insertValidation.run({
          validationId: validation.validationId,
          runId,
          kind: validation.kind,
          command: validation.command,
          cwd: validation.cwd,
          status: validation.status,
          summary: validation.summary,
          artifactsJson: serializeJson(validation.artifacts),
          startedAt: validation.startedAt,
          completedAt: validation.completedAt,
          createdAt: validation.createdAt,
          updatedAt: validation.updatedAt,
        });
      }

      if (normalizedProofStrategy) {
        this.db
          .prepare(
            `INSERT INTO ticket_run_proof_strategy (
               run_id,
               adapter_id,
               repo_relative_path,
               scenario_path,
               scenario_name,
               command,
               artifact_mode,
               rationale,
               metadata_json,
               created_at,
               updated_at
             ) VALUES (
               @runId,
               @adapterId,
               @repoRelativePath,
               @scenarioPath,
               @scenarioName,
               @command,
               @artifactMode,
               @rationale,
               @metadataJson,
               @createdAt,
               @updatedAt
             )`,
          )
          .run({
            runId,
            adapterId: normalizedProofStrategy.adapterId,
            repoRelativePath: normalizedProofStrategy.repoRelativePath,
            scenarioPath: normalizedProofStrategy.scenarioPath,
            scenarioName: normalizedProofStrategy.scenarioName,
            command: normalizedProofStrategy.command,
            artifactMode: normalizedProofStrategy.artifactMode,
            rationale: normalizedProofStrategy.rationale,
            metadataJson: serializeJson(normalizedProofStrategy.metadata),
            createdAt: normalizedProofStrategy.createdAt,
            updatedAt: normalizedProofStrategy.updatedAt,
          });
      }

      this.db
        .prepare(
          `DELETE FROM ticket_run_proof_runs
           WHERE run_id = @runId`,
        )
        .run({ runId });

      const insertProofRun = this.db.prepare(
        `INSERT INTO ticket_run_proof_runs (
           proof_run_id,
           run_id,
           profile_id,
           profile_label,
           status,
           summary,
           started_at,
           completed_at,
           exit_code,
           command,
           artifacts_json
         ) VALUES (
           @proofRunId,
           @runId,
           @profileId,
           @profileLabel,
           @status,
           @summary,
           @startedAt,
           @completedAt,
           @exitCode,
           @command,
           @artifactsJson
         )`,
      );

      for (const proofRun of normalizedProofRuns) {
        insertProofRun.run({
          runId,
          proofRunId: proofRun.proofRunId,
          profileId: proofRun.profileId,
          profileLabel: proofRun.profileLabel,
          status: proofRun.status,
          summary: proofRun.summary,
          startedAt: proofRun.startedAt,
          completedAt: proofRun.completedAt,
          exitCode: proofRun.exitCode,
          command: proofRun.command,
          artifactsJson: serializeJson(proofRun.artifacts),
        });
      }
    });

    replace();
    const record = this.getTicketRun(runId);
    if (!record) {
      throw new Error(`Failed to persist ticket run ${runId}.`);
    }
    return record;
  }

  getTicketRunSnapshot(): TicketRunSnapshot {
    return {
      runs: this.listTicketRuns(),
    };
  }

  listMcpServerConfigs(): McpServerConfigRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json AS argsJson,
           env_json AS envJson,
           url,
           headers_json AS headersJson,
           tool_access_json AS toolAccessJson,
           enabled,
           auto_restart AS autoRestart,
           max_restarts AS maxRestarts,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM mcp_server_configs
         ORDER BY source ASC, name COLLATE NOCASE ASC`,
      )
      .all() as unknown as McpServerConfigRow[];

    return rows.map(mapMcpServerConfigRow);
  }

  getMcpServerConfig(serverId: string): McpServerConfigRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json AS argsJson,
           env_json AS envJson,
           url,
           headers_json AS headersJson,
           tool_access_json AS toolAccessJson,
           enabled,
           auto_restart AS autoRestart,
           max_restarts AS maxRestarts,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM mcp_server_configs
         WHERE id = @serverId`,
      )
      .get({ serverId }) as McpServerConfigRow | undefined;

    return row ? mapMcpServerConfigRow(row) : null;
  }

  upsertMcpServerConfig(input: UpsertMcpServerConfigInput): McpServerConfigRecord {
    this.assertWritable();
    const now = input.createdAt ?? Date.now();
    const existing = this.getMcpServerConfig(input.id);
    const description = normalizeText(input.description);
    const transportPayload =
      input.transport === "streamable-http"
        ? {
            command: "",
            argsJson: "[]",
            envJson: null,
            url: input.url.trim(),
            headersJson: serializeJson(input.headers ?? {}),
          }
        : {
            command: input.command.trim(),
            argsJson: serializeJson(normalizeStringArray(input.args)) ?? "[]",
            envJson: serializeJson(input.env ?? {}),
            url: null,
            headersJson: null,
          };
    const payload = {
      id: input.id,
      name: input.name.trim(),
      description,
      source: input.source,
      transport: input.transport,
      ...transportPayload,
      toolAccessJson: serializeJson(normalizeMcpToolAccessPolicy(input.toolAccess) ?? null),
      enabled: input.enabled ? 1 : 0,
      autoRestart: input.autoRestart ? 1 : 0,
      maxRestarts: input.maxRestarts ?? 3,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!payload.name) {
      throw new Error("MCP server name cannot be empty.");
    }
    if (input.transport === "stdio" && !payload.command) {
      throw new Error("MCP server command cannot be empty.");
    }
    if (input.transport === "streamable-http" && !payload.url) {
      throw new Error("MCP server URL cannot be empty.");
    }

    this.db
      .prepare(
        `INSERT INTO mcp_server_configs (
           id,
           name,
           description,
           source,
           transport,
           command,
           args_json,
           env_json,
           url,
           headers_json,
           tool_access_json,
           enabled,
           auto_restart,
           max_restarts,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @name,
           @description,
           @source,
           @transport,
           @command,
           @argsJson,
           @envJson,
           @url,
           @headersJson,
           @toolAccessJson,
           @enabled,
           @autoRestart,
           @maxRestarts,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           source = excluded.source,
           transport = excluded.transport,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           url = excluded.url,
           headers_json = excluded.headers_json,
           tool_access_json = excluded.tool_access_json,
           enabled = excluded.enabled,
           auto_restart = excluded.auto_restart,
           max_restarts = excluded.max_restarts,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = this.getMcpServerConfig(input.id);
    if (!saved) {
      throw new Error(`Failed to load MCP server config ${input.id}.`);
    }

    return saved;
  }

  seedBuiltinMcpServerConfigs(configs: readonly McpServerConfig[]): McpServerConfigRecord[] {
    this.assertWritable();
    const seed = this.db.transaction((items: readonly McpServerConfig[]) =>
      items.map((config) =>
        this.upsertMcpServerConfig({
          ...config,
          description: config.description,
          source: "builtin",
          enabled: this.getMcpServerConfig(config.id)?.enabled ?? config.enabled,
        }),
      ),
    );

    return seed(configs);
  }

  removeMcpServerConfig(serverId: string): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `DELETE FROM mcp_server_configs
         WHERE id = @serverId`,
      )
      .run({ serverId });

    return result.changes > 0;
  }

  setMcpServerEnabled(serverId: string, enabled: boolean): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE mcp_server_configs
         SET enabled = @enabled,
             updated_at = @updatedAt
         WHERE id = @serverId`,
      )
      .run({
        serverId,
        enabled: enabled ? 1 : 0,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  }

  listSubagentConfigs(): SubagentConfigRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
           id,
           label,
           description,
           source,
           system_prompt AS systemPrompt,
           delegation_tool_name AS delegationToolName,
           server_ids_json AS serverIdsJson,
           allowed_tool_names_json AS allowedToolNamesJson,
           allow_writes AS allowWrites,
           ready,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM subagent_configs
         ORDER BY source ASC, label COLLATE NOCASE ASC`,
      )
      .all() as unknown as SubagentConfigRow[];

    return rows.map(mapSubagentConfigRow);
  }

  getSubagentConfig(agentId: string): SubagentConfigRecord | null {
    const row = this.db
      .prepare(
        `SELECT
           id,
           label,
           description,
           source,
           system_prompt AS systemPrompt,
           delegation_tool_name AS delegationToolName,
           server_ids_json AS serverIdsJson,
           allowed_tool_names_json AS allowedToolNamesJson,
           allow_writes AS allowWrites,
           ready,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM subagent_configs
         WHERE id = @agentId`,
      )
      .get({ agentId }) as SubagentConfigRow | undefined;

    return row ? mapSubagentConfigRow(row) : null;
  }

  upsertSubagentConfig(input: UpsertSubagentConfigInput): SubagentConfigRecord {
    this.assertWritable();
    const now = input.createdAt ?? Date.now();
    const existing = this.getSubagentConfig(input.id);
    const payload = {
      id: input.id,
      label: input.label.trim(),
      description: normalizeText(input.description),
      source: input.source,
      systemPrompt: normalizeText(input.systemPrompt),
      delegationToolName: input.delegationToolName.trim(),
      serverIdsJson: serializeJson(normalizeStringArray(input.serverIds)) ?? "[]",
      allowedToolNamesJson:
        input.allowedToolNames === null || input.allowedToolNames === undefined
          ? null
          : serializeJson(normalizeStringArray(input.allowedToolNames)),
      allowWrites: input.allowWrites ? 1 : 0,
      ready: input.ready ? 1 : 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (!payload.label) {
      throw new Error("Subagent label cannot be empty.");
    }
    if (!payload.delegationToolName) {
      throw new Error("Subagent delegation tool name cannot be empty.");
    }

    this.db
      .prepare(
        `INSERT INTO subagent_configs (
           id,
           label,
           description,
           source,
           system_prompt,
           delegation_tool_name,
           server_ids_json,
           allowed_tool_names_json,
           allow_writes,
           ready,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @label,
           @description,
           @source,
           @systemPrompt,
           @delegationToolName,
           @serverIdsJson,
           @allowedToolNamesJson,
           @allowWrites,
           @ready,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           description = excluded.description,
           source = excluded.source,
           system_prompt = excluded.system_prompt,
           delegation_tool_name = excluded.delegation_tool_name,
           server_ids_json = excluded.server_ids_json,
           allowed_tool_names_json = excluded.allowed_tool_names_json,
           allow_writes = excluded.allow_writes,
           ready = excluded.ready,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = this.getSubagentConfig(input.id);
    if (!saved) {
      throw new Error(`Failed to load subagent config ${input.id}.`);
    }

    return saved;
  }

  seedBuiltinSubagentConfigs(configs: readonly SubagentDomain[]): SubagentConfigRecord[] {
    this.assertWritable();
    const seed = this.db.transaction((items: readonly SubagentDomain[]) =>
      items.map((config) =>
        this.upsertSubagentConfig({
          ...config,
          source: "builtin",
          ready: this.getSubagentConfig(config.id)?.ready ?? config.ready,
        }),
      ),
    );

    return seed(configs);
  }

  removeSubagentConfig(agentId: string): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `DELETE FROM subagent_configs
         WHERE id = @agentId`,
      )
      .run({ agentId });

    return result.changes > 0;
  }

  setSubagentReady(agentId: string, ready: boolean): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE subagent_configs
         SET ready = @ready,
             updated_at = @updatedAt
         WHERE id = @agentId`,
      )
      .run({
        agentId,
        ready: ready ? 1 : 0,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  }

  remember(input: RememberMemoryInput): MemoryEntryRecord {
    this.assertWritable();
    const content = input.content.trim();
    if (!content) {
      throw new Error("Memory content cannot be empty.");
    }

    const category = input.category ?? "task-context";
    assertMemoryEntryCategory(category);
    const now = input.createdAt ?? Date.now();
    const memoryId = input.id ?? randomUUID();

    this.db
      .prepare(
        `INSERT INTO memory_entries (
           id,
           category,
           content,
           source_conversation_id,
           source_message_id,
           created_at,
           updated_at,
           archived
         ) VALUES (
           @id,
           @category,
           @content,
           @sourceConversationId,
           @sourceMessageId,
           @createdAt,
           @updatedAt,
           0
         )
         ON CONFLICT(id) DO UPDATE SET
           category = excluded.category,
           content = excluded.content,
           source_conversation_id = excluded.source_conversation_id,
           source_message_id = excluded.source_message_id,
           updated_at = excluded.updated_at,
           archived = 0`,
      )
      .run({
        id: memoryId,
        category,
        content,
        sourceConversationId: input.sourceConversationId ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        createdAt: now,
        updatedAt: now,
      });

    const record = this.db
      .prepare(
        `SELECT
           id,
           category,
           content,
           source_conversation_id AS sourceConversationId,
           source_message_id AS sourceMessageId,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM memory_entries
         WHERE id = @id`,
      )
      .get({ id: memoryId }) as MemoryEntryRow | undefined;

    if (!record) {
      throw new Error(`Failed to load saved memory entry ${memoryId}.`);
    }

    return {
      id: String(record.id),
      category: String(record.category) as MemoryEntryCategory,
      content: String(record.content),
      sourceConversationId: record.sourceConversationId === null ? null : String(record.sourceConversationId),
      sourceMessageId: record.sourceMessageId === null ? null : String(record.sourceMessageId),
      createdAt: Number(record.createdAt),
      updatedAt: Number(record.updatedAt),
    };
  }

  getMemoryEntry(memoryId: string): MemoryEntryRecord | null {
    const record = this.db
      .prepare(
        `SELECT
           id,
           category,
           content,
           source_conversation_id AS sourceConversationId,
           source_message_id AS sourceMessageId,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM memory_entries
         WHERE id = @id AND archived = 0`,
      )
      .get({ id: memoryId }) as MemoryEntryRow | undefined;

    if (!record) {
      return null;
    }

    return {
      id: String(record.id),
      category: String(record.category) as MemoryEntryCategory,
      content: String(record.content),
      sourceConversationId: record.sourceConversationId === null ? null : String(record.sourceConversationId),
      sourceMessageId: record.sourceMessageId === null ? null : String(record.sourceMessageId),
      createdAt: Number(record.createdAt),
      updatedAt: Number(record.updatedAt),
    };
  }

  updateMemory(input: UpdateMemoryInput): MemoryEntryRecord {
    this.assertWritable();
    const existing = this.getMemoryEntry(input.memoryId);
    if (!existing) {
      throw new Error(`Memory entry ${input.memoryId} was not found.`);
    }

    const nextContent = typeof input.content === "string" ? input.content.trim() : existing.content;
    if (!nextContent) {
      throw new Error("Memory content cannot be empty.");
    }

    const nextCategory = input.category ?? existing.category;
    assertMemoryEntryCategory(nextCategory);
    const updatedAt = Date.now();

    this.db
      .prepare(
        `UPDATE memory_entries
         SET category = @category,
             content = @content,
             updated_at = @updatedAt
         WHERE id = @id AND archived = 0`,
      )
      .run({
        id: input.memoryId,
        category: nextCategory,
        content: nextContent,
        updatedAt,
      });

    const updated = this.getMemoryEntry(input.memoryId);
    if (!updated) {
      throw new Error(`Failed to reload updated memory entry ${input.memoryId}.`);
    }

    return updated;
  }

  archiveMemory(memoryId: string): boolean {
    this.assertWritable();
    const result = this.db
      .prepare(
        `UPDATE memory_entries
         SET archived = 1,
             updated_at = @updatedAt
         WHERE id = @id AND archived = 0`,
      )
      .run({
        id: memoryId,
        updatedAt: Date.now(),
      });

    return result.changes > 0;
  }

  listMemoryEntries(limit = 20, category?: MemoryEntryCategory): MemoryEntryRecord[] {
    const statement = category
      ? this.db.prepare(
          `SELECT
             id,
             category,
             content,
             source_conversation_id AS sourceConversationId,
             source_message_id AS sourceMessageId,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM memory_entries
           WHERE archived = 0 AND category = @category
           ORDER BY updated_at DESC
           LIMIT @limit`,
        )
      : this.db.prepare(
          `SELECT
             id,
             category,
             content,
             source_conversation_id AS sourceConversationId,
             source_message_id AS sourceMessageId,
             created_at AS createdAt,
             updated_at AS updatedAt
           FROM memory_entries
           WHERE archived = 0
           ORDER BY updated_at DESC
           LIMIT @limit`,
        );

    const rows = statement.all(category ? { category, limit } : { limit }) as unknown as MemoryEntryRow[];
    return rows.map((row) => ({
      id: String(row.id),
      category: String(row.category) as MemoryEntryCategory,
      content: String(row.content),
      sourceConversationId: row.sourceConversationId === null ? null : String(row.sourceConversationId),
      sourceMessageId: row.sourceMessageId === null ? null : String(row.sourceMessageId),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  searchMemoryEntries(query: string, limit = 10, category?: MemoryEntryCategory): MemoryEntryRecord[] {
    const ftsQuery = toFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    const statement = category
      ? this.db.prepare(
          `SELECT
             e.id,
             e.category,
             e.content,
             e.source_conversation_id AS sourceConversationId,
             e.source_message_id AS sourceMessageId,
             e.created_at AS createdAt,
             e.updated_at AS updatedAt
           FROM memory_entries_fts
           JOIN memory_entries e ON e.rowid = memory_entries_fts.rowid
           WHERE memory_entries_fts MATCH @query AND e.archived = 0 AND e.category = @category
           ORDER BY bm25(memory_entries_fts), e.updated_at DESC
           LIMIT @limit`,
        )
      : this.db.prepare(
          `SELECT
             e.id,
             e.category,
             e.content,
             e.source_conversation_id AS sourceConversationId,
             e.source_message_id AS sourceMessageId,
             e.created_at AS createdAt,
             e.updated_at AS updatedAt
           FROM memory_entries_fts
           JOIN memory_entries e ON e.rowid = memory_entries_fts.rowid
           WHERE memory_entries_fts MATCH @query AND e.archived = 0
           ORDER BY bm25(memory_entries_fts), e.updated_at DESC
           LIMIT @limit`,
        );

    const rows = statement.all(
      category ? { query: ftsQuery, category, limit } : { query: ftsQuery, limit },
    ) as unknown as MemoryEntryRow[];
    return rows.map((row) => ({
      id: String(row.id),
      category: String(row.category) as MemoryEntryCategory,
      content: String(row.content),
      sourceConversationId: row.sourceConversationId === null ? null : String(row.sourceConversationId),
      sourceMessageId: row.sourceMessageId === null ? null : String(row.sourceMessageId),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    }));
  }

  private assertWritable(): void {
    if (this.isReadonly) {
      throw new Error("The memory database is open in read-only mode.");
    }
  }
}
