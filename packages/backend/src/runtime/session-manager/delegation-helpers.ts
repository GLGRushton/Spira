import { SUBAGENT_DOMAINS, type SubagentDomain } from "@spira/shared";
import type { McpToolAggregator } from "../../mcp/tool-aggregator.js";
import type { SubagentRegistry } from "../../subagent/registry.js";

export const getSubagentRunnerKey = (domainId: string, workingDirectory?: string): string =>
  `${domainId}::${workingDirectory ?? ""}`;

export const getDelegationDomains = (subagentRegistry: SubagentRegistry | null): SubagentDomain[] =>
  subagentRegistry?.listReady() ?? SUBAGENT_DOMAINS.filter((domain) => domain.ready !== false);

export const getDelegationDomain = (
  subagentRegistry: SubagentRegistry | null,
  domainId: string,
): SubagentDomain | null =>
  subagentRegistry?.get(domainId) ?? SUBAGENT_DOMAINS.find((domain) => domain.id === domainId) ?? null;

export const getDelegatedServerIds = (subagentRegistry: SubagentRegistry | null): string[] =>
  subagentRegistry?.getDelegatedServerIds() ?? [
    ...new Set(getDelegationDomains(subagentRegistry).flatMap((domain) => domain.serverIds)),
  ];

export const getDelegationDomainTools = (
  subagentRegistry: SubagentRegistry | null,
  domainId: string,
  tools: ReturnType<McpToolAggregator["getTools"]>,
) => {
  if (subagentRegistry) {
    return subagentRegistry.getDomainTools(domainId, tools);
  }

  const domain = getDelegationDomain(subagentRegistry, domainId);
  if (!domain) {
    return [];
  }

  const serverIdSet = new Set(domain.serverIds);
  const scopedTools = tools.filter((tool) => serverIdSet.has(tool.serverId));
  if (!domain.allowedToolNames || domain.allowedToolNames.length === 0) {
    return scopedTools;
  }

  const allowedToolNames = new Set(domain.allowedToolNames);
  return scopedTools.filter((tool) => allowedToolNames.has(tool.name));
};
