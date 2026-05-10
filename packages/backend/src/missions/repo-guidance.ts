import type {
  RepoIntelligenceRecord,
  RepoProfileRecord,
  SpiraMemoryDatabase,
  ValidationProfileRecord,
} from "@spira/memory-db";
import type { TicketRunSummary } from "@spira/shared";
import { DEFAULT_PROMOTION_THRESHOLDS } from "./learned-candidate-promoter.js";
import { parseLearnedTagState } from "./learned-tag-state.js";
import { buildMissionScopePaths } from "./mission-intelligence.js";

/**
 * Repo-aware prompt context.
 *
 * Builds a stable `## Repo guidance` section to inject into mission prompts so the agent
 * starts with the operator-curated knowledge for each impacted repo: the profile (registry,
 * default branch, required SDKs), the top approved briefings + pitfalls, and the registered
 * default validation commands. Section wording is intentionally stable so the prompt prefix
 * is prompt-cacheable across attempts.
 *
 * Returns null when there's nothing useful to inject (no profile, no entries, no validations
 * for the run's scope) — the caller can skip the section entirely.
 */

const MAX_BRIEFINGS_PER_SECTION = 3;
const MAX_PITFALLS_PER_SECTION = 3;
const MAX_VALIDATIONS_PER_SECTION = 6;

export interface BuildRepoGuidanceSectionOptions {
  /** Override for tests; defaults to memoryDb-backed fetch. */
  fetchProfile?: (projectKey: string) => RepoProfileRecord | null;
  fetchIntelligence?: (
    projectKey: string,
    repoPaths: readonly string[],
  ) => readonly RepoIntelligenceRecord[];
  fetchValidations?: (
    projectKey: string,
    repoPaths: readonly string[],
  ) => readonly ValidationProfileRecord[];
}

const formatList = (label: string, items: readonly string[]): string | null => {
  if (items.length === 0) return null;
  return `${label}: ${items.join(", ")}`;
};

const formatProfile = (profile: RepoProfileRecord): string => {
  const lines = [`### Project ${profile.projectKey} (${profile.displayName})`];
  if (profile.description) lines.push(profile.description);
  const meta: string[] = [];
  if (profile.defaultBranch) meta.push(`default branch: ${profile.defaultBranch}`);
  if (profile.defaultBuildWorkingDirectory) {
    meta.push(`build dir: ${profile.defaultBuildWorkingDirectory}`);
  }
  if (profile.defaultRegistry) meta.push(`registry: ${profile.defaultRegistry}`);
  if (meta.length > 0) lines.push(meta.join(" · "));
  const requirements = [
    formatList("Required SDKs", profile.requiredSdks),
    formatList("Required env vars", profile.requiredEnvVars),
    formatList("Registry hints", profile.registryHints),
    formatList("User-facing copy globs", profile.userFacingCopyGlobs),
    formatList("UI test globs", profile.uiTestGlobs),
  ].filter((entry): entry is string => entry !== null);
  for (const requirement of requirements) lines.push(`- ${requirement}`);
  if (profile.notes) lines.push(`Notes: ${profile.notes}`);
  return lines.join("\n");
};

/**
 * Confidence band for an auto-promoted learned entry. Computed at prompt-build time so
 * the band tracks the current threshold rather than the threshold at promotion time.
 *  - "high-confidence" when the entry has ≥2× threshold contributing runs
 *  - "promoted" when the entry was auto-promoted but is below 2× threshold
 *  - "provisional" when the entry is approved but has no contributing runs (e.g. manually
 *     approved before the learner caught up)
 *  - null when the entry is not learned (no banding for hand-curated entries)
 */
const computeTrustBand = (entry: RepoIntelligenceRecord): "high-confidence" | "promoted" | "provisional" | null => {
  if (entry.source !== "learned") return null;
  const state = parseLearnedTagState(entry);
  const threshold = DEFAULT_PROMOTION_THRESHOLDS[entry.type];
  if (state.promotedFormulaVersion !== null && state.promotedRunIds.length > 0) {
    if (state.promotedRunIds.length >= threshold * 2) return "high-confidence";
    return "promoted";
  }
  return "provisional";
};

