import type {
  ProofDecisionRecord,
  RepoIntelligenceRecord,
  SpiraMemoryDatabase,
  ValidationProfileRecord,
} from "@spira/memory-db";
import type {
  TicketRunMissionClassification,
  TicketRunMissionPhase,
  TicketRunMissionPlan,
  TicketRunPreviousPassContext,
  TicketRunMissionProofStrategy,
  TicketRunMissionSummary,
  TicketRunMissionValidationRecord,
  TicketRunProofRunSummary,
  TicketRunProofSnapshotResult,
  TicketRunProofStatus,
  TicketRunSummary,
} from "@spira/shared";
import type { SpiraEventBus } from "../util/event-bus.js";
import {
  assertMissionWorkflowActionAllowed,
  getMissionWorkflowState,
  type MissionWorkflowState,
} from "./mission-workflow-guard.js";
import {
  computeAdvisoryProofDecision,
  type MissionRepoGuidanceSnapshot,
  toPersistedProofDecisionInput,
} from "./mission-intelligence.js";

const buildRepoScopePaths = (run: TicketRunSummary): string[] =>
  Array.from(
    new Set(
      [
        ".",
        ...run.worktrees.map((worktree) => worktree.repoRelativePath),
        ...(run.classification?.impactedRepoRelativePaths ?? []),
        ...(run.plan?.touchedRepoRelativePaths ?? []),
        ...(run.missionSummary?.changedRepoRelativePaths ?? []),
        ...(run.proofStrategy?.repoRelativePath ? [run.proofStrategy.repoRelativePath] : []),
      ].filter((repoRelativePath): repoRelativePath is string => repoRelativePath.trim().length > 0),
    ),
  );

const toPersistedRunInput = (run: TicketRunSummary) => ({
  ...run,
  proofStrategy: run.proofStrategy
    ? {
        adapterId: run.proofStrategy.adapterId,
        repoRelativePath: run.proofStrategy.repoRelativePath,
        scenarioPath: run.proofStrategy.scenarioPath,
        scenarioName: run.proofStrategy.scenarioName,
        command: run.proofStrategy.command,
        artifactMode: run.proofStrategy.artifactMode,
        rationale: run.proofStrategy.rationale,
        metadata: run.proofStrategy.metadata,
        createdAt: run.proofStrategy.createdAt,
        updatedAt: run.proofStrategy.updatedAt,
      }
    : null,
});

export interface MissionProofResultInput {
  proof: {
    status: TicketRunProofStatus;
    lastProofRunId?: string | null;
    lastProofProfileId?: string | null;
    lastProofAt?: number | null;
    lastProofSummary?: string | null;
    staleReason?: string | null;
  };
  proofRun?: TicketRunProofRunSummary | null;
}

export interface MissionContextSnapshot {
  run: TicketRunSummary;
  availableProofs: TicketRunProofSnapshotResult["proofSnapshot"]["profiles"];
  latestAttemptSummary: string | null;
  previousPassContext: TicketRunPreviousPassContext | null;
  repoGuidance: MissionRepoGuidanceSnapshot;
  advisoryProofDecision: ProofDecisionRecord | null;
  workflow: MissionWorkflowState;
}

export class MissionLifecycleService {
  constructor(
    private readonly memoryDb: SpiraMemoryDatabase | null,
    private readonly bus?: SpiraEventBus,
    private readonly listMissionProofs?: (runId: string) => Promise<TicketRunProofSnapshotResult>,
  ) {}

  async getMissionContext(runId: string): Promise<MissionContextSnapshot> {
    const run = this.requireRun(runId);
    const availableProofs = this.listMissionProofs ? (await this.listMissionProofs(runId)).proofSnapshot.profiles : [];
    const nextRun = this.markContextLoaded(run);
    const repoGuidance = this.collectRepoGuidance(nextRun);
    const advisoryProofDecision = this.refreshAdvisoryProofDecision(nextRun, availableProofs);
    const latestAttemptSummary =
      [...nextRun.attempts]
        .reverse()
        .find((attempt) => typeof attempt.summary === "string" && attempt.summary.trim().length > 0)?.summary ?? null;
    this.recordMissionEvent(nextRun, nextRun.missionPhase, "context-loaded", {
      proofProfileCount: availableProofs.length,
      repoGuidanceCount: repoGuidance.entries.length,
      validationProfileCount: repoGuidance.validationProfiles.length,
      recommendedProofLevel: advisoryProofDecision?.recommendedLevel ?? null,
      preflightStatus: advisoryProofDecision?.preflightStatus ?? null,
    });
    return {
      run: nextRun,
      availableProofs,
      latestAttemptSummary,
      previousPassContext: nextRun.previousPassContext,
      repoGuidance,
      advisoryProofDecision,
      workflow: getMissionWorkflowState(nextRun),
    };
  }

