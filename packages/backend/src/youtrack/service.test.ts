import { DEFAULT_YOUTRACK_STATE_MAPPING } from "@spira/shared";
import { describe, expect, it, vi } from "vitest";
import {
  YouTrackService,
  getPreferredInProgressState,
  mapYouTrackIssue,
  mapYouTrackProject,
  matchesYouTrackState,
} from "./service.js";

describe("matchesYouTrackState", () => {
  it("treats the MVP working states as tracked", () => {
    expect(matchesYouTrackState("Submitted", DEFAULT_YOUTRACK_STATE_MAPPING)).toBe(true);
    expect(matchesYouTrackState("Open", DEFAULT_YOUTRACK_STATE_MAPPING)).toBe(true);
    expect(matchesYouTrackState("In Progress", DEFAULT_YOUTRACK_STATE_MAPPING)).toBe(true);
    expect(matchesYouTrackState("Fixed", DEFAULT_YOUTRACK_STATE_MAPPING)).toBe(false);
  });

  it("matches states case-insensitively", () => {
    expect(matchesYouTrackState("submitted", DEFAULT_YOUTRACK_STATE_MAPPING)).toBe(true);
    expect(matchesYouTrackState("in progress", DEFAULT_YOUTRACK_STATE_MAPPING)).toBe(true);
  });
});

describe("mapYouTrackIssue", () => {
  it("maps a REST issue into a renderer summary", () => {
    expect(
      mapYouTrackIssue("https://example.youtrack.cloud", {
        idReadable: "SPI-101",
        summary: "Wire native ticket intake",
        updated: 12345,
        project: {
          shortName: "SPI",
          name: "Spira",
        },
        customFields: [
          { name: "State", value: { name: "Open" } },
          { name: "Assignee", value: { login: "admin", fullName: "Admin" } },
        ],
      }),
    ).toEqual({
      id: "SPI-101",
      summary: "Wire native ticket intake",
      url: "https://example.youtrack.cloud/issue/SPI-101",
      projectKey: "SPI",
      projectName: "Spira",
      state: "Open",
      assignee: "admin",
      updatedAt: 12345,
    });
  });
});

describe("mapYouTrackProject", () => {
  it("maps a REST project into a renderer summary", () => {
    expect(
      mapYouTrackProject({
        id: "0-13",
        shortName: "SPI",
        name: "Spira",
      }),
    ).toEqual({
      id: "0-13",
      shortName: "SPI",
      name: "Spira",
    });
  });

  it("returns null for incomplete projects", () => {
    expect(
      mapYouTrackProject({
        shortName: "SPI",
      }),
    ).toBeNull();
  });
});

describe("getPreferredInProgressState", () => {
  it("prefers the first configured in-progress state", () => {
    expect(getPreferredInProgressState(DEFAULT_YOUTRACK_STATE_MAPPING)).toBe("In Progress");
  });
});

describe("YouTrackService.transitionTicketToInProgress", () => {
  it("sends the live-supported raw state command for multi-word values", async () => {
    const service = new YouTrackService(
      {
        YOUTRACK_BASE_URL: "https://example.youtrack.cloud",
        YOUTRACK_TOKEN: "token",
      } as ConstructorParameters<typeof YouTrackService>[0],
      {
        warn: vi.fn(),
      } as never,
    );
    const sendJsonMock = vi.spyOn(service as never, "sendJson").mockResolvedValue(undefined);

    await service.transitionTicketToInProgress("SPI-101");

    expect(sendJsonMock).toHaveBeenCalledWith(
      "https://example.youtrack.cloud/api/commands",
      "token",
      {
        query: "State In Progress",
        issues: [{ idReadable: "SPI-101" }],
      },
      "ticket transition",
    );
  });
});
