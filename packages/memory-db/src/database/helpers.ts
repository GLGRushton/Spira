import {
  MODEL_PROVIDERS,
  TICKET_RUN_ATTEMPT_STATUSES,
  TICKET_RUN_CLEANUP_STATES,
  TICKET_RUN_MISSION_CLASSIFICATIONS,
  TICKET_RUN_MISSION_PHASES,
  TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES,
  TICKET_RUN_MISSION_PROOF_LEVELS,
  TICKET_RUN_MISSION_PROOF_PREFLIGHT_STATUSES,
  TICKET_RUN_MISSION_VALIDATION_KINDS,
  TICKET_RUN_MISSION_VALIDATION_STATUSES,
  TICKET_RUN_PROOF_ARTIFACT_KINDS,
  TICKET_RUN_PROOF_RUN_STATUSES,
  TICKET_RUN_PROOF_STATUSES,
  TICKET_RUN_STATUSES,
} from "@spira/shared";
import type {
  McpServerSource,
  ModelProviderId,
  SubagentSource,
  TicketRunAttemptStatus,
  TicketRunCleanupState,
  TicketRunMissionClassificationKind,
  TicketRunMissionPhase,
  TicketRunMissionProofArtifactMode,
  TicketRunMissionProofLevel,
  TicketRunMissionProofPreflightStatus,
  TicketRunMissionValidationKind,
  TicketRunMissionValidationStatus,
  TicketRunProofArtifactKind,
  TicketRunProofRunStatus,
  TicketRunProofStatus,
  TicketRunStatus,
  TicketRunSubmoduleParentRef,
} from "@spira/shared";
import type BetterSqlite3 from "better-sqlite3";
import { MIGRATIONS } from "./migrations.js";
import {
  MEMORY_ENTRY_CATEGORIES,
  REPO_INTELLIGENCE_ENTRY_SOURCES,
  REPO_INTELLIGENCE_ENTRY_TYPES,
  RUNTIME_HOST_RESOURCE_STATUSES,
  RUNTIME_PERMISSION_REQUEST_STATUSES,
  SQLITE_BUSY_TIMEOUT_MS,
  VALIDATION_PROFILE_KINDS,
} from "./types.js";
import type {
  MemoryEntryCategory,
  RepoIntelligenceEntrySource,
  RepoIntelligenceEntryType,
  RuntimeHostResourceStatus,
  RuntimePermissionRequestStatus,
  ValidationProfileKind,
} from "./types.js";

export const getPersistedProviderSessionStateKey = (stationId: string): string =>
  stationId === "primary" ? "copilot-session-id" : `station:${stationId}:copilot-session-id`;

export type SqliteDatabase = InstanceType<typeof BetterSqlite3>;

export const toBoolean = (value: number): boolean => value === 1;

export const tryParseJson = (value: string | null): unknown => {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

export const serializeJson = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
};

export const normalizeTitle = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeText = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

export const MODEL_PROVIDER_ID_SET = new Set<ModelProviderId>(MODEL_PROVIDERS);

export const normalizeModelProviderId = (value: unknown): ModelProviderId | null =>
  typeof value === "string" && MODEL_PROVIDER_ID_SET.has(value as ModelProviderId) ? (value as ModelProviderId) : null;

export const parseStringArray = (value: string | null, fallback: string[] = []): string[] => {
  const parsed = tryParseJson(value);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : fallback;
};

