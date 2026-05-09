import {
  type DatabasePersistenceContext,
  assertDatabaseWritable,
  buildScopedRecordFilter,
  matchesScopedRecord,
} from "./context.js";
import {
  assertRepoIntelligenceEntrySource,
  assertRepoIntelligenceEntryType,
  assertTicketRunMissionClassificationKind,
  assertTicketRunMissionProofLevel,
  assertTicketRunMissionProofPreflightStatus,
  assertValidationProfileKind,
  normalizeStringArray,
  normalizeTitle,
  serializeJson,
} from "./helpers.js";
import {
  mapProofDecisionRow,
  mapProofRuleRow,
  mapRepoIntelligenceRow,
  mapRepoProfileRow,
  mapValidationProfileRow,
} from "./mappers.js";
import type {
  ProofDecisionRow,
  ProofRuleRow,
  RepoIntelligenceRow,
  RepoProfileRow,
  ValidationProfileRow,
} from "./rows.js";
import type {
  ProofDecisionRecord,
  ProofRuleRecord,
  RepoIntelligenceRecord,
  RepoProfileRecord,
  UpsertProofDecisionInput,
  UpsertProofRuleInput,
  UpsertRepoIntelligenceInput,
  UpsertRepoProfileInput,
  UpsertValidationProfileInput,
  ValidationProfileRecord,
} from "./types.js";

