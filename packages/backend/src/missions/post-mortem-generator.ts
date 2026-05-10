import type {
  TicketRunMissionEventSummary,
  TicketRunMissionPhase,
  TicketRunMissionValidationRecord,
  TicketRunProofRunSummary,
  TicketRunSummary,
} from "@spira/shared";

const PHASE_DISPLAY: Record<TicketRunMissionPhase, string> = {
  classification: "Classify",
  plan: "Plan",
  implement: "Implement",
  validate: "Validate",
  proof: "Prove",
  summarize: "Summarize",
};

const PHASE_ORDER: TicketRunMissionPhase[] = [
  "classification",
  "plan",
  "implement",
  "validate",
  "proof",
  "summarize",
];

const formatTimestamp = (ms: number | null | undefined): string => {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return "—";
  }
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, "Z");
};

export const formatDurationMs = (ms: number): string => {
  if (ms < 1_000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`;
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1_000);
    return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
  }
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
};

interface PhaseTimingRow {
  phase: TicketRunMissionPhase;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
}

const computePhaseTimings = (
  events: readonly TicketRunMissionEventSummary[],
  runStart: number,
  runEnd: number,
): PhaseTimingRow[] => {
  // First event for each phase indicates phase entry. Phase ends when the next phase first appears
  // (or, for the trailing phase, at the run's completion).
  const firstEntryByPhase = new Map<TicketRunMissionPhase, number>();
  for (const event of [...events].sort((left, right) => left.occurredAt - right.occurredAt)) {
    const stage = event.stage as TicketRunMissionPhase | "system";
    if (stage === "system") continue;
    if (!firstEntryByPhase.has(stage)) {
      firstEntryByPhase.set(stage, event.occurredAt);
    }
  }

  const rows: PhaseTimingRow[] = [];
  for (let index = 0; index < PHASE_ORDER.length; index += 1) {
    const phase = PHASE_ORDER[index];
    if (phase === undefined) {
      continue;
    }
    const startedAt = firstEntryByPhase.get(phase) ?? null;
    let endedAt: number | null = null;
    for (let next = index + 1; next < PHASE_ORDER.length; next += 1) {
      const candidatePhase = PHASE_ORDER[next];
      if (candidatePhase === undefined) continue;
      const candidate = firstEntryByPhase.get(candidatePhase);
      if (candidate !== undefined) {
        endedAt = candidate;
        break;
      }
    }
    if (startedAt !== null && endedAt === null) {
      endedAt = runEnd;
    }
    const durationMs = startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : null;
    rows.push({ phase, startedAt, endedAt, durationMs });
  }
  // Anchor first phase to runStart if it never fired (rare — usually classification starts immediately).
  if (rows[0] && rows[0].startedAt === null) {
    rows[0].startedAt = runStart;
  }
  return rows;
};

const escapePipes = (value: string): string => value.replace(/\|/g, "\\|");

const renderHeader = (run: TicketRunSummary, runStart: number, runEnd: number): string => {
  const elapsed = Math.max(0, runEnd - runStart);
  const closedDate = new Date(runEnd).toISOString().slice(0, 10);
  return [
    `# ${run.ticketId} Mission Postmortem`,
    "",
    `**Ticket:** ${run.ticketId}${run.ticketUrl ? ` ([${run.ticketUrl}](${run.ticketUrl}))` : ""}`,
    `**Summary:** ${run.ticketSummary}`,
    `**Mission run:** \`${run.runId}\``,
    `**Date:** ${closedDate}`,
    `**Total elapsed time:** **${formatDurationMs(elapsed)}**`,
    "",
    "*Auto-generated stub. Fill in the open observations section before sharing.*",
    "",
  ].join("\n");
};

