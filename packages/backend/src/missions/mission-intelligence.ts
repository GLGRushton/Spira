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

const COPY_CHANGE_KEYWORDS = ["copy", "wording", "label", "labels", "text", "tooltip", "terminology", "rename"];
const UI_CHANGE_KEYWORDS = ["ui", "screen", "page", "dialog", "button", "menu", "nav", "visual", "layout"];

export interface MissionRepoGuidanceSnapshot {
  entries: RepoIntelligenceRecord[];
  validationProfiles: ValidationProfileRecord[];
}

export interface AdvisoryProofDecisionInput {
  run: TicketRunSummary;
  classification: TicketRunMissionClassification | null;
  availableProofs: readonly TicketRunProofProfileSummary[];
  proofRules: readonly ProofRuleRecord[];
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

const hashFragment = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 12);

const includesAnyKeyword = (text: string, keywords: readonly string[]): boolean =>
  keywords.some((keyword) => text.includes(keyword));

export const buildMissionScopePaths = (
  run: TicketRunSummary,
  classificationOverride?: TicketRunMissionClassification | null,
): string[] =>
  [
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
    if (!includesAnyKeyword(searchText, rule.summaryKeywords.map((keyword) => keyword.toLowerCase()))) {
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

export const computeAdvisoryProofDecision = (
  input: AdvisoryProofDecisionInput,
): AdvisoryProofDecisionComputation => {
  const { run, classification, availableProofs, proofRules } = input;
  const searchText = normalizeSearchText(run.ticketSummary);

  if (!classification) {
    const preliminaryLevel = inferPreliminaryProofLevel(run);
    return {
      recommendedLevel: preliminaryLevel,
      preflightStatus:
        preliminaryLevel === null ? null : availableProofs.length > 0 || preliminaryLevel === "light" ? "runnable" : "blocked",
      rationale:
        preliminaryLevel === null
          ? "Save classification to generate repo-aware proof guidance."
          : "Ticket summary suggests a UI-facing change. Save classification to confirm the proof recommendation.",
      evidence: preliminaryLevel === null ? [] : ["ticket-summary-keywords"],
    };
  }

  if (!classification.proofRequired || !classification.uiChange || classification.kind === "backend" || classification.kind === "infra") {
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

  const recommendedLevel =
    matchingRule?.recommendedLevel ??
    (includesAnyKeyword(searchText, COPY_CHANGE_KEYWORDS)
      ? "light"
      : availableProofs.length > 0
        ? "targeted-screenshot"
        : "full-ui-proof");

  const preflightStatus =
    recommendedLevel === "manual-review-only"
      ? "degraded"
      : recommendedLevel === "none"
        ? "runnable"
        : availableProofs.length > 0
          ? "runnable"
          : "blocked";

  const rationale =
    matchingRule?.rationale ??
    (recommendedLevel === "light"
      ? "The ticket reads like a copy-oriented UI change, so a lighter proof path is recommended."
      : recommendedLevel === "targeted-screenshot"
        ? "A UI-facing change with available proof profiles should prefer a targeted proof path first."
        : "The run appears UI-affecting and currently warrants a fuller proof path.");

  const evidence = [
    ...(matchingRule ? [`proof-rule:${matchingRule.id}`] : []),
    ...(includesAnyKeyword(searchText, COPY_CHANGE_KEYWORDS) ? ["copy-change-keywords"] : []),
    ...(availableProofs.length > 0 ? ["proof-profiles-available"] : ["no-proof-profiles-available"]),
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
  const currentAttempt = [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;
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
  [...new Set(run.validations.filter((validation) => validation.status === "passed").map((validation) => validation.command.trim()))]
    .filter((command) => command.length > 0)
    .slice(0, 2)
    .join(" ; ");

const isCleanMissionForLearning = (run: TicketRunSummary): boolean =>
  run.status === "done" &&
  run.classification !== null &&
  run.plan !== null &&
  run.missionSummary !== null &&
  run.validations.some((validation) => validation.status === "passed") &&
  !run.validations.some((validation) => validation.status === "failed" || validation.status === "pending") &&
  (!run.classification.proofRequired || run.proof.status === "passed");

export const buildLearnedRepoIntelligenceCandidates = (run: TicketRunSummary): UpsertRepoIntelligenceInput[] => {
  if (!isCleanMissionForLearning(run) || !run.classification || !run.missionSummary) {
    return [];
  }
  const classification = run.classification;
  const missionSummary = run.missionSummary;

  const repoRelativePaths = [
    ...new Set(
      [
        ...missionSummary.changedRepoRelativePaths,
        ...run.plan!.touchedRepoRelativePaths,
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

  return repoRelativePaths.map((repoRelativePath) => {
    const repoSlug = slugifyFragment(repoRelativePath) || "root";
    return {
      id: `learned-${run.runId}-${repoSlug}-${hashFragment(repoRelativePath)}`,
      projectKey: run.projectKey,
      repoRelativePath,
      type: "example",
      title: `Observed mission pattern from ${run.ticketId}`,
      content:
        `Observed from "${run.ticketSummary}" in ${repoRelativePath}. ` +
        `Completed work: ${missionSummary.completedWork.trim()}. ` +
        (validationCommands.length > 0 ? `Passing validation: ${validationCommands}.` : "Passing validation was recorded.") +
        proofSummary,
      tags: [
        "learned",
        `run:${run.runId}`,
        `ticket:${run.ticketId}`,
        `classification:${classification.kind}`,
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
];
