import type { WorkSessionClassification, WorkSessionIntent, WorkSessionMode } from "@spira/shared";

export interface WorkSessionGateInput {
  text: string;
  missionRunId?: string | null;
  hasActiveWorkSession?: boolean;
}

export interface WorkSessionGateDecision {
  mode: WorkSessionMode;
  reason: string;
  classification: WorkSessionClassification | null;
  startsNewSession?: boolean;
}

const WORK_VERBS = [
  "add",
  "audit",
  "build",
  "change",
  "debug",
  "fix",
  "implement",
  "investigate",
  "patch",
  "plan",
  "refactor",
  "review",
  "repair",
  "rewrite",
  "update",
  "wire",
];

const CODE_QUALIFIERS = [
  "api",
  "bug",
  "build",
  "class",
  "code",
  "component",
  "feature",
  "file",
  "function",
  "module",
  "repo",
  "repository",
  "renderer",
  "test",
  "tests",
  "ticket",
  "type",
  "ui",
];

const PLAN_QUALIFIERS = ["plan", "phased", "phase", "approach", "slice"];
const REVIEW_QUALIFIERS = ["diff", "changes", "patch", "pr", "pull", "request"];
const CONTINUATION_CUES = ["continue", "continued", "continuing", "resume", "resuming"];

const normalize = (text: string): string => text.trim().toLowerCase();

const tokenize = (text: string): string[] =>
  normalize(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const hasAnyToken = (tokens: string[], candidates: readonly string[]): boolean =>
  tokens.some((token) => candidates.includes(token));

const hasFilePathCue = (text: string): boolean => /[a-z0-9_-]+\.(ts|tsx|js|jsx|json|md|css|scss)\b|[\\/]/i.test(text);

const classifyIntent = (tokens: string[]): WorkSessionIntent => {
  if (hasAnyToken(tokens, ["debug", "fix", "repair"])) {
    return "debug";
  }
  if (hasAnyToken(tokens, ["review", "audit"])) {
    return "review";
  }
  if (hasAnyToken(tokens, ["plan", "phased", "phase"])) {
    return "plan";
  }
  if (hasAnyToken(tokens, ["implement", "refactor", "rewrite", "wire", "change", "update", "patch", "add", "build"])) {
    return "edit";
  }
  return "question";
};

export const deriveWorkSessionClassification = (text: string): WorkSessionClassification => {
  const tokens = tokenize(text);
  const hasReviewIntent = hasAnyToken(tokens, ["review", "audit"]);
  const hasRepoQualifier =
    hasAnyToken(tokens, CODE_QUALIFIERS) ||
    hasAnyToken(tokens, PLAN_QUALIFIERS) ||
    hasAnyToken(tokens, REVIEW_QUALIFIERS) ||
    hasFilePathCue(text);
  const explicitWorkIntent =
    (hasAnyToken(tokens, WORK_VERBS) && hasRepoQualifier) || (hasReviewIntent && hasRepoQualifier);
  const requiresRepoContext =
    explicitWorkIntent ||
    hasRepoQualifier ||
    hasAnyToken(tokens, ["codebase", "repo", "repository", "module", "modules", "file", "files", "test", "tests"]);

  return {
    intent: classifyIntent(tokens),
    explicitWorkIntent,
    requiresRepoContext,
    confidence: "heuristic",
  };
};

export const decideWorkSessionMode = (input: WorkSessionGateInput): WorkSessionGateDecision => {
  if (input.missionRunId) {
    return {
      mode: "mission",
      reason: "Mission context is active.",
      classification: null,
      startsNewSession: false,
    };
  }
  const hasContinuationCue = hasAnyToken(tokenize(input.text), CONTINUATION_CUES);
  const classification = deriveWorkSessionClassification(input.text);
  if (input.hasActiveWorkSession) {
    if (classification.explicitWorkIntent) {
      return {
        mode: "work-session",
        reason: hasContinuationCue ? "Continuing an active WorkSession." : "Starting a new WorkSession task.",
        classification,
        startsNewSession: !hasContinuationCue,
      };
    }
    if (hasContinuationCue) {
      return {
        mode: "work-session",
        reason: "Continuing an active WorkSession.",
        classification,
        startsNewSession: false,
      };
    }
    return {
      mode: "conversational",
      reason: "Falling back to conversational mode for a non-work follow-up.",
      classification,
      startsNewSession: false,
    };
  }
  return classification.explicitWorkIntent
    ? {
        mode: "work-session",
        reason: "Explicit coding work intent detected.",
        classification,
        startsNewSession: true,
      }
    : {
        mode: "conversational",
        reason: "Defaulting to conversational mode on ambiguity.",
        classification,
        startsNewSession: false,
      };
};
