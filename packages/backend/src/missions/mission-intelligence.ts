import { createHash } from "node:crypto";
import type {
  ProofDecisionRecord,
  ProofRuleRecord,
  RepoIntelligenceRecord,
  UpsertProofRuleInput,
  UpsertRepoIntelligenceInput,
  UpsertValidationProfileInput,
  ValidationProfileRecord,
} from "@spira/memory-db";
import type {
  TicketRunMissionClassification,
  TicketRunMissionProofLevel,
  TicketRunMissionProofPreflightStatus,
  TicketRunProofProfileSummary,
  TicketRunSummary,
} from "@spira/shared";
import { getEffectiveValidations } from "@spira/shared";
import { type MissionOutcomeClassification } from "./mission-outcome.js";

const COPY_CHANGE_KEYWORDS = ["copy", "wording", "label", "labels", "text", "tooltip", "terminology", "rename"];
const UI_CHANGE_KEYWORDS = ["ui", "screen", "page", "dialog", "button", "menu", "nav", "visual", "layout"];

export interface MissionRepoGuidanceSnapshot {
  entries: RepoIntelligenceRecord[];
  validationProfiles: ValidationProfileRecord[];
}

/**
 * Phase 2.4 — diff-shape signal that can downgrade or upgrade the recommended proof level.
 * The caller computes this from the active worktrees' git status; it's optional so callers
 * that don't have diff state available (e.g. pre-implement decisions) keep working.
 */
export interface AdvisoryProofDiffSignal {
  /** Total files changed across all impacted worktrees. */
  totalFilesChanged: number;
  /** Sum of additions across changed files. */
  totalLinesAdded: number;
  /** Sum of removals across changed files. */
  totalLinesRemoved: number;
  /**
   * True if every changed file is a "copy carrier" — templates, locale resources, string
   * constants — and no production logic file was touched. Drives the copy-only rule.
   */
  copyOnly: boolean;
  /** True if every changed file is a test fixture / spec file. */
  testsOnly: boolean;
  /**
   * True if at least one changed file matches a registered UI surface glob for the repo.
   * Used to escalate the recommendation to targeted-screenshot when the operator has
   * touched a surface known to need visual proof.
   */
  touchesUiSurface: boolean;
}

/**
 * Phase 2.4 — historical proof outcomes for the same `(projectKey, repoRelativePath, kind)`
 * triple. The recommendation engine can use this to demote levels that have been failing
 * recently in operationally consistent ways (e.g. preflight blockers that haven't been
 * resolved between runs).
 */
export interface AdvisoryProofHistoricalSignal {
  /** Most-recent-first list capped by the caller (typically last 5). */
  recentRuns: ReadonlyArray<{
    status: "passed" | "failed" | "preflight-blocked" | "running";
    /** ms-since-epoch difference between now and the run's completedAt. */
    ageMs: number;
  }>;
}

export interface AdvisoryProofDecisionInput {
  run: TicketRunSummary;
  classification: TicketRunMissionClassification | null;
  availableProofs: readonly TicketRunProofProfileSummary[];
  proofRules: readonly ProofRuleRecord[];
  /** Phase 2.4 — optional diff-shape signal. Absent for pre-implement decisions. */
  diffSignal?: AdvisoryProofDiffSignal;
  /** Phase 2.4 — optional historical outcomes for this repo + ticket pattern. */
  historicalOutcomes?: AdvisoryProofHistoricalSignal;
}

export interface AdvisoryProofDecisionComputation {
  recommendedLevel: TicketRunMissionProofLevel | null;
  preflightStatus: TicketRunMissionProofPreflightStatus | null;
  rationale: string | null;
  evidence: string[];
}

const normalizeSearchText = (value: string): string => value.trim().toLowerCase();
const slugifyFragment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 48);

export const hashFragment = (value: string): string =>
  createHash("sha1").update(value).digest("hex").slice(0, 12);

const includesAnyKeyword = (text: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => text.includes(keyword));

export const buildMissionScopePaths = (
  run: TicketRunSummary,
  classificationOverride?: TicketRunMissionClassification | null,
): string[] => [
  ...new Set(
    [
      ".",
      ...run.worktrees.map((worktree) => worktree.repoRelativePath),
      ...(classificationOverride?.impactedRepoRelativePaths ?? run.classification?.impactedRepoRelativePaths ?? []),
      ...(run.plan?.touchedRepoRelativePaths ?? []),
      ...(run.missionSummary?.changedRepoRelativePaths ?? []),
      ...(run.proofStrategy?.repoRelativePath ? [run.proofStrategy.repoRelativePath] : []),
    ].filter((repoRelativePath): repoRelativePath is string => repoRelativePath.trim().length > 0),
  ),
];

