import { type SdkMcpToolDefinition, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { type ZodRawShape, type ZodTypeAny, z } from "zod";
import type { ProviderToolDefinition, ProviderToolResultObject } from "../types.js";

type JsonSchemaNode = {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode | JsonSchemaNode[];
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean | JsonSchemaNode;
  default?: unknown;
};

const pickType = (schema: JsonSchemaNode): string | undefined => {
  if (Array.isArray(schema.type)) {
    return schema.type.find((entry) => entry !== "null") ?? schema.type[0];
  }
  return schema.type;
};

const isNullable = (schema: JsonSchemaNode): boolean =>
  Array.isArray(schema.type) ? schema.type.includes("null") : false;

const jsonSchemaNodeToZod = (schema: JsonSchemaNode): ZodTypeAny => {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const stringEnum = schema.enum.filter((value): value is string => typeof value === "string");
    if (stringEnum.length === schema.enum.length && stringEnum.length > 0) {
      return z.enum(stringEnum as [string, ...string[]]);
    }
    const literals = schema.enum.map((value) => z.literal(value as string | number | boolean) as unknown as ZodTypeAny);
    if (literals.length >= 2) {
      return z.union(literals as unknown as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]);
    }
    return literals[0] ?? z.unknown();
  }

  let base: ZodTypeAny;
  switch (pickType(schema)) {
    case "string":
      base = z.string();
      break;
    case "number":
      base = z.number();
      break;
    case "integer":
      base = z.number().int();
      break;
    case "boolean":
      base = z.boolean();
      break;
    case "array":
      base = z.array(
        Array.isArray(schema.items)
          ? z.union([
              jsonSchemaNodeToZod(schema.items[0] ?? {}),
              jsonSchemaNodeToZod(schema.items[1] ?? {}),
              ...schema.items.slice(2).map((entry) => jsonSchemaNodeToZod(entry)),
            ] as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]])
          : schema.items
            ? jsonSchemaNodeToZod(schema.items)
            : z.unknown(),
      );
      break;
    case "object": {
      const shape = jsonSchemaParametersToZodShape(schema);
      const objectSchema = z.object(shape);
      base =
        schema.additionalProperties === false
          ? objectSchema.strict()
          : typeof schema.additionalProperties === "object"
            ? objectSchema.catchall(jsonSchemaNodeToZod(schema.additionalProperties))
            : objectSchema.passthrough();
      break;
    }
    default:
      base = z.unknown();
  }

  if (isNullable(schema)) {
    base = base.nullable();
  }

  return schema.description ? base.describe(schema.description) : base;
};

export const jsonSchemaParametersToZodShape = (parameters: JsonSchemaNode): ZodRawShape => {
  const required = new Set(parameters.required ?? []);
  const shape: ZodRawShape = {};
  for (const [name, property] of Object.entries(parameters.properties ?? {})) {
    let entry = jsonSchemaNodeToZod(property);
    if (!required.has(name)) {
      entry = entry.optional();
    }
    shape[name] = entry;
  }
  return shape;
};

const formatToolHandlerResult = (
  result: ProviderToolResultObject,
): {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  isError?: boolean;
} => {
  const isError = result.resultType === "failure";
  const blocks: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
  if (result.content && result.content.length > 0) {
    for (const block of result.content) {
      if (block.type === "text") {
        blocks.push({ type: "text", text: block.text });
      } else {
        blocks.push({ type: "image", data: block.base64, mimeType: block.mimeType });
      }
    }
  }
  if (blocks.length === 0) {
    blocks.push({ type: "text", text: result.textResultForLlm });
  }
  return {
    content: blocks,
    ...(isError ? { isError: true } : {}),
  };
};

export type SpiraMcpTool = SdkMcpToolDefinition<ZodRawShape>;

export const buildSpiraSdkMcpServer = (
  serverName: string,
  tools: readonly ProviderToolDefinition[],
): ReturnType<typeof createSdkMcpServer> => {
  const sdkTools = tools.map((definition): SpiraMcpTool => {
    const shape = jsonSchemaParametersToZodShape(definition.parameters as JsonSchemaNode);
    return tool(definition.name, definition.description, shape, async (args) => {
      const result = await definition.handler(args as Record<string, unknown>);
      return formatToolHandlerResult(result);
    });
  });
  return createSdkMcpServer({
    name: serverName,
    version: "0.1.0",
    tools: sdkTools,
  });
};
