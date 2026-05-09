import type { TicketRunSnapshot, TicketRunSubmoduleParentRef, TicketRunSummary } from "@spira/shared";
import { isMissionEventType } from "@spira/shared";
import { type DatabasePersistenceContext, assertDatabaseWritable } from "./context.js";
import {
  assertTicketRunAttemptStatus,
  assertTicketRunCleanupState,
  assertTicketRunMissionClassificationKind,
  assertTicketRunMissionPhase,
  assertTicketRunMissionProofArtifactMode,
  assertTicketRunMissionProofLevel,
  assertTicketRunMissionValidationKind,
  assertTicketRunMissionValidationStatus,
  assertTicketRunProofArtifactKind,
  assertTicketRunProofRunStatus,
  assertTicketRunProofStatus,
  assertTicketRunStatus,
  normalizeStringArray,
  normalizeTicketRunSubmoduleParentRefs,
  normalizeTitle,
  serializeJson,
} from "./helpers.js";
import {
  mapMissionEventRow,
  mapTicketRunAttemptRow,
  mapTicketRunProofRunRow,
  mapTicketRunProofStrategyRow,
  mapTicketRunRow,
  mapTicketRunSubmoduleParentRow,
  mapTicketRunSubmoduleRow,
  mapTicketRunValidationRow,
  mapTicketRunWorktreeRow,
} from "./mappers.js";
import type {
  MissionEventRow,
  TicketRunAttemptRow,
  TicketRunProofRunRow,
  TicketRunProofStrategyRow,
  TicketRunRow,
  TicketRunSubmoduleParentRow,
  TicketRunSubmoduleRow,
  TicketRunValidationRow,
  TicketRunWorktreeRow,
} from "./rows.js";
import type { AppendMissionEventInput, MissionEventRecord, UpsertTicketRunInput } from "./types.js";

