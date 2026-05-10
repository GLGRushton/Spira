import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type { WorkSessionSnapshot } from "@spira/shared";
import {
  escapePipes,
  formatDurationMs,
  formatTimestamp,
  sanitizeFilenameFragment,
} from "../../missions/post-mortem-generator.js";
import { atomicWritePostmortem } from "../../missions/postmortem-writer.js";
import type { WorkSessionOutcomeClassification } from "./work-session-outcome.js";

/**
 * WorkSession post-mortem stub generator + writer.
 *
 * Pure stub generator that mirrors the mission post-mortem shape, scoped to a
 * workSession's data: phase timing table, validation outcomes, fix iterations, and
 * the outcome classification. Filed as `reports/spira-worksession-{date}-{sessionId}.md`
 * relative to the configured workspaceRoot. Best-effort: skipped when no workspace is
 * configured (writes nothing). Atomic create (`flag: "wx"`) so a handwritten
 * post-mortem for the same session is never clobbered.
 */

const formatDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Filename includes a millisecond suffix so a same-day reopen + close cycle (which the
 * `clearWorkSessionState` path explicitly supports) doesn't silently EEXIST and lose its
 * post-mortem. Sanitization shares with the mission post-mortem; falls back to the raw
 * sessionId if the sanitizer reduces it to empty.
 */
export const buildWorkSessionPostmortemFilename = (snapshot: WorkSessionSnapshot, closedAt: number): string => {
  const slug = sanitizeFilenameFragment(snapshot.sessionId) || snapshot.sessionId.replace(/[^a-z0-9-]+/giu, "");
  return `spira-worksession-${formatDate(closedAt)}-${slug}-${closedAt}.md`;
};

export const generateWorkSessionPostmortem = (
  snapshot: WorkSessionSnapshot,
  outcome: WorkSessionOutcomeClassification,
): string => {
  const closedAt = snapshot.completedAt ?? snapshot.updatedAt ?? snapshot.createdAt;
  const totalElapsedMs = Math.max(0, closedAt - snapshot.createdAt);
  const lines: string[] = [];
  lines.push(`# Spira WorkSession post-mortem — ${snapshot.sessionId}`);
  lines.push("");
  lines.push(`Station: ${snapshot.stationId}`);
  lines.push(`Started: ${formatTimestamp(snapshot.createdAt)}`);
  lines.push(`Closed:  ${formatTimestamp(closedAt)}`);
  lines.push(`Total elapsed: ${formatDurationMs(totalElapsedMs)}`);
  lines.push(`Outcome: **${outcome.kind}** — ${outcome.rationale}`);
  if (outcome.reason) lines.push(`Reason: ${outcome.reason}`);
  lines.push("");
  lines.push("## Task");
  lines.push("");
  lines.push(snapshot.taskText.trim() || "(no task text recorded)");
  lines.push("");

  // Phase timing table
  lines.push("## Phase timings");
  if (snapshot.phaseHistory.length === 0) {
    lines.push("");
    lines.push("No phase history recorded.");
  } else {
    lines.push("");
    lines.push("| Phase | Status | Duration | Summary |");
    lines.push("| --- | --- | ---: | --- |");
    for (const entry of snapshot.phaseHistory) {
      const end = entry.completedAt ?? entry.updatedAt;
      const duration = entry.startedAt && end ? Math.max(0, end - entry.startedAt) : null;
      lines.push(
        `| ${entry.phase} | ${entry.status} | ${duration === null ? "—" : formatDurationMs(duration)} | ${entry.summary ? escapePipes(entry.summary) : ""} |`,
      );
    }
  }
  lines.push("");

  // Validations
  lines.push("## Validation outcomes");
  const validations = snapshot.validationResults ?? [];
  if (validations.length === 0) {
    lines.push("");
    lines.push("No validation runs recorded.");
  } else {
    lines.push("");
    lines.push("| Command | Success | Summary | Error |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of validations) {
      lines.push(
        `| \`${escapePipes(entry.command)}\` | ${entry.success ? "yes" : "no"} | ${escapePipes(entry.summary)} | ${escapePipes(entry.errorMessage ?? "")} |`,
      );
    }
  }
  lines.push("");

  // Iterations + repeat failures
  if ((snapshot.fixIterationCount ?? 0) > 0 || (snapshot.repeatFailureCount ?? 0) > 0) {
    lines.push("## Friction signals");
    lines.push("");
    if ((snapshot.fixIterationCount ?? 0) > 0) {
      lines.push(`- Fix iterations: ${snapshot.fixIterationCount}`);
    }
    if ((snapshot.repeatFailureCount ?? 0) > 0) {
      lines.push(`- Repeat failures: ${snapshot.repeatFailureCount}`);
    }
    if (snapshot.lastValidationFingerprint) {
      lines.push(`- Last validation fingerprint: \`${snapshot.lastValidationFingerprint}\``);
    }
    lines.push("");
  }

  // Files changed
  if (snapshot.changedFiles && snapshot.changedFiles.length > 0) {
    lines.push("## Files changed");
    lines.push("");
    for (const file of snapshot.changedFiles) lines.push(`- ${file}`);
    lines.push("");
  }

  // Open observations placeholder
  lines.push("## Open observations");
  lines.push("");
  if (outcome.kind === "fail-final" || outcome.kind === "fail-with-recovery") {
    lines.push(`**Closed with friction.** ${outcome.rationale}`);
    lines.push("");
  }
  lines.push("<!-- Reviewer notes go here. -->");
  lines.push("");

  return lines.join("\n");
};

/**
 * Write the stub to disk. Skipped when there's no workspace root or no memory DB to
 * resolve one. Returns the file path on success or null on skip; throws only on
 * unexpected I/O errors that aren't EEXIST (atomic-create collision is a no-op).
 */
export const writeWorkSessionPostmortem = async (
  memoryDb: SpiraMemoryDatabase | null,
  snapshot: WorkSessionSnapshot,
  outcome: WorkSessionOutcomeClassification,
): Promise<string | null> => {
  if (!memoryDb) return null;
  const workspaceRoot = memoryDb.getProjectWorkspaceRoot();
  const closedAt = snapshot.completedAt ?? snapshot.updatedAt ?? Date.now();
  const filename = buildWorkSessionPostmortemFilename(snapshot, closedAt);
  const markdown = generateWorkSessionPostmortem(snapshot, outcome);
  const result = await atomicWritePostmortem({ workspaceRoot, filename, markdown });
  return result.status === "written" ? result.path : null;
};
