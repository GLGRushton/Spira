import { PROTOCOL_VERSION } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { isExpectedReadyPong } from "./backend-lifecycle.js";

describe("isExpectedReadyPong", () => {
  it("accepts the expected backend generation and build id", () => {
    expect(
      isExpectedReadyPong(
        {
          type: "pong",
          protocolVersion: PROTOCOL_VERSION,
          backendBuildId: "dev",
          generation: 7,
        },
        7,
        "dev",
      ),
    ).toBe(true);
  });

  it("rejects stale backend generations", () => {
    expect(
      isExpectedReadyPong(
        {
          type: "pong",
          protocolVersion: PROTOCOL_VERSION,
          backendBuildId: "dev",
          generation: 6,
        },
        7,
        "dev",
      ),
    ).toBe(false);
  });

  it("rejects mismatched build ids", () => {
    expect(
      isExpectedReadyPong(
        {
          type: "pong",
          protocolVersion: PROTOCOL_VERSION,
          backendBuildId: "old-build",
          generation: 7,
        },
        7,
        "dev",
      ),
    ).toBe(false);
  });
});
