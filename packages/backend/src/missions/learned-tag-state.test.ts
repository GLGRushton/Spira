import type { RepoIntelligenceRecord } from "@spira/memory-db";
import { describe, expect, it } from "vitest";
import { parseLearnedTagState } from "./learned-tag-state.js";

const record = (tags: string[]): RepoIntelligenceRecord =>
  ({
    id: "x",
    projectKey: "SPI",
    repoRelativePath: ".",
    type: "briefing",
    title: "t",
    content: "c",
    severity: "info",
    source: "learned",
    approved: false,
    createdAt: 0,
    updatedAt: 0,
    tags,
  }) as unknown as RepoIntelligenceRecord;

describe("parseLearnedTagState", () => {
  it("parses an empty tag list to defaults", () => {
    expect(parseLearnedTagState(record([]))).toEqual({
      revoked: false,
      archived: false,
      promotedRunIds: [],
      revokedRunIds: [],
      classification: null,
      sourceTicketId: null,
      sourceRunId: null,
      outcome: null,
      promotedFormulaVersion: null,
    });
  });

  it("collects promoted-run / revoked-run ids in order", () => {
    const state = parseLearnedTagState(
      record(["promoted-run:r1", "revoked-run:r2", "promoted-run:r3", "revoked-run:r4"]),
    );
    expect(state.promotedRunIds).toEqual(["r1", "r3"]);
    expect(state.revokedRunIds).toEqual(["r2", "r4"]);
  });

  it("flags revoked / archived markers", () => {
    expect(parseLearnedTagState(record(["revoked"])).revoked).toBe(true);
    expect(parseLearnedTagState(record(["archived"])).archived).toBe(true);
  });

  it("captures source provenance + outcome + classification", () => {
    const state = parseLearnedTagState(
      record(["run:r9", "ticket:SPI-12", "classification:bugfix", "outcome:clean-pass"]),
    );
    expect(state.sourceRunId).toBe("r9");
    expect(state.sourceTicketId).toBe("SPI-12");
    expect(state.classification).toBe("bugfix");
    expect(state.outcome).toBe("clean-pass");
  });

  it("captures promotion formula version", () => {
    expect(parseLearnedTagState(record(["promoted-formula-v3"])).promotedFormulaVersion).toBe(3);
  });
});
