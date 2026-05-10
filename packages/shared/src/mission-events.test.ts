import { describe, expect, it } from "vitest";
import {
  MISSION_EVENT_TYPES,
  type MissionEventMetadataMap,
  type MissionEventType,
  isMissionEventType,
  validateMissionEventType,
} from "./mission-events.js";

describe("mission event taxonomy", () => {
  it("contains every event type that the production code emits today", () => {
    // This is the contract: every appendMissionEvent call site in the backend uses one of these.
    // Adding/removing a member here must be matched by a write-site change.
    const expected: MissionEventType[] = [
      "context-loaded",
      "classification-saved",
      "plan-saved",
      "validation-recorded",
      "proof-strategy-saved",
      "proof-result-recorded",
      "summary-saved",
      "attempt-started",
      "attempt-finished",
      "attempt-cancelled",
      "attempt-repair-requested",
      "attempt-recovered-after-restart",
      "mission-startup-recovered-after-restart",
      "mission-startup-timed-out",
      "proof-started",
      "proof-finished",
      "workspace-prepared",
      "repo-intelligence-candidates-observed",
      "repo-intelligence-candidate-approved",
      "run-closed",
      "attempt-action",
      "attempt-shell-command",
      "attempt-awaiting-permission",
      "attempt-permission-resolved",
      // Phase 2.1 / 2.2 / 2.3 — proof gate + preflight events.
      "proof-set-manual-review-only",
      "proof-manual-review-cleared",
      "proof-preflight-started",
      "proof-preflight-finished",
      // dependency warming.
      "workspace-dependencies-warming-started",
      "workspace-dependencies-warming-finished",
      // learning loop.
      "mission-outcome-classified",
      "validation-profile-candidate-observed",
      "validation-profile-auto-promoted",
      "learned-candidate-promoted",
      "learned-candidate-revoked",
      // polish.
      "validations-superseded",
      "mission-state-reconciled",
      "mission-aborted",
      // visible-learning.
      "repo-guidance-injected",
      "learned-candidate-skipped",
    ];
    expect([...MISSION_EVENT_TYPES].sort()).toEqual(expected.sort());
  });

  it("rejects unknown event types and accepts known ones", () => {
    expect(isMissionEventType("attempt-started")).toBe(true);
    expect(isMissionEventType("does-not-exist")).toBe(false);
    expect(isMissionEventType("")).toBe(false);
  });

  it("validateMissionEventType narrows to MissionEventType for known values", () => {
    const value = validateMissionEventType("attempt-finished");
    // Compile-time check: the return is narrowed to MissionEventType, allowing it to index the metadata map.
    const lookup: keyof MissionEventMetadataMap = value;
    expect(lookup).toBe("attempt-finished");
  });

  it("validateMissionEventType throws with a clear pointer for unknown values", () => {
    expect(() => validateMissionEventType("nonsense")).toThrow(/Unknown mission event type/);
    expect(() => validateMissionEventType("nonsense")).toThrow(/MISSION_EVENT_TYPES/);
  });
});
