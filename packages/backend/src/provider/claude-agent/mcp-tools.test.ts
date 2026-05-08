import { describe, expect, it } from "vitest";
import type { ProviderToolDefinition } from "../types.js";
import { buildSpiraSdkMcpServer, jsonSchemaParametersToZodShape } from "./mcp-tools.js";

describe("jsonSchemaParametersToZodShape", () => {
  it("converts a basic JSON Schema object into a Zod raw shape", () => {
    const shape = jsonSchemaParametersToZodShape({
      type: "object",
      properties: {
        name: { type: "string", description: "The user's name" },
        count: { type: "integer" },
        active: { type: "boolean" },
      },
      required: ["name"],
      additionalProperties: false,
    });

    const parsed = shape.name?.parse?.("Alice");
    expect(parsed).toBe("Alice");
    expect(() => shape.name?.parse?.(undefined)).toThrow();
    expect(() => shape.count?.parse?.(undefined)).not.toThrow();
    expect(() => shape.count?.parse?.("nope")).toThrow();
    expect(() => shape.count?.parse?.(3)).not.toThrow();
    expect(() => shape.active?.parse?.(true)).not.toThrow();
  });

  it("handles enum, array, and nested object schemas", () => {
    const shape = jsonSchemaParametersToZodShape({
      type: "object",
      properties: {
        mode: { type: "string", enum: ["fast", "thorough"] },
        tags: { type: "array", items: { type: "string" } },
        meta: {
          type: "object",
          properties: { id: { type: "number" } },
          required: ["id"],
        },
      },
      required: ["mode"],
    });

    expect(() => shape.mode?.parse?.("fast")).not.toThrow();
    expect(() => shape.mode?.parse?.("invalid")).toThrow();
    expect(() => shape.tags?.parse?.(["a", "b"])).not.toThrow();
    expect(() => shape.meta?.parse?.({ id: 7 })).not.toThrow();
    expect(() => shape.meta?.parse?.({})).toThrow();
  });
});

describe("buildSpiraSdkMcpServer", () => {
  it("registers Spira tools as an in-process SDK MCP server config", () => {
    const tools: ProviderToolDefinition[] = [
      {
        name: "spira_test_tool",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
          required: ["value"],
        },
        handler: async () => ({ resultType: "success", textResultForLlm: "ok" }),
      },
    ];

    const config = buildSpiraSdkMcpServer("spira-tools", tools);
    expect(config.type).toBe("sdk");
    expect(config.name).toBe("spira-tools");
    expect(config.instance).toBeDefined();
  });
});
