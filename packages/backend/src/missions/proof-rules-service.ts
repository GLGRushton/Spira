import { randomUUID } from "node:crypto";
import type { ProofRuleRecord, SpiraMemoryDatabase } from "@spira/memory-db";
import type { MissionProofRuleRecord, MissionProofRulesSnapshot, UpsertMissionProofRuleInput } from "@spira/shared";
import { isBuiltinRecordId } from "./builtin-id.js";

/**
 * Proof rules admin service.
 *
 * Renderer-facing CRUD for the `proof_rules` table. Builtin rules (id prefix `global-`)
 * are returned for read but cannot be deleted; user rules can be freely added, updated,
 * and removed. This is intentionally permissive — the proof rule scoring already handles
 * arbitrary rules, and the operator's experience matters more than strict policy here.
 */

const mapRule = (record: ProofRuleRecord): MissionProofRuleRecord => ({
  id: record.id,
  projectKey: record.projectKey,
  repoRelativePath: record.repoRelativePath,
  classificationKind: record.classificationKind,
  uiChange: record.uiChange,
  proofRequired: record.proofRequired,
  summaryKeywords: [...record.summaryKeywords],
  recommendedLevel: record.recommendedLevel,
  rationale: record.rationale,
  source: isBuiltinRecordId(record.id) ? "builtin" : "user",
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export class ProofRulesService {
  constructor(private readonly memoryDb: SpiraMemoryDatabase) {}

  /** List every rule in the DB (no scope filtering — admin pane wants the full picture). */
  list(): MissionProofRulesSnapshot {
    const rules = this.memoryDb.listProofRules({ limit: 1_000 });
    return { rules: rules.map(mapRule) };
  }

  /**
   * Upsert a user rule. If `id` is omitted, a new uuid id is minted with a `user-` prefix
   * so it can never be confused with a builtin. Existing builtin rules cannot be updated
   * via this path — those changes need a code change to {@link BUILTIN_PROOF_RULES}.
   */
  upsert(input: UpsertMissionProofRuleInput): MissionProofRulesSnapshot {
    const trimmedId = input.id?.trim() ?? "";
    const id = trimmedId.length > 0 ? trimmedId : `user-${randomUUID()}`;
    if (isBuiltinRecordId(id)) {
      throw new Error(`Cannot upsert builtin proof rule "${id}". Builtin rules ship with the application code.`);
    }
    this.memoryDb.upsertProofRule({
      id,
      projectKey: input.projectKey ?? null,
      repoRelativePath: input.repoRelativePath ?? null,
      classificationKind: input.classificationKind ?? null,
      uiChange: input.uiChange ?? null,
      proofRequired: input.proofRequired ?? null,
      summaryKeywords: input.summaryKeywords ?? [],
      recommendedLevel: input.recommendedLevel,
      rationale: input.rationale.trim(),
    });
    return this.list();
  }

  /** Delete a user rule. Builtin rules are protected — delete requests for them throw. */
  delete(ruleId: string): MissionProofRulesSnapshot {
    if (isBuiltinRecordId(ruleId)) {
      throw new Error(
        `Cannot delete builtin proof rule "${ruleId}". Remove it from BUILTIN_PROOF_RULES and reseed.`,
      );
    }
    this.memoryDb.deleteProofRule(ruleId);
    return this.list();
  }
}
