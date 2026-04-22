import type { McpServerStatus } from "@spira/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { McpClusterDetail } from "./McpClusterDetail.js";

const createServer = (overrides: Partial<McpServerStatus>): McpServerStatus => ({
  id: "windows-system",
  name: "Windows System",
  description: "Host control",
  source: "builtin",
  enabled: true,
  state: "connected",
  toolCount: 2,
  tools: ["system_get_volume", "system_get_cpu_usage"],
  diagnostics: {
    failureCount: 0,
    recentStderr: [],
  },
  ...overrides,
});

describe("McpClusterDetail", () => {
  it("renders built-in servers with a toggle, badge, and disabled label", () => {
    const html = renderToStaticMarkup(
      <McpClusterDetail
        servers={[createServer({ enabled: false, state: "disconnected" })]}
        onSelectServer={() => undefined}
      />,
    );

    expect(html).toContain("Built-ins can be disabled but not removed");
    expect(html).toContain("Disabled");
    expect(html).toContain("disabled");
    expect(html).toContain("Built-in");
    expect(html).not.toContain("Remove");
  });

  it("renders custom servers with toggle and remove controls", () => {
    const html = renderToStaticMarkup(
      <McpClusterDetail
        servers={[
          createServer({
            id: "youtrack",
            name: "YouTrack",
            source: "user",
            enabled: true,
            tools: ["find_projects"],
            toolCount: 1,
          }),
        ]}
        onSelectServer={() => undefined}
      />,
    );

    expect(html).toContain("Enabled");
    expect(html).toContain("Remove");
    expect(html).not.toContain(">Built-in<");
  });
});