  saveClassification(runId: string, classification: TicketRunMissionClassification): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-classification");
    const now = Date.now();
    const nextRun = this.persistRun({
      ...run,
      classification: {
        ...classification,
        advisoryProofLevel: null,
        advisoryProofRationale: null,
      },
      missionPhase: "plan",
      missionPhaseUpdatedAt: now,
    });
    this.recordMissionEvent(nextRun, "plan", "classification-saved", {
      proofRequired: classification.proofRequired,
      impactedRepoRelativePaths: classification.impactedRepoRelativePaths,
    });
    return nextRun;
  }

  savePlan(runId: string, plan: TicketRunMissionPlan): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-plan");
    const now = Date.now();
    const nextRun = this.persistRun({
      ...run,
      plan,
      missionPhase: "implement",
      missionPhaseUpdatedAt: now,
    });
    this.recordMissionEvent(nextRun, "implement", "plan-saved", {
      touchedRepoRelativePaths: plan.touchedRepoRelativePaths,
      validationStepCount: plan.validationPlan.length,
    });
    return nextRun;
  }

  setPhase(runId: string, phase: TicketRunMissionPhase): TicketRunSummary {
    const run = this.requireRun(runId);
    if (run.missionPhase === phase) {
      return run;
    }
    throw new Error(
      "Mission phase is backend-owned. Persist the matching lifecycle state instead of calling set_phase.",
    );
  }

  recordValidation(runId: string, validation: TicketRunMissionValidationRecord): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "record-validation");
    const validations = [
      ...run.validations.filter((entry) => entry.validationId !== validation.validationId),
      validation,
    ].sort((left, right) => right.startedAt - left.startedAt || right.createdAt - left.createdAt);
    const nextRun = this.persistRun({
      ...run,
      missionPhase: "validate",
      missionPhaseUpdatedAt: Date.now(),
      validations,
    });
    this.recordMissionEvent(nextRun, "validate", "validation-recorded", {
      validationId: validation.validationId,
      status: validation.status,
      kind: validation.kind,
      command: validation.command,
    });
    return nextRun;
  }

  setProofStrategy(runId: string, proofStrategy: TicketRunMissionProofStrategy): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-proof-strategy");
    const nextRun = this.persistRun({
      ...run,
      missionPhase: "proof",
      missionPhaseUpdatedAt: Date.now(),
      proofStrategy,
    });
    this.recordMissionEvent(nextRun, "proof", "proof-strategy-saved", {
      adapterId: proofStrategy.adapterId,
      repoRelativePath: proofStrategy.repoRelativePath,
    });
    return nextRun;
  }

  recordProofResult(runId: string, result: MissionProofResultInput): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "record-proof-result");
    const proofRuns = result.proofRun
      ? [...run.proofRuns.filter((entry) => entry.proofRunId !== result.proofRun?.proofRunId), result.proofRun].sort(
          (left, right) => right.startedAt - left.startedAt,
        )
      : run.proofRuns;
    const nextRun = this.persistRun({
      ...run,
      missionPhase: "proof",
      missionPhaseUpdatedAt: Date.now(),
      proof: {
        status: result.proof.status,
        lastProofRunId: result.proof.lastProofRunId ?? null,
        lastProofProfileId: result.proof.lastProofProfileId ?? null,
        lastProofAt: result.proof.lastProofAt ?? null,
        lastProofSummary: result.proof.lastProofSummary ?? null,
        staleReason: result.proof.staleReason ?? null,
      },
      proofRuns,
    });
    this.recordMissionEvent(nextRun, "proof", "proof-result-recorded", {
      status: result.proof.status,
      lastProofRunId: result.proof.lastProofRunId ?? null,
      lastProofProfileId: result.proof.lastProofProfileId ?? null,
    });
    return nextRun;
  }

  saveSummary(runId: string, missionSummary: TicketRunMissionSummary): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-summary");
    const nextRun = this.persistRun({
      ...run,
      missionPhase: "summarize",
      missionPhaseUpdatedAt: Date.now(),
      missionSummary,
    });
    this.recordMissionEvent(nextRun, "summarize", "summary-saved", {
      changedRepoRelativePaths: missionSummary.changedRepoRelativePaths,
    });
    return nextRun;
  }

  getWorkflowState(runId: string): MissionWorkflowState {
    return getMissionWorkflowState(this.requireRun(runId));
  }

  assertActionAllowed(runId: string, action: Parameters<typeof assertMissionWorkflowActionAllowed>[1]): void {
    assertMissionWorkflowActionAllowed(this.requireRun(runId), action);
  }

  private persistRun(run: TicketRunSummary): TicketRunSummary {
    if (!this.memoryDb) {
      throw new Error("Mission lifecycle persistence is unavailable.");
    }
    const nextRun = this.memoryDb.upsertTicketRun(toPersistedRunInput(run));
    this.bus?.emit("missions:runs-changed", this.memoryDb.getTicketRunSnapshot());
    return nextRun;
  }

  private requireRun(runId: string): TicketRunSummary {
    if (!this.memoryDb) {
      throw new Error("Mission lifecycle persistence is unavailable.");
    }
    const run = this.memoryDb.getTicketRun(runId);
    if (!run) {
      throw new Error(`No mission run found for ${runId}.`);
    }
    return run;
  }

  private markContextLoaded(run: TicketRunSummary): TicketRunSummary {
    const workflow = getMissionWorkflowState(run);
    if (workflow.kickoffComplete || run.status !== "working") {
      return run;
    }
    const currentAttempt = [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? null;
    const nextMissionPhaseUpdatedAt =
      currentAttempt && typeof currentAttempt.startedAt === "number"
        ? Math.max(Date.now(), currentAttempt.startedAt + 1)
        : Date.now();
    return this.persistRun({
      ...run,
      missionPhase: "classification",
      missionPhaseUpdatedAt: nextMissionPhaseUpdatedAt,
    });
  }

  private collectRepoGuidance(run: TicketRunSummary): MissionRepoGuidanceSnapshot {
    if (!this.memoryDb) {
      return {
        entries: [],
        validationProfiles: [],
      };
    }

    const repoRelativePaths = buildRepoScopePaths(run);
    const storedEntries = this.memoryDb.listRepoIntelligence({
      projectKey: run.projectKey,
      repoRelativePaths,
      limit: 6,
    });
    const entries =
      storedEntries.length > 0
        ? storedEntries
        : ([
            {
              id: `fallback:${run.runId}`,
              projectKey: run.projectKey,
              repoRelativePath: repoRelativePaths[0] ?? null,
              type: "briefing",
              title: "Mission workspace",
              content: `Mission scope currently includes: ${repoRelativePaths.length > 0 ? repoRelativePaths.join(", ") : "the managed worktrees"}.`,
              tags: ["mission", "fallback"],
              source: "builtin",
              approved: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            } satisfies RepoIntelligenceRecord,
          ] as RepoIntelligenceRecord[]);

    return {
      entries,
      validationProfiles: this.memoryDb.listValidationProfiles({
        projectKey: run.projectKey,
        repoRelativePaths,
        limit: 6,
      }),
    };
  }

  private refreshAdvisoryProofDecision(
    run: TicketRunSummary,
    availableProofs: TicketRunProofSnapshotResult["proofSnapshot"]["profiles"],
  ): ProofDecisionRecord | null {
    if (!this.memoryDb) {
      return null;
    }

    const decision = computeAdvisoryProofDecision({
      run,
      classification: run.classification,
      availableProofs,
      proofRules: this.memoryDb.listProofRules({
        projectKey: run.projectKey,
        repoRelativePaths: buildRepoScopePaths(run),
        limit: 10,
      }),
    });

    return this.memoryDb.upsertProofDecision(toPersistedProofDecisionInput(run, decision, run.classification));
  }

  private recordMissionEvent(
    run: TicketRunSummary,
    stage: TicketRunMissionPhase,
    eventType: string,
    metadata: Record<string, unknown>,
  ): void {
    if (!this.memoryDb) {
      return;
    }
    const currentAttempt = [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;
    this.memoryDb.appendMissionEvent({
      runId: run.runId,
      attemptId: currentAttempt?.attemptId ?? null,
      stage,
      eventType,
      metadata,
    });
  }
}
