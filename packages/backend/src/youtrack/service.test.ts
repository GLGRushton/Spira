import { DEFAULT_YOUTRACK_STATE_MAPPING } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { mapYouTrackIssue, mapYouTrackProject, matchesYouTrackState } from "./service.js";

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