export const createIntelligencePersistence = (context: DatabasePersistenceContext) => {
  const getRepoIntelligenceEntry = (entryId: string): RepoIntelligenceRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           type,
           title,
           content,
           tags_json AS tagsJson,
           source,
           approved,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM repo_intelligence_entries
         WHERE id = @entryId`,
      )
      .get({ entryId }) as RepoIntelligenceRow | undefined;

    return row ? mapRepoIntelligenceRow(row) : null;
  };

  const listRepoIntelligence = (
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      tags?: readonly string[];
      includeUnapproved?: boolean;
      limit?: number;
    } = {},
  ): RepoIntelligenceRecord[] => {
    const normalizedProjectKey = normalizeTitle(options.projectKey) ?? null;
    const repoPaths = normalizeStringArray(options.repoRelativePaths);
    const repoPathSet = new Set(repoPaths);
    const tagSet = new Set(normalizeStringArray(options.tags));
    const includeUnapproved = options.includeUnapproved === true;
    const limit = options.limit ?? 20;

    const scopedFilter = buildScopedRecordFilter(normalizedProjectKey, repoPaths);
    const approvalClause = includeUnapproved ? "" : scopedFilter.whereClause ? "AND approved = 1" : "WHERE approved = 1";
    const sql = `SELECT
       id,
       project_key AS projectKey,
       repo_relative_path AS repoRelativePath,
       type,
       title,
       content,
       tags_json AS tagsJson,
       source,
       approved,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM repo_intelligence_entries
     ${scopedFilter.whereClause}
     ${approvalClause}
     ORDER BY approved DESC, updated_at DESC, created_at DESC`;

    const rows = context.db.prepare(sql).all(scopedFilter.params) as unknown as RepoIntelligenceRow[];

    return rows
      .map((row) => mapRepoIntelligenceRow(row))
      .filter(
        (entry) =>
          // SQL filters by project/repo/approved; this final pass enforces tags and the
          // matchesScopedRecord semantics for any edge case the SQL clause doesn't cover.
          matchesScopedRecord(entry, normalizedProjectKey, repoPathSet) &&
          (tagSet.size === 0 || [...tagSet].every((tag) => entry.tags.includes(tag))),
      )
      .slice(0, limit);
  };

  const upsertRepoIntelligence = (input: UpsertRepoIntelligenceInput): RepoIntelligenceRecord => {
    assertDatabaseWritable(context);
    const now = input.createdAt ?? Date.now();
    const existing = getRepoIntelligenceEntry(input.id);
    const payload = {
      id: input.id.trim(),
      projectKey: normalizeTitle(input.projectKey),
      repoRelativePath: normalizeTitle(input.repoRelativePath),
      type: input.type,
      title: input.title.trim(),
      content: input.content.trim(),
      tagsJson: serializeJson(normalizeStringArray(input.tags)) ?? "[]",
      source: input.source,
      approved: input.approved === false ? 0 : 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    assertRepoIntelligenceEntryType(payload.type);
    assertRepoIntelligenceEntrySource(payload.source);
    if (!payload.id || !payload.title || !payload.content) {
      throw new Error("Repo intelligence entries require non-empty id, title, and content.");
    }

    context.db
      .prepare(
        `INSERT INTO repo_intelligence_entries (
           id,
           project_key,
           repo_relative_path,
           type,
           title,
           content,
           tags_json,
           source,
           approved,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @projectKey,
           @repoRelativePath,
           @type,
           @title,
           @content,
           @tagsJson,
           @source,
           @approved,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           project_key = excluded.project_key,
           repo_relative_path = excluded.repo_relative_path,
           type = excluded.type,
           title = excluded.title,
           content = excluded.content,
           tags_json = excluded.tags_json,
           source = excluded.source,
           approved = excluded.approved,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = getRepoIntelligenceEntry(payload.id);
    if (!saved) {
      throw new Error(`Failed to load repo intelligence entry ${payload.id}.`);
    }

    return saved;
  };

  const seedBuiltinRepoIntelligence = (
    entries: readonly Omit<UpsertRepoIntelligenceInput, "source">[],
  ): RepoIntelligenceRecord[] => {
    assertDatabaseWritable(context);
    const seed = context.db.transaction((items: readonly Omit<UpsertRepoIntelligenceInput, "source">[]) =>
      items.map((entry) =>
        upsertRepoIntelligence({
          ...entry,
          source: "builtin",
          approved: getRepoIntelligenceEntry(entry.id)?.approved ?? true,
        }),
      ),
    );

    return seed(entries);
  };

  const setRepoIntelligenceApproval = (entryId: string, approved: boolean): RepoIntelligenceRecord => {
    assertDatabaseWritable(context);
    const existing = getRepoIntelligenceEntry(entryId);
    if (!existing) {
      throw new Error(`Repo intelligence entry ${entryId} does not exist.`);
    }

    return upsertRepoIntelligence({
      id: existing.id,
      projectKey: existing.projectKey,
      repoRelativePath: existing.repoRelativePath,
      type: existing.type,
      title: existing.title,
      content: existing.content,
      tags: existing.tags,
      source: existing.source,
      approved,
      createdAt: existing.createdAt,
    });
  };

  const getValidationProfile = (profileId: string): ValidationProfileRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           label,
           kind,
           command,
           working_directory AS workingDirectory,
           notes,
           confidence,
           expected_runtime_ms AS expectedRuntimeMs,
           last_observed_runtime_ms AS lastObservedRuntimeMs,
           prerequisites_json AS prerequisitesJson,
           source,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM validation_profiles
         WHERE id = @profileId`,
      )
      .get({ profileId }) as ValidationProfileRow | undefined;

    return row ? mapValidationProfileRow(row) : null;
  };

  const listValidationProfiles = (
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      limit?: number;
    } = {},
  ): ValidationProfileRecord[] => {
    const normalizedProjectKey = normalizeTitle(options.projectKey) ?? null;
    const repoPaths = normalizeStringArray(options.repoRelativePaths);
    const repoPathSet = new Set(repoPaths);
    const limit = options.limit ?? 20;

    const scopedFilter = buildScopedRecordFilter(normalizedProjectKey, repoPaths);
    const sql = `SELECT
       id,
       project_key AS projectKey,
       repo_relative_path AS repoRelativePath,
       label,
       kind,
       command,
       working_directory AS workingDirectory,
       notes,
       confidence,
       expected_runtime_ms AS expectedRuntimeMs,
       last_observed_runtime_ms AS lastObservedRuntimeMs,
       prerequisites_json AS prerequisitesJson,
       source,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM validation_profiles
     ${scopedFilter.whereClause}
     ORDER BY updated_at DESC, created_at DESC`;

    const rows = context.db.prepare(sql).all(scopedFilter.params) as unknown as ValidationProfileRow[];

    return rows
      .map((row) => mapValidationProfileRow(row))
      .filter((entry) => matchesScopedRecord(entry, normalizedProjectKey, repoPathSet))
      .slice(0, limit);
  };

  const upsertValidationProfile = (input: UpsertValidationProfileInput): ValidationProfileRecord => {
    assertDatabaseWritable(context);
    const now = input.createdAt ?? Date.now();
    const existing = getValidationProfile(input.id);
    const payload = {
      id: input.id.trim(),
      projectKey: normalizeTitle(input.projectKey),
      repoRelativePath: normalizeTitle(input.repoRelativePath),
      label: input.label.trim(),
      kind: input.kind,
      command: input.command.trim(),
      workingDirectory: input.workingDirectory.trim(),
      notes: normalizeTitle(input.notes),
      confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence ?? 0.5)) : 0.5,
      expectedRuntimeMs:
        typeof input.expectedRuntimeMs === "number" && Number.isFinite(input.expectedRuntimeMs)
          ? Math.max(0, input.expectedRuntimeMs)
          : null,
      lastObservedRuntimeMs:
        typeof input.lastObservedRuntimeMs === "number" && Number.isFinite(input.lastObservedRuntimeMs)
          ? Math.max(0, input.lastObservedRuntimeMs)
          : (existing?.lastObservedRuntimeMs ?? null),
      prerequisitesJson: serializeJson(normalizeStringArray(input.prerequisites)) ?? "[]",
      source: input.source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    assertValidationProfileKind(payload.kind);
    if (payload.source !== "builtin" && payload.source !== "user") {
      throw new Error(`Unsupported validation profile source: ${payload.source}`);
    }
    if (!payload.id || !payload.label || !payload.command || !payload.workingDirectory) {
      throw new Error("Validation profiles require non-empty id, label, command, and workingDirectory.");
    }

    context.db
      .prepare(
        `INSERT INTO validation_profiles (
           id,
           project_key,
           repo_relative_path,
           label,
           kind,
           command,
           working_directory,
           notes,
           confidence,
           expected_runtime_ms,
           last_observed_runtime_ms,
           prerequisites_json,
           source,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @projectKey,
           @repoRelativePath,
           @label,
           @kind,
           @command,
           @workingDirectory,
           @notes,
           @confidence,
           @expectedRuntimeMs,
           @lastObservedRuntimeMs,
           @prerequisitesJson,
           @source,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           project_key = excluded.project_key,
           repo_relative_path = excluded.repo_relative_path,
           label = excluded.label,
           kind = excluded.kind,
           command = excluded.command,
           working_directory = excluded.working_directory,
           notes = excluded.notes,
           confidence = excluded.confidence,
           expected_runtime_ms = excluded.expected_runtime_ms,
           last_observed_runtime_ms = excluded.last_observed_runtime_ms,
           prerequisites_json = excluded.prerequisites_json,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = getValidationProfile(payload.id);
    if (!saved) {
      throw new Error(`Failed to load validation profile ${payload.id}.`);
    }

    return saved;
  };

  const seedBuiltinValidationProfiles = (
    entries: readonly Omit<UpsertValidationProfileInput, "source">[],
  ): ValidationProfileRecord[] => {
    assertDatabaseWritable(context);
    const seed = context.db.transaction((items: readonly Omit<UpsertValidationProfileInput, "source">[]) =>
      items.map((entry) =>
        upsertValidationProfile({
          ...entry,
          source: "builtin",
        }),
      ),
    );

    return seed(entries);
  };

  const getProofRule = (ruleId: string): ProofRuleRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           id,
           project_key AS projectKey,
           repo_relative_path AS repoRelativePath,
           classification_kind AS classificationKind,
           ui_change AS uiChange,
           proof_required AS proofRequired,
           summary_keywords_json AS summaryKeywordsJson,
           recommended_level AS recommendedLevel,
           rationale,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM proof_rules
         WHERE id = @ruleId`,
      )
      .get({ ruleId }) as ProofRuleRow | undefined;

    return row ? mapProofRuleRow(row) : null;
  };

  const listProofRules = (
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      limit?: number;
    } = {},
  ): ProofRuleRecord[] => {
    const normalizedProjectKey = normalizeTitle(options.projectKey) ?? null;
    const repoPaths = normalizeStringArray(options.repoRelativePaths);
    const repoPathSet = new Set(repoPaths);
    const limit = options.limit ?? 20;

    const scopedFilter = buildScopedRecordFilter(normalizedProjectKey, repoPaths);
    const sql = `SELECT
       id,
       project_key AS projectKey,
       repo_relative_path AS repoRelativePath,
       classification_kind AS classificationKind,
       ui_change AS uiChange,
       proof_required AS proofRequired,
       summary_keywords_json AS summaryKeywordsJson,
       recommended_level AS recommendedLevel,
       rationale,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM proof_rules
     ${scopedFilter.whereClause}
     ORDER BY updated_at DESC, created_at DESC`;

    const rows = context.db.prepare(sql).all(scopedFilter.params) as unknown as ProofRuleRow[];

    return rows
      .map((row) => mapProofRuleRow(row))
      .filter((entry) => matchesScopedRecord(entry, normalizedProjectKey, repoPathSet))
      .slice(0, limit);
  };

  const upsertProofRule = (input: UpsertProofRuleInput): ProofRuleRecord => {
    assertDatabaseWritable(context);
    const now = input.createdAt ?? Date.now();
    const existing = getProofRule(input.id);
    const payload = {
      id: input.id.trim(),
      projectKey: normalizeTitle(input.projectKey),
      repoRelativePath: normalizeTitle(input.repoRelativePath),
      classificationKind: input.classificationKind ?? null,
      uiChange: typeof input.uiChange === "boolean" ? (input.uiChange ? 1 : 0) : null,
      proofRequired: typeof input.proofRequired === "boolean" ? (input.proofRequired ? 1 : 0) : null,
      summaryKeywordsJson: serializeJson(normalizeStringArray(input.summaryKeywords)) ?? "[]",
      recommendedLevel: input.recommendedLevel,
      rationale: input.rationale.trim(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (payload.classificationKind !== null) {
      assertTicketRunMissionClassificationKind(payload.classificationKind);
    }
    assertTicketRunMissionProofLevel(payload.recommendedLevel);
    if (!payload.id || !payload.rationale) {
      throw new Error("Proof rules require non-empty id and rationale.");
    }

    context.db
      .prepare(
        `INSERT INTO proof_rules (
           id,
           project_key,
           repo_relative_path,
           classification_kind,
           ui_change,
           proof_required,
           summary_keywords_json,
           recommended_level,
           rationale,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @projectKey,
           @repoRelativePath,
           @classificationKind,
           @uiChange,
           @proofRequired,
           @summaryKeywordsJson,
           @recommendedLevel,
           @rationale,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           project_key = excluded.project_key,
           repo_relative_path = excluded.repo_relative_path,
           classification_kind = excluded.classification_kind,
           ui_change = excluded.ui_change,
           proof_required = excluded.proof_required,
           summary_keywords_json = excluded.summary_keywords_json,
           recommended_level = excluded.recommended_level,
           rationale = excluded.rationale,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = getProofRule(payload.id);
    if (!saved) {
      throw new Error(`Failed to load proof rule ${payload.id}.`);
    }

    return saved;
  };

  const seedBuiltinProofRules = (entries: readonly Omit<UpsertProofRuleInput, "createdAt">[]): ProofRuleRecord[] => {
    assertDatabaseWritable(context);
    const seed = context.db.transaction((items: readonly Omit<UpsertProofRuleInput, "createdAt">[]) =>
      items.map((entry) => upsertProofRule(entry)),
    );

    return seed(entries);
  };

  /**
   * Phase 2.5 — delete a single proof rule by id. Returns true if a row was removed.
   * Caller is responsible for any policy checks (e.g. "don't delete builtins") — this is
   * intentionally permissive so the editor UI can also recover from accidentally-orphaned
   * records.
   */
  const deleteProofRule = (ruleId: string): boolean => {
    assertDatabaseWritable(context);
    const result = context.db.prepare("DELETE FROM proof_rules WHERE id = @ruleId").run({ ruleId });
    return result.changes > 0;
  };

  const getProofDecision = (runId: string): ProofDecisionRecord | null => {
    const row = context.db
      .prepare(
        `SELECT
           run_id AS runId,
           attempt_id AS attemptId,
           recommended_level AS recommendedLevel,
           preflight_status AS preflightStatus,
           rationale,
           evidence_json AS evidenceJson,
           repo_relative_paths_json AS repoRelativePathsJson,
           created_at AS createdAt,
           updated_at AS updatedAt
         FROM proof_decisions
         WHERE run_id = @runId`,
      )
      .get({ runId }) as ProofDecisionRow | undefined;

    return row ? mapProofDecisionRow(row) : null;
  };

  const upsertProofDecision = (input: UpsertProofDecisionInput): ProofDecisionRecord => {
    assertDatabaseWritable(context);
    const normalizedRunId = input.runId.trim();
    if (!normalizedRunId) {
      throw new Error("Proof decisions require a non-empty run id.");
    }
    const existing = getProofDecision(normalizedRunId);
    const now = input.createdAt ?? Date.now();
    if (input.recommendedLevel !== null && input.recommendedLevel !== undefined) {
      assertTicketRunMissionProofLevel(input.recommendedLevel);
    }
    if (input.preflightStatus !== null && input.preflightStatus !== undefined) {
      assertTicketRunMissionProofPreflightStatus(input.preflightStatus);
    }

    context.db
      .prepare(
        `INSERT INTO proof_decisions (
           run_id,
           attempt_id,
           recommended_level,
           preflight_status,
           rationale,
           evidence_json,
           repo_relative_paths_json,
           created_at,
           updated_at
         ) VALUES (
           @runId,
           @attemptId,
           @recommendedLevel,
           @preflightStatus,
           @rationale,
           @evidenceJson,
           @repoRelativePathsJson,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(run_id) DO UPDATE SET
           attempt_id = excluded.attempt_id,
           recommended_level = excluded.recommended_level,
           preflight_status = excluded.preflight_status,
           rationale = excluded.rationale,
           evidence_json = excluded.evidence_json,
           repo_relative_paths_json = excluded.repo_relative_paths_json,
           updated_at = excluded.updated_at`,
      )
      .run({
        runId: normalizedRunId,
        attemptId: normalizeTitle(input.attemptId),
        recommendedLevel: input.recommendedLevel ?? null,
        preflightStatus: input.preflightStatus ?? null,
        rationale: normalizeTitle(input.rationale),
        evidenceJson: serializeJson(normalizeStringArray(input.evidence)),
        repoRelativePathsJson: serializeJson(normalizeStringArray(input.repoRelativePaths)),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });

    const saved = getProofDecision(normalizedRunId);
    if (!saved) {
      throw new Error(`Failed to load proof decision for ${normalizedRunId}.`);
    }

    return saved;
  };

  /**
   * Phase 3.4 — delete a validation profile by id. Returns true if a row was removed.
   */
  const deleteValidationProfile = (profileId: string): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare("DELETE FROM validation_profiles WHERE id = @profileId")
      .run({ profileId });
    return result.changes > 0;
  };

  /**
   * Phase 4.1 — record an observed runtime against a validation profile (e.g. from
   * dependency warming). Updates only `last_observed_runtime_ms` and `updated_at`; the
   * existing rolling-average semantics (Phase 5 work) can layer on top later. Returns
   * true if a row was updated.
   */
  const recordValidationProfileObservedRuntime = (profileId: string, runtimeMs: number): boolean => {
    assertDatabaseWritable(context);
    if (!Number.isFinite(runtimeMs) || runtimeMs < 0) return false;
    const result = context.db
      .prepare(
        "UPDATE validation_profiles SET last_observed_runtime_ms = @runtimeMs, updated_at = @updatedAt WHERE id = @profileId",
      )
      .run({ profileId, runtimeMs: Math.round(runtimeMs), updatedAt: Date.now() });
    return result.changes > 0;
  };

  // ─── Phase 3.1 — repo_profiles CRUD ────────────────────────────────────────────────
  // Per-projectKey "what is this repo" record. Singleton per projectKey (PK), so we use
  // upsert + delete + list/get rather than a scoped-list pattern.

  const REPO_PROFILE_SELECT = `SELECT
       project_key AS projectKey,
       display_name AS displayName,
       description,
       default_branch AS defaultBranch,
       default_build_working_directory AS defaultBuildWorkingDirectory,
       default_registry AS defaultRegistry,
       registry_hints_json AS registryHintsJson,
       required_env_vars_json AS requiredEnvVarsJson,
       required_sdks_json AS requiredSdksJson,
       user_facing_copy_globs_json AS userFacingCopyGlobsJson,
       ui_test_globs_json AS uiTestGlobsJson,
       notes,
       source,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM repo_profiles`;

  const getRepoProfile = (projectKey: string): RepoProfileRecord | null => {
    const trimmed = projectKey.trim();
    if (!trimmed) return null;
    const row = context.db
      .prepare(`${REPO_PROFILE_SELECT} WHERE project_key = @projectKey`)
      .get({ projectKey: trimmed }) as RepoProfileRow | undefined;
    return row ? mapRepoProfileRow(row) : null;
  };

  const listRepoProfiles = (options: { limit?: number } = {}): RepoProfileRecord[] => {
    const limit = options.limit ?? 100;
    const rows = context.db
      .prepare(`${REPO_PROFILE_SELECT} ORDER BY updated_at DESC, project_key ASC LIMIT @limit`)
      .all({ limit }) as unknown as RepoProfileRow[];
    return rows.map((row) => mapRepoProfileRow(row));
  };

  const upsertRepoProfile = (input: UpsertRepoProfileInput): RepoProfileRecord => {
    assertDatabaseWritable(context);
    const projectKey = input.projectKey.trim();
    const displayName = input.displayName.trim();
    if (!projectKey || !displayName) {
      throw new Error("Repo profiles require non-empty projectKey and displayName.");
    }
    const source = input.source ?? "user";
    if (source !== "builtin" && source !== "user" && source !== "learned") {
      throw new Error(`Unsupported repo profile source: ${source}`);
    }
    const now = input.createdAt ?? Date.now();
    const existing = getRepoProfile(projectKey);
    const payload = {
      projectKey,
      displayName,
      description: normalizeTitle(input.description),
      defaultBranch: normalizeTitle(input.defaultBranch),
      defaultBuildWorkingDirectory: normalizeTitle(input.defaultBuildWorkingDirectory),
      defaultRegistry: normalizeTitle(input.defaultRegistry),
      registryHintsJson: serializeJson(normalizeStringArray(input.registryHints)) ?? "[]",
      requiredEnvVarsJson: serializeJson(normalizeStringArray(input.requiredEnvVars)) ?? "[]",
      requiredSdksJson: serializeJson(normalizeStringArray(input.requiredSdks)) ?? "[]",
      userFacingCopyGlobsJson: serializeJson(normalizeStringArray(input.userFacingCopyGlobs)) ?? "[]",
      uiTestGlobsJson: serializeJson(normalizeStringArray(input.uiTestGlobs)) ?? "[]",
      notes: normalizeTitle(input.notes),
      source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    context.db
      .prepare(
        `INSERT INTO repo_profiles (
           project_key,
           display_name,
           description,
           default_branch,
           default_build_working_directory,
           default_registry,
           registry_hints_json,
           required_env_vars_json,
           required_sdks_json,
           user_facing_copy_globs_json,
           ui_test_globs_json,
           notes,
           source,
           created_at,
           updated_at
         ) VALUES (
           @projectKey,
           @displayName,
           @description,
           @defaultBranch,
           @defaultBuildWorkingDirectory,
           @defaultRegistry,
           @registryHintsJson,
           @requiredEnvVarsJson,
           @requiredSdksJson,
           @userFacingCopyGlobsJson,
           @uiTestGlobsJson,
           @notes,
           @source,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(project_key) DO UPDATE SET
           display_name = excluded.display_name,
           description = excluded.description,
           default_branch = excluded.default_branch,
           default_build_working_directory = excluded.default_build_working_directory,
           default_registry = excluded.default_registry,
           registry_hints_json = excluded.registry_hints_json,
           required_env_vars_json = excluded.required_env_vars_json,
           required_sdks_json = excluded.required_sdks_json,
           user_facing_copy_globs_json = excluded.user_facing_copy_globs_json,
           ui_test_globs_json = excluded.ui_test_globs_json,
           notes = excluded.notes,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = getRepoProfile(projectKey);
    if (!saved) {
      throw new Error(`Failed to load repo profile ${projectKey}.`);
    }
    return saved;
  };

  const deleteRepoProfile = (projectKey: string): boolean => {
    assertDatabaseWritable(context);
    const trimmed = projectKey.trim();
    if (!trimmed) return false;
    const result = context.db
      .prepare("DELETE FROM repo_profiles WHERE project_key = @projectKey")
      .run({ projectKey: trimmed });
    return result.changes > 0;
  };

  return {
    listRepoIntelligence,
    getRepoIntelligenceEntry,
    upsertRepoIntelligence,
    seedBuiltinRepoIntelligence,
    setRepoIntelligenceApproval,
    listValidationProfiles,
    getValidationProfile,
    upsertValidationProfile,
    seedBuiltinValidationProfiles,
    deleteValidationProfile,
    recordValidationProfileObservedRuntime,
    listProofRules,
    getProofRule,
    upsertProofRule,
    seedBuiltinProofRules,
    deleteProofRule,
    getProofDecision,
    upsertProofDecision,
    getRepoProfile,
    listRepoProfiles,
    upsertRepoProfile,
    deleteRepoProfile,
  };
};
