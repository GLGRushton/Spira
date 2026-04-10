import { type McpTool, SUBAGENT_DOMAINS, type SubagentDomain, type SubagentDomainId } from "@spira/shared";

export { SUBAGENT_DOMAINS } from "@spira/shared";

const delegatedServerIds = new Set(SUBAGENT_DOMAINS.flatMap((domain) => domain.serverIds));

export const getSubagentDomain = (domainId: SubagentDomainId): SubagentDomain | undefined =>
  SUBAGENT_DOMAINS.find((domain) => domain.id === domainId);

export const getSubagentDomainForServer = (serverId: string): SubagentDomain | undefined =>
  SUBAGENT_DOMAINS.find((domain) => domain.serverIds.includes(serverId));

export const getDelegatedServerIds = (): string[] => [...delegatedServerIds];

export const getDomainTools = (domainId: SubagentDomainId, tools: readonly McpTool[]): McpTool[] => {
  const domain = getSubagentDomain(domainId);
  if (!domain) {
    return [];
  }

  const serverIds = new Set(domain.serverIds);
  return tools.filter((tool) => serverIds.has(tool.serverId));
};
