import { describe, expect, it } from "vitest";
import { createRendererFatalPayload } from "./renderer-fatal.js";

describe("createRendererFatalPayload", () => {
  it("formats bootstrap failures with the error message and stack", () => {
    const error = new Error("Missing renderer chunk");

    const fatal = createRendererFatalPayload(error, "bootstrap");

    expect(fatal).toMatchObject({
      phase: "bootstrap",
      title: "Spira couldn't finish loading",
      message: "A renderer error stopped the interface before it finished loading: Missing renderer chunk",
    });
    expect(fatal.details).toContain("Missing renderer chunk");
  });

  it("includes the React component stack for runtime failures", () => {
    const fatal = createRendererFatalPayload(
      new Error("BridgeRoomDetail exploded"),
      "runtime",
      "\n    at BridgeRoomDetail",
    );

    expect(fatal).toMatchObject({
      phase: "runtime",
      title: "Spira hit a UI failure",
      message: "The interface encountered an unrecoverable error: BridgeRoomDetail exploded",
    });
    expect(fatal.details).toContain("React component stack:");
    expect(fatal.details).toContain("BridgeRoomDetail");
  });

  it("handles non-Error values without inventing details", () => {
    const fatal = createRendererFatalPayload("Unexpected bootstrap failure", "bootstrap");

    expect(fatal).toEqual({
      phase: "bootstrap",
      title: "Spira couldn't finish loading",
      message: "A renderer error stopped the interface before it finished loading: Unexpected bootstrap failure",
      details: "Unexpected bootstrap failure",
    });
  });
});