const scoreProofRule = (options: {
  rule: ProofRuleRecord;
  run: TicketRunSummary;
  classification: TicketRunMissionClassification | null;
  searchText: string;
}): number | null => {
  const { rule, run, classification, searchText } = options;
  const repoScopePaths = new Set(buildMissionScopePaths(run, classification));
  const directlyImpactedPaths = new Set(classification?.impactedRepoRelativePaths ?? []);
  let score = 0;

  if (rule.projectKey !== null) {
    if (rule.projectKey !== run.projectKey) {
      return null;
    }
    score += 2;
  }

  if (rule.repoRelativePath !== null) {
    if (!repoScopePaths.has(rule.repoRelativePath) && !directlyImpactedPaths.has(rule.repoRelativePath)) {
      return null;
    }
    score += directlyImpactedPaths.has(rule.repoRelativePath) ? 6 : 4;
  }

  if (rule.classificationKind !== null) {
    if (!classification || classification.kind !== rule.classificationKind) {
      return null;
    }
    score += 3;
  }

  if (rule.uiChange !== null) {
    if (!classification || classification.uiChange !== rule.uiChange) {
      return null;
    }
    score += 1;
  }

  if (rule.proofRequired !== null) {
    if (!classification || classification.proofRequired !== rule.proofRequired) {
      return null;
    }
    score += 1;
  }

  if (rule.summaryKeywords.length > 0) {
    if (
      !includesAnyKeyword(
        searchText,
        rule.summaryKeywords.map((keyword) => keyword.toLowerCase()),
      )
    ) {
      return null;
    }
    score += 2;
  }

  return score;
};

const inferPreliminaryProofLevel = (run: TicketRunSummary): TicketRunMissionProofLevel | null => {
  const searchText = normalizeSearchText(run.ticketSummary);
  if (includesAnyKeyword(searchText, COPY_CHANGE_KEYWORDS)) {
    return "light";
  }
  if (includesAnyKeyword(searchText, UI_CHANGE_KEYWORDS)) {
    return "targeted-screenshot";
  }
  return null;
};

/**
 * Phase 2.4 — proportionality overrides applied after the rule-scored recommendation.
 * Returns either an override level + rationale + evidence, or null if no override applies.
 *
 * Diff signal trumps a higher level when:
 *   - tests-only diff      → "none"  (the change literally cannot regress UI)
 *   - copy-only ≤10 lines  → "light" (rendered text changed, no logic — visual diff is enough)
 * Diff signal upgrades when:
 *   - touchesUiSurface     → at least "targeted-screenshot" (a registered visual surface moved)
 *
 * Historical signal is currently advisory only — surfaces in evidence but doesn't change
 * the level. A future iteration can demote levels that consistently fail with the same
 * preflight blocker (so the operator gets pushed toward manual-review-only sooner).
 */
const applyProportionalityOverrides = (
  base: TicketRunMissionProofLevel,
  signal: AdvisoryProofDiffSignal | undefined,
  history: AdvisoryProofHistoricalSignal | undefined,
): { level: TicketRunMissionProofLevel; reasons: string[]; evidence: string[] } | null => {
  if (!signal && !history) return null;
  const reasons: string[] = [];
  const evidence: string[] = [];
  let level = base;

  if (signal) {
    const totalLines = signal.totalLinesAdded + signal.totalLinesRemoved;
    if (signal.testsOnly && signal.totalFilesChanged > 0) {
      level = "none";
      reasons.push("Diff is tests-only; production paths cannot regress.");
      evidence.push("diff-tests-only");
    } else if (signal.copyOnly && totalLines > 0 && totalLines <= 10) {
      level = "light";
      reasons.push(`Copy-only diff (${totalLines} line${totalLines === 1 ? "" : "s"}); a light proof is enough.`);
      evidence.push("diff-copy-only-small");
    } else if (signal.touchesUiSurface) {
      // Don't downgrade — only escalate up to targeted-screenshot if the base is below it.
      const escalated = level === "none" || level === "light" ? "targeted-screenshot" : level;
      if (escalated !== level) {
        level = escalated;
        reasons.push("Diff touches a registered UI surface; recommending targeted screenshot.");
        evidence.push("diff-ui-surface-touched");
      }
    }
  }

  if (history) {
    const recentFailures = history.recentRuns.filter(
      (entry) => entry.status === "failed" || entry.status === "preflight-blocked",
    ).length;
    if (recentFailures >= 2 && history.recentRuns.length >= 3) {
      // Surface the signal as evidence — operators can see "this profile has been failing"
      // in the rationale even though we don't auto-demote yet.
      evidence.push(`history-recent-failures:${recentFailures}/${history.recentRuns.length}`);
    }
  }

  if (level === base && reasons.length === 0 && evidence.length === 0) {
    return null;
  }
  return { level, reasons, evidence };
};

