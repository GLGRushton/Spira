import type { RepoIntelligenceRecord } from "@spira/memory-db";

/**
 * Shared tag prefix vocabulary for the learning-loop audit trail. Every read or write
 * of these prefixes flows through this module so renames are a single-line change.
 *
 * The "run:" / "classification:" / "outcome:" tags identify which mission contributed
 * a candidate; the "promoted-run:" / "revoked-run:" tags record the snapshot of evidence
 * at the moment a promotion decision was applied; "revoked" / "archived" mark the
 * candidate's lifecycle state.
 */
export const TAG_PREFIXES = {
  promotedRun: "promoted-run:",
  revokedRun: "revoked-run:",
  /** Source-mission run id (pre-promotion provenance, written by mission-intelligence). */
  sourceRun: "run:",
  /** Source-mission ticket id (pre-promotion provenance). */
  sourceTicket: "ticket:",
  /** Mission classification mode at observation time. */
  classification: "classification:",
  /** Mission outcome kind at observation time. */
  outcome: "outcome:",
  revoked: "revoked",
  archived: "archived",
  learned: "learned",
  promotedFormula: "promoted-formula-v",
} as const;

export interface LearnedTagState {
  revoked: boolean;
  archived: boolean;
  promotedRunIds: string[];
  revokedRunIds: string[];
  /** Mission classification mode (single-valued; first match wins). */
  classification: string | null;
  /** Source ticket id (the run that observed the candidate). */
  sourceTicketId: string | null;
  /** Source mission run id. */
  sourceRunId: string | null;
  /** Outcome kind at observation time, when present. */
  outcome: string | null;
  /** Promotion formula version applied at last promotion, when present. */
  promotedFormulaVersion: number | null;
}

const stripPrefix = (tag: string, prefix: string): string => tag.slice(prefix.length);

/**
 * Parse the tag-encoded state for a learned candidate. The shape is intentionally flat:
 * every consumer reads one or two fields.
 */
export const parseLearnedTagState = (record: RepoIntelligenceRecord): LearnedTagState => {
  const promotedRunIds: string[] = [];
  const revokedRunIds: string[] = [];
  let revoked = false;
  let archived = false;
  let classification: string | null = null;
  let sourceTicketId: string | null = null;
  let sourceRunId: string | null = null;
  let outcome: string | null = null;
  let promotedFormulaVersion: number | null = null;

  for (const tag of record.tags) {
    if (tag === TAG_PREFIXES.revoked) revoked = true;
    else if (tag === TAG_PREFIXES.archived) archived = true;
    else if (tag.startsWith(TAG_PREFIXES.promotedRun)) {
      promotedRunIds.push(stripPrefix(tag, TAG_PREFIXES.promotedRun));
    } else if (tag.startsWith(TAG_PREFIXES.revokedRun)) {
      revokedRunIds.push(stripPrefix(tag, TAG_PREFIXES.revokedRun));
    } else if (classification === null && tag.startsWith(TAG_PREFIXES.classification)) {
      classification = stripPrefix(tag, TAG_PREFIXES.classification);
    } else if (sourceRunId === null && tag.startsWith(TAG_PREFIXES.sourceRun)) {
      sourceRunId = stripPrefix(tag, TAG_PREFIXES.sourceRun);
    } else if (sourceTicketId === null && tag.startsWith(TAG_PREFIXES.sourceTicket)) {
      sourceTicketId = stripPrefix(tag, TAG_PREFIXES.sourceTicket);
    } else if (outcome === null && tag.startsWith(TAG_PREFIXES.outcome)) {
      outcome = stripPrefix(tag, TAG_PREFIXES.outcome);
    } else if (promotedFormulaVersion === null && tag.startsWith(TAG_PREFIXES.promotedFormula)) {
      const value = Number.parseInt(stripPrefix(tag, TAG_PREFIXES.promotedFormula), 10);
      if (Number.isFinite(value)) promotedFormulaVersion = value;
    }
  }

  return {
    revoked,
    archived,
    promotedRunIds,
    revokedRunIds,
    classification,
    sourceTicketId,
    sourceRunId,
    outcome,
    promotedFormulaVersion,
  };
};