export const normalizeTicketRunSubmoduleParentRefs = (
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

export const normalizeStringArray = (value: readonly string[] | null | undefined): string[] =>
  (value ?? []).map((entry) => entry.trim()).filter((entry) => entry.length > 0);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const assertRuntimePermissionRequestStatus: (value: string) => asserts value is RuntimePermissionRequestStatus =
  (value) => {
    if ((RUNTIME_PERMISSION_REQUEST_STATUSES as readonly string[]).includes(value)) {
      return;
    }
    throw new Error(`Unknown runtime permission request status: ${value}`);
  };

export const assertRuntimeHostResourceStatus: (value: string) => asserts value is RuntimeHostResourceStatus = (
  value,
) => {
  if ((RUNTIME_HOST_RESOURCE_STATUSES as readonly string[]).includes(value)) {
    return;
  }
  throw new Error(`Unknown runtime host resource status: ${value}`);
};

export const toFtsQuery = (query: string): string => {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .map((token) => token.replace(/"/gu, '""'))
    .filter((token) => token.length > 0);

  return tokens.map((token) => `"${token}"`).join(" AND ");
};

export function assertMemoryEntryCategory(category: string): asserts category is MemoryEntryCategory {
  if (!MEMORY_ENTRY_CATEGORIES.includes(category as MemoryEntryCategory)) {
    throw new Error(`Unsupported memory entry category: ${category}`);
  }
}

export function assertRepoIntelligenceEntryType(type: string): asserts type is RepoIntelligenceEntryType {
  if (!REPO_INTELLIGENCE_ENTRY_TYPES.includes(type as RepoIntelligenceEntryType)) {
    throw new Error(`Unsupported repo intelligence entry type: ${type}`);
  }
}

export function assertRepoIntelligenceEntrySource(source: string): asserts source is RepoIntelligenceEntrySource {
  if (!REPO_INTELLIGENCE_ENTRY_SOURCES.includes(source as RepoIntelligenceEntrySource)) {
    throw new Error(`Unsupported repo intelligence entry source: ${source}`);
  }
}

export function assertValidationProfileKind(kind: string): asserts kind is ValidationProfileKind {
  if (!VALIDATION_PROFILE_KINDS.includes(kind as ValidationProfileKind)) {
    throw new Error(`Unsupported validation profile kind: ${kind}`);
  }
}

export function assertMcpServerSource(source: string): asserts source is McpServerSource {
  if (source !== "builtin" && source !== "user") {
    throw new Error(`Unsupported MCP server source: ${source}`);
  }
}

export function assertSubagentSource(source: string): asserts source is SubagentSource {
  if (source !== "builtin" && source !== "user") {
    throw new Error(`Unsupported subagent source: ${source}`);
  }
}

export function assertValidationProfileSource(
  source: string,
): asserts source is "builtin" | "user" | "learned" {
  if (source !== "builtin" && source !== "user" && source !== "learned") {
    throw new Error(`Unsupported validation profile source: ${source}`);
  }
}

export function assertValidationProfileScope(
  scope: string,
): asserts scope is "global" | "project" | "shared-repo" {
  if (scope !== "global" && scope !== "project" && scope !== "shared-repo") {
    throw new Error(`Unsupported validation profile scope: ${scope}`);
  }
}

export function assertRepoProfileTrustLearnerMode(
  mode: string,
): asserts mode is "manual-review" | "auto-accept-below-threshold" | "paused" {
  if (mode !== "manual-review" && mode !== "auto-accept-below-threshold" && mode !== "paused") {
    throw new Error(`Unsupported repo profile trust-learner mode: ${mode}`);
  }
}

export function assertTicketRunStatus(status: string): asserts status is TicketRunStatus {
  if (!TICKET_RUN_STATUSES.includes(status as TicketRunStatus)) {
    throw new Error(`Unsupported ticket run status: ${status}`);
  }
}

export function assertTicketRunAttemptStatus(status: string): asserts status is TicketRunAttemptStatus {
  if (!TICKET_RUN_ATTEMPT_STATUSES.includes(status as TicketRunAttemptStatus)) {
    throw new Error(`Unsupported ticket run attempt status: ${status}`);
  }
}

export function assertTicketRunCleanupState(state: string): asserts state is TicketRunCleanupState {
  if (!TICKET_RUN_CLEANUP_STATES.includes(state as TicketRunCleanupState)) {
    throw new Error(`Unsupported ticket run cleanup state: ${state}`);
  }
}

export function assertTicketRunProofStatus(status: string): asserts status is TicketRunProofStatus {
  if (!TICKET_RUN_PROOF_STATUSES.includes(status as TicketRunProofStatus)) {
    throw new Error(`Unsupported ticket run proof status: ${status}`);
  }
}

export function assertTicketRunMissionPhase(phase: string): asserts phase is TicketRunMissionPhase {
  if (!TICKET_RUN_MISSION_PHASES.includes(phase as TicketRunMissionPhase)) {
    throw new Error(`Unsupported ticket run mission phase: ${phase}`);
  }
}

export function assertTicketRunMissionClassificationKind(
  kind: string,
): asserts kind is TicketRunMissionClassificationKind {
  if (!TICKET_RUN_MISSION_CLASSIFICATIONS.includes(kind as TicketRunMissionClassificationKind)) {
    throw new Error(`Unsupported ticket run mission classification kind: ${kind}`);
  }
}

export function assertTicketRunMissionProofArtifactMode(
  mode: string,
): asserts mode is TicketRunMissionProofArtifactMode {
  if (!TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES.includes(mode as TicketRunMissionProofArtifactMode)) {
    throw new Error(`Unsupported ticket run mission proof artifact mode: ${mode}`);
  }
}

export function assertTicketRunMissionProofLevel(level: string): asserts level is TicketRunMissionProofLevel {
  if (!TICKET_RUN_MISSION_PROOF_LEVELS.includes(level as TicketRunMissionProofLevel)) {
    throw new Error(`Unsupported ticket run mission proof level: ${level}`);
  }
}

export function assertTicketRunMissionProofPreflightStatus(
  status: string,
): asserts status is TicketRunMissionProofPreflightStatus {
  if (!TICKET_RUN_MISSION_PROOF_PREFLIGHT_STATUSES.includes(status as TicketRunMissionProofPreflightStatus)) {
    throw new Error(`Unsupported ticket run mission proof preflight status: ${status}`);
  }
}

export function assertTicketRunMissionValidationKind(kind: string): asserts kind is TicketRunMissionValidationKind {
  if (!TICKET_RUN_MISSION_VALIDATION_KINDS.includes(kind as TicketRunMissionValidationKind)) {
    throw new Error(`Unsupported ticket run mission validation kind: ${kind}`);
  }
}

export function assertTicketRunMissionValidationStatus(
  status: string,
): asserts status is TicketRunMissionValidationStatus {
  if (!TICKET_RUN_MISSION_VALIDATION_STATUSES.includes(status as TicketRunMissionValidationStatus)) {
    throw new Error(`Unsupported ticket run mission validation status: ${status}`);
  }
}

export function assertTicketRunProofRunStatus(status: string): asserts status is TicketRunProofRunStatus {
  if (!TICKET_RUN_PROOF_RUN_STATUSES.includes(status as TicketRunProofRunStatus)) {
    throw new Error(`Unsupported ticket run proof run status: ${status}`);
  }
}

export function assertTicketRunProofArtifactKind(kind: string): asserts kind is TicketRunProofArtifactKind {
  if (!TICKET_RUN_PROOF_ARTIFACT_KINDS.includes(kind as TicketRunProofArtifactKind)) {
    throw new Error(`Unsupported ticket run proof artifact kind: ${kind}`);
  }
}

export const configureDatabase = (db: SqliteDatabase, readonly: boolean): void => {
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  if (readonly) {
    db.pragma("query_only = ON");
    return;
  }

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
};

export const applyMigrations = (db: SqliteDatabase): void => {
  const currentVersion = Number(db.pragma("user_version", { simple: true }) ?? 0);
  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    // Hot path on every db open — short-circuit before touching any pragmas so the steady-state
    // cost is just the user_version read above.
    return;
  }

  // Migrations that recreate referenced tables (e.g. v29 rebuilding ticket_runs to evolve a
  // CHECK constraint) need two pragmas relaxed:
  //   - foreign_keys = OFF: lets us drop the renamed shadow table without FK enforcement.
  //   - legacy_alter_table = ON: stops SQLite 3.25+ from rewriting FK references in
  //     dependent tables during ALTER TABLE RENAME. Without this, dependent FKs end up
  //     pointing at the (later-dropped) shadow table and break at runtime.
  // We restore both pragmas in a finally block and run a foreign_key_check as defence.
  const wereForeignKeysOn = db.pragma("foreign_keys", { simple: true }) === 1;
  const previousLegacyAlterTable = db.pragma("legacy_alter_table", { simple: true }) === 1;
  if (wereForeignKeysOn) {
    db.pragma("foreign_keys = OFF");
  }
  db.pragma("legacy_alter_table = ON");

  try {
    const migrate = db.transaction(() => {
      for (const migration of pending) {
        for (const statement of migration.statements) {
          db.exec(statement);
        }
        db.pragma(`user_version = ${migration.version}`);
      }
    });
    migrate();
    if (wereForeignKeysOn) {
      const violations = db.pragma("foreign_key_check") as unknown[];
      if (violations.length > 0) {
        throw new Error(
          `Foreign key violations detected after migrations: ${JSON.stringify(violations).slice(0, 200)}`,
        );
      }
    }
  } finally {
    db.pragma(`legacy_alter_table = ${previousLegacyAlterTable ? "ON" : "OFF"}`);
    if (wereForeignKeysOn) {
      db.pragma("foreign_keys = ON");
    }
  }
};