const renderPhaseTimings = (rows: readonly PhaseTimingRow[]): string => {
  const lines = [
    "## Stage timings",
    "",
    "| Stage | Entered | Left | Duration |",
    "| --- | --- | --- | ---: |",
  ];
  for (const row of rows) {
    lines.push(
      `| ${PHASE_DISPLAY[row.phase]} | ${formatTimestamp(row.startedAt)} | ${formatTimestamp(row.endedAt)} | ${row.durationMs !== null ? formatDurationMs(row.durationMs) : "—"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

const renderValidations = (validations: readonly TicketRunMissionValidationRecord[]): string => {
  if (validations.length === 0) {
    return "## Validations\n\nNo validations were recorded.\n";
  }
  const lines = [
    "## Validations",
    "",
    "| Kind | Status | Started | Duration | Command |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const validation of [...validations].sort((left, right) => left.startedAt - right.startedAt)) {
    const duration =
      validation.completedAt !== null ? formatDurationMs(Math.max(0, validation.completedAt - validation.startedAt)) : "running";
    lines.push(
      `| ${validation.kind} | ${validation.status} | ${formatTimestamp(validation.startedAt)} | ${duration} | \`${escapePipes(validation.command)}\` |`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

const renderProofRuns = (proofRuns: readonly TicketRunProofRunSummary[]): string => {
  if (proofRuns.length === 0) {
    return "## Proof runs\n\nNo proof runs were attempted.\n";
  }
  const lines = [
    "## Proof runs",
    "",
    "| Profile | Status | Exit | Started | Duration |",
    "| --- | --- | ---: | --- | --- |",
  ];
  for (const proofRun of [...proofRuns].sort((left, right) => left.startedAt - right.startedAt)) {
    const duration =
      proofRun.completedAt !== null ? formatDurationMs(Math.max(0, proofRun.completedAt - proofRun.startedAt)) : "running";
    lines.push(
      `| ${proofRun.profileLabel} | ${proofRun.status} | ${proofRun.exitCode ?? "—"} | ${formatTimestamp(proofRun.startedAt)} | ${duration} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
};

const renderFilesChanged = (run: TicketRunSummary): string => {
  const repos = run.missionSummary?.changedRepoRelativePaths ?? [];
  if (repos.length === 0) {
    return "## Files changed\n\nNo changed-repo summary was captured.\n";
  }
  const lines = ["## Files changed", "", "Repos touched:"];
  for (const repo of repos) {
    lines.push(`- ${repo}`);
  }
  if (run.commitMessageDraft) {
    lines.push("", "### Commit message draft", "", "```", run.commitMessageDraft, "```");
  }
  lines.push("");
  return lines.join("\n");
};

const renderOpenObservations = (events: readonly TicketRunMissionEventSummary[]): string => {
  const abortEvent = events.find((event) => event.eventType === "mission-aborted");
  const abortMetadata = abortEvent?.metadata as { reason?: unknown; phaseAtAbort?: unknown } | undefined;
  const lines = ["## Open observations", ""];
  if (abortEvent && typeof abortMetadata?.reason === "string") {
    lines.push(`**Mission was aborted in phase ${stableString(abortMetadata.phaseAtAbort)}.**`, "");
    lines.push(`Operator reason: ${abortMetadata.reason}`, "");
  }
  lines.push(
    "<!-- Reviewer notes go here. Worth capturing: -->",
    "<!-- - What slowed this mission down? -->",
    "<!-- - What helped? -->",
    "<!-- - What should the next mission of this shape do differently? -->",
    "",
  );
  return lines.join("\n");
};

const stableString = (value: unknown): string => (typeof value === "string" ? value : String(value ?? "unknown"));

/**
 * Build the markdown post-mortem stub for a closed mission. Pure function — no I/O.
 * Sections: header, stage timings, validations, proof runs, files changed, open observations.
 */
export const generateMissionPostmortem = (
  run: TicketRunSummary,
  events: readonly TicketRunMissionEventSummary[],
): string => {
  const runStart = run.startedAt ?? run.createdAt;
  // TicketRunSummary doesn't carry an explicit completedAt; updatedAt is the close timestamp
  // when status === "done" (which is how this generator is invoked from closeRun).
  const runEnd = run.updatedAt ?? run.createdAt ?? Date.now();
  const sortedEvents = [...events].sort((left, right) => left.occurredAt - right.occurredAt);
  const phaseRows = computePhaseTimings(sortedEvents, runStart, runEnd);
  return [
    renderHeader(run, runStart, runEnd),
    renderPhaseTimings(phaseRows),
    renderValidations(run.validations),
    renderProofRuns(run.proofRuns),
    renderFilesChanged(run),
    renderOpenObservations(events),
  ].join("\n");
};

/**
 * Default file name for the auto-generated post-mortem stub.
 * Format: `{ticketId}-mission-postmortem-{yyyy-mm-dd}.md` (lowercased ticket id).
 */
export const buildPostmortemFilename = (run: TicketRunSummary, closedAt: number): string => {
  const date = new Date(closedAt).toISOString().slice(0, 10);
  const safeTicketId = run.ticketId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safeTicketId}-mission-postmortem-${date}.md`;
};
