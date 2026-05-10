import type { RepoIntelligenceRecord } from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { TAG_PREFIXES } from "./learned-tag-state.js";
import { classifyMissionOutcome, outcomeLearningWeight } from "./mission-outcome.js";

/**
 * Confidence-based auto-promotion of learned intelligence candidates.
 *
 * Pure module: takes the corpus of learned candidates + the closed runs that contributed
 * to them, computes a confidence score per candidate, and decides which to promote
 * (`approved=true`). The decision rule is:
 *   1. Sum corroborating-run weights (clean-pass = 1.0, friction = 0.5, recovery = 0.25),
 *      apply a 90-day exponential decay against `now`.
 *   2. Subtract 2× the count of contradicting (fail-final) runs.
 *   3. Apply a diversity multiplier: ×1.2 when ≥3 distinct ticket-classification kinds
 *      across corroborating runs, otherwise ×1.0.
 *   4. Compare against the per-type threshold; promote if score ≥ threshold.
 *
 * `formulaVersion` is bumped whenever the formula changes so audit-trail events can be
 * replayed against the rule that was in force at the moment of promotion.
 */

export const PROMOTION_FORMULA_VERSION = 1;

export const DEFAULT_PROMOTION_THRESHOLDS = {
  briefing: 3,
  example: 4,
  pitfall: 6,
} as const satisfies Record<RepoIntelligenceRecord["type"], number>;

const HALF_LIFE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface PromotionDecision {
  candidateId: string;
  type: RepoIntelligenceRecord["type"];
  /** True when the candidate would be promoted under these inputs. */
  promote: boolean;
  /** Final score after recency/diversity/contradiction adjustments. */
  confidence: number;
  /** Threshold used (per-type, after settings override). */
  threshold: number;
  /** Run ids that contributed positive evidence at scoring time. */
  contributingRunIds: string[];
  /** Run ids that contributed negative evidence at scoring time. */
  contradictingRunIds: string[];
  /** Why the candidate was not promoted, when promote=false. Always populated for skips. */
  skipReason: string | null;
}

export interface ScoreLearnedCandidatesInput {
  /** Pending or already-approved learned candidates. Approved entries are skipped. */
  candidates: readonly RepoIntelligenceRecord[];
  /** Closed runs in the same projectKey scope as the candidates. */
  runs: readonly TicketRunSummary[];
  /** Override per-type thresholds. Falls back to DEFAULT_PROMOTION_THRESHOLDS. */
  thresholds?: Partial<Record<RepoIntelligenceRecord["type"], number>>;
  /** Reference time for recency decay. Defaults to Date.now(). */
  now?: number;
}

const PROMOTED_RUN_TAG_PREFIX = TAG_PREFIXES.promotedRun;
const REVOKED_RUN_TAG_PREFIX = TAG_PREFIXES.revokedRun;
const REVOKED_TAG = TAG_PREFIXES.revoked;

/**
 * Tags carry the revocation history per candidate, since the revocation contract is
 * "must not auto-re-promote on the same evidence." When every contributing run id for
 * the current scoring is already on the revoked-run blocklist, we skip the candidate.
 */
const collectBlockedRunIds = (candidate: RepoIntelligenceRecord): Set<string> => {
  const blocked = new Set<string>();
  for (const tag of candidate.tags) {
    if (tag.startsWith(REVOKED_RUN_TAG_PREFIX)) {
      blocked.add(tag.slice(REVOKED_RUN_TAG_PREFIX.length));
    }
  }
  return blocked;
};

const isRevoked = (candidate: RepoIntelligenceRecord): boolean => candidate.tags.includes(REVOKED_TAG);

const extractRunIdFromTags = (tags: readonly string[]): string | null => {
  for (const tag of tags) {
    if (tag.startsWith("run:")) return tag.slice("run:".length);
  }
  return null;
};

const extractClassificationKindFromTags = (tags: readonly string[]): string | null => {
  for (const tag of tags) {
    if (tag.startsWith("classification:")) return tag.slice("classification:".length);
  }
  return null;
};

const recencyMultiplier = (ageMs: number): number => {
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const halfLifeMs = HALF_LIFE_DAYS * MS_PER_DAY;
  return Math.pow(0.5, ageMs / halfLifeMs);
};

