import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreamingText } from "./StreamingText.js";

describe("StreamingText", () => {
  it("renders literal text while a reply is streaming", () => {
    const html = renderToStaticMarkup(<StreamingText content="**bold** _still raw_" fallbackText="Waiting..." />);

    expect(html).toContain("**bold** _still raw_");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<em>");
  });
});
