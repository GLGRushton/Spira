import type { TicketRunSummary, YouTrackTicketSummary } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { buildRunByTicketId, resolveRunTab, splitMissionCollections } from "./mission-utils.js";

const createTicket = (id: string, projectKey = "SPI"): YouTrackTicketSummary => ({
  id,
  summary: `${id} summary`,
  url: `https://example.test/issue/${id}`,
  projectKey,
  projectName: "Spira",
  state: "Open",
  assignee: "Shinra",
  updatedAt: 1_000,
});

const createRun = (ticketId: string, status: TicketRunSummary["status"]): TicketRunSummary => ({
  runId: `${ticketId}-run`,
  stationId: null,
  ticketId,
  ticketSummary: `${ticketId} summary`,
  ticketUrl: `https://example.test/issue/${ticketId}`,
  projectKey: "SPI",
  status,
  statusMessage: null,
  commitMessageDraft: null,
  missionPhase: "classification",
  missionPhaseUpdatedAt: 1_000,
  classification: null,
  plan: null,
  validations: [],
  proofStrategy: null,
  missionSummary: null,
  previousPassContext: null,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_500,
  worktrees: [],
  submodules: [],
  attempts: [],
  proof: {
    status: "not-run",
    lastProofRunId: null,
    lastProofProfileId: null,
    lastProofAt: null,
    lastProofSummary: null,
    staleReason: null,
  },
  proofRuns: [],
});

describe("resolveRunTab", () => {
  it("routes error runs back to the launch bay", () => {
    expect(resolveRunTab(createRun("SPI-1", "error"))).toBe("launch-bay");
  });

  it("routes completed runs to dry dock", () => {
    expect(resolveRunTab(createRun("SPI-1", "done"))).toBe("dry-dock");
  });

  it("keeps in-progress runs on the flight deck", () => {
    expect(resolveRunTab(createRun("SPI-1", "working"))).toBe("flight-deck");
  });

  it("routes ready and review states to the flight deck", () => {
    expect(resolveRunTab(createRun("SPI-1", "ready"))).toBe("flight-deck");
    expect(resolveRunTab(createRun("SPI-1", "awaiting-review"))).toBe("flight-deck");
  });
});

describe("buildRunByTicketId", () => {
  it("prefers a live run over an older completed run for the same ticket", () => {
    const completedRun = createRun("SPI-4", "done");
    const workingRun = { ...createRun("SPI-4", "working"), updatedAt: completedRun.updatedAt - 100 };

    expect(buildRunByTicketId([completedRun, workingRun]).get("SPI-4")).toMatchObject({
      runId: workingRun.runId,
      status: "working",
    });
  });
});

describe("splitMissionCollections", () => {
  it("keeps each mission in a single list", () => {
    const tickets = [createTicket("SPI-1"), createTicket("SPI-2"), createTicket("SPI-3")];
    const runs: TicketRunSummary[] = [createRun("SPI-2", "working"), createRun("SPI-3", "done")];

    const collections = splitMissionCollections(tickets, runs);

    expect(collections.pendingTickets.map((ticket) => ticket.id)).toEqual(["SPI-1"]);
    expect(collections.activeRuns.map((run) => run.ticketId)).toEqual(["SPI-2"]);
    expect(collections.completedRuns.map((run) => run.ticketId)).toEqual(["SPI-3"]);
  });

  it("keeps error runs in the pickup lane for retry", () => {
    const tickets = [createTicket("SPI-9")];
    const runs: TicketRunSummary[] = [createRun("SPI-9", "error")];

    const collections = splitMissionCollections(tickets, runs);

    expect(collections.pendingTickets.map((ticket) => ticket.id)).toEqual(["SPI-9"]);
    expect(collections.activeRuns).toEqual([]);
    expect(collections.completedRuns).toEqual([]);
  });

  it("handles empty mission inputs", () => {
    expect(splitMissionCollections([], [])).toEqual({
      pendingTickets: [],
      activeRuns: [],
      completedRuns: [],
    });
  });
});
