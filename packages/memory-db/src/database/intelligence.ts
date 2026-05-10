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
  assertValidationProfileScope,
  assertValidationProfileSource,
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
      source?: RepoIntelligenceRecord["source"];
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
    const params: Record<string, unknown> = { ...scopedFilter.params };
    const extraClauses: string[] = [];
    if (!includeUnapproved) extraClauses.push("approved = 1");
    if (options.source) {
      extraClauses.push("source = @source");
      params.source = options.source;
    }
    const whereClause = scopedFilter.whereClause
      ? extraClauses.length > 0
        ? `${scopedFilter.whereClause} AND ${extraClauses.join(" AND ")}`
        : scopedFilter.whereClause
      : extraClauses.length > 0
        ? `WHERE ${extraClauses.join(" AND ")}`
        : "";
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
     ${whereClause}
     ORDER BY approved DESC, updated_at DESC, created_at DESC`;

    const rows = context.db.prepare(sql).all(params) as unknown as RepoIntelligenceRow[];

    return rows
      .map((row) => mapRepoIntelligenceRow(row))
      .filter(
        (entry) =>
          // SQL filters by project/repo/approved/source; this final pass enforces tags
          // and the matchesScopedRecord semantics for any edge case SQL doesn't cover.
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

  const VALIDATION_PROFILE_SELECT = `SELECT
       id,
       project_key AS projectKey,
       repo_relative_path AS repoRelativePath,
       scope,
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
     FROM validation_profiles`;

  const getValidationProfile = (profileId: string): ValidationProfileRecord | null => {
    const row = context.db
      .prepare(`${VALIDATION_PROFILE_SELECT} WHERE id = @profileId`)
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
    const sql = `${VALIDATION_PROFILE_SELECT}
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
    const projectKey = normalizeTitle(input.projectKey);
    // Default scope: `global` when projectKey is null (legacy NULL behaviour), `project` otherwise.
    const scope = input.scope ?? (projectKey === null ? "global" : "project");
    const payload = {
      id: input.id.trim(),
      projectKey,
      repoRelativePath: normalizeTitle(input.repoRelativePath),
      scope,
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
    assertValidationProfileSource(payload.source);
    assertValidationProfileScope(payload.scope);
    if (!payload.id || !payload.label || !payload.command || !payload.workingDirectory) {
      throw new Error("Validation profiles require non-empty id, label, command, and workingDirectory.");
    }

    context.db
      .prepare(
        `INSERT INTO validation_profiles (
           id,
           project_key,
           repo_relative_path,
           scope,
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
           @scope,
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
           scope = excluded.scope,
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
   * delete a single proof rule by id. Returns true if a row was removed.
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
   * delete a validation profile by id. Returns true if a row was removed.
   */
  const deleteValidationProfile = (profileId: string): boolean => {
    assertDatabaseWritable(context);
    const result = context.db
      .prepare("DELETE FROM validation_profiles WHERE id = @profileId")
      .run({ profileId });
    return result.changes > 0;
  };

  /**
   * record an observed runtime against a validation profile (e.g. from
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

  // ─── repo_profiles CRUD ────────────────────────────────────────────────
  // Keyed on (projectKey, repoRelativePath). Empty repoRelativePath ('') is the
  // project-wide default. Per-repo overrides layer on top.

  const REPO_PROFILE_SELECT = `SELECT
       project_key AS projectKey,
       repo_relative_path AS repoRelativePath,
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
       trust_learner_mode AS trustLearnerMode,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM repo_profiles`;

  /**
   * Fetch the row for an exact `(projectKey, repoRelativePath)` pair. Pass an empty string
   * (the default) to fetch the project-wide row. For the "all rows that apply to this run"
   * semantics, use `listRepoProfiles({ projectKey })` and filter in the caller.
   */
  const getRepoProfile = (
    projectKey: string,
    repoRelativePath: string = "",
  ): RepoProfileRecord | null => {
    const trimmedKey = projectKey.trim();
    if (!trimmedKey) return null;
    const trimmedPath = (repoRelativePath ?? "").trim();
    const row = context.db
      .prepare(
        `${REPO_PROFILE_SELECT} WHERE project_key = @projectKey AND repo_relative_path = @repoRelativePath`,
      )
      .get({ projectKey: trimmedKey, repoRelativePath: trimmedPath }) as RepoProfileRow | undefined;
    return row ? mapRepoProfileRow(row) : null;
  };

  const listRepoProfiles = (options: { limit?: number; projectKey?: string } = {}): RepoProfileRecord[] => {
    const limit = options.limit ?? 100;
    const projectKey = options.projectKey?.trim();
    const sql = projectKey
      ? `${REPO_PROFILE_SELECT} WHERE project_key = @projectKey ORDER BY repo_relative_path ASC LIMIT @limit`
      : `${REPO_PROFILE_SELECT} ORDER BY updated_at DESC, project_key ASC, repo_relative_path ASC LIMIT @limit`;
    const params = projectKey ? { projectKey, limit } : { limit };
    const rows = context.db.prepare(sql).all(params) as unknown as RepoProfileRow[];
    return rows.map((row) => mapRepoProfileRow(row));
  };

  const upsertRepoProfile = (input: UpsertRepoProfileInput): RepoProfileRecord => {
    assertDatabaseWritable(context);
    const projectKey = input.projectKey.trim();
    const repoRelativePath = (input.repoRelativePath ?? "").trim();
    const displayName = input.displayName.trim();
    if (!projectKey || !displayName) {
      throw new Error("Repo profiles require non-empty projectKey and displayName.");
    }
    const source = input.source ?? "user";
    if (source !== "builtin" && source !== "user" && source !== "learned") {
      throw new Error(`Unsupported repo profile source: ${source}`);
    }
    const now = input.createdAt ?? Date.now();
    const existing = getRepoProfile(projectKey, repoRelativePath);
    // Trust mode preserves the existing value when omitted on edit; defaults to manual-review for new rows.
    const trustLearnerMode = input.trustLearnerMode ?? existing?.trustLearnerMode ?? "manual-review";
    const payload = {
      projectKey,
      repoRelativePath,
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
      trustLearnerMode,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    context.db
      .prepare(
        `INSERT INTO repo_profiles (
           project_key,
           repo_relative_path,
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
           trust_learner_mode,
           created_at,
           updated_at
         ) VALUES (
           @projectKey,
           @repoRelativePath,
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
           @trustLearnerMode,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(project_key, repo_relative_path) DO UPDATE SET
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
           trust_learner_mode = excluded.trust_learner_mode,
           updated_at = excluded.updated_at`,
      )
      .run(payload);

    const saved = getRepoProfile(projectKey, repoRelativePath);
    if (!saved) {
      throw new Error(`Failed to load repo profile ${projectKey}/${repoRelativePath || "(default)"}.`);
    }
    return saved;
  };

  const deleteRepoProfile = (projectKey: string, repoRelativePath: string = ""): boolean => {
    assertDatabaseWritable(context);
    const trimmedKey = projectKey.trim();
    if (!trimmedKey) return false;
    const trimmedPath = (repoRelativePath ?? "").trim();
    const result = context.db
      .prepare(
        "DELETE FROM repo_profiles WHERE project_key = @projectKey AND repo_relative_path = @repoRelativePath",
      )
      .run({ projectKey: trimmedKey, repoRelativePath: trimmedPath });
    return result.changes > 0;
  };

  /**
   * bulk-upsert builtin repo profiles. Skips overwriting an existing user
   * profile for the same projectKey: the seed only fires when the row is missing or its
   * source is already "builtin" (so a re-seed across upgrades doesn't trample operator edits).
   *
   * Uses a single SELECT IN(...) to pre-fetch every projectKey we're about to consider,
   * so the per-item N+1 collapses to one query before the transaction starts.
   */
  const seedBuiltinRepoProfiles = (
    profiles: readonly Omit<UpsertRepoProfileInput, "source">[],
  ): RepoProfileRecord[] => {
    assertDatabaseWritable(context);
    if (profiles.length === 0) return [];
    const seedKeys = profiles.map((profile) => ({
      projectKey: profile.projectKey.trim(),
      repoRelativePath: (profile.repoRelativePath ?? "").trim(),
    }));
    const distinctProjectKeys = [...new Set(seedKeys.map((entry) => entry.projectKey))].filter(
      (key) => key.length > 0,
    );
    const placeholders = distinctProjectKeys.map((_, index) => `@key${index}`).join(", ");
    const params: Record<string, string> = {};
    distinctProjectKeys.forEach((key, index) => {
      params[`key${index}`] = key;
    });
    const existingRows = distinctProjectKeys.length === 0
      ? []
      : (context.db
          .prepare(`${REPO_PROFILE_SELECT} WHERE project_key IN (${placeholders})`)
          .all(params) as unknown as RepoProfileRow[]);
    const compositeKey = (projectKey: string, repoRelativePath: string): string =>
      `${projectKey}\u0000${repoRelativePath}`;
    const existingByKey = new Map(
      existingRows.map((row) => {
        const record = mapRepoProfileRow(row);
        return [compositeKey(record.projectKey, record.repoRelativePath), record] as const;
      }),
    );
    const seedKeySet = new Set(
      seedKeys.map((entry) => compositeKey(entry.projectKey, entry.repoRelativePath)),
    );
    const seed = context.db.transaction((items: readonly Omit<UpsertRepoProfileInput, "source">[]) => {
      // Drop builtin rows that are no longer in the seed list. Without this, renames like
      // E.4's "Spira" → "SPI" leave orphans that double-count in any join on projectKey.
      // User-edited rows (source !== "builtin") are untouched. Compares on the composite
      // (projectKey, repoRelativePath) key so per-repo rows aren't accidentally dropped.
      const builtinRows = context.db
        .prepare(
          `SELECT project_key AS projectKey, repo_relative_path AS repoRelativePath
           FROM repo_profiles WHERE source = 'builtin'`,
        )
        .all() as Array<{ projectKey: string; repoRelativePath: string }>;
      const dropStatement = context.db.prepare(
        "DELETE FROM repo_profiles WHERE source = 'builtin' AND project_key = @projectKey AND repo_relative_path = @repoRelativePath",
      );
      for (const row of builtinRows) {
        if (!seedKeySet.has(compositeKey(row.projectKey, row.repoRelativePath))) {
          dropStatement.run(row);
        }
      }
      const results: RepoProfileRecord[] = [];
      for (const item of items) {
        const key = compositeKey(item.projectKey.trim(), (item.repoRelativePath ?? "").trim());
        const existing = existingByKey.get(key);
        if (existing && existing.source !== "builtin") {
          results.push(existing);
          continue;
        }
        results.push(upsertRepoProfile({ ...item, source: "builtin" }));
      }
      return results;
    });
    return seed(profiles);
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
    seedBuiltinRepoProfiles,
  };
};
