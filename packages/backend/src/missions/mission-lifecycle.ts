import type { SpiraMemoryDatabase } from "@spira/memory-db";
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
    const latestAttemptSummary =
      [...nextRun.attempts]
        .reverse()
        .find((attempt) => typeof attempt.summary === "string" && attempt.summary.trim().length > 0)?.summary ?? null;
    return {
      run: nextRun,
      availableProofs,
      latestAttemptSummary,
      previousPassContext: nextRun.previousPassContext,
      workflow: getMissionWorkflowState(nextRun),
    };
  }

  saveClassification(runId: string, classification: TicketRunMissionClassification): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-classification");
    const now = Date.now();
    return this.persistRun({
      ...run,
      classification,
      missionPhase: "plan",
      missionPhaseUpdatedAt: now,
    });
  }

  savePlan(runId: string, plan: TicketRunMissionPlan): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-plan");
    const now = Date.now();
    return this.persistRun({
      ...run,
      plan,
      missionPhase: "implement",
      missionPhaseUpdatedAt: now,
    });
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
    return this.persistRun({
      ...run,
      missionPhase: "validate",
      missionPhaseUpdatedAt: Date.now(),
      validations,
    });
  }

  setProofStrategy(runId: string, proofStrategy: TicketRunMissionProofStrategy): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-proof-strategy");
    return this.persistRun({
      ...run,
      missionPhase: "proof",
      missionPhaseUpdatedAt: Date.now(),
      proofStrategy,
    });
  }

  recordProofResult(runId: string, result: MissionProofResultInput): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "record-proof-result");
    const proofRuns = result.proofRun
      ? [...run.proofRuns.filter((entry) => entry.proofRunId !== result.proofRun?.proofRunId), result.proofRun].sort(
          (left, right) => right.startedAt - left.startedAt,
        )
      : run.proofRuns;
    return this.persistRun({
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
  }

  saveSummary(runId: string, missionSummary: TicketRunMissionSummary): TicketRunSummary {
    const run = this.requireRun(runId);
    assertMissionWorkflowActionAllowed(run, "save-summary");
    return this.persistRun({
      ...run,
      missionPhase: "summarize",
      missionPhaseUpdatedAt: Date.now(),
      missionSummary,
    });
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
}
