import { describe, expect, it } from "vitest";
import { parseClientMessagePayload } from "./client-message-validation.js";

describe("parseClientMessagePayload", () => {
  it("accepts valid chat messages", () => {
    expect(
      parseClientMessagePayload(
        JSON.stringify({
          type: "chat:send",
          text: "Status report.",
          conversationId: "conversation-1",
          stationId: "station-alpha",
        }),
      ),
    ).toEqual({
      message: {
        type: "chat:send",
        text: "Status report.",
        conversationId: "conversation-1",
        stationId: "station-alpha",
      },
    });
  });

  it("rejects invalid JSON", () => {
    expect(parseClientMessagePayload("{ nope")).toEqual({
      message: null,
      errorDetails: expect.stringContaining("Invalid JSON:"),
    });
  });

  it("rejects malformed nested settings payloads", () => {
    expect(
      parseClientMessagePayload(
        JSON.stringify({
          type: "settings:update",
          settings: {
            wakeWordEnabled: "yes",
          },
        }),
      ),
    ).toEqual({
      message: null,
      errorDetails: "settings.wakeWordEnabled: Expected boolean, received string",
    });
  });

  it("accepts MCP server creation messages that match the shared config schema", () => {
    expect(
      parseClientMessagePayload(
        JSON.stringify({
          type: "mcp:add-server",
          config: {
            id: "vision",
            name: "Spira Vision",
            enabled: true,
            autoRestart: true,
            transport: "stdio",
            command: "node",
            args: ["vision.js"],
          },
        }),
      ),
    ).toEqual({
      message: {
        type: "mcp:add-server",
        config: {
          id: "vision",
          name: "Spira Vision",
          enabled: true,
          autoRestart: true,
          maxRestarts: 3,
          transport: "stdio",
          command: "node",
          args: ["vision.js"],
        },
      },
    });
  });

  it("accepts mission review snapshot and submodule git messages", () => {
    expect(
      parseClientMessagePayload(
        JSON.stringify({
          type: "missions:ticket-run:review-snapshot:get",
          requestId: "req-1",
          runId: "run-1",
        }),
      ),
    ).toEqual({
      message: {
        type: "missions:ticket-run:review-snapshot:get",
        requestId: "req-1",
        runId: "run-1",
      },
    });

    expect(
      parseClientMessagePayload(
        JSON.stringify({
          type: "missions:ticket-run:submodule:commit",
          requestId: "req-2",
          runId: "run-1",
          canonicalUrl: "github.com/example/legapp-common",
          message: "feat(SPI-101): update shared module",
        }),
      ),
    ).toEqual({
      message: {
        type: "missions:ticket-run:submodule:commit",
        requestId: "req-2",
        runId: "run-1",
        canonicalUrl: "github.com/example/legapp-common",
        message: "feat(SPI-101): update shared module",
      },
    });
  });

  it("rejects unknown message types", () => {
    expect(
      parseClientMessagePayload(
        JSON.stringify({
          type: "bridge:explode",
        }),
      ),
    ).toEqual({
      message: null,
      errorDetails: expect.stringContaining("Invalid discriminator value"),
    });
  });
});
