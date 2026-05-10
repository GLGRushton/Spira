/**
 * Shared outcome vocabulary across mission-outcome and work-session-outcome classifiers.
 *
 * Both flows learn from a four-way classification with the same per-kind weight, so the
 * type and the weight live here once. Each classifier returns its domain-specific shape
 * on top of this shared `OutcomeKind`.
 */

export type OutcomeKind = "clean-pass" | "pass-with-friction" | "fail-with-recovery" | "fail-final";

/**
 * Per-outcome learning weight used by the auto-promotion confidence formula. clean-pass
 * counts in full, friction at half, recovery at quarter, fail-final flips sign.
 */
export const outcomeLearningWeight = (kind: OutcomeKind): number => {
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
