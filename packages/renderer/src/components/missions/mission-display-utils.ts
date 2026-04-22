import type { MissionServiceProcessSummary, MissionServiceProfileSummary, TicketRunSummary } from "@spira/shared";

export const formatDiffDelta = (additions: number | null, deletions: number | null): string => {
  if (additions === null && deletions === null) {
    return "Binary or metadata change";
  }

  return `+${additions ?? 0} / -${deletions ?? 0}`;
};

export const isMissionServiceProcessActive = (process: MissionServiceProcessSummary): boolean =>
  process.state === "starting" || process.state === "running" || process.state === "stopping";

export const describeMissionServiceLauncher = (
  profile: MissionServiceProfileSummary | MissionServiceProcessSummary,
): string => {
  switch (profile.launcher) {
    case "translated-iisexpress":
      return "IIS Express profile (translated)";
    default:
      return "Project profile";
  }
};

export const describeMissionServiceState = (state: MissionServiceProcessSummary["state"]): string => {
  switch (state) {
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "stopped":
      return "Stopped";
    case "error":
      return "Error";
  }
};

export const formatMissionServiceUrls = (urls: string[]): string =>
  urls.length > 0 ? urls.join(" • ") : "No URL declared";

export const describeRunStatus = (run: TicketRunSummary): string => {
  switch (run.status) {
    case "starting":
      return "Starting";
    case "ready":
      return "Ready";
    case "blocked":
      return "Blocked";
    case "working":
      return "Working";
    case "awaiting-review":
      return "Awaiting review";
    case "error":
      return "Error";
    case "done":
      return "Done";
  }
};

export const describeAttemptStatus = (status: TicketRunSummary["attempts"][number]["status"]): string => {
  switch (status) {
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Needs review";
    case "cancelled":
      return "Cancelled";
  }
};

export const describeMissionNextAction = (
  run: TicketRunSummary,
): { label: string; detail: string; complete: boolean } => {
  const currentAttempt =
    [...run.attempts].reverse().find((attempt) => attempt.status === "running") ?? run.attempts.at(-1) ?? null;
  const attemptStartedAt = currentAttempt?.startedAt ?? null;
  const classificationSaved = attemptStartedAt !== null && (run.classification?.updatedAt ?? 0) >= attemptStartedAt;
  const planSaved = attemptStartedAt !== null && (run.plan?.updatedAt ?? 0) >= attemptStartedAt;
  const summarySaved = attemptStartedAt !== null && (run.missionSummary?.updatedAt ?? 0) >= attemptStartedAt;
  const kickoffComplete =
    classificationSaved ||
    planSaved ||
    summarySaved ||
    run.validations.length > 0 ||
    run.proofStrategy !== null ||
    (attemptStartedAt !== null &&
      run.missionPhase === "classification" &&
      run.missionPhaseUpdatedAt > attemptStartedAt);
  const hasPassingValidation = run.validations.some((validation) => validation.status === "passed");
  const hasFailingValidation = run.validations.some((validation) => validation.status === "failed");
  const hasPendingValidation = run.validations.some((validation) => validation.status === "pending");
  const proofRequired = run.classification?.proofRequired === true;
  const proofStrategySaved =
    !proofRequired || (attemptStartedAt !== null && (run.proofStrategy?.updatedAt ?? 0) >= attemptStartedAt);
  const proofPassed = !proofRequired || run.proof.status === "passed";

  if (!kickoffComplete) {
    return {
      label: "Load mission context",
      detail: "Shinra must call get_mission_context before doing real work.",
      complete: false,
    };
  }
  if (!classificationSaved) {
    return {
      label: "Save classification",
      detail: "Classification should be stored before planning or implementation.",
      complete: false,
    };
  }
  if (!planSaved) {
    return {
      label: "Save plan",
      detail: "The mission plan must be recorded before write-capable actions unlock.",
      complete: false,
    };
  }
  if (!hasPassingValidation || hasFailingValidation || hasPendingValidation) {
    return {
      label: "Record validation",
      detail: hasPendingValidation
        ? "A validation is still pending, so the pass cannot finish yet."
        : hasFailingValidation
          ? "A failing validation is recorded and must be resolved before the pass can finish."
          : "At least one passing validation should be recorded before the pass can finish.",
      complete: false,
    };
  }
  if (proofRequired && !proofStrategySaved) {
    return {
      label: "Save proof strategy",
      detail: "UI work needs a targeted proof strategy before proof can be recorded.",
      complete: false,
    };
  }
  if (proofRequired && !proofPassed) {
    return {
      label: "Record proof result",
      detail: "This mission still needs a passing proof result.",
      complete: false,
    };
  }
  if (!summarySaved) {
    return { label: "Save summary", detail: "The final mission summary is still missing.", complete: false };
  }
  return {
    label: "Mission workflow complete",
    detail: "Lifecycle requirements are satisfied for this pass.",
    complete: true,
  };
};
