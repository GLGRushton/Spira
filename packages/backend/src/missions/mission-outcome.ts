import {
  type TicketRunMissionValidationRecord,
  type TicketRunSummary,
  getEffectiveValidations,
} from "@spira/shared";

/**
 * Phase 5.1 — outcome classifier for closed missions.
 *
 * Replaces the binary `isCleanMissionForLearning` gate with a four-way classification so
 * the learning loop can record evidence from every closed mission, weighting each kind
 * differently. The exact rules:
 *
 *  - `clean-pass`         — first-try success: every validation passed without a retry,
 *                           and (proof not required OR proof.status === "passed").
 *  - `pass-with-friction` — closed successfully but with friction: at least one validation
 *                           kind had a failed-then-passed retry, OR the proof gate was
 *                           satisfied via manual-review rather than an automated pass.
 *  - `fail-with-recovery` — combination: a retry was needed AND manual-review was used.
 *                           The recovery action is worth capturing as a learned pitfall.
 *  - `fail-final`         — closed but the gate is not actually satisfied (operator
 *                           force-closed via a path that left a failed validation pending,
 *                           or proof failed and was not waived). Contributes negative
 *                           evidence to the learning loop.
 *
 * Returns `null` when the run is not in a terminal state we can learn from (e.g. status
 * is not `done`, missing classification or summary). Callers treat null as "skip".
 */

export type MissionOutcomeKind = "clean-pass" | "pass-with-friction" | "fail-with-recovery" | "fail-final";

export interface MissionOutcomeClassification {
  kind: MissionOutcomeKind;
  /** Short human-readable rationale for the operator-facing audit trail. */
  rationale: string;
  /**
   * Validation kinds that experienced a failed-then-passed retry. Drives the
   * pass-with-friction / fail-with-recovery learning rules.
   */
  retriedValidationKinds: string[];
  /** True when the proof gate was satisfied via manual review rather than an automated pass. */
  usedManualReview: boolean;
}

/**
 * Detect validation kinds that had at least one failed entry superseded by a later pass.
 * Returns a sorted, de-duplicated list of kind strings.
 */
const detectRetriedValidationKinds = (
  validations: readonly TicketRunMissionValidationRecord[],
): string[] => {
  if (validations.length === 0) return [];
  const byId = new Map(validations.map((entry) => [entry.validationId, entry] as const));
  const supersededIds = new Set<string>();
  for (const entry of validations) {
    for (const id of entry.supersedesValidationIds ?? []) {
      supersededIds.add(id);
    }
  }
  const retriedKinds = new Set<string>();
  for (const supersededId of supersededIds) {
    const superseded = byId.get(supersededId);
    if (superseded && superseded.status === "failed") {
      retriedKinds.add(superseded.kind);
    }
  }
  return [...retriedKinds].sort();
};

export const classifyMissionOutcome = (run: TicketRunSummary): MissionOutcomeClassification | null => {
  if (run.status !== "done" || !run.classification || !run.missionSummary) {
    return null;
  }

  const effectiveValidations = getEffectiveValidations(run.validations);
  const hasUnrecoveredFailure = effectiveValidations.some((entry) => entry.status === "failed");
  const hasPending = effectiveValidations.some((entry) => entry.status === "pending");
  const hasPassed = effectiveValidations.some((entry) => entry.status === "passed");

  const proofRequired = run.classification.proofRequired === true;
  const usedManualReview = proofRequired && run.proof.status === "manual-review";
  const proofGateSatisfied = !proofRequired || run.proof.status === "passed" || run.proof.status === "manual-review";

  // The mission was force-closed in a state where the gate is not actually satisfied. We
  // still learn from it, but as a `fail-final` so its contribution is negative evidence.
  if (hasUnrecoveredFailure || hasPending || !proofGateSatisfied || !hasPassed) {
    let rationale: string;
    if (hasUnrecoveredFailure) rationale = "Closed with unrecovered validation failures.";
    else if (hasPending) rationale = "Closed with pending validations.";
    else if (!proofGateSatisfied) rationale = "Closed without a satisfied proof gate.";
    else rationale = "Closed without any passing validation.";
    return {
      kind: "fail-final",
      rationale,
      retriedValidationKinds: detectRetriedValidationKinds(run.validations),
      usedManualReview,
    };
  }

  const retriedValidationKinds = detectRetriedValidationKinds(run.validations);
  const hasRetry = retriedValidationKinds.length > 0;

  if (hasRetry && usedManualReview) {
    return {
      kind: "fail-with-recovery",
      rationale: `Closed after ${retriedValidationKinds.join(", ")} retried and proof was satisfied via manual review.`,
      retriedValidationKinds,
      usedManualReview,
    };
  }
  if (hasRetry) {
    return {
      kind: "pass-with-friction",
      rationale: `Closed after retrying ${retriedValidationKinds.join(", ")}.`,
      retriedValidationKinds,
      usedManualReview,
    };
  }
  if (usedManualReview) {
    return {
      kind: "pass-with-friction",
      rationale: "Closed with proof satisfied via manual review.",
      retriedValidationKinds,
      usedManualReview,
    };
  }
  return {
    kind: "clean-pass",
    rationale: "Closed first try with all validations passing and the proof gate satisfied.",
    retriedValidationKinds,
    usedManualReview,
  };
};

/**
 * Per-outcome learning weight, used by the auto-promotion confidence formula. The values
 * mirror the plan's "outcome quality" multiplier — clean-pass counts in full, friction
 * counts at half, recovery counts at quarter, and fail-final flips sign.
 */
export const outcomeLearningWeight = (kind: MissionOutcomeKind): number => {
  switch (kind) {
    case "clean-pass":
      return 1;
    case "pass-with-friction":
      return 0.5;
    case "fail-with-recovery":
      return 0.25;
    case "fail-final":
      return -2;
  }
};
