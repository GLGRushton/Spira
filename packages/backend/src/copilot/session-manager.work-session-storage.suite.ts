import { describe, expect, it } from "vitest";
import {
  createRuntimeMemoryDb,
  createWorkSessionStorage,
  isWorkSessionSnapshot,
} from "./session-manager.test-support.js";
import type { WorkSessionSnapshot } from "./session-manager.test-support.js";

describe("work-session storage", () => {
  it("accepts legacy snapshots that do not include closure fields", () => {
    expect(
      isWorkSessionSnapshot({
        sessionId: "work-session",
        stationId: "station-alpha",
        taskText: "Implement the bridge UI badge in the renderer file",
        currentPhase: "validate",
        classification: {
          intent: "edit",
          explicitWorkIntent: true,
          requiresRepoContext: true,
          confidence: "heuristic",
        },
        phaseHistory: [],
        searchTerms: ["bridge", "renderer"],
        candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toBe(true);
  });

  it("round-trips snapshots that include closure fields", () => {
    const memory = createRuntimeMemoryDb();
    const storage = createWorkSessionStorage(memory.db as never, "station-alpha");
    const snapshot: WorkSessionSnapshot = {
      sessionId: "work-session",
      stationId: "station-alpha",
      taskText: "Implement the bridge UI badge in the renderer file",
      currentPhase: "validate",
      classification: {
        intent: "edit",
        explicitWorkIntent: true,
        requiresRepoContext: true,
        confidence: "heuristic",
      },
      phaseHistory: [],
      searchTerms: ["bridge", "renderer"],
      candidateFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
      selectedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
      summary: "Validation passed; ready for review.",
      planSummary: "Plan ready.",
      patchAttempts: [],
      changedFiles: ["packages/renderer/src/components/base/BridgeRoomDetail.tsx"],
      validationResults: [],
      pendingValidationShellId: null,
      pendingValidationCommand: null,
      fixIterationCount: 0,
      repeatFailureCount: 0,
      lastValidationFingerprint: null,
      readyForReview: true,
      reviewSummary: "Review completed.",
      completedAt: 10,
      stalledReason: null,
      stalledAt: null,
      createdAt: 1,
      updatedAt: 10,
    };

    storage.save(snapshot);

    expect(storage.load()).toEqual(snapshot);
  });
});
