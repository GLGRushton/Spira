import {
  describeTicketRunMissionNextAction,
  getTicketRunMissionWorkflowState,
  type MissionServiceProcessSummary,
  type MissionServiceProfileSummary,
  type TicketRunSummary,
} from "@spira/shared";

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
  const workflow = getTicketRunMissionWorkflowState(run);
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
      return workflow.nextAction === "complete-pass" ? "Ready to close" : "Awaiting review";
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
): { label: string; detail: string; complete: boolean } => describeTicketRunMissionNextAction(run);
