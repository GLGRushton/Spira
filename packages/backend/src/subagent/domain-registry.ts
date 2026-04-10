import type { McpTool, SubagentDomain, SubagentDomainId } from "@spira/shared";

export const SUBAGENT_DOMAINS: readonly SubagentDomain[] = [
  {
    id: "windows",
    label: "Windows Agent",
    serverIds: ["windows-system", "windows-ui", "vision"],
    delegationToolName: "delegate_to_windows",
    allowWrites: true,
    systemPrompt: "",
  },
  {
    id: "spira",
    label: "Spira Agent",
    serverIds: ["spira-ui"],
    delegationToolName: "delegate_to_spira",
    allowWrites: true,
    systemPrompt: "",
  },
  {
    id: "nexus",
    label: "Nexus Agent",
    serverIds: ["nexus-mods"],
    delegationToolName: "delegate_to_nexus",
    allowWrites: true,
    systemPrompt: "",
  },
];

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
