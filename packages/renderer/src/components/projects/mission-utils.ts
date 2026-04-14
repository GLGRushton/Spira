import type { TicketRunSummary, YouTrackTicketSummary } from "@spira/shared";

export type MissionLaneTabId = "launch-bay" | "flight-deck" | "dry-dock";

export interface MissionCollections {
  pendingTickets: YouTrackTicketSummary[];
  activeRuns: TicketRunSummary[];
  completedRuns: TicketRunSummary[];
}

const compareRunPriority = (left: TicketRunSummary, right: TicketRunSummary): number => {
  const leftLane = resolveRunTab(left);
  const rightLane = resolveRunTab(right);

  if (leftLane !== rightLane) {
    const lanePriority: Record<MissionLaneTabId, number> = {
      "flight-deck": 3,
      "launch-bay": 2,
      "dry-dock": 1,
    };
    return lanePriority[leftLane] - lanePriority[rightLane];
  }

  return left.updatedAt - right.updatedAt;
};

export const buildRunByTicketId = (runs: TicketRunSummary[]): Map<string, TicketRunSummary> => {
  const runByTicketId = new Map<string, TicketRunSummary>();

  for (const run of runs) {
    const current = runByTicketId.get(run.ticketId);
    if (!current || compareRunPriority(run, current) > 0) {
      runByTicketId.set(run.ticketId, run);
    }
  }

  return runByTicketId;
};

export const resolveRunTab = (run: TicketRunSummary): MissionLaneTabId => {
  if (run.status === "done") {
    return "dry-dock";
  }

  if (run.status === "error") {
    return "launch-bay";
  }

  return "flight-deck";
};

export const splitMissionCollections = (
  tickets: YouTrackTicketSummary[],
  runs: TicketRunSummary[],
): MissionCollections => {
  const runByTicketId = buildRunByTicketId(runs);

  return {
    pendingTickets: tickets.filter((ticket) => {
      const run = runByTicketId.get(ticket.id);
      return !run || resolveRunTab(run) === "launch-bay";
    }),
    activeRuns: runs.filter((run) => resolveRunTab(run) === "flight-deck"),
    completedRuns: runs.filter((run) => resolveRunTab(run) === "dry-dock"),
  };
};
