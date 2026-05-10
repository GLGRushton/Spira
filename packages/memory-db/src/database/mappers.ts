import {
  TICKET_RUN_MISSION_PROOF_ARTIFACT_MODES,
  TICKET_RUN_MISSION_PROOF_LEVELS,
  TICKET_RUN_PROOF_STATUSES,
  normalizeMcpToolAccessPolicy,
} from "@spira/shared";
import type {
  PermissionRequestPayload,
  SubagentRunSnapshot,
  TicketRunAttemptSummary,
  TicketRunMissionClassification,
  TicketRunMissionPlan,
  TicketRunMissionProofArtifactMode,
  TicketRunMissionProofLevel,
  TicketRunMissionProofStrategy,
  TicketRunMissionSummary,
  TicketRunMissionValidationRecord,
  TicketRunPreviousPassContext,
  TicketRunProofArtifact,
  TicketRunProofRunSummary,
  TicketRunProofStatus,
  TicketRunProofSummary,
  TicketRunSubmoduleParentRef,
  TicketRunSubmoduleSummary,
  TicketRunSummary,
  TicketRunWorktreeSummary,
} from "@spira/shared";
import {
  assertMcpServerSource,
  assertRepoIntelligenceEntrySource,
  assertRepoIntelligenceEntryType,
  assertRuntimeHostResourceStatus,
  assertRuntimePermissionRequestStatus,
  assertSubagentSource,
  assertTicketRunAttemptStatus,
  assertTicketRunCleanupState,
  assertTicketRunMissionClassificationKind,
  assertTicketRunMissionPhase,
  assertTicketRunMissionProofArtifactMode,
  assertTicketRunMissionProofLevel,
  assertTicketRunMissionProofPreflightStatus,
  assertTicketRunMissionValidationKind,
  assertTicketRunMissionValidationStatus,
  assertTicketRunProofArtifactKind,
  assertTicketRunProofRunStatus,
  assertTicketRunProofStatus,
  assertTicketRunStatus,
  assertValidationProfileKind,
  isRecord,
  normalizeModelProviderId,
  parseStringArray,
  serializeJson,
  toBoolean,
  tryParseJson,
} from "./helpers.js";
import type {
  McpServerConfigRow,
  MissionEventRow,
  ProofDecisionRow,
  ProofRuleRow,
  ProviderUsageRecordRow,
  RepoIntelligenceRow,
  RuntimeCheckpointRow,
  RuntimeHostResourceRow,
  RuntimeLedgerEventRow,
  RuntimePermissionRequestRow,
  RuntimeSessionRow,
  RuntimeSubagentRunRow,
  SubagentConfigRow,
  TicketRunAttemptRow,
  TicketRunProofRunRow,
  TicketRunProofStrategyRow,
  TicketRunRow,
  TicketRunSubmoduleParentRow,
  TicketRunSubmoduleRow,
  TicketRunValidationRow,
  TicketRunWorktreeRow,
  ValidationProfileRow,
  RepoProfileRow,
} from "./rows.js";
import type {
  McpServerConfigRecord,
  MissionEventRecord,
  PersistedProviderUsageRecord,
  PersistedRuntimeCheckpointRecord,
  PersistedRuntimeHostResourceRecord,
  PersistedRuntimeLedgerEventRecord,
  PersistedRuntimeSessionRecord,
  ProofDecisionRecord,
  ProofRuleRecord,
  RepoIntelligenceEntrySource,
  RepoIntelligenceRecord,
  RepoProfileRecord,
  RuntimePermissionRequestRecord,
  RuntimeSubagentRunRecord,
  SubagentConfigRecord,
  ValidationProfileRecord,
} from "./types.js";
import { REPO_INTELLIGENCE_ENTRY_SOURCES } from "./types.js";

export const mapRuntimePermissionRequestRow = (row: RuntimePermissionRequestRow): RuntimePermissionRequestRecord => {
  assertRuntimePermissionRequestStatus(row.status);
  const payload = tryParseJson(row.payloadJson);
  if (!isRecord(payload)) {
    throw new Error(`Stored runtime permission request ${row.requestId} has invalid payload JSON`);
  }
  return {
    requestId: String(row.requestId),
    stationId: row.stationId === null ? null : String(row.stationId),
    payload: payload as unknown as PermissionRequestPayload,
    status: row.status,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    resolvedAt: row.resolvedAt === null ? null : Number(row.resolvedAt),
  };
};

