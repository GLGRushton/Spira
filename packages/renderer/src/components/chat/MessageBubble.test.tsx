import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MessageBubble } from "./MessageBubble.js";

describe("MessageBubble", () => {
  it("shows the responding model in the assistant header when available", () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: "assistant-1",
          role: "assistant",
          content: "Escalation confirmed.",
          model: "gpt-5.4",
          timestamp: 1,
        }}
      />,
    );

    expect(html).toContain("SPIRA - gpt-5.4");
  });
});
