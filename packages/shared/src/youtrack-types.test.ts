import { describe, expect, it } from "vitest";
import { normalizeYouTrackStateMapping, validateYouTrackStateMapping } from "./youtrack-types.js";

describe("normalizeYouTrackStateMapping", () => {
  it("trims values and removes duplicates case-insensitively", () => {
    expect(
      normalizeYouTrackStateMapping({
        todo: [" Submitted ", "submitted", "Open", "  "],
        inProgress: ["In Progress", "in progress", "Review"],
      }),
    ).toEqual({
      todo: ["Submitted", "Open"],
      inProgress: ["In Progress", "Review"],
    });
  });

  it("fills missing lanes with empty arrays", () => {
    expect(
      normalizeYouTrackStateMapping({
        todo: ["Submitted"],
      }),
    ).toEqual({
      todo: ["Submitted"],
      inProgress: [],
    });
  });
});

describe("validateYouTrackStateMapping", () => {
  it("canonicalizes states from the live YouTrack option set", () => {
    expect(
      validateYouTrackStateMapping(
        {
          todo: ["submitted"],
          inProgress: ["in progress"],
        },
        ["Submitted", "Open", "In Progress"],
      ),
    ).toEqual({
      mapping: {
        todo: ["Submitted"],
        inProgress: ["In Progress"],
      },
      invalidTodoStates: [],
      invalidInProgressStates: [],
      overlappingStates: [],
    });
  });

  it("reports invalid and overlapping states without hiding them", () => {
    expect(
      validateYouTrackStateMapping(
        {
          todo: ["Submitted", "Custom queue"],
          inProgress: ["Submitted", "Review"],
        },
        ["Submitted", "Open", "In Progress"],
      ),
    ).toEqual({
      mapping: {
        todo: ["Submitted", "Custom queue"],
        inProgress: ["Submitted", "Review"],
      },
      invalidTodoStates: ["Custom queue"],
      invalidInProgressStates: ["Review"],
      overlappingStates: ["Submitted"],
    });
  });
});
