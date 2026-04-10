import { describe, expect, it } from "vitest";
import { summarizeConversationTitle } from "./conversation-title.js";

describe("summarizeConversationTitle", () => {
  it("returns null for empty content", () => {
    expect(summarizeConversationTitle("")).toBeNull();
    expect(summarizeConversationTitle("   \n\t  ")).toBeNull();
  });

  it("keeps up to three meaningful words after dropping leading filler", () => {
    expect(summarizeConversationTitle("Can you help me write a Python script?")).toBe("Help Me Write");
  });

  it("drops leading question scaffolding when it is not the substance", () => {
    expect(summarizeConversationTitle("When are chats actually saved?")).toBe("Chats Actually Saved");
  });

  it("strips token-edge punctuation and collapses whitespace", () => {
    expect(summarizeConversationTitle("  Hello,\n\nworld!  ")).toBe("World");
  });

  it("preserves short acronyms while title-casing ordinary words", () => {
    expect(summarizeConversationTitle("please fix CSS grid layout")).toBe("Fix CSS Grid");
  });

  it("falls back to the first cleaned words when every leading word is filler", () => {
    expect(summarizeConversationTitle("hello please can")).toBe("Hello Please Can");
  });

  it("drops standalone punctuation tokens", () => {
    expect(summarizeConversationTitle("... please --- fix auth ???")).toBe("Fix Auth");
  });

  it("is deterministic for repeated calls", () => {
    expect(summarizeConversationTitle("Can you help me write a Python script?")).toBe(
      summarizeConversationTitle("Can you help me write a Python script?"),
    );
  });
});
