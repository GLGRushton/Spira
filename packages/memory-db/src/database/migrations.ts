import { MODEL_PROVIDERS } from "@spira/shared";

export interface MigrationDefinition {
  version: number;
  statements: string[];
}

export const SQLITE_MODEL_PROVIDER_CHECK_VALUES = MODEL_PROVIDERS.map((provider) => `'${provider}'`).join(", ");

export const MIGRATIONS: MigrationDefinition[] = [
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
  {
    version: 20,
    statements: [
      `CREATE TABLE repo_intelligence_entries (
        id TEXT PRIMARY KEY,
        project_key TEXT,
        repo_relative_path TEXT,
        type TEXT NOT NULL CHECK(type IN ('briefing', 'pitfall', 'example')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL CHECK(source IN ('builtin', 'user', 'learned')),
        approved INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_repo_intelligence_scope_v20 ON repo_intelligence_entries(project_key, repo_relative_path, updated_at DESC)",
      `CREATE TABLE validation_profiles (
        id TEXT PRIMARY KEY,
        project_key TEXT,
        repo_relative_path TEXT,
        label TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('build', 'unit-test', 'lint', 'typecheck')),
        command TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        notes TEXT,
        confidence REAL NOT NULL DEFAULT 0.5,
        expected_runtime_ms INTEGER,
        prerequisites_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL CHECK(source IN ('builtin', 'user')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_validation_profiles_scope_v20 ON validation_profiles(project_key, repo_relative_path, updated_at DESC)",
      `CREATE TABLE proof_rules (
        id TEXT PRIMARY KEY,
        project_key TEXT,
        repo_relative_path TEXT,
        classification_kind TEXT CHECK(classification_kind IN ('backend', 'frontend', 'ui', 'infra', 'mixed', 'unknown')),
        ui_change INTEGER,
        proof_required INTEGER,
        summary_keywords_json TEXT NOT NULL DEFAULT '[]',
        recommended_level TEXT NOT NULL CHECK(recommended_level IN ('none', 'light', 'targeted-screenshot', 'full-ui-proof', 'manual-review-only')),
        rationale TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_proof_rules_scope_v20 ON proof_rules(project_key, repo_relative_path, updated_at DESC)",
      `CREATE TABLE proof_decisions (
        run_id TEXT PRIMARY KEY REFERENCES ticket_runs(run_id) ON DELETE CASCADE,
        attempt_id TEXT,
        recommended_level TEXT CHECK(recommended_level IN ('none', 'light', 'targeted-screenshot', 'full-ui-proof', 'manual-review-only')),
        preflight_status TEXT CHECK(preflight_status IN ('runnable', 'blocked', 'degraded')),
        rationale TEXT,
        evidence_json TEXT,
        repo_relative_paths_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_proof_decisions_updated_v20 ON proof_decisions(updated_at DESC)",
      `CREATE TABLE mission_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES ticket_runs(run_id) ON DELETE CASCADE,
        attempt_id TEXT,
        stage TEXT NOT NULL,
        event_type TEXT NOT NULL,
        metadata_json TEXT,
        occurred_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_mission_events_run_v20 ON mission_events(run_id, occurred_at DESC)",
    ],
  },
  {
    version: 21,
    statements: [
      `CREATE TABLE runtime_permission_requests (
        request_id TEXT PRIMARY KEY,
        station_id TEXT,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'denied', 'expired')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER
      )`,
      "CREATE INDEX idx_runtime_permission_requests_station_status_v21 ON runtime_permission_requests(station_id, status, updated_at DESC)",
      `CREATE TABLE runtime_subagent_runs (
        run_id TEXT PRIMARY KEY,
        station_id TEXT,
        snapshot_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'idle', 'completed', 'failed', 'partial', 'cancelled', 'expired')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER
      )`,
      "CREATE INDEX idx_runtime_subagent_runs_station_status_v21 ON runtime_subagent_runs(station_id, status, updated_at DESC)",
      `CREATE TABLE provider_usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK(provider IN ('copilot', 'azure-openai')),
        station_id TEXT,
        run_id TEXT,
        session_id TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd REAL,
        latency_ms INTEGER,
        observed_at INTEGER NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('provider', 'estimated', 'unknown'))
      )`,
      "CREATE INDEX idx_provider_usage_records_scope_v21 ON provider_usage_records(provider, station_id, run_id, observed_at DESC)",
      "CREATE INDEX idx_provider_usage_records_session_v21 ON provider_usage_records(session_id, observed_at DESC)",
    ],
  },
  {
    version: 22,
    statements: [
      `CREATE TABLE runtime_sessions (
        runtime_session_id TEXT PRIMARY KEY,
        station_id TEXT,
        run_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('station', 'subagent', 'background')),
        contract_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_runtime_sessions_station_v22 ON runtime_sessions(station_id, updated_at DESC)",
      "CREATE INDEX idx_runtime_sessions_run_v22 ON runtime_sessions(run_id, updated_at DESC)",
      `CREATE TABLE runtime_checkpoints (
        checkpoint_id TEXT PRIMARY KEY,
        runtime_session_id TEXT NOT NULL REFERENCES runtime_sessions(runtime_session_id) ON DELETE CASCADE,
        station_id TEXT,
        run_id TEXT,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_runtime_checkpoints_session_v22 ON runtime_checkpoints(runtime_session_id, created_at DESC)",
      `CREATE TABLE runtime_ledger_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        runtime_session_id TEXT NOT NULL REFERENCES runtime_sessions(runtime_session_id) ON DELETE CASCADE,
        station_id TEXT,
        run_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        occurred_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_runtime_ledger_events_session_v22 ON runtime_ledger_events(runtime_session_id, occurred_at ASC, id ASC)",
    ],
  },
  {
    version: 23,
    statements: [
      `CREATE TABLE runtime_host_resources (
        resource_id TEXT PRIMARY KEY,
        runtime_session_id TEXT NOT NULL REFERENCES runtime_sessions(runtime_session_id) ON DELETE CASCADE,
        station_id TEXT,
        kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'idle', 'completed', 'failed', 'unrecoverable', 'cancelled')),
        state_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_runtime_host_resources_session_v23 ON runtime_host_resources(runtime_session_id, updated_at DESC)",
      "CREATE INDEX idx_runtime_host_resources_station_v23 ON runtime_host_resources(station_id, updated_at DESC)",
    ],
  },
  {
    version: 24,
    statements: [
      "ALTER TABLE provider_usage_records RENAME TO provider_usage_records_v23",
      `CREATE TABLE provider_usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK(provider IN ('copilot', 'azure-openai', 'openai')),
        station_id TEXT,
        run_id TEXT,
        session_id TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd REAL,
        latency_ms INTEGER,
        observed_at INTEGER NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('provider', 'estimated', 'unknown'))
      )`,
      `INSERT INTO provider_usage_records (
         id,
         provider,
         station_id,
         run_id,
         session_id,
         model,
         input_tokens,
         output_tokens,
         total_tokens,
         estimated_cost_usd,
         latency_ms,
         observed_at,
         source
       )
       SELECT
         id,
         provider,
         station_id,
         run_id,
         session_id,
         model,
         input_tokens,
         output_tokens,
         total_tokens,
         estimated_cost_usd,
         latency_ms,
         observed_at,
         source
       FROM provider_usage_records_v23`,
      "DROP TABLE provider_usage_records_v23",
      "CREATE INDEX idx_provider_usage_records_scope_v24 ON provider_usage_records(provider, station_id, run_id, observed_at DESC)",
      "CREATE INDEX idx_provider_usage_records_session_v24 ON provider_usage_records(session_id, observed_at DESC)",
    ],
  },
  {
    version: 25,
    statements: [
      "ALTER TABLE provider_usage_records RENAME TO provider_usage_records_v24",
      `CREATE TABLE provider_usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK(provider IN (${SQLITE_MODEL_PROVIDER_CHECK_VALUES})),
        station_id TEXT,
        run_id TEXT,
        session_id TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd REAL,
        latency_ms INTEGER,
        observed_at INTEGER NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('provider', 'estimated', 'unknown'))
      )`,
      `INSERT INTO provider_usage_records (
         id,
         provider,
         station_id,
         run_id,
         session_id,
         model,
         input_tokens,
         output_tokens,
         total_tokens,
         estimated_cost_usd,
         latency_ms,
         observed_at,
         source
       )
       SELECT
         id,
         provider,
         station_id,
         run_id,
         session_id,
         model,
         input_tokens,
         output_tokens,
         total_tokens,
         estimated_cost_usd,
         latency_ms,
         observed_at,
         source
       FROM provider_usage_records_v24`,
      "DROP TABLE provider_usage_records_v24",
      "CREATE INDEX idx_provider_usage_records_scope_v25 ON provider_usage_records(provider, station_id, run_id, observed_at DESC)",
      "CREATE INDEX idx_provider_usage_records_session_v25 ON provider_usage_records(session_id, observed_at DESC)",
    ],
  },
  {
    version: 26,
    statements: ["ALTER TABLE messages ADD COLUMN model TEXT"],
  },
  {
    version: 27,
    statements: [
      `CREATE TABLE IF NOT EXISTS ticket_run_validations (
        validation_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('build', 'unit-test', 'lint', 'typecheck')),
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
      "ALTER TABLE ticket_run_validations ADD COLUMN supersedes_validation_ids_json TEXT",
    ],
  },
  {
    version: 28,
    statements: [
      "ALTER TABLE provider_usage_records RENAME TO provider_usage_records_v25",
      `CREATE TABLE provider_usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL CHECK(provider IN (${SQLITE_MODEL_PROVIDER_CHECK_VALUES})),
        station_id TEXT,
        run_id TEXT,
        session_id TEXT,
        model TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        total_tokens INTEGER,
        estimated_cost_usd REAL,
        latency_ms INTEGER,
        observed_at INTEGER NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('provider', 'estimated', 'unknown'))
      )`,
      `INSERT INTO provider_usage_records (
         id,
         provider,
         station_id,
         run_id,
         session_id,
         model,
         input_tokens,
         output_tokens,
         total_tokens,
         estimated_cost_usd,
         latency_ms,
         observed_at,
         source
       )
       SELECT
         id,
         provider,
         station_id,
         run_id,
         session_id,
         model,
         input_tokens,
         output_tokens,
         total_tokens,
         estimated_cost_usd,
         latency_ms,
         observed_at,
         source
       FROM provider_usage_records_v25`,
      "DROP TABLE provider_usage_records_v25",
      "CREATE INDEX idx_provider_usage_records_scope_v28 ON provider_usage_records(provider, station_id, run_id, observed_at DESC)",
      "CREATE INDEX idx_provider_usage_records_session_v28 ON provider_usage_records(session_id, observed_at DESC)",
    ],
  },
  {
    // extend the proof status enums and add manual-review audit columns.
    //   - ticket_runs.proof_status gains 'manual-review' (gate satisfied by operator review)
    //     and 'preflight-blocked' (preflight refused to spawn the harness).
    //   - ticket_run_proof_runs.status gains 'preflight-blocked' for the per-run audit row.
    //   - ticket_runs gains proof_manual_review_justification + proof_manual_review_at columns
    //     so the audit trail is queryable in the snapshot, not just in mission_events.
    //
    // SQLite has no DROP CONSTRAINT and better-sqlite3 blocks writable_schema modifications,
    // so we use the standard table-rename-and-recreate pattern (same as migration 28 for
    // provider_usage_records). The recreated tables include the new CHECK values *and* the
    // two new columns so a single migration handles both shape and constraint changes.
    version: 29,
    statements: [
      "ALTER TABLE ticket_runs RENAME TO ticket_runs_v28",
      `CREATE TABLE ticket_runs (
        run_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        ticket_summary TEXT NOT NULL,
        ticket_url TEXT NOT NULL,
        project_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('starting', 'ready', 'blocked', 'working', 'awaiting-review', 'error', 'done')),
        status_message TEXT,
        station_id TEXT,
        commit_message_draft TEXT,
        proof_status TEXT NOT NULL DEFAULT 'not-run' CHECK(proof_status IN ('not-run', 'running', 'passed', 'failed', 'stale', 'manual-review', 'preflight-blocked')),
        last_proof_run_id TEXT,
        last_proof_profile_id TEXT,
        last_proof_at INTEGER,
        last_proof_summary TEXT,
        proof_stale_reason TEXT,
        proof_manual_review_justification TEXT,
        proof_manual_review_at INTEGER,
        mission_phase TEXT NOT NULL DEFAULT 'classification' CHECK(mission_phase IN ('classification', 'plan', 'implement', 'validate', 'proof', 'summarize')),
        mission_phase_updated_at INTEGER NOT NULL DEFAULT 0,
        classification_json TEXT,
        plan_json TEXT,
        summary_json TEXT,
        previous_pass_context_json TEXT,
        started_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `INSERT INTO ticket_runs (
        run_id, ticket_id, ticket_summary, ticket_url, project_key, status, status_message,
        station_id, commit_message_draft, proof_status, last_proof_run_id, last_proof_profile_id,
        last_proof_at, last_proof_summary, proof_stale_reason,
        mission_phase, mission_phase_updated_at, classification_json, plan_json, summary_json,
        previous_pass_context_json, started_at, created_at, updated_at
      )
      SELECT
        run_id, ticket_id, ticket_summary, ticket_url, project_key, status, status_message,
        station_id, commit_message_draft, proof_status, last_proof_run_id, last_proof_profile_id,
        last_proof_at, last_proof_summary, proof_stale_reason,
        mission_phase, mission_phase_updated_at, classification_json, plan_json, summary_json,
        previous_pass_context_json, started_at, created_at, updated_at
      FROM ticket_runs_v28`,
      "DROP TABLE ticket_runs_v28",
      "CREATE UNIQUE INDEX idx_ticket_runs_ticket_id ON ticket_runs(ticket_id)",
      "CREATE INDEX idx_ticket_runs_status ON ticket_runs(status, updated_at DESC)",

      "ALTER TABLE ticket_run_proof_runs RENAME TO ticket_run_proof_runs_v28",
      `CREATE TABLE ticket_run_proof_runs (
        proof_run_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_label TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'passed', 'failed', 'preflight-blocked')),
        summary TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        exit_code INTEGER,
        command TEXT,
        artifacts_json TEXT,
        FOREIGN KEY(run_id) REFERENCES ticket_runs(run_id) ON DELETE CASCADE
      )`,
      `INSERT INTO ticket_run_proof_runs (
        proof_run_id, run_id, profile_id, profile_label, status, summary,
        started_at, completed_at, exit_code, command, artifacts_json
      )
      SELECT
        proof_run_id, run_id, profile_id, profile_label, status, summary,
        started_at, completed_at, exit_code, command, artifacts_json
      FROM ticket_run_proof_runs_v28`,
      "DROP TABLE ticket_run_proof_runs_v28",
      "CREATE INDEX idx_ticket_run_proof_runs_run_id_v29 ON ticket_run_proof_runs(run_id, started_at DESC)",
    ],
  },
  {
    // repo_profiles + Phase 3.4 validation_profiles enrichment.
    //   - New repo_profiles table: per-projectKey "what is this repo" record. Carries display
    //     metadata, default registry / branch / build dir, required env vars + SDKs (JSON
    //     arrays), user-facing copy globs, UI test globs, and free-text notes. JS-side source
    //     tag mirrors the one on repo_intelligence_entries (builtin / user / learned).
    //   - validation_profiles gains 'restore', 'format', 'e2e-smoke' kinds + a
    //     last_observed_runtime_ms column for the rolling-average runtime feedback that
    //     Phase 5 will populate. As with v29 we use the table-rename pattern because SQLite
    //     can't drop a CHECK constraint in place.
    version: 30,
    statements: [
      `CREATE TABLE repo_profiles (
        project_key TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        description TEXT,
        default_branch TEXT,
        default_build_working_directory TEXT,
        default_registry TEXT,
        registry_hints_json TEXT NOT NULL DEFAULT '[]',
        required_env_vars_json TEXT NOT NULL DEFAULT '[]',
        required_sdks_json TEXT NOT NULL DEFAULT '[]',
        user_facing_copy_globs_json TEXT NOT NULL DEFAULT '[]',
        ui_test_globs_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        source TEXT NOT NULL CHECK(source IN ('builtin', 'user', 'learned')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_repo_profiles_updated_v30 ON repo_profiles(updated_at DESC)",

      "ALTER TABLE validation_profiles RENAME TO validation_profiles_v29",
      `CREATE TABLE validation_profiles (
        id TEXT PRIMARY KEY,
        project_key TEXT,
        repo_relative_path TEXT,
        label TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('build', 'unit-test', 'lint', 'typecheck', 'restore', 'format', 'e2e-smoke')),
        command TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        notes TEXT,
        confidence REAL NOT NULL DEFAULT 0.5,
        expected_runtime_ms INTEGER,
        last_observed_runtime_ms INTEGER,
        prerequisites_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL CHECK(source IN ('builtin', 'user')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `INSERT INTO validation_profiles (
        id, project_key, repo_relative_path, label, kind, command, working_directory,
        notes, confidence, expected_runtime_ms, prerequisites_json, source, created_at, updated_at
      )
      SELECT
        id, project_key, repo_relative_path, label, kind, command, working_directory,
        notes, confidence, expected_runtime_ms, prerequisites_json, source, created_at, updated_at
      FROM validation_profiles_v29`,
      "DROP TABLE validation_profiles_v29",
      "CREATE INDEX idx_validation_profiles_scope_v30 ON validation_profiles(project_key, repo_relative_path, updated_at DESC)",
    ],
  },
  {
    // v31 — Phase 4.6 cursor-paged mission timeline reads (`WHERE run_id = ? AND id < ?`).
    // The existing v20 index covers the run_id equality + occurred_at ordering, but the
    // cursor predicate runs as a residual scan over every row in the run. This covering
    // index lets long-running missions page back through their event log without scanning.
    version: 31,
    statements: ["CREATE INDEX IF NOT EXISTS idx_mission_events_run_id_v31 ON mission_events(run_id, id DESC)"],
  },
  {
    // v32 — Phase 7.1 WorkSession event log. Mirrors mission_events shape (id auto-PK,
    // station_id grouping, stage + event_type discriminators, JSON metadata, occurredAt).
    // Distinct table to avoid the mission_events FK to ticket_runs; WorkSessions live
    // outside the ticket-runs lifecycle and have their own (sessionId, stationId) scope.
    version: 32,
    statements: [
      `CREATE TABLE work_session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        event_type TEXT NOT NULL,
        metadata_json TEXT,
        occurred_at INTEGER NOT NULL
      )`,
      "CREATE INDEX idx_work_session_events_session_v32 ON work_session_events(session_id, id DESC)",
      "CREATE INDEX idx_work_session_events_station_v32 ON work_session_events(station_id, occurred_at DESC)",
    ],
  },
  {
    // v33 — covering index for the cross-mission validation-candidate sweep
    // (listMissionEventsByProjectKey). The query filters mission_events by event_type and
    // joins ticket_runs by run_id; without this index the planner falls back to scanning
    // all mission_events rows for the JOIN partner.
    version: 33,
    statements: ["CREATE INDEX IF NOT EXISTS idx_mission_events_event_type_v33 ON mission_events(event_type, run_id)"],
  },
  {
    // v34 — extend ticket_runs.status CHECK to include 'aborted'. The status was added to
    // TICKET_RUN_STATUSES (shared) when abortRun() landed, but the schema constraint was
    // never updated, so any abort would crash with a CHECK violation. Same table-rename
    // pattern as v29 because SQLite cannot drop a CHECK constraint in place.
    version: 34,
    statements: [
      "ALTER TABLE ticket_runs RENAME TO ticket_runs_v33",
      `CREATE TABLE ticket_runs (
        run_id TEXT PRIMARY KEY,
        ticket_id TEXT NOT NULL,
        ticket_summary TEXT NOT NULL,
        ticket_url TEXT NOT NULL,
        project_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('starting', 'ready', 'blocked', 'working', 'awaiting-review', 'error', 'done', 'aborted')),
        status_message TEXT,
        station_id TEXT,
        commit_message_draft TEXT,
        proof_status TEXT NOT NULL DEFAULT 'not-run' CHECK(proof_status IN ('not-run', 'running', 'passed', 'failed', 'stale', 'manual-review', 'preflight-blocked')),
        last_proof_run_id TEXT,
        last_proof_profile_id TEXT,
        last_proof_at INTEGER,
        last_proof_summary TEXT,
        proof_stale_reason TEXT,
        proof_manual_review_justification TEXT,
        proof_manual_review_at INTEGER,
        mission_phase TEXT NOT NULL DEFAULT 'classification' CHECK(mission_phase IN ('classification', 'plan', 'implement', 'validate', 'proof', 'summarize')),
        mission_phase_updated_at INTEGER NOT NULL DEFAULT 0,
        classification_json TEXT,
        plan_json TEXT,
        summary_json TEXT,
        previous_pass_context_json TEXT,
        started_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `INSERT INTO ticket_runs (
        run_id, ticket_id, ticket_summary, ticket_url, project_key, status, status_message,
        station_id, commit_message_draft, proof_status, last_proof_run_id, last_proof_profile_id,
        last_proof_at, last_proof_summary, proof_stale_reason,
        proof_manual_review_justification, proof_manual_review_at,
        mission_phase, mission_phase_updated_at, classification_json, plan_json, summary_json,
        previous_pass_context_json, started_at, created_at, updated_at
      )
      SELECT
        run_id, ticket_id, ticket_summary, ticket_url, project_key, status, status_message,
        station_id, commit_message_draft, proof_status, last_proof_run_id, last_proof_profile_id,
        last_proof_at, last_proof_summary, proof_stale_reason,
        proof_manual_review_justification, proof_manual_review_at,
        mission_phase, mission_phase_updated_at, classification_json, plan_json, summary_json,
        previous_pass_context_json, started_at, created_at, updated_at
      FROM ticket_runs_v33`,
      "DROP TABLE ticket_runs_v33",
      "CREATE UNIQUE INDEX idx_ticket_runs_ticket_id ON ticket_runs(ticket_id)",
      "CREATE INDEX idx_ticket_runs_status ON ticket_runs(status, updated_at DESC)",
    ],
  },
];
