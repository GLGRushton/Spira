import type { SpiraMemoryDatabase, SubagentConfigRecord } from "@spira/memory-db";
import type { McpTool, SubagentCreateConfig, SubagentDomain } from "@spira/shared";
import { SUBAGENT_DOMAINS } from "@spira/shared";
import { ConfigError } from "../util/errors.js";
import type { SpiraEventBus } from "../util/event-bus.js";

const RESERVED_SUBAGENT_IDS = new Set(SUBAGENT_DOMAINS.map((domain) => domain.id));

const normalizeIdentifier = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

const toDelegationToolName = (id: string): string => `delegate_to_${id.replace(/[^a-z0-9]+/gu, "_")}`;

const normalizeDomain = (domain: SubagentDomain): SubagentDomain => ({
  ...domain,
  label: domain.label.trim(),
  description: domain.description?.trim() ?? "",
  serverIds: [...new Set(domain.serverIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0))],
  allowedToolNames:
    domain.allowedToolNames === null || domain.allowedToolNames === undefined
      ? null
      : [...new Set(domain.allowedToolNames.map((entry) => entry.trim()).filter((entry) => entry.length > 0))],
  delegationToolName: domain.delegationToolName.trim(),
  systemPrompt: domain.systemPrompt.trim(),
  ready: domain.ready ?? true,
  source: domain.source ?? "builtin",
});

const toDomainRecord = (record: SubagentConfigRecord): SubagentDomain => normalizeDomain(record);

export const mergeBuiltinDomains = (
  builtinDomains: readonly SubagentDomain[],
  dynamicBuiltinDomains: readonly SubagentDomain[],
): SubagentDomain[] => {
  const dynamicIds = new Set(dynamicBuiltinDomains.map((domain) => domain.id));
  return [...builtinDomains.filter((domain) => !dynamicIds.has(domain.id)), ...dynamicBuiltinDomains];
};

export const filterManagedBuiltinDomains = (
  domains: readonly SubagentDomain[],
  activeBuiltinDomainIds: readonly string[],
  managedBuiltinDomainIds: readonly string[],
): SubagentDomain[] => {
  const activeIds = new Set(activeBuiltinDomainIds);
  const managedIds = new Set(managedBuiltinDomainIds);
  return domains.filter((domain) => !managedIds.has(domain.id) || activeIds.has(domain.id));
};

export class SubagentRegistry {
  constructor(
    private readonly bus: SpiraEventBus,
    private readonly memoryDb: SpiraMemoryDatabase | null,
    private readonly dynamicBuiltinDomains: readonly SubagentDomain[] = [],
    private readonly managedBuiltinDomainIds: readonly string[] = [],
  ) {}

  initialize(): void {
    if (!this.memoryDb) {
      this.publishCatalog();
      return;
    }

    this.memoryDb.seedBuiltinSubagentConfigs(mergeBuiltinDomains(SUBAGENT_DOMAINS, this.dynamicBuiltinDomains));
    this.publishCatalog();
  }

  listAll(): SubagentDomain[] {
    if (!this.memoryDb) {
      return mergeBuiltinDomains(SUBAGENT_DOMAINS, this.dynamicBuiltinDomains);
    }

    return filterManagedBuiltinDomains(
      this.memoryDb.listSubagentConfigs().map(toDomainRecord),
      this.dynamicBuiltinDomains.map((domain) => domain.id),
      this.managedBuiltinDomainIds,
    );
  }

  listReady(): SubagentDomain[] {
    return this.listAll().filter((domain) => domain.ready);
  }

  get(domainId: string): SubagentDomain | null {
    return this.listAll().find((domain) => domain.id === domainId) ?? null;
  }

  getDelegatedServerIds(): string[] {
    return [...new Set(this.listReady().flatMap((domain) => domain.serverIds))];
  }

  getDomainTools(domainId: string, tools: readonly McpTool[]): McpTool[] {
    const domain = this.get(domainId);
    if (!domain) {
      return [];
    }

    return filterSubagentDomainTools(domain, tools);
  }

  createCustom(input: SubagentCreateConfig): SubagentDomain {
    if (!this.memoryDb) {
      throw new ConfigError("Subagent persistence is unavailable");
    }

    const id = normalizeIdentifier(input.id ?? input.label);
    if (!id) {
      throw new ConfigError("Subagent id cannot be empty");
    }
    if (this.get(id)) {
      throw new ConfigError(`Subagent ${id} already exists`);
    }
    if (RESERVED_SUBAGENT_IDS.has(id) || this.managedBuiltinDomainIds.includes(id)) {
      throw new ConfigError(`Subagent id ${id} is reserved`);
    }

    const saved = this.memoryDb.upsertSubagentConfig(
      normalizeDomain({
        ...input,
        id,
        source: "user",
        delegationToolName: input.delegationToolName?.trim() || toDelegationToolName(id),
      }),
    );
    this.publishCatalog();
    return toDomainRecord(saved);
  }

  updateCustom(
    domainId: string,
    patch: Partial<Omit<SubagentDomain, "id" | "source" | "delegationToolName">>,
  ): SubagentDomain {
    if (!this.memoryDb) {
      throw new ConfigError("Subagent persistence is unavailable");
    }

    const existing = this.requireDomain(domainId);
    if (existing.source !== "user") {
      throw new ConfigError(`Built-in subagent ${domainId} cannot be edited`);
    }

    const saved = this.memoryDb.upsertSubagentConfig(
      normalizeDomain({
        ...existing,
        ...patch,
        id: existing.id,
        source: "user",
        delegationToolName: existing.delegationToolName,
      }),
    );
    this.publishCatalog();
    return toDomainRecord(saved);
  }

  removeCustom(domainId: string): void {
    if (!this.memoryDb) {
      throw new ConfigError("Subagent persistence is unavailable");
    }

    const existing = this.requireDomain(domainId);
    if (existing.source !== "user") {
      throw new ConfigError(`Built-in subagent ${domainId} cannot be removed`);
    }
    if (!this.memoryDb.removeSubagentConfig(domainId)) {
      throw new ConfigError(`Subagent ${domainId} was not found`);
    }
    this.publishCatalog();
  }

  setReady(domainId: string, ready: boolean): void {
    if (!this.memoryDb) {
      throw new ConfigError("Subagent persistence is unavailable");
    }

    const existing = this.requireDomain(domainId);
    if (!this.memoryDb.setSubagentReady(domainId, ready)) {
      throw new ConfigError(`Subagent ${domainId} was not found`);
    }
    if (existing.source === "builtin") {
      RESERVED_SUBAGENT_IDS.add(existing.id);
    }
    this.publishCatalog();
  }

  private requireDomain(domainId: string): SubagentDomain {
    const domain = this.get(domainId);
    if (!domain) {
      throw new ConfigError(`Unknown subagent ${domainId}`);
    }

    return domain;
  }

  private publishCatalog(): void {
    this.bus.emit("subagent:catalog-changed", this.listAll());
  }
}

export const filterSubagentDomainTools = (
  domain: Pick<SubagentDomain, "serverIds" | "allowedToolNames">,
  tools: readonly McpTool[],
): McpTool[] => {
  const serverIdSet = new Set(domain.serverIds);
  const scopedTools = tools.filter((tool) => serverIdSet.has(tool.serverId));
  if (!domain.allowedToolNames || domain.allowedToolNames.length === 0) {
    return scopedTools;
  }

  const allowedToolNames = new Set(domain.allowedToolNames);
  return scopedTools.filter((tool) => allowedToolNames.has(tool.name));
};