export const computeAdvisoryProofDecision = (input: AdvisoryProofDecisionInput): AdvisoryProofDecisionComputation => {
  const { run, classification, availableProofs, proofRules, diffSignal, historicalOutcomes } = input;
  const searchText = normalizeSearchText(run.ticketSummary);

  if (!classification) {
    const preliminaryLevel = inferPreliminaryProofLevel(run);
    return {
      recommendedLevel: preliminaryLevel,
      preflightStatus:
        preliminaryLevel === null
          ? null
          : availableProofs.length > 0 || preliminaryLevel === "light"
            ? "runnable"
            : "blocked",
      rationale:
        preliminaryLevel === null
          ? "Save classification to generate repo-aware proof guidance."
          : "Ticket summary suggests a UI-facing change. Save classification to confirm the proof recommendation.",
      evidence: preliminaryLevel === null ? [] : ["ticket-summary-keywords"],
    };
  }

  if (
    !classification.proofRequired ||
    !classification.uiChange ||
    classification.kind === "backend" ||
    classification.kind === "infra"
  ) {
    return {
      recommendedLevel: "none",
      preflightStatus: "runnable",
      rationale: "Current classification does not require automated UI proof.",
      evidence: ["classification-no-ui-proof"],
    };
  }

  const matchingRule = proofRules
    .map((rule) => ({ rule, score: scoreProofRule({ rule, run, classification, searchText }) }))
    .filter((entry): entry is { rule: ProofRuleRecord; score: number } => entry.score !== null)
    .sort((left, right) => right.score - left.score || right.rule.updatedAt - left.rule.updatedAt)[0]?.rule;

  const baseLevel: TicketRunMissionProofLevel =
    matchingRule?.recommendedLevel ??
    (includesAnyKeyword(searchText, COPY_CHANGE_KEYWORDS)
      ? "light"
      : availableProofs.length > 0
        ? "targeted-screenshot"
        : "full-ui-proof");

  // Phase 2.4 — apply diff/history overrides after the rule-scored base recommendation.
  const proportionality = applyProportionalityOverrides(baseLevel, diffSignal, historicalOutcomes);
  const recommendedLevel = proportionality?.level ?? baseLevel;

  const preflightStatus =
    recommendedLevel === "manual-review-only"
      ? "degraded"
      : recommendedLevel === "none"
        ? "runnable"
        : availableProofs.length > 0
          ? "runnable"
          : "blocked";

  const baseRationale =
    matchingRule?.rationale ??
    (baseLevel === "light"
      ? "The ticket reads like a copy-oriented UI change, so a lighter proof path is recommended."
      : baseLevel === "targeted-screenshot"
        ? "A UI-facing change with available proof profiles should prefer a targeted proof path first."
        : "The run appears UI-affecting and currently warrants a fuller proof path.");
  const rationale = proportionality && proportionality.reasons.length > 0
    ? `${proportionality.reasons.join(" ")} (Base recommendation: ${baseRationale})`
    : baseRationale;

  const evidence = [
    ...(matchingRule ? [`proof-rule:${matchingRule.id}`] : []),
    ...(includesAnyKeyword(searchText, COPY_CHANGE_KEYWORDS) ? ["copy-change-keywords"] : []),
    ...(availableProofs.length > 0 ? ["proof-profiles-available"] : ["no-proof-profiles-available"]),
    ...(proportionality?.evidence ?? []),
  ];

  return {
    recommendedLevel,
    preflightStatus,
    rationale,
    evidence,
  };
};

export const mergeClassificationWithAdvisoryProof = (
  classification: TicketRunMissionClassification,
  decision: AdvisoryProofDecisionComputation,
): TicketRunMissionClassification => ({
  ...classification,
  advisoryProofLevel: decision.recommendedLevel,
  advisoryProofRationale: decision.rationale,
});

