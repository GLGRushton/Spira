import { describe, expect, it } from "vitest";
import { assessYouTrackStateMappingDraft, haveYouTrackStateMappingsChanged } from "./youtrack-state-mapping-utils.js";

describe("assessYouTrackStateMappingDraft", () => {
  it("accepts a valid connected-state mapping", () => {
    expect(
      assessYouTrackStateMappingDraft(
        {
          todo: ["Submitted", "Open"],
          inProgress: ["In Progress"],
        },
        ["Submitted", "Open", "In Progress", "Review"],
      ),
    ).toEqual({
      mapping: {
        todo: ["Submitted", "Open"],
        inProgress: ["In Progress"],
      },
      invalidTodoStates: [],
      invalidInProgressStates: [],
      overlappingStates: [],
      errors: [],
    });
  });

  it("surfaces empty, invalid, and overlapping state problems", () => {
    expect(
      assessYouTrackStateMappingDraft(
        {
          todo: [],
          inProgress: ["Submitted", "Review"],
        },
        ["Submitted", "Open", "In Progress"],
      ),
    ).toEqual({
      mapping: {
        todo: [],
        inProgress: ["Submitted", "Review"],
      },
      invalidTodoStates: [],
      invalidInProgressStates: ["Review"],
      overlappingStates: [],
      errors: [
        "Select at least one To-do YouTrack state.",
        "In-progress states not found in YouTrack: Review.",
      ],
    });
  });

  it("reports overlapping states after canonicalizing names", () => {
    expect(
      assessYouTrackStateMappingDraft(
        {
          todo: ["submitted"],
          inProgress: ["Submitted"],
        },
        ["Submitted", "Open", "In Progress"],
      ),
    ).toEqual({
      mapping: {
        todo: ["Submitted"],
        inProgress: ["Submitted"],
      },
      invalidTodoStates: [],
      invalidInProgressStates: [],
      overlappingStates: ["Submitted"],
      errors: ["State mapping cannot place the same state in both To-do and In-progress: Submitted."],
    });
  });
});

describe("haveYouTrackStateMappingsChanged", () => {
  it("treats normalization-only edits as unchanged", () => {
    expect(
      haveYouTrackStateMappingsChanged(
        {
          todo: [" Submitted ", "Open"],
          inProgress: ["In Progress"],
        },
        {
          todo: ["Submitted", "Open"],
          inProgress: ["In Progress"],
        },
      ),
    ).toBe(false);
  });

  it("treats ordering changes as meaningful", () => {
    expect(
      haveYouTrackStateMappingsChanged(
        {
          todo: ["Open", "Submitted"],
          inProgress: ["In Progress"],
        },
        {
          todo: ["Submitted", "Open"],
          inProgress: ["In Progress"],
        },
      ),
    ).toBe(true);
  });
});
