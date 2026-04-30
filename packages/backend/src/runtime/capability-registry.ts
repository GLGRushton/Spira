import { createHash } from "node:crypto";
import type { ToolBridgeOptions } from "./tool-bridge.js";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { requiresProviderManifestProjection } from "../provider/capability-fallback.js";
import type { ProviderCapabilities, ProviderId, ProviderToolDefinition } from "../provider/types.js";
import { buildRuntimeCapabilityDefinitions } from "./capability-tools.js";
import type { RuntimeCapabilitySource } from "./runtime-contract.js";

export type RuntimeCapabilityRegistryEntry = {
  capabilityId: string;
  source: RuntimeCapabilitySource;
  tool: ProviderToolDefinition;
  suppressForProviders: ProviderId[];
  binding?: Record<string, unknown>;
};

export type RuntimeCapabilityRegistry = {
  entries: RuntimeCapabilityRegistryEntry[];
  hostManifestHash: string;
};

export type ProviderToolManifest = {
  tools: ProviderToolDefinition[];
  hostManifestHash: string;
  projectionHash: string;
  suppressedCapabilityIds: string[];
};

const buildManifestHash = (
  entries: ReadonlyArray<{
    capabilityId: string;
    source: RuntimeCapabilitySource;
    toolName: string;
    description: string;
    parameters: Record<string, unknown>;
    skipPermission?: boolean;
    overridesBuiltInTool?: boolean;
    binding?: Record<string, unknown>;
  }>,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...entries].sort(
          (left, right) =>
            left.capabilityId.localeCompare(right.capabilityId) ||
            left.source.localeCompare(right.source) ||
            left.toolName.localeCompare(right.toolName),
        ),
      ),
    )
    .digest("hex");

export const buildRuntimeCapabilityRegistry = (
  aggregator: McpToolAggregator,
  options: ToolBridgeOptions = {},
): RuntimeCapabilityRegistry => {
  const entries = buildRuntimeCapabilityDefinitions(aggregator, options);

  return {
    entries,
    hostManifestHash: buildManifestHash(
      entries.map((entry) => ({
        capabilityId: entry.capabilityId,
        source: entry.source,
        toolName: entry.tool.name,
        description: entry.tool.description,
        parameters: entry.tool.parameters,
        skipPermission: entry.tool.skipPermission,
        overridesBuiltInTool: entry.tool.overridesBuiltInTool,
        binding: entry.binding,
      })),
    ),
  };
};

export const projectRuntimeCapabilityRegistry = (
  registry: RuntimeCapabilityRegistry,
  providerId?: ProviderId,
  capabilities?: ProviderCapabilities,
  options?: {
    preserveCapabilityIds?: readonly string[];
  },
): ProviderToolManifest => {
  const shouldProject =
    providerId !== undefined && capabilities !== undefined && requiresProviderManifestProjection(capabilities);
  const preservedCapabilityIds = new Set(options?.preserveCapabilityIds ?? []);

  const suppressedCapabilityIds = shouldProject
    ? registry.entries
        .filter(
          (entry) => entry.suppressForProviders.includes(providerId) && !preservedCapabilityIds.has(entry.capabilityId),
        )
        .map((entry) => entry.capabilityId)
    : [];

  const projectedEntries = shouldProject
    ? registry.entries.filter(
        (entry) => !entry.suppressForProviders.includes(providerId) || preservedCapabilityIds.has(entry.capabilityId),
      )
    : registry.entries;

  return {
    tools: projectedEntries.map((entry) => entry.tool),
    hostManifestHash: registry.hostManifestHash,
    projectionHash: buildManifestHash(
      projectedEntries.map((entry) => ({
        capabilityId: entry.capabilityId,
        source: entry.source,
        toolName: entry.tool.name,
        description: entry.tool.description,
        parameters: entry.tool.parameters,
        skipPermission: entry.tool.skipPermission,
        overridesBuiltInTool: entry.tool.overridesBuiltInTool,
        binding: entry.binding,
      })),
    ),
    suppressedCapabilityIds,
  };
};

export const getProviderToolManifest = (input: {
  aggregator: McpToolAggregator;
  options?: ToolBridgeOptions;
  providerId?: ProviderId;
  capabilities?: ProviderCapabilities;
  preserveCapabilityIds?: readonly string[];
}): ProviderToolManifest =>
  projectRuntimeCapabilityRegistry(
    buildRuntimeCapabilityRegistry(input.aggregator, input.options),
    input.providerId,
    input.capabilities,
    input.preserveCapabilityIds ? { preserveCapabilityIds: input.preserveCapabilityIds } : undefined,
  );