export const toPersistedProofDecisionInput = (
  run: TicketRunSummary,
  decision: AdvisoryProofDecisionComputation,
  classificationOverride?: TicketRunMissionClassification | null,
): Omit<ProofDecisionRecord, "createdAt" | "updatedAt"> => {
  const currentAttempt =
    [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;
  return {
    runId: run.runId,
    attemptId: currentAttempt?.attemptId ?? null,
    recommendedLevel: decision.recommendedLevel,
    preflightStatus: decision.preflightStatus,
    rationale: decision.rationale,
    evidence: decision.evidence,
    repoRelativePaths: buildMissionScopePaths(run, classificationOverride),
  };
};

const summarizeValidationCommands = (run: TicketRunSummary): string =>
  [
    ...new Set(
      getEffectiveValidations(run.validations)
        .filter((validation) => validation.status === "passed")
        .map((validation) => validation.command.trim()),
    ),
  ]
    .filter((command) => command.length > 0)
    .slice(0, 2)
    .join(" ; ");

export const buildLearnedRepoIntelligenceCandidates = (
  run: TicketRunSummary,
  outcome: MissionOutcomeClassification,
): UpsertRepoIntelligenceInput[] => {
  if (!run.classification || !run.plan || !run.missionSummary) {
    return [];
  }
  const classification = run.classification;
  const missionSummary = run.missionSummary;

  const repoRelativePaths = [
    ...new Set(
      [
        ...missionSummary.changedRepoRelativePaths,
        ...(run.plan?.touchedRepoRelativePaths ?? []),
        ...classification.impactedRepoRelativePaths,
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
  if (repoRelativePaths.length === 0) {
    return [];
  }

  const validationCommands = summarizeValidationCommands(run);
  const proofSummary =
    classification.proofRequired && missionSummary.proofSummary
      ? ` Proof evidence: ${missionSummary.proofSummary.trim()}.`
      : "";

  // Pitfall variants for fail-final / fail-with-recovery outcomes — these are negative-
  // evidence learnings ("if you see X, consider Y") rather than positive examples.
  const isPitfall = outcome.kind === "fail-final" || outcome.kind === "fail-with-recovery";
  const candidateType: UpsertRepoIntelligenceInput["type"] = isPitfall ? "pitfall" : "example";
  const titlePrefix = isPitfall ? "Mission friction observed in" : "Observed mission pattern from";
  const frictionNote = outcome.retriedValidationKinds.length > 0
    ? ` Retry observed for: ${outcome.retriedValidationKinds.join(", ")}.`
    : "";
  const manualReviewNote = outcome.usedManualReview
    ? " Proof gate satisfied via manual review."
    : "";
  const outcomeNote = ` Outcome: ${outcome.kind}.`;

  return repoRelativePaths.map((repoRelativePath) => {
    const repoSlug = slugifyFragment(repoRelativePath) || "root";
    return {
      id: `learned-${run.runId}-${repoSlug}-${hashFragment(repoRelativePath)}`,
      projectKey: run.projectKey,
      repoRelativePath,
      type: candidateType,
      title: `${titlePrefix} ${run.ticketId}`,
      content: `Observed from "${run.ticketSummary}" in ${repoRelativePath}. Completed work: ${missionSummary.completedWork.trim()}. ${
        validationCommands.length > 0
          ? `Passing validation: ${validationCommands}.`
          : "Passing validation was recorded."
      }${proofSummary}${frictionNote}${manualReviewNote}${outcomeNote}`,
      tags: [
        "learned",
        `run:${run.runId}`,
        `ticket:${run.ticketId}`,
        `classification:${classification.kind}`,
        `outcome:${outcome.kind}`,
      ],
      source: "learned",
      approved: false,
      createdAt: missionSummary.updatedAt,
    };
  });
};

export const BUILTIN_REPO_INTELLIGENCE: Array<Omit<UpsertRepoIntelligenceInput, "source">> = [
  {
    id: "spira-root-briefing",
    repoRelativePath: ".",
    type: "briefing",
    title: "Spira mission architecture",
    content:
      "Mission workflow logic lives in packages/backend/src/missions. Shared mission and ticket-run types live in packages/shared/src/ticket-run-types.ts. Mission UI surfaces live under packages/renderer/src/components/missions.",
    tags: ["missions", "workflow", "spira"],
  },
  {
    id: "spira-proof-pitfall",
    repoRelativePath: ".",
    type: "pitfall",
    title: "Binary proof gate still active",
    content:
      "The workflow guard still treats proofRequired as the authoritative gate. Advisory proof levels should inform recommendations before they are allowed to change workflow enforcement.",
    tags: ["proof", "workflow", "guard"],
  },
  {
    id: "spira-renderer-mission-surface-map",
    repoRelativePath: "packages/renderer",
    type: "example",
    title: "Mission UI surface map",
    content:
      "Mission rooms live under packages/renderer/src/components/missions/rooms. The details room composes status, workflow, timeline, and evidence views, while useMissionRunController.ts owns the mission detail data-fetching layer.",
    tags: ["missions", "renderer", "ui-map"],
  },
  {
    id: "spira-shared-mission-workflow-map",
    repoRelativePath: "packages/shared",
    type: "example",
    title: "Shared workflow map",
    content:
      "Shared ticket-run mission types live in packages/shared/src/ticket-run-types.ts, and the canonical workflow-state derivation lives in packages/shared/src/ticket-run-workflow.ts.",
    tags: ["missions", "shared", "workflow"],
  },
  {
    id: "spira-mission-test-map",
    repoRelativePath: "packages/backend",
    type: "example",
    title: "Mission test map",
    content:
      "Mission backend tests live alongside the feature files under packages/backend/src/missions. ticket-runs.test.ts covers orchestration and closure, while mission-lifecycle.test.ts covers lifecycle context, proof advice, and event persistence.",
    tags: ["missions", "tests", "backend"],
  },
];

export const BUILTIN_VALIDATION_PROFILES: Array<Omit<UpsertValidationProfileInput, "source">> = [
  {
    id: "spira-lint",
    repoRelativePath: ".",
    label: "Workspace lint",
    kind: "lint",
    command: "pnpm lint",
    workingDirectory: ".",
    notes: "Runs biome checks across the workspace.",
    confidence: 0.55,
    expectedRuntimeMs: 60_000,
  },
  {
    id: "spira-typecheck",
    repoRelativePath: ".",
    label: "Workspace typecheck",
    kind: "typecheck",
    command: "pnpm typecheck",
    workingDirectory: ".",
    notes: "Runs the TypeScript build and renderer noEmit checks.",
    confidence: 0.8,
    expectedRuntimeMs: 180_000,
  },
  {
    id: "spira-test",
    repoRelativePath: ".",
    label: "Workspace tests",
    kind: "unit-test",
    command: "pnpm test",
    workingDirectory: ".",
    notes: "Runs the Vitest workspace test suite.",
    confidence: 0.85,
    expectedRuntimeMs: 180_000,
  },
];

export const BUILTIN_PROOF_RULES: Array<Omit<UpsertProofRuleInput, "createdAt">> = [
  {
    id: "global-ui-copy-light",
    classificationKind: "ui",
    uiChange: true,
    proofRequired: true,
    summaryKeywords: ["copy", "wording", "label", "text", "tooltip", "terminology", "rename"],
    recommendedLevel: "light",
    rationale: "Copy-oriented UI work should start with a light proof recommendation unless repo rules say otherwise.",
  },
  {
    id: "global-ui-default-targeted",
    classificationKind: "ui",
    uiChange: true,
    proofRequired: true,
    recommendedLevel: "targeted-screenshot",
    rationale: "Default UI work should prefer a targeted proof path before escalating to full UI proof.",
  },
  {
    id: "global-backend-none",
    classificationKind: "backend",
    uiChange: false,
    proofRequired: false,
    recommendedLevel: "none",
    rationale: "Backend-only work should not request automated UI proof.",
  },
  // Phase 2.4 — extra builtin rules to nudge proportionality before diff signal arrives.
  {
    id: "global-frontend-copy-manual-review",
    classificationKind: "frontend",
    uiChange: true,
    proofRequired: true,
    summaryKeywords: ["typo", "spelling", "punctuation", "capitalization", "casing"],
    recommendedLevel: "manual-review-only",
    rationale:
      "Pure typo / casing fixes are below the threshold where automated UI proof pays its way; operator review is the right gate.",
  },
  {
    id: "global-tests-only-none",
    classificationKind: "ui",
    uiChange: false,
    proofRequired: false,
    summaryKeywords: ["test", "tests", "spec", "fixture", "mock"],
    recommendedLevel: "none",
    rationale: "Tests-only changes can't regress the UI surface; no proof artifact is required.",
  },
  {
    id: "global-mixed-default-targeted",
    classificationKind: "mixed",
    uiChange: true,
    proofRequired: true,
    recommendedLevel: "targeted-screenshot",
    rationale: "Mixed changes that touch UI default to a targeted screenshot before escalating to full UI proof.",
  },
];