export const mapRuntimeSubagentRunRow = (row: RuntimeSubagentRunRow): RuntimeSubagentRunRecord => {
  const snapshot = tryParseJson(row.snapshotJson);
  if (!isRecord(snapshot)) {
    throw new Error(`Stored runtime subagent run ${row.runId} has invalid snapshot JSON`);
  }
  return {
    runId: String(row.runId),
    stationId: row.stationId === null ? null : String(row.stationId),
    snapshot: snapshot as unknown as SubagentRunSnapshot,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
    expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
  };
};

export const mapRuntimeSessionRow = (row: RuntimeSessionRow): PersistedRuntimeSessionRecord => {
  const contract = tryParseJson(row.contractJson);
  if (!isRecord(contract)) {
    throw new Error(`Stored runtime session ${row.runtimeSessionId} has invalid contract JSON`);
  }
  return {
    runtimeSessionId: String(row.runtimeSessionId),
    stationId: row.stationId === null ? null : String(row.stationId),
    runId: row.runId === null ? null : String(row.runId),
    kind: row.kind === "subagent" || row.kind === "background" ? row.kind : "station",
    contract,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

export const mapRuntimeCheckpointRow = (row: RuntimeCheckpointRow): PersistedRuntimeCheckpointRecord => {
  const payload = tryParseJson(row.payloadJson);
  if (!isRecord(payload)) {
    throw new Error(`Stored runtime checkpoint ${row.checkpointId} has invalid payload JSON`);
  }
  return {
    checkpointId: String(row.checkpointId),
    runtimeSessionId: String(row.runtimeSessionId),
    stationId: row.stationId === null ? null : String(row.stationId),
    runId: row.runId === null ? null : String(row.runId),
    kind: String(row.kind),
    summary: String(row.summary),
    payload,
    createdAt: Number(row.createdAt),
  };
};

export const mapRuntimeLedgerEventRow = (row: RuntimeLedgerEventRow): PersistedRuntimeLedgerEventRecord => {
  const payload = tryParseJson(row.payloadJson);
  if (!isRecord(payload)) {
    throw new Error(`Stored runtime ledger event ${row.eventId} has invalid payload JSON`);
  }
  return {
    id: Number(row.id),
    eventId: String(row.eventId),
    runtimeSessionId: String(row.runtimeSessionId),
    stationId: row.stationId === null ? null : String(row.stationId),
    runId: row.runId === null ? null : String(row.runId),
    type: String(row.type),
    payload,
    occurredAt: Number(row.occurredAt),
  };
};

export const mapRuntimeHostResourceRow = (row: RuntimeHostResourceRow): PersistedRuntimeHostResourceRecord => {
  assertRuntimeHostResourceStatus(row.status);
  const state = tryParseJson(row.stateJson);
  if (!isRecord(state)) {
    throw new Error(`Stored runtime host resource ${row.resourceId} has invalid state JSON`);
  }
  return {
    resourceId: String(row.resourceId),
    runtimeSessionId: String(row.runtimeSessionId),
    stationId: row.stationId === null ? null : String(row.stationId),
    kind: String(row.kind),
    status: row.status,
    state,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

export const mapProviderUsageRecordRow = (row: ProviderUsageRecordRow): PersistedProviderUsageRecord => ({
  id: Number(row.id),
  provider: normalizeModelProviderId(row.provider) ?? "copilot",
  stationId: row.stationId === null ? null : String(row.stationId),
  runId: row.runId === null ? null : String(row.runId),
  sessionId: row.sessionId === null ? null : String(row.sessionId),
  model: row.model === null ? null : String(row.model),
  inputTokens: row.inputTokens === null ? null : Number(row.inputTokens),
  outputTokens: row.outputTokens === null ? null : Number(row.outputTokens),
  totalTokens: row.totalTokens === null ? null : Number(row.totalTokens),
  estimatedCostUsd: row.estimatedCostUsd === null ? null : Number(row.estimatedCostUsd),
  latencyMs: row.latencyMs === null ? null : Number(row.latencyMs),
  observedAt: Number(row.observedAt),
  source: row.source === "provider" || row.source === "estimated" ? row.source : "unknown",
});

export const mapMcpServerConfigRow = (row: McpServerConfigRow): McpServerConfigRecord => {
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

export const mapSubagentConfigRow = (row: SubagentConfigRow): SubagentConfigRecord => {
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

export const mapRepoIntelligenceRow = (row: RepoIntelligenceRow): RepoIntelligenceRecord => {
  assertRepoIntelligenceEntryType(row.type);
  assertRepoIntelligenceEntrySource(row.source);
  return {
    id: String(row.id),
    projectKey: row.projectKey === null ? null : String(row.projectKey),
    repoRelativePath: row.repoRelativePath === null ? null : String(row.repoRelativePath),
    type: row.type,
    title: String(row.title),
    content: String(row.content),
    tags: parseStringArray(row.tagsJson),
    source: row.source,
    approved: toBoolean(row.approved),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

export const mapValidationProfileRow = (row: ValidationProfileRow): ValidationProfileRecord => {
  assertValidationProfileKind(row.kind);
  assertMcpServerSource(row.source);
  return {
    id: String(row.id),
    projectKey: row.projectKey === null ? null : String(row.projectKey),
    repoRelativePath: row.repoRelativePath === null ? null : String(row.repoRelativePath),
    label: String(row.label),
    kind: row.kind,
    command: String(row.command),
    workingDirectory: String(row.workingDirectory),
    notes: row.notes === null ? null : String(row.notes),
    confidence: Number(row.confidence),
    expectedRuntimeMs: row.expectedRuntimeMs === null ? null : Number(row.expectedRuntimeMs),
    lastObservedRuntimeMs:
      row.lastObservedRuntimeMs === null || row.lastObservedRuntimeMs === undefined
        ? null
        : Number(row.lastObservedRuntimeMs),
    prerequisites: parseStringArray(row.prerequisitesJson),
    source: row.source,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

// repo profiles share the source vocabulary with repo_intelligence_entries.
function assertRepoProfileSource(value: string): asserts value is RepoIntelligenceEntrySource {
  if (!REPO_INTELLIGENCE_ENTRY_SOURCES.includes(value as RepoIntelligenceEntrySource)) {
    throw new Error(`Unsupported repo profile source: ${value}`);
  }
}

export const mapRepoProfileRow = (row: RepoProfileRow): RepoProfileRecord => {
  assertRepoProfileSource(row.source);
  return {
    projectKey: String(row.projectKey),
    displayName: String(row.displayName),
    description: row.description === null ? null : String(row.description),
    defaultBranch: row.defaultBranch === null ? null : String(row.defaultBranch),
    defaultBuildWorkingDirectory:
      row.defaultBuildWorkingDirectory === null ? null : String(row.defaultBuildWorkingDirectory),
    defaultRegistry: row.defaultRegistry === null ? null : String(row.defaultRegistry),
    registryHints: parseStringArray(row.registryHintsJson),
    requiredEnvVars: parseStringArray(row.requiredEnvVarsJson),
    requiredSdks: parseStringArray(row.requiredSdksJson),
    userFacingCopyGlobs: parseStringArray(row.userFacingCopyGlobsJson),
    uiTestGlobs: parseStringArray(row.uiTestGlobsJson),
    notes: row.notes === null ? null : String(row.notes),
    source: row.source,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

export const mapProofRuleRow = (row: ProofRuleRow): ProofRuleRecord => {
  if (row.classificationKind !== null) {
    assertTicketRunMissionClassificationKind(row.classificationKind);
  }
  assertTicketRunMissionProofLevel(row.recommendedLevel);
  return {
    id: String(row.id),
    projectKey: row.projectKey === null ? null : String(row.projectKey),
    repoRelativePath: row.repoRelativePath === null ? null : String(row.repoRelativePath),
    classificationKind: row.classificationKind === null ? null : row.classificationKind,
    uiChange: row.uiChange === null ? null : toBoolean(row.uiChange),
    proofRequired: row.proofRequired === null ? null : toBoolean(row.proofRequired),
    summaryKeywords: parseStringArray(row.summaryKeywordsJson),
    recommendedLevel: row.recommendedLevel,
    rationale: String(row.rationale),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

export const mapProofDecisionRow = (row: ProofDecisionRow): ProofDecisionRecord => {
  if (row.recommendedLevel !== null) {
    assertTicketRunMissionProofLevel(row.recommendedLevel);
  }
  if (row.preflightStatus !== null) {
    assertTicketRunMissionProofPreflightStatus(row.preflightStatus);
  }
  return {
    runId: String(row.runId),
    attemptId: row.attemptId === null ? null : String(row.attemptId),
    recommendedLevel: row.recommendedLevel === null ? null : row.recommendedLevel,
    preflightStatus: row.preflightStatus === null ? null : row.preflightStatus,
    rationale: row.rationale === null ? null : String(row.rationale),
    evidence: parseStringArray(row.evidenceJson),
    repoRelativePaths: parseStringArray(row.repoRelativePathsJson),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

export const mapMissionEventRow = (row: MissionEventRow): MissionEventRecord => {
  const metadata = tryParseJson(row.metadataJson);
  return {
    id: Number(row.id),
    runId: String(row.runId),
    attemptId: row.attemptId === null ? null : String(row.attemptId),
    stage: String(row.stage),
    eventType: String(row.eventType),
    metadata: isRecord(metadata) ? metadata : null,
    occurredAt: Number(row.occurredAt),
  };
};

export const mapTicketRunWorktreeRow = (row: TicketRunWorktreeRow): TicketRunWorktreeSummary => {
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

export const mapTicketRunAttemptRow = (row: TicketRunAttemptRow): TicketRunAttemptSummary => {
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

export const mapTicketRunProofSummary = (row: TicketRunRow): TicketRunProofSummary => {
  assertTicketRunProofStatus(row.proofStatus);
  return {
    status: row.proofStatus,
    lastProofRunId: row.lastProofRunId === null ? null : String(row.lastProofRunId),
    lastProofProfileId: row.lastProofProfileId === null ? null : String(row.lastProofProfileId),
    lastProofAt: row.lastProofAt === null ? null : Number(row.lastProofAt),
    lastProofSummary: row.lastProofSummary === null ? null : String(row.lastProofSummary),
    staleReason: row.proofStaleReason === null ? null : String(row.proofStaleReason),
    manualReviewJustification:
      row.proofManualReviewJustification === null || row.proofManualReviewJustification === undefined
        ? null
        : String(row.proofManualReviewJustification),
    manualReviewAt:
      row.proofManualReviewAt === null || row.proofManualReviewAt === undefined
        ? null
        : Number(row.proofManualReviewAt),
  };
};

export const mapTicketRunMissionClassification = (value: unknown): TicketRunMissionClassification | null => {
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
    advisoryProofLevel:
      typeof value.advisoryProofLevel === "string" &&
      TICKET_RUN_MISSION_PROOF_LEVELS.includes(value.advisoryProofLevel as TicketRunMissionProofLevel)
        ? (value.advisoryProofLevel as TicketRunMissionProofLevel)
        : null,
    advisoryProofRationale: typeof value.advisoryProofRationale === "string" ? value.advisoryProofRationale : null,
    rationale: typeof value.rationale === "string" ? value.rationale : null,
    createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
};

export const mapTicketRunMissionPlan = (value: unknown): TicketRunMissionPlan | null => {
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

export const mapTicketRunMissionSummary = (value: unknown): TicketRunMissionSummary | null => {
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

export const mapTicketRunPreviousPassContext = (value: unknown): TicketRunPreviousPassContext | null => {
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
        manualReviewJustification:
          typeof value.proof.manualReviewJustification === "string" ? value.proof.manualReviewJustification : null,
        manualReviewAt: typeof value.proof.manualReviewAt === "number" ? value.proof.manualReviewAt : null,
      }
    : {
        status: "not-run" as const,
        lastProofRunId: null,
        lastProofProfileId: null,
        lastProofAt: null,
        lastProofSummary: null,
        staleReason: null,
        manualReviewJustification: null,
        manualReviewAt: null,
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

export const mapTicketRunProofArtifact = (value: unknown): TicketRunProofArtifact | null => {
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

export const mapTicketRunProofRunRow = (row: TicketRunProofRunRow): TicketRunProofRunSummary => {
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

export const mapTicketRunValidationRow = (row: TicketRunValidationRow): TicketRunMissionValidationRecord => {
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
    supersedesValidationIds: parseStringArray(row.supersedesValidationIdsJson),
    status: row.status,
    summary: row.summary === null ? null : String(row.summary),
    artifacts,
    startedAt: Number(row.startedAt),
    completedAt: row.completedAt === null ? null : Number(row.completedAt),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
};

export const mapTicketRunProofStrategyRow = (row: TicketRunProofStrategyRow): TicketRunMissionProofStrategy => {
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

export const mapTicketRunSubmoduleParentRow = (row: TicketRunSubmoduleParentRow): TicketRunSubmoduleParentRef => ({
  parentRepoRelativePath: String(row.parentRepoRelativePath),
  submodulePath: String(row.submodulePath),
  submoduleWorktreePath: String(row.submoduleWorktreePath),
});

export const mapTicketRunSubmoduleRow = (
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

export const mapTicketRunRow = (
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