export const createMissionPersistence = (context: DatabasePersistenceContext) => {
  const listTicketRuns = (): TicketRunSummary[] => {
    const runRows = context.db
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

    const worktreeRows = context.db
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

    const worktreesByRun = new Map<string, ReturnType<typeof mapTicketRunWorktreeRow>[]>();
    for (const row of worktreeRows) {
      const worktrees = worktreesByRun.get(row.runId) ?? [];
      worktrees.push(mapTicketRunWorktreeRow(row));
      worktreesByRun.set(row.runId, worktrees);
    }

    const attemptRows = context.db
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

    const attemptsByRun = new Map<string, ReturnType<typeof mapTicketRunAttemptRow>[]>();
    for (const row of attemptRows) {
      const attempts = attemptsByRun.get(row.runId) ?? [];
      attempts.push(mapTicketRunAttemptRow(row));
      attemptsByRun.set(row.runId, attempts);
    }

    const validationRows = context.db
      .prepare(
        `SELECT
           validation_id AS validationId,
           run_id AS runId,
           kind,
           command,
           cwd,
           supersedes_validation_ids_json AS supersedesValidationIdsJson,
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

    const validationsByRun = new Map<string, ReturnType<typeof mapTicketRunValidationRow>[]>();
    for (const row of validationRows) {
      const validations = validationsByRun.get(row.runId) ?? [];
      validations.push(mapTicketRunValidationRow(row));
      validationsByRun.set(row.runId, validations);
    }

    const proofStrategyRows = context.db
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

    const proofStrategyByRun = new Map<string, ReturnType<typeof mapTicketRunProofStrategyRow>>();
    for (const row of proofStrategyRows) {
      proofStrategyByRun.set(row.runId, mapTicketRunProofStrategyRow(row));
    }

    const proofRunRows = context.db
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

    const proofRunsByRun = new Map<string, ReturnType<typeof mapTicketRunProofRunRow>[]>();
    for (const row of proofRunRows) {
      const proofRuns = proofRunsByRun.get(row.runId) ?? [];
      proofRuns.push(mapTicketRunProofRunRow(row));
      proofRunsByRun.set(row.runId, proofRuns);
    }

    const submoduleRows = context.db
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

    const submoduleParentRows = context.db
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

    const submodulesByRun = new Map<string, ReturnType<typeof mapTicketRunSubmoduleRow>[]>();
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
  };

  const getTicketRun = (runId: string): TicketRunSummary | null => {
    const row = context.db
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

    const worktrees = context.db
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

    const attempts = context.db
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

    const validations = context.db
      .prepare(
        `SELECT
           validation_id AS validationId,
           run_id AS runId,
           kind,
           command,
           cwd,
           supersedes_validation_ids_json AS supersedesValidationIdsJson,
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

    const proofStrategy = context.db
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

    const proofRuns = context.db
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

    const submodules = context.db
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

    const submoduleParents = context.db
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
  };

  const getTicketRunByTicketId = (ticketId: string): TicketRunSummary | null => {
    const row = context.db
      .prepare(
        `SELECT
            run_id AS runId
          FROM ticket_runs
         WHERE ticket_id = @ticketId`,
      )
      .get({ ticketId }) as { runId: string } | undefined;

    return row ? getTicketRun(String(row.runId)) : null;
  };

  const deleteTicketRun = (runId: string): boolean => {
    assertDatabaseWritable(context);
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      throw new Error("Ticket runs require a non-empty run id to delete.");
    }

    return (
      context.db
        .prepare(
          `DELETE FROM ticket_runs
           WHERE run_id = @runId`,
        )
        .run({ runId: normalizedRunId }).changes > 0
    );
  };

  const appendMissionEvent = (input: AppendMissionEventInput): MissionEventRecord => {
    assertDatabaseWritable(context);
    const runId = input.runId.trim();
    const stage = input.stage.trim();
    const eventType = input.eventType.trim();
    if (!runId || !stage || !eventType) {
      throw new Error("Mission events require non-empty runId, stage, and eventType values.");
    }
    if (!isMissionEventType(eventType)) {
      throw new Error(
        `Unknown mission event type "${eventType}". Add it to MISSION_EVENT_TYPES in @spira/shared/src/mission-events.ts.`,
      );
    }

    const result = context.db
      .prepare(
        `INSERT INTO mission_events (
           run_id,
           attempt_id,
           stage,
           event_type,
           metadata_json,
           occurred_at
         ) VALUES (
           @runId,
           @attemptId,
           @stage,
           @eventType,
           @metadataJson,
           @occurredAt
         )`,
      )
      .run({
        runId,
        attemptId: normalizeTitle(input.attemptId),
        stage,
        eventType,
        metadataJson: serializeJson(input.metadata ?? null),
        occurredAt: input.occurredAt ?? Date.now(),
      });

    const row = context.db
      .prepare(
        `SELECT
           id,
           run_id AS runId,
           attempt_id AS attemptId,
           stage,
           event_type AS eventType,
           metadata_json AS metadataJson,
           occurred_at AS occurredAt
         FROM mission_events
         WHERE id = @id`,
      )
      .get({ id: result.lastInsertRowid }) as MissionEventRow | undefined;

    if (!row) {
      throw new Error(`Failed to load mission event for ${runId}.`);
    }

    return mapMissionEventRow(row);
  };

  const listMissionEvents = (runId: string, limit = 50): MissionEventRecord[] => {
    const rows = context.db
      .prepare(
        `SELECT
           id,
           run_id AS runId,
           attempt_id AS attemptId,
           stage,
           event_type AS eventType,
           metadata_json AS metadataJson,
           occurred_at AS occurredAt
         FROM mission_events
         WHERE run_id = @runId
         ORDER BY occurred_at DESC, id DESC
         LIMIT @limit`,
      )
      .all({ runId, limit }) as unknown as MissionEventRow[];

    return rows.map((row) => mapMissionEventRow(row));
  };

  const upsertTicketRun = (input: UpsertTicketRunInput): TicketRunSummary => {
    assertDatabaseWritable(context);
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
      const submoduleCommitMessageDraft = normalizeTitle(submodule.commitMessageDraft);
      const parentRefs = normalizeTicketRunSubmoduleParentRefs(submodule.parentRefs);
      if (!canonicalUrl || !name || !branchName || parentRefs.length === 0) {
        throw new Error("Ticket run submodules require a canonical URL, name, branch name, and parent refs.");
      }

      return {
        canonicalUrl,
        name,
        branchName,
        commitMessageDraft: submoduleCommitMessageDraft,
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
          advisoryProofLevel:
            typeof input.classification.advisoryProofLevel === "string"
              ? input.classification.advisoryProofLevel
              : null,
          advisoryProofRationale: normalizeTitle(input.classification.advisoryProofRationale),
          rationale: normalizeTitle(input.classification.rationale),
          createdAt: input.classification.createdAt ?? now,
          updatedAt: input.classification.updatedAt ?? now,
        }
      : null;
    if (normalizedClassification) {
      assertTicketRunMissionClassificationKind(normalizedClassification.kind);
      assertTicketRunMissionProofArtifactMode(normalizedClassification.proofArtifactMode);
      if (normalizedClassification.advisoryProofLevel !== null) {
        assertTicketRunMissionProofLevel(normalizedClassification.advisoryProofLevel);
      }
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
        supersedesValidationIds: [
          ...new Set(
            (validation.supersedesValidationIds ?? [])
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0 && entry !== validationId),
          ),
        ],
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

    const replace = context.db.transaction(() => {
      context.db
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

      context.db.prepare("DELETE FROM ticket_run_worktrees WHERE run_id = @runId").run({ runId });
      const insertWorktree = context.db.prepare(
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
        insertWorktree.run({ runId, ...worktree });
      }

      context.db.prepare("DELETE FROM ticket_run_submodules WHERE run_id = @runId").run({ runId });
      const insertSubmodule = context.db.prepare(
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
      const insertSubmoduleParent = context.db.prepare(
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
          insertSubmoduleParent.run({ runId, canonicalUrl: submodule.canonicalUrl, ...parentRef });
        }
      }

      context.db.prepare("DELETE FROM ticket_run_attempts WHERE run_id = @runId").run({ runId });
      context.db.prepare("DELETE FROM ticket_run_validations WHERE run_id = @runId").run({ runId });
      context.db.prepare("DELETE FROM ticket_run_proof_strategy WHERE run_id = @runId").run({ runId });

      const insertAttempt = context.db.prepare(
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
        insertAttempt.run({ runId, ...attempt });
      }

      const insertValidation = context.db.prepare(
        `INSERT INTO ticket_run_validations (
           validation_id,
           run_id,
           kind,
           command,
           cwd,
           supersedes_validation_ids_json,
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
           @supersedesValidationIdsJson,
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
          supersedesValidationIdsJson: serializeJson(validation.supersedesValidationIds),
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
        context.db
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

      context.db.prepare("DELETE FROM ticket_run_proof_runs WHERE run_id = @runId").run({ runId });
      const insertProofRun = context.db.prepare(
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
    const record = getTicketRun(runId);
    if (!record) {
      throw new Error(`Failed to persist ticket run ${runId}.`);
    }
    return record;
  };

  const getTicketRunSnapshot = (): TicketRunSnapshot => ({
    runs: listTicketRuns(),
  });

  return {
    appendMissionEvent,
    listMissionEvents,
    listTicketRuns,
    getTicketRun,
    getTicketRunByTicketId,
    deleteTicketRun,
    upsertTicketRun,
    getTicketRunSnapshot,
  };
};
