import type { OutcomeKind, WorkSessionSnapshot } from "@spira/shared";

/**
 * Outcome classifier for WorkSession closes. Mirrors the mission outcome classifier
 * shape (`clean-pass | pass-with-friction | fail-with-recovery | fail-final`) so Spira's
 * own learning loop can use the same vocabulary.
 *
 * Rules:
 *  - `clean-pass`         — first-try success: no validation failure, no stall ever, no fix iterations.
 *  - `pass-with-friction` — completed but `fixIterationCount > 0` OR a validation failed before
 *                           the eventual passing one OR `repeatFailureCount > 0`.
 *  - `fail-with-recovery` — completed AND a stall was observed at some point during the run
 *                           (caller passes `everStalled: true` from the events table — the
 *                           snapshot's `stalledAt` is cleared on validation pass and so cannot
 *                           be the source of truth for "ever stalled").
 *  - `fail-final`         — closed without `completedAt` / `readyForReview` set, or while a
 *                           `stalledReason` is currently in effect.
 */

export type WorkSessionOutcomeKind = OutcomeKind;

export interface WorkSessionOutcomeClassification {
  kind: WorkSessionOutcomeKind;
  rationale: string;
  reason: string | null;
}

export interface ClassifyWorkSessionOutcomeOptions {
  /**
   * True when at least one `worksession-stalled` event has been recorded for this session
   * over its lifetime. The caller (close path) computes this from `listWorkSessionEvents`
   * because the snapshot's own `stalledAt` is sticky-cleared on validation success.
   */
  everStalled?: boolean;
}

export const classifyWorkSessionOutcome = (
  snapshot: WorkSessionSnapshot,
  options: ClassifyWorkSessionOutcomeOptions = {},
): WorkSessionOutcomeClassification => {
  const completed = snapshot.readyForReview === true || typeof snapshot.completedAt === "number";
  const fixIterationCount = snapshot.fixIterationCount ?? 0;
  const repeatFailureCount = snapshot.repeatFailureCount ?? 0;
  const validationResults = snapshot.validationResults ?? [];
  const hadValidationFailure = validationResults.some((entry) => entry.success === false);
  const currentlyStalled = typeof snapshot.stalledReason === "string" && snapshot.stalledReason.length > 0;

  if (!completed || currentlyStalled) {
    return {
      kind: "fail-final",
      rationale: currentlyStalled
        ? `Closed while stalled: ${snapshot.stalledReason ?? "unknown"}`
        : "Closed without reaching ready-for-review.",
      reason: snapshot.stalledReason ?? null,
    };
  }

  if (options.everStalled === true) {
    return {
      kind: "fail-with-recovery",
      rationale: "Recovered after a prior stall to reach ready-for-review.",
      reason: null,
    };
  }

  if (hadValidationFailure || fixIterationCount > 0 || repeatFailureCount > 0) {
    const friction: string[] = [];
    if (fixIterationCount > 0) friction.push(`${fixIterationCount} fix iteration(s)`);
    if (hadValidationFailure) friction.push("at least one validation failed before passing");
    if (repeatFailureCount > 0) friction.push(`${repeatFailureCount} repeated failure(s)`);
    return {
      kind: "pass-with-friction",
      rationale: `Closed cleanly after friction: ${friction.join("; ")}.`,
      reason: null,
    };
  }

  return {
    kind: "clean-pass",
    rationale: "Closed cleanly on first attempt with all validations passing.",
    reason: null,
  };
};
