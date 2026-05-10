import type { TicketRunSummary } from "@spira/shared";

/**
 * Display-state reconciliation.
 *
 * Pure function that detects and corrects internally-contradictory state on a closed
 * or near-closed mission run. The model is "deterministic patch": we observe specific
 * conflict shapes (proof passed but `staleReason` lingering, summary saved but
 * statusMessage still says "Working", validations all passed but the workflow guard
 * still claims a failure pending), and patch them to the canonical resolution.
 *
 * The caller persists the patched run AND emits a `mission-state-reconciled` event per
 * field changed so drift over time is visible in the timeline.
 *
 * This is intentionally NOT a workflow-guard bypass — it can only widen the gate
 * (clear stale messages), never tighten it. If a real contradiction exists (e.g.
 * proof.status === "running" and the run is closed) we leave it alone and let the
 * workflow guard reject the close.
 */

export interface MissionReconciliationPatch {
  /** Field name that was reconciled. Useful for the event payload. */
  field: string;
  /** Stable string representation of the previous value (or "null"). */
  previousValue: string;
  /** Stable string representation of the canonical value. */
  nextValue: string;
  /** Short reason the reconciler fired. */
  reason: string;
}

export interface ReconciliationResult {
  run: TicketRunSummary;
  patches: MissionReconciliationPatch[];
}

const stableString = (value: string | null | undefined): string =>
  value === null || value === undefined ? "null" : value;

/**
 * Reconcile a TicketRunSummary's display state. Returns the patched run plus the list
 * of patches applied (empty when no drift was found). Pure: no DB writes, no events.
 */
export const reconcileMissionDisplayState = (run: TicketRunSummary): ReconciliationResult => {
  const patches: MissionReconciliationPatch[] = [];
  let nextRun = run;

  // Patch 1: proof.staleReason left on a now-passing/manual-review proof. The stale
  // marker exists for the "validations re-ran since last proof" case; if proof.status
  // moved out of "stale" but the reason stuck around, the UI shows misleading text.
  if (
    nextRun.proof.staleReason !== null &&
    nextRun.proof.status !== "stale" &&
    nextRun.proof.status !== "not-run"
  ) {
    patches.push({
      field: "proof.staleReason",
      previousValue: stableString(nextRun.proof.staleReason),
      nextValue: "null",
      reason: `proof status is "${nextRun.proof.status}"; stale reason no longer applies`,
    });
    nextRun = { ...nextRun, proof: { ...nextRun.proof, staleReason: null } };
  }

  // Patch 2: statusMessage still narrating an in-flight attempt after the run reached
  // a terminal phase. Common cause: the close path raced an async status update.
  if (
    (nextRun.status === "awaiting-review" || nextRun.status === "done") &&
    nextRun.statusMessage !== null &&
    /\b(working|in flight|preparing|starting)\b/iu.test(nextRun.statusMessage)
  ) {
    const canonical =
      nextRun.status === "done" ? "Mission closed." : "Awaiting review. Continue when ready.";
    patches.push({
      field: "statusMessage",
      previousValue: stableString(nextRun.statusMessage),
      nextValue: canonical,
      reason: `status is "${nextRun.status}" but message still references in-flight work`,
    });
    nextRun = { ...nextRun, statusMessage: canonical };
  }

  return { run: nextRun, patches };
};
