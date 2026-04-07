import { describe, expect, it } from "vitest";
import { markdownToSpeechText } from "./markdown-to-speech.js";

describe("markdownToSpeechText", () => {
  it("removes emphasis markers while keeping the words", () => {
    expect(markdownToSpeechText("Use **bold** and _italics_ here.")).toBe("Use bold and italics here.");
  });

  it("strips markdown structure from lists, links, and blockquotes", () => {
    expect(
      markdownToSpeechText(`# Status
> **Shinra**
1. Review [logs](https://example.com/logs)
- [x] Confirm`),
    ).toBe("Status\nShinra\nReview logs\nConfirm");
  });

  it("flattens tables and inline code to readable speech text", () => {
    expect(
      markdownToSpeechText(`| Name | Value |
| --- | --- |
| Mode | \`elevenlabs\` |`),
    ).toBe("Name, Value\nMode, elevenlabs");
  });

  it("preserves snake_case and generic syntax inside inline code", () => {
    expect(markdownToSpeechText("Use `snake_case_value` with `Promise<string>` output.")).toBe(
      "Use snake_case_value with Promise<string> output.",
    );
  });
});