export const scoreLearnedCandidates = (input: ScoreLearnedCandidatesInput): PromotionDecision[] => {
  const now = input.now ?? Date.now();
  const thresholds = { ...DEFAULT_PROMOTION_THRESHOLDS, ...input.thresholds };
  const runById = new Map(input.runs.map((run) => [run.runId, run] as const));
  // Memo: the same run id appears in many candidate groups. Outcome classification is
  // pure but walks `run.validations`, so caching cuts O(candidates × members) classifies
  // down to O(distinct run ids).
  const outcomeByRunId = new Map<string, ReturnType<typeof classifyMissionOutcome>>();
  const getOutcome = (run: TicketRunSummary) => {
    if (outcomeByRunId.has(run.runId)) return outcomeByRunId.get(run.runId)!;
    const fresh = classifyMissionOutcome(run);
    outcomeByRunId.set(run.runId, fresh);
    return fresh;
  };

  // Group candidates by (projectKey, repoRelativePath, type) so the contributing-run set
  // is the union across all matching candidates — multiple runs leaving the same kind of
  // entry in the same scope is the corroboration signal.
  const groups = new Map<string, RepoIntelligenceRecord[]>();
  for (const candidate of input.candidates) {
    if (candidate.source !== "learned") continue;
    const key = `${candidate.projectKey ?? "*"}|${candidate.repoRelativePath ?? "*"}|${candidate.type}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(candidate);
    else groups.set(key, [candidate]);
  }

  const decisions: PromotionDecision[] = [];
  for (const [, members] of groups) {
    // Score the latest-updated member as the "candidate of record" but include every
    // member's contributing run id in the evidence pool.
    const sortedMembers = [...members].sort((left, right) => right.updatedAt - left.updatedAt);
    const candidate = sortedMembers[0]!;
    const blockedRunIds = collectBlockedRunIds(candidate);

    const contributingRunIds = new Set<string>();
    const contradictingRunIds = new Set<string>();
    const corroboratingClassifications = new Set<string>();
    let corroboration = 0;
    let contradictionCount = 0;

    for (const member of sortedMembers) {
      const runId = extractRunIdFromTags(member.tags);
      if (!runId || blockedRunIds.has(runId)) continue;
      const run = runById.get(runId);
      if (!run) continue;
      const outcome = getOutcome(run);
      if (!outcome) continue;
      const weight = outcomeLearningWeight(outcome.kind);
      const recency = recencyMultiplier(now - (run.updatedAt ?? run.createdAt));
      if (weight < 0) {
        contradictionCount += 1;
        contradictingRunIds.add(runId);
        continue;
      }
      if (weight <= 0) continue;
      contributingRunIds.add(runId);
      corroboration += weight * recency;
      const classification = extractClassificationKindFromTags(member.tags);
      if (classification) corroboratingClassifications.add(classification);
    }

    const diversityMultiplier = corroboratingClassifications.size >= 3 ? 1.2 : 1.0;
    const confidence = (corroboration * diversityMultiplier) - 2 * contradictionCount;
    const threshold = thresholds[candidate.type] ?? DEFAULT_PROMOTION_THRESHOLDS[candidate.type];

    let skipReason: string | null = null;
    if (candidate.approved) skipReason = "candidate already approved";
    else if (isRevoked(candidate)) skipReason = "candidate previously revoked";
    else if (contributingRunIds.size === 0) skipReason = "no fresh contributing runs";
    else if (confidence < threshold) skipReason = `confidence ${confidence.toFixed(2)} below threshold ${threshold}`;

    decisions.push({
      candidateId: candidate.id,
      type: candidate.type,
      promote: skipReason === null,
      confidence,
      threshold,
      contributingRunIds: [...contributingRunIds].sort(),
      contradictingRunIds: [...contradictingRunIds].sort(),
      skipReason,
    });
  }
  return decisions;
};

/**
 * Build the tag set for a promoted entry — preserves the existing tags + appends the
 * contributing-run snapshot so revoke-and-replay can later refuse to re-promote on the
 * same evidence.
 */
export const buildPromotedTags = (
  candidate: RepoIntelligenceRecord,
  contributingRunIds: readonly string[],
): string[] => {
  const fresh = new Set(candidate.tags);
  for (const runId of contributingRunIds) fresh.add(`${PROMOTED_RUN_TAG_PREFIX}${runId}`);
  fresh.add(`promoted-formula-v${PROMOTION_FORMULA_VERSION}`);
  return [...fresh].sort();
};

/**
 * Build the tag set for a revoked entry — adds the `revoked` marker plus a `revoked-run:`
 * tag per contributing run id, so re-promotion requires *new* runs beyond this snapshot.
 * strips any previous `promoted-run:` tags so the audit trail of the active promotion is
 * superseded (the mission-event log retains the historical record).
 */
export const buildRevokedTags = (
  candidate: RepoIntelligenceRecord,
  contributingRunIds: readonly string[],
): string[] => {
  const fresh = new Set(candidate.tags.filter((tag) => !tag.startsWith(PROMOTED_RUN_TAG_PREFIX)));
  fresh.add(REVOKED_TAG);
  for (const runId of contributingRunIds) fresh.add(`${REVOKED_RUN_TAG_PREFIX}${runId}`);
  return [...fresh].sort();
};

// TAG_PREFIXES is re-exported from learned-tag-state.ts; this re-export keeps the legacy
// import path working for downstream consumers.
export { TAG_PREFIXES } from "./learned-tag-state.js";
