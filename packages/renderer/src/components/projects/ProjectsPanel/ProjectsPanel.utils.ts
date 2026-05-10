import {
  DEFAULT_YOUTRACK_STATE_MAPPING,
  type MissionServiceProcessSummary,
  type MissionServiceProfileSummary,
  type ProjectRepoMappingsSnapshot,
  type TicketRunSummary,
  type YouTrackStateMapping,
  type YouTrackStatusSummary,
  normalizeYouTrackStateMapping,
} from "@spira/shared";
import type { MissionLaneTabId } from "../mission-utils.js";
import styles from "./ProjectsPanel.module.css";

export const EMPTY_SNAPSHOT: ProjectRepoMappingsSnapshot = {
  workspaceRoot: null,
  repos: [],
  mappings: [],
};

export const NEW_MAPPING_SENTINEL = "__new__";
export const YOUTRACK_TICKET_LIST_LIMIT = 50;

export type MissionsTabId = "quarterdeck" | MissionLaneTabId;
export type MissionSelection = { kind: "ticket"; ticketId: string } | { kind: "run"; runId: string };

export const MISSIONS_TAB_ORDER: MissionsTabId[] = ["quarterdeck", "launch-bay", "flight-deck", "dry-dock"];

export const buildManagedSubmoduleKey = (runId: string, canonicalUrl: string): string => `${runId}:${canonicalUrl}`;

const ACTIVE_MISSION_SERVICE_STATES = new Set<MissionServiceProcessSummary["state"]>([
  "starting",
  "running",
  "stopping",
]);

export const describeStatusTone = (status: YouTrackStatusSummary | null): string => {
  if (!status || status.state === "missing-config" || status.state === "disabled") {
    return styles.statusWarning;
  }

  if (status.state === "connected") {
    return styles.statusConnected;
  }

  return styles.statusError;
};

export const describeStatusLabel = (status: YouTrackStatusSummary | null): string => {
  if (!status) {
    return "Checking";
  }

  switch (status.state) {
    case "connected":
      return "Connected";
    case "disabled":
      return "Disabled";
    case "missing-config":
      return "Needs setup";
    case "error":
      return "Error";
  }
};

export const formatTicketUpdatedAt = (updatedAt: number | null): string =>
  updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : "Update time unavailable";

export const formatStateList = (states: string[] | undefined): string =>
  states && states.length > 0 ? states.join(", ") : "None";

export const cloneYouTrackStateMapping = (
  mapping: YouTrackStateMapping | null | undefined = DEFAULT_YOUTRACK_STATE_MAPPING,
): YouTrackStateMapping => normalizeYouTrackStateMapping(mapping);

export const formatDiffDelta = (additions: number | null, deletions: number | null): string => {
  if (additions === null && deletions === null) {
    return "Binary or metadata change";
  }
  return `+${additions ?? 0} / -${deletions ?? 0}`;
};

export const getDiffStatusTone = (status: string): string => {
  switch (status) {
    case "A":
      return styles.diffStatusAdded;
    case "D":
      return styles.diffStatusDeleted;
    default:
      return styles.diffStatusModified;
  }
};

export const getDiffLineTone = (line: string): string => {
  if (line.startsWith("@@")) {
    return styles.diffLineModified;
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return styles.diffLineAdded;
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return styles.diffLineDeleted;
  }
  if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
    return styles.diffLineMeta;
  }
  return "";
};

export const isMissionServiceProcessActive = (process: MissionServiceProcessSummary): boolean =>
  ACTIVE_MISSION_SERVICE_STATES.has(process.state);

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

export const getMissionServiceStateTone = (state: MissionServiceProcessSummary["state"]): string => {
  switch (state) {
    case "starting":
      return styles.serviceStateStarting;
    case "running":
      return styles.serviceStateRunning;
    case "stopping":
      return styles.serviceStateStopping;
    case "error":
      return styles.serviceStateError;
    default:
      return styles.serviceStateStopped;
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
    case "aborted":
      return "Aborted";
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

export const describeMissionTab = (tabId: MissionLaneTabId): string => {
  switch (tabId) {
    case "launch-bay":
      return "Launch bay";
    case "flight-deck":
      return "Flight deck";
    case "dry-dock":
      return "Dry dock";
  }
};

export const getTicketStartBlocker = (
  isMapped: boolean,
  repoCount: number,
  existingRun: TicketRunSummary | null,
): string | null => {
  if (existingRun) {
    return null;
  }

  if (!isMapped || repoCount === 0) {
    return "Map a repo first";
  }

  return null;
};
