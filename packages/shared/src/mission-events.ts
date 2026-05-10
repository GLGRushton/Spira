import type { TicketRunMissionPhase } from "./ticket-run-types.js";

/**
 * Stage label written to mission_events.stage. The "system" stage is for
 * cross-phase events (workspace prep, run closure, restart recovery, etc.).
 */
export type MissionEventStage = TicketRunMissionPhase | "system";

/**
 * Closed enumeration of every mission event type. New event types must be added
 * here AND given a metadata entry in MissionEventMetadataMap below; otherwise
 * recordMissionEvent() will fail to compile at the call site.
 *
 * Ordering follows the lifecycle (lifecycle events first, then attempt events,
 * then proof events, then system / cross-phase events, then live attempt-action
 * events introduced in Phase 1.1).
 */
export const MISSION_EVENT_TYPES = [
  // Lifecycle (mission-lifecycle.ts)
  "context-loaded",
  "classification-saved",
  "plan-saved",
  "validation-recorded",
  "proof-strategy-saved",
  "proof-result-recorded",
  "summary-saved",
  // Attempt orchestration (ticket-runs.ts)
  "attempt-started",
  "attempt-finished",
  "attempt-cancelled",
  "attempt-repair-requested",
  "attempt-recovered-after-restart",
  "mission-startup-recovered-after-restart",
  "mission-startup-timed-out",
  // Proof execution (ticket-runs.ts + proof runner)
  "proof-started",
  "proof-finished",
  // System / cross-phase (ticket-runs.ts)
  "workspace-prepared",
  "repo-intelligence-candidates-observed",
  "repo-intelligence-candidate-approved",
  "run-closed",
  // Live attempt telemetry (Phase 1.1)
  "attempt-action",
  "attempt-shell-command",
  "attempt-awaiting-permission",
  "attempt-permission-resolved",
  // Proof gate (Phase 2.1)
  "proof-set-manual-review-only",
  "proof-manual-review-cleared",
  // Proof preflight (Phase 2.2 / 2.3)
  "proof-preflight-started",
  "proof-preflight-finished",
  // Dependency warming (Phase 4.1)
  "workspace-dependencies-warming-started",
  "workspace-dependencies-warming-finished",
  // Learning loop (Phase 5)
  "mission-outcome-classified",
  "validation-profile-candidate-observed",
  "validation-profile-auto-promoted",
  "learned-candidate-promoted",
  "learned-candidate-revoked",
  // Polish (Phase 6)
  "validations-superseded",
  "mission-state-reconciled",
  "mission-aborted",
  // Visible-learning (Batch J–M)
  "repo-guidance-injected",
  "learned-candidate-skipped",
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

const MISSION_EVENT_TYPE_SET = new Set<string>(MISSION_EVENT_TYPES);

export const isMissionEventType = (value: string): value is MissionEventType => MISSION_EVENT_TYPE_SET.has(value);

export interface MissionEventMetadataMap {
  // Lifecycle
  "context-loaded": {
    proofProfileCount: number;
    repoGuidanceCount: number;
    validationProfileCount: number;
    recommendedProofLevel: string | null;
    preflightStatus: string | null;
  };
  "classification-saved": {
    proofRequired: boolean;
    impactedRepoRelativePaths: readonly string[];
  };
  "plan-saved": {
    touchedRepoRelativePaths: readonly string[];
    validationStepCount: number;
  };
  "validation-recorded": {
    validationId: string;
    status: string;
    kind: string;
    command: string;
  };
  "proof-strategy-saved": {
    adapterId: string;
    repoRelativePath: string;
  };
  "proof-result-recorded": {
    status: string;
    lastProofRunId: string | null;
    lastProofProfileId: string | null;
  };
  "summary-saved": {
    changedRepoRelativePaths: readonly string[];
  };
  // Attempt orchestration
  "attempt-started": {
    attemptId: string;
    sequence: number;
    reusedLiveAttempt: boolean;
    promptProvided: boolean;
  };
  "attempt-finished": {
    attemptId: string;
    status: string;
    repairCount: number;
    waitReason: string | null;
    nextAction: string | null;
  };
  "attempt-cancelled": {
    attemptId: string;
  };
  "attempt-repair-requested": {
    attemptId: string;
    waitReason: string | null;
    nextAction: string | null;
  };
  "attempt-recovered-after-restart": {
    attemptId: string;
  };
  "mission-startup-recovered-after-restart": {
    /** statusMessage at the moment recovery flipped the row out of "starting". */
    previousStatusMessage: string | null;
  };
  "mission-startup-timed-out": {
    /** Which step exceeded its timeout: "worktree-add" or "submodule-hydrate". */
    step: "worktree-add" | "submodule-hydrate";
    /** Repo (or worktree) the slow op was scoped to. Helps the operator decide where to investigate. */
    repoRelativePath: string;
    /** Configured timeout in milliseconds at the time of the failure. */
    timeoutMs: number;
  };
  // Proof execution
  "proof-started": {
    proofRunId: string;
    profileId: string;
    profileLabel: string;
  };
  "proof-finished": {
    proofRunId: string;
    profileId: string;
    status: string;
    exitCode: number | null;
  };
  // System / cross-phase
  "workspace-prepared": {
    status: string;
    worktreeCount: number;
  };
  "repo-intelligence-candidates-observed": {
    count: number;
    entryIds: readonly string[];
    repoRelativePaths: readonly (string | null)[];
  };
  "repo-intelligence-candidate-approved": {
    entryId: string;
    repoRelativePath: string | null;
  };
  "run-closed": {
    stationCleared: boolean;
  };
  // Live attempt telemetry — Phase 1.1
  "attempt-action": {
    attemptId: string;
    /** Short human-readable label, e.g. "Read", "Write", "Edit", "Bash". */
    action: string;
    /** Optional target hint truncated by the caller (e.g. file path, tool name). */
    target?: string | null;
    /** Optional duration if the action has settled. */
    durationMs?: number | null;
    /** Optional outcome status (e.g. "success", "error", "denied"). */
    status?: string | null;
  };
  "attempt-shell-command": {
    attemptId: string;
    command: string;
    cwd?: string | null;
    durationMs?: number | null;
    exitCode?: number | null;
    status?: "running" | "passed" | "failed" | "cancelled" | null;
  };
  "attempt-awaiting-permission": {
    attemptId: string;
    requestId: string;
    /** Short label of the tool / surface that needs approval. */
    label?: string | null;
  };
  "attempt-permission-resolved": {
    attemptId: string;
    requestId: string;
    result: "approved" | "denied" | "expired";
  };
  // Proof gate — Phase 2.1
  "proof-set-manual-review-only": {
    /** Operator's free-text justification — e.g. "5-line copy edit, eyeballed in MissionChangesRoom". */
    justification: string;
    /** Whether this manual-review choice replaced a previously failed/blocked proof status. */
    replacedPriorStatus: string | null;
  };
  "proof-manual-review-cleared": {
    /** What the proof status reverted to (typically "not-run"). */
    revertedTo: string;
  };
  // Proof preflight — Phase 2.2 / 2.3
  "proof-preflight-started": {
    profileId: string;
    profileLabel: string;
  };
  "proof-preflight-finished": {
    profileId: string;
    profileLabel: string;
    ok: boolean;
    blockerCount: number;
    warningCount: number;
    elapsedMs: number;
    /** Brief reason summary when ok = false; e.g. "dotnet not on PATH; node_modules missing". */
    summary: string | null;
  };
  // Dependency warming — Phase 4.1
  "workspace-dependencies-warming-started": {
    repoRelativePath: string;
    profileId: string;
    profileLabel: string;
    command: string;
    workingDirectory: string;
  };
  "workspace-dependencies-warming-finished": {
    repoRelativePath: string;
    profileId: string;
    profileLabel: string;
    command: string;
    status: "ok" | "skipped" | "failed";
    durationMs: number;
    exitCode: number | null;
    error: string | null;
  };
  // Learning loop — Phase 5
  "mission-outcome-classified": {
    /** "clean-pass" | "pass-with-friction" | "fail-with-recovery" | "fail-final" */
    outcome: string;
    rationale: string;
    retriedValidationKinds: readonly string[];
    usedManualReview: boolean;
  };
  "validation-profile-candidate-observed": {
    candidateId: string;
    projectKey: string | null;
    repoRelativePath: string | null;
    /** Validation kind inferred from the command pattern (e.g. "build", "lint"). */
    kind: string;
    command: string;
    workingDirectory: string;
    /** Total successful observations of this command across runs at the moment of observation. */
    successCount: number;
  };
  "learned-candidate-promoted": {
    candidateId: string;
    type: string;
    confidence: number;
    threshold: number;
    /** Schema version of the confidence formula used. Bump when scoring changes. */
    formulaVersion: number;
    /** Run ids that contributed positive evidence at the moment of promotion. */
    contributingRunIds: readonly string[];
    /** Run ids that contributed negative evidence at the moment of promotion. */
    contradictingRunIds: readonly string[];
  };
  "validation-profile-auto-promoted": {
    /** Stable id of the candidate that was promoted (matches the observed event). */
    candidateId: string;
    /** Resolved validation_profiles row id after upsert. */
    profileId: string;
    projectKey: string | null;
    repoRelativePath: string | null;
    kind: string;
    command: string;
    workingDirectory: string;
    successCount: number;
    threshold: number;
    /** Schema version of the promotion formula used. */
    formulaVersion: number;
    /**
     * Why this candidate auto-promoted: `threshold-met` for the standard count-based path
     * (default 5), `trust-mode-auto` when the project's `trustLearnerMode` lowered the
     * threshold to 1 because the operator opted into silent acceptance.
     */
    promotionReason?: "threshold-met" | "trust-mode-auto";
  };
  "learned-candidate-revoked": {
    candidateId: string;
    type: string;
    /** Operator-supplied reason or "auto" for system-driven revocation. */
    reason: string;
    /** Snapshot of the contributing run ids that must NOT auto-re-promote on the same evidence. */
    blockedContributingRunIds: readonly string[];
    /** When true, the candidate is archived rather than just demoted. */
    archived: boolean;
  };
  // Polish — Phase 6
  "validations-superseded": {
    /** Validation kind that the operator marked as recovered. */
    kind: string;
    /** Newer (winning) validation id. */
    winnerValidationId: string;
    /** Validation ids that are now flagged as superseded. */
    supersededValidationIds: readonly string[];
  };
  "mission-state-reconciled": {
    /** Field that was reconciled (e.g. "statusMessage", "missionPhase"). */
    field: string;
    /** Previous value as a stable string (or "null"). */
    previousValue: string;
    /** New canonical value as a stable string. */
    nextValue: string;
    /** Short reason the reconciler fired. */
    reason: string;
  };
  "mission-aborted": {
    /** Operator-supplied reason for the abort; surfaces in the post-mortem stub. */
    reason: string;
    /** Mission phase the run was in at the moment of abort. */
    phaseAtAbort: string;
  };
  /**
   * Provenance for the `## Repo guidance` section the prompt builder injected for an
   * attempt. Renderer's "Guidance applied" panel reads this to show which learned entries
   * shaped the mission, instead of the operator having to guess.
   */
  "repo-guidance-injected": {
    repoIntelligenceEntryIds: readonly string[];
    validationProfileIds: readonly string[];
    repoProfileKeys: readonly { projectKey: string; repoRelativePath: string }[];
    /** Length of the rendered markdown section in characters. */
    sectionLength: number;
  };
  /**
   * Operator clicked "Skip for now" on a sub-threshold candidate in the close-screen
   * learning panel. Records that the entry was seen + intentionally not promoted; the
   * candidate stays pending in the LearnedCandidatesEditor.
   */
  "learned-candidate-skipped": {
    candidateId: string;
  };
}

/**
 * Convenience union of every typed event. Useful for renderer-side reducers
 * that want to switch on event.type and get fully-typed metadata.
 */
export type MissionEvent = {
  [K in MissionEventType]: { type: K; stage: MissionEventStage; metadata: MissionEventMetadataMap[K] };
}[MissionEventType];

/**
 * Build an AppendMissionEventInput-shaped payload from a typed event.
 * throws if the event type is unknown (defensive — TS catches this at compile
 * time, but at runtime the validator gives an actionable message).
 */
export const validateMissionEventType = (eventType: string): MissionEventType => {
  if (!isMissionEventType(eventType)) {
    throw new Error(
      `Unknown mission event type "${eventType}". Add it to MISSION_EVENT_TYPES in @spira/shared/src/mission-events.ts.`,
    );
  }
  return eventType;
};
