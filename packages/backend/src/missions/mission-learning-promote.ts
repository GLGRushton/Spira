import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  MissionLearningSummary,
  PromoteLearningCandidateKind,
  RepoProfileDraft,
  TicketRunSummary,
  ValidationProfileDraft,
} from "@spira/shared";
import { LEARNING_MANUAL_ACCEPT_TAG } from "@spira/shared";
import { TAG_PREFIXES } from "./learned-tag-state.js";
import { inferValidationKindFromCommand } from "./validation-candidate-learner.js";

/**
 * Manual accept for a single candidate surfaced in the close-screen learning panel.
 * Routes to the correct persistence path based on `kind`. Promoted entries get the
 * `acceptance:manual` tag so the IntelligenceAuditEditor can render the badge.
 *
 * Returns true on success (row persisted), false on no-op (e.g. id not found in the
 * summary, summary already promoted). Throws on a true persistence failure so the caller
 * can surface a request-error.
 */
export interface PromoteLearningCandidateInput {
  memoryDb: SpiraMemoryDatabase;
  run: TicketRunSummary;
  summary: MissionLearningSummary;
  /** Pre-loaded mission events. Avoids a third listMissionEvents call inside the helper. */
  events: readonly import("@spira/memory-db").MissionEventRecord[];
  candidateId: string;
  kind: PromoteLearningCandidateKind;
}

/**
 * `validation_profiles` has no `tags` column today, so the manual-accept signal cannot
 * land on the row itself. Audit-feed callers detect manual promotion by reading the
 * `learned-candidate-promoted` event's `acceptanceMode` metadata instead. When the
 * schema gains a tags column, thread `LEARNING_MANUAL_ACCEPT_TAG` through here.
 */
const persistValidationDraft = (memoryDb: SpiraMemoryDatabase, draft: ValidationProfileDraft): void => {
  const validatedKind = inferValidationKindFromCommand(draft.command);
  if (validatedKind === null) {
    throw new Error(`Validation profile draft for command "${draft.command}" has no inferable kind.`);
  }
  memoryDb.upsertValidationProfile({
    id: draft.candidateId,
    projectKey: draft.projectKey,
    repoRelativePath: draft.repoRelativePath,
    scope: draft.scope,
    label: `Manual: ${draft.kind} (${draft.command})`,
    kind: validatedKind,
    command: draft.command,
    workingDirectory: draft.workingDirectory,
    confidence: 0.7,
    expectedRuntimeMs: draft.observedRuntimeMs,
    lastObservedRuntimeMs: draft.observedRuntimeMs,
    source: "learned",
  });
};

const persistRepoProfileDraft = (memoryDb: SpiraMemoryDatabase, draft: RepoProfileDraft): void => {
  memoryDb.upsertRepoProfile({
    projectKey: draft.projectKey,
    repoRelativePath: draft.repoRelativePath,
    displayName: draft.displayName,
    defaultBranch: draft.defaultBranch,
    defaultBuildWorkingDirectory: draft.defaultBuildWorkingDirectory,
    requiredSdks: draft.requiredSdks,
    notes: draft.notes,
    source: "learned",
  });
};

export const promoteLearningCandidate = (input: PromoteLearningCandidateInput): boolean => {
  const { memoryDb, summary, candidateId, kind } = input;

  if (kind === "repo-profile-bootstrap") {
    if (!summary.bootstrapProfile) return false;
    persistRepoProfileDraft(memoryDb, summary.bootstrapProfile);
    return true;
  }

  if (kind === "validation-profile-bootstrap") {
    const draft = summary.bootstrapValidationProfiles.find((entry) => entry.candidateId === candidateId);
    if (!draft) return false;
    persistValidationDraft(memoryDb, draft);
    return true;
  }

  if (kind === "validation-profile-proposed") {
    const proposed = summary.proposed.find(
      (entry) => entry.kind === "validation-profile" && entry.candidateId === candidateId,
    );
    if (!proposed) return false;
    // The proposed validation profile candidate is recorded in mission_events but isn't
    // in validation_profiles yet. Pull the source event from the pre-loaded events array.
    const sourceEvent = input.events.find(
      (event) =>
        event.eventType === "validation-profile-candidate-observed" &&
        typeof (event.metadata as { candidateId?: unknown } | null)?.candidateId === "string" &&
        (event.metadata as { candidateId: string }).candidateId === candidateId,
    );
    if (!sourceEvent) return false;
    const meta = (sourceEvent.metadata ?? {}) as Record<string, unknown>;
    const command = typeof meta["command"] === "string" ? (meta["command"] as string) : null;
    const workingDirectory = typeof meta["workingDirectory"] === "string" ? (meta["workingDirectory"] as string) : null;
    const projectKey = typeof meta["projectKey"] === "string" ? (meta["projectKey"] as string) : null;
    const repoRelativePath = typeof meta["repoRelativePath"] === "string" ? (meta["repoRelativePath"] as string) : null;
    if (!command || !workingDirectory) return false;
    const validatedKind = inferValidationKindFromCommand(command);
    if (validatedKind === null) return false;
    memoryDb.upsertValidationProfile({
      id: candidateId,
      projectKey,
      repoRelativePath,
      scope: projectKey ? "project" : "global",
      label: `Manual: ${validatedKind} (${command})`,
      kind: validatedKind,
      command,
      workingDirectory,
      confidence: 0.7,
      source: "learned",
    });
    return true;
  }

  if (kind === "repo-intelligence") {
    const proposed = summary.proposed.find((entry) => entry.candidateId === candidateId);
    if (!proposed) return false;
    const existing = memoryDb.getRepoIntelligenceEntry(candidateId);
    if (!existing) return false;
    // Add the manual-accept tag + flip approval to true. Re-uses the upsert path so the
    // tag union doesn't drop existing tags.
    const tags = [...new Set([...existing.tags, LEARNING_MANUAL_ACCEPT_TAG, TAG_PREFIXES.learned])];
    memoryDb.upsertRepoIntelligence({
      id: existing.id,
      projectKey: existing.projectKey,
      repoRelativePath: existing.repoRelativePath,
      type: existing.type,
      title: existing.title,
      content: existing.content,
      tags,
      source: existing.source,
      approved: true,
      createdAt: existing.createdAt,
    });
    return true;
  }

  return false;
};
