import type { MissionValidationProfileScope } from "./ticket-run-types.js";

/**
 * Summary of what a single closed mission proposed, auto-promoted, and (for first-mission
 * bootstrap) drafted. Surfaced in the close-screen learning panel so the operator can see
 * what was learned and one-click accept anything below the auto-promotion threshold.
 *
 * Both `proposed` and `bootstrap*` are *drafts*: nothing is written to the durable
 * profile/intelligence tables until the operator promotes them via
 * `missions:learning:promote-candidate`.
 */
export interface MissionLearningSummary {
  runId: string;
  /** Items that crossed the auto-promotion threshold and are already saved. Informational only. */
  autoPromoted: PromotedLearningItem[];
  /** Items below threshold awaiting one-click manual accept. */
  proposed: ProposedLearningItem[];
  /**
   * Draft repo profile for the first-mission bootstrap case (project has no `repo_profiles`
   * row). Null when at least one row already exists for the project.
   */
  bootstrapProfile: RepoProfileDraft | null;
  /**
   * Draft validation profiles assembled from the run's successful shell commands. Empty
   * unless `bootstrapProfile` is non-null OR the operator explicitly opens the panel for
   * a project that has profiles but no validations registered yet.
   */
  bootstrapValidationProfiles: ValidationProfileDraft[];
}

export type LearningItemKind =
  | "validation-profile"
  | "repo-intelligence-briefing"
  | "repo-intelligence-pitfall"
  | "repo-intelligence-example";

/**
 * Discriminator for the manual-promote path. The renderer panel sends one of these
 * alongside the candidateId so the backend knows which persistence path to take.
 */
export type PromoteLearningCandidateKind =
  | "validation-profile-proposed"
  | "validation-profile-bootstrap"
  | "repo-intelligence"
  | "repo-profile-bootstrap";

export interface PromotedLearningItem {
  kind: LearningItemKind;
  /** Stable id of the persisted row (validation_profile id or repo_intelligence_entries id). */
  candidateId: string;
  title: string;
  /** Free-text rationale for why this was promoted ("5/5 confirming missions" etc). */
  rationale: string;
  /** Whether the auto path or the operator clicked accept. Drives the audit-feed badge. */
  acceptanceMode: "automatic" | "manual";
  occurredAt: number;
}

export interface ProposedLearningItem {
  kind: LearningItemKind;
  candidateId: string;
  title: string;
  /** Operator-facing summary of why it didn't auto-promote ("1/5 confirming missions"). */
  rationale: string;
  /** Numeric "current score" if known; null when the threshold isn't a count. */
  currentScore: number | null;
  threshold: number | null;
}

export interface RepoProfileDraft {
  projectKey: string;
  repoRelativePath: string;
  displayName: string;
  defaultBranch: string | null;
  defaultBuildWorkingDirectory: string | null;
  requiredSdks: string[];
  notes: string | null;
}

export interface ValidationProfileDraft {
  /** Stable id derived from (projectKey, repoRelativePath, command, cwd). */
  candidateId: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  scope: MissionValidationProfileScope;
  kind: string;
  command: string;
  workingDirectory: string;
  /** Inferred from the run's observation of this command. */
  successCount: number;
  observedRuntimeMs: number | null;
}

/**
 * Acceptance-mode source enum extension. Promoted entries carry this in their tags so the
 * audit feed can render the distinction.
 */
export const LEARNING_ACCEPTANCE_TAG_PREFIX = "acceptance:" as const;
export const LEARNING_MANUAL_ACCEPT_TAG = "acceptance:manual" as const;
export const LEARNING_AUTOMATIC_ACCEPT_TAG = "acceptance:automatic" as const;
