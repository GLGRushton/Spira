import type { IntelligenceAuditEvent } from "./protocol.js";

/**
 * Stand-alone shape for the raw mission_events row a backend handler hands to the
 * projection. Decoupled from the memory-db record type so this module stays in shared.
 */
export interface IntelligenceAuditEventInput {
  id: number;
  runId: string;
  occurredAt: number;
  eventType: string;
  metadata: unknown;
}

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const asStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;

/**
 * Project a raw mission_events row into the renderer-facing audit feed entry. Returns
 * null when the row's `eventType` isn't one of the audit pair so callers can map+filter
 * in one pass.
 */
export const projectIntelligenceAuditEvent = (
  input: IntelligenceAuditEventInput,
): IntelligenceAuditEvent | null => {
  const meta = (input.metadata ?? {}) as Record<string, unknown>;
  const candidateId = asString(meta["candidateId"]) ?? "";
  const candidateType = asString(meta["type"]);
  if (input.eventType === "learned-candidate-promoted") {
    return {
      id: input.id,
      runId: input.runId,
      occurredAt: input.occurredAt,
      eventType: "learned-candidate-promoted",
      candidateId,
      candidateType,
      confidence: asNumber(meta["confidence"]),
      threshold: asNumber(meta["threshold"]),
      formulaVersion: asNumber(meta["formulaVersion"]),
      contributingRunIds: asStringArray(meta["contributingRunIds"]),
      contradictingRunIds: asStringArray(meta["contradictingRunIds"]),
      reason: null,
      blockedContributingRunIds: null,
      archived: false,
    };
  }
  if (input.eventType === "learned-candidate-revoked") {
    return {
      id: input.id,
      runId: input.runId,
      occurredAt: input.occurredAt,
      eventType: "learned-candidate-revoked",
      candidateId,
      candidateType,
      confidence: null,
      threshold: null,
      formulaVersion: null,
      contributingRunIds: null,
      contradictingRunIds: null,
      reason: asString(meta["reason"]),
      blockedContributingRunIds: asStringArray(meta["blockedContributingRunIds"]),
      archived: meta["archived"] === true,
    };
  }
  return null;
};