const formatIntelligenceGroup = (entries: readonly RepoIntelligenceRecord[], heading: string): string | null => {
  if (entries.length === 0) return null;
  const lines = [`### ${heading}`];
  for (const entry of entries) {
    const scope = entry.repoRelativePath ?? "any repo";
    const band = computeTrustBand(entry);
    const trustNote = band ? ` _[${band}]_` : "";
    lines.push(`- **${entry.title}** (${scope})${trustNote}: ${entry.content}`);
  }
  return lines.join("\n");
};

const formatValidations = (validations: readonly ValidationProfileRecord[]): string | null => {
  if (validations.length === 0) return null;
  const lines = ["### Default validation commands"];
  for (const validation of validations) {
    const scope = validation.repoRelativePath ?? "(any repo)";
    const runtime =
      validation.lastObservedRuntimeMs ?? validation.expectedRuntimeMs;
    const runtimeNote = runtime !== null ? ` (~${Math.round(runtime / 1000)}s)` : "";
    lines.push(`- **${validation.kind}** for ${scope}: \`${validation.command}\` in \`${validation.workingDirectory}\`${runtimeNote}`);
  }
  return lines.join("\n");
};

/**
 * Compose the `## Repo guidance` section for a mission prompt. Returns null when nothing is
 * worth saying for this run (no profile, no approved entries, no validations).
 */
export const buildRepoGuidanceSection = (
  memoryDb: SpiraMemoryDatabase,
  run: TicketRunSummary,
  options: BuildRepoGuidanceSectionOptions = {},
): string | null => {
  const projectKey = run.projectKey?.trim();
  if (!projectKey) return null;

  const repoPaths = buildMissionScopePaths(run);

  const fetchProfile = options.fetchProfile ?? ((key: string) => memoryDb.getRepoProfile(key));
  const fetchIntelligence =
    options.fetchIntelligence ??
    ((key: string, paths: readonly string[]) =>
      memoryDb.listRepoIntelligence({ projectKey: key, repoRelativePaths: paths, limit: 50 }));
  const fetchValidations =
    options.fetchValidations ??
    ((key: string, paths: readonly string[]) =>
      memoryDb.listValidationProfiles({ projectKey: key, repoRelativePaths: paths, limit: 50 }));

  const profile = fetchProfile(projectKey);
  const intelligence = fetchIntelligence(projectKey, repoPaths);
  const validations = fetchValidations(projectKey, repoPaths);

  const briefings = intelligence
    .filter((entry) => entry.type === "briefing" && entry.approved)
    .slice(0, MAX_BRIEFINGS_PER_SECTION);
  const pitfalls = intelligence
    .filter((entry) => entry.type === "pitfall" && entry.approved)
    .slice(0, MAX_PITFALLS_PER_SECTION);
  const trimmedValidations = validations.slice(0, MAX_VALIDATIONS_PER_SECTION);

  if (!profile && briefings.length === 0 && pitfalls.length === 0 && trimmedValidations.length === 0) {
    return null;
  }

  const sections: string[] = ["## Repo guidance"];
  sections.push(
    "Operator-curated knowledge for the impacted repos. Treat as defaults: deviate when the change at hand demands it, but don't re-derive from scratch.",
  );
  if (profile) sections.push(formatProfile(profile));
  const briefingsBlock = formatIntelligenceGroup(briefings, "Briefings");
  if (briefingsBlock) sections.push(briefingsBlock);
  const pitfallsBlock = formatIntelligenceGroup(pitfalls, "Pitfalls");
  if (pitfallsBlock) sections.push(pitfallsBlock);
  const validationsBlock = formatValidations(trimmedValidations);
  if (validationsBlock) sections.push(validationsBlock);

  return sections.join("\n\n");
};
