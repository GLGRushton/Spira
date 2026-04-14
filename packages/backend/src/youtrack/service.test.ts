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
          { name: "Type", value: { name: "Task" } },
          { name: "State", value: { name: "Open" } },
          { name: "Assignee", value: { login: "admin", fullName: "Admin" } },
        ],
        parent: {
          issues: [
            {
              idReadable: "SPI-100",
              summary: "Mission intake epic",
              project: {
                shortName: "SPI",
                name: "Spira",
              },
              customFields: [
                { name: "Type", value: { name: "Epic" } },
                { name: "State", value: { name: "In Progress" } },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      id: "SPI-101",
      summary: "Wire native ticket intake",
      url: "https://example.youtrack.cloud/issue/SPI-101",
      projectKey: "SPI",
      projectName: "Spira",
      type: "Task",
      state: "Open",
      assignee: "admin",
      updatedAt: 12345,
      isEpic: false,
      parent: {
        id: "SPI-100",
        summary: "Mission intake epic",
        url: "https://example.youtrack.cloud/issue/SPI-100",
        projectKey: "SPI",
        projectName: "Spira",
        type: "Epic",
        state: "In Progress",
      },
      subtasks: [],
      blockedReason: "SPI-100 is already active (In Progress). Pick up the epic instead of the child task.",
    });
  });

  it("marks epic issues and keeps child pickup available when the parent epic is not active", () => {
    expect(
      mapYouTrackIssue("https://example.youtrack.cloud", {
        idReadable: "SPI-200",
        summary: "Coordinate the whole mission",
        project: {
          shortName: "SPI",
          name: "Spira",
        },
        customFields: [
          { name: "Type", value: { name: "Epic" } },
          { name: "State", value: { name: "Open" } },
        ],
        subtasks: {
          issues: [
            {
              idReadable: "SPI-201",
              summary: "Implement the obvious part",
              project: {
                shortName: "SPI",
                name: "Spira",
              },
              customFields: [
                { name: "Type", value: { name: "Task" } },
                { name: "State", value: { name: "Open" } },
              ],
            },
          ],
        },
      }),
    ).toEqual({
      id: "SPI-200",
      summary: "Coordinate the whole mission",
      url: "https://example.youtrack.cloud/issue/SPI-200",
      projectKey: "SPI",
      projectName: "Spira",
      type: "Epic",
      state: "Open",
      assignee: null,
      updatedAt: null,
      isEpic: true,
      parent: null,
      subtasks: [
        {
          id: "SPI-201",
          summary: "Implement the obvious part",
          url: "https://example.youtrack.cloud/issue/SPI-201",
          projectKey: "SPI",
          projectName: "Spira",
          type: "Task",
          state: "Open",
        },
      ],
      blockedReason: null,
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
