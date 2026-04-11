import type { McpServerStatus, SubagentDomain } from "@spira/shared";
import { useMemo, useState } from "react";
import type { AgentRoom } from "../../stores/room-store.js";
import styles from "./BarracksDetail.module.css";

interface BarracksDetailProps {
  servers: McpServerStatus[];
  agents: SubagentDomain[];
  agentRooms: AgentRoom[];
}

interface SubagentDraft {
  id: string;
  label: string;
  description: string;
  systemPrompt: string;
  serverIds: string[];
  allowedToolMode: "all" | "selected";
  allowedToolNames: string[];
  ready: boolean;
}

const MAX_VISIBLE_TOOLS = 8;

const createEmptyDraft = (): SubagentDraft => ({
  id: "",
  label: "",
  description: "",
  systemPrompt: "",
  serverIds: [],
  allowedToolMode: "all",
  allowedToolNames: [],
  ready: true,
});

const normalizeIdentifier = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

const getDomainTone = (domain: SubagentDomain): string => {
  if (domain.id === "windows") {
    return styles.windows;
  }
  if (domain.id === "spira") {
    return styles.spira;
  }
  if (domain.id === "nexus") {
    return styles.nexus;
  }
  return styles.custom;
};

export function BarracksDetail({ servers, agents, agentRooms }: BarracksDetailProps) {
  const [draft, setDraft] = useState<SubagentDraft>(createEmptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);

  const connectedServers = useMemo(() => servers.filter((server) => server.state === "connected"), [servers]);
  const deployedRooms = agentRooms.filter((room) => room.kind === "subagent").length;
  const linkedSurfaceCount = [...new Set(agents.flatMap((agent) => agent.serverIds))].filter((serverId) =>
    servers.some((server) => server.id === serverId && server.state === "connected"),
  ).length;
  const delegatedToolCount = agents.reduce((sum, agent) => {
    const linkedServers = agent.serverIds.map((serverId) => servers.find((server) => server.id === serverId) ?? null);
    const availableTools = [...new Set(linkedServers.flatMap((server) => server?.tools ?? []))];
    return (
      sum +
      (agent.allowedToolNames && agent.allowedToolNames.length > 0
        ? agent.allowedToolNames.length
        : availableTools.length)
    );
  }, 0);

  const availableDraftTools = useMemo(
    () =>
      [
        ...new Set(
          draft.serverIds.flatMap((serverId) => servers.find((server) => server.id === serverId)?.tools ?? []),
        ),
      ].sort(),
    [draft.serverIds, servers],
  );

  const resetDraft = () => {
    setDraft(createEmptyDraft());
    setEditingId(null);
    setIsFormOpen(false);
  };

  const openCreateForm = () => {
    setDraft(createEmptyDraft());
    setEditingId(null);
    setIsFormOpen(true);
  };

  const openEditForm = (agent: SubagentDomain) => {
    setEditingId(agent.id);
    setIsFormOpen(true);
    setDraft({
      id: agent.id,
      label: agent.label,
      description: agent.description ?? "",
      systemPrompt: agent.systemPrompt,
      serverIds: [...agent.serverIds],
      allowedToolMode: agent.allowedToolNames && agent.allowedToolNames.length > 0 ? "selected" : "all",
      allowedToolNames: [...(agent.allowedToolNames ?? [])],
      ready: agent.ready !== false,
    });
  };

  const handleServerToggle = (serverId: string) => {
    setDraft((current) => {
      const nextServerIds = current.serverIds.includes(serverId)
        ? current.serverIds.filter((entry) => entry !== serverId)
        : [...current.serverIds, serverId];
      const nextAllowedTools = current.allowedToolNames.filter((toolName) =>
        [...new Set(nextServerIds.flatMap((id) => servers.find((server) => server.id === id)?.tools ?? []))].includes(
          toolName,
        ),
      );
      return {
        ...current,
        serverIds: nextServerIds,
        allowedToolNames: nextAllowedTools,
      };
    });
  };

  const handleToolToggle = (toolName: string) => {
    setDraft((current) => ({
      ...current,
      allowedToolNames: current.allowedToolNames.includes(toolName)
        ? current.allowedToolNames.filter((entry) => entry !== toolName)
        : [...current.allowedToolNames, toolName],
    }));
  };

  const submitDraft = () => {
    const normalisedId = normalizeIdentifier(draft.id || draft.label);
    if (!draft.label.trim() || !normalisedId || draft.serverIds.length === 0) {
      return;
    }

    const payload = {
      id: normalisedId,
      label: draft.label.trim(),
      description: draft.description.trim(),
      systemPrompt: draft.systemPrompt.trim(),
      serverIds: draft.serverIds,
      allowedToolNames: draft.allowedToolMode === "all" ? null : draft.allowedToolNames,
      allowWrites: true,
      ready: draft.ready,
    };

    if (editingId) {
      window.electronAPI.updateSubagent(editingId, {
        label: payload.label,
        description: payload.description,
        systemPrompt: payload.systemPrompt,
        serverIds: payload.serverIds,
        allowedToolNames: payload.allowedToolNames,
        ready: payload.ready,
      });
    } else {
      window.electronAPI.createSubagent(payload);
    }

    resetDraft();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Barracks</div>
          <h2 className={styles.title}>Delegation roster</h2>
        </div>
        <div className={styles.headerActions}>
          <p className={styles.caption}>
            A standing roster of Shinra&apos;s bespoke subagents and the MCP surfaces each one is cleared to access.
            This is the part where the org chart pretends to be glamorous.
          </p>
          <button type="button" className={styles.actionButton} onClick={openCreateForm}>
            New subagent
          </button>
        </div>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Custom subagents</span>
          <strong className={styles.metricValue}>{agents.filter((agent) => agent.source === "user").length}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Linked surfaces</span>
          <strong className={styles.metricValue}>{linkedSurfaceCount}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Delegated tools</span>
          <strong className={styles.metricValue}>{delegatedToolCount}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Live field rooms</span>
          <strong className={styles.metricValue}>{deployedRooms}</strong>
        </article>
      </div>

      {isFormOpen ? (
        <div className={styles.formPanel}>
          <div className={styles.formHeader}>
            <div>
              <div className={styles.sectionLabel}>{editingId ? "Edit custom subagent" : "Create custom subagent"}</div>
              <div className={styles.formCaption}>
                Name it, brief it, wire its MCP surfaces, and decide whether Shinra can call on it.
              </div>
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} onClick={resetDraft}>
                Cancel
              </button>
              <button type="button" className={styles.actionButton} onClick={submitDraft}>
                {editingId ? "Save subagent" : "Create subagent"}
              </button>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Name</span>
              <input
                className={styles.input}
                value={draft.label}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    label: event.target.value,
                    id: editingId ? current.id : normalizeIdentifier(event.target.value),
                  }))
                }
                placeholder="YouTrack Agent"
              />
            </label>
            <label className={styles.field}>
              <span>Identifier</span>
              <input
                className={styles.input}
                value={draft.id}
                disabled={editingId !== null}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, id: normalizeIdentifier(event.target.value) }))
                }
                placeholder="youtrack-agent"
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>Description</span>
              <input
                className={styles.input}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Handles issue triage and release-note preparation."
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>System prompt</span>
              <textarea
                className={styles.textarea}
                value={draft.systemPrompt}
                onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
                placeholder="Focus on concise issue summaries and workflow-safe suggestions."
              />
            </label>
          </div>

          <div className={styles.toggleRow}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={draft.ready}
                onChange={(event) => setDraft((current) => ({ ...current, ready: event.target.checked }))}
              />
              <span>Ready for Shinra</span>
            </label>
          </div>

          <div className={styles.selectionSection}>
            <div className={styles.sectionLabel}>Linked MCP servers</div>
            <div className={styles.checkboxGrid}>
              {servers.map((server) => (
                <label key={server.id} className={styles.checkboxCard}>
                  <input
                    type="checkbox"
                    checked={draft.serverIds.includes(server.id)}
                    onChange={() => handleServerToggle(server.id)}
                  />
                  <div>
                    <strong>{server.name}</strong>
                    <div className={styles.checkboxMeta}>{server.toolCount} tools</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className={styles.selectionSection}>
            <div className={styles.sectionLabel}>Allowed tools</div>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={draft.allowedToolMode === "all"}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    allowedToolMode: event.target.checked ? "all" : "selected",
                    allowedToolNames: event.target.checked ? [] : current.allowedToolNames,
                  }))
                }
              />
              <span>Use every tool on linked servers</span>
            </label>
            {draft.allowedToolMode === "selected" ? (
              <div className={styles.checkboxGrid}>
                {availableDraftTools.map((toolName) => (
                  <label key={toolName} className={styles.checkboxCard}>
                    <input
                      type="checkbox"
                      checked={draft.allowedToolNames.includes(toolName)}
                      onChange={() => handleToolToggle(toolName)}
                    />
                    <div>
                      <strong>{toolName}</strong>
                    </div>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className={styles.roster}>
        {agents.map((domain) => {
          const linkedServers = domain.serverIds.map(
            (serverId) => servers.find((server) => server.id === serverId) ?? null,
          );
          const availableToolNames = [...new Set(linkedServers.flatMap((server) => server?.tools ?? []))];
          const toolNames =
            domain.allowedToolNames && domain.allowedToolNames.length > 0
              ? domain.allowedToolNames
              : availableToolNames;
          const visibleToolNames = toolNames.slice(0, MAX_VISIBLE_TOOLS);
          const hiddenToolCount = Math.max(toolNames.length - visibleToolNames.length, 0);
          const domainRooms = agentRooms.filter((room) => room.kind === "subagent" && room.domainId === domain.id);

          return (
            <article key={domain.id} className={`${styles.domainCard} ${getDomainTone(domain)}`}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.domainEyebrow}>{domain.delegationToolName}</div>
                  <h3 className={styles.domainTitle}>{domain.label}</h3>
                  <p className={styles.domainDescription}>{domain.description ?? "Custom delegation profile."}</p>
                </div>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.toggleButton}
                    onClick={() => window.electronAPI.setSubagentReady(domain.id, domain.ready === false)}
                  >
                    {domain.ready === false ? "Standby" : "Ready"}
                  </button>
                  {domain.source === "user" ? (
                    <>
                      <button type="button" className={styles.secondaryButton} onClick={() => openEditForm(domain)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.dangerButton}
                        onClick={() => window.electronAPI.removeSubagent(domain.id)}
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <div className={styles.cardBadge}>Built-in</div>
                  )}
                </div>
              </div>

              <div className={styles.cardMeta}>
                <span>{domain.allowWrites ? "Write-capable when granted" : "Read-only domain"}</span>
                <span>
                  {linkedServers.filter(Boolean).length}/{domain.serverIds.length} linked surfaces
                </span>
                <span>{domainRooms.length > 0 ? `${domainRooms.length} live rooms` : "Standby"}</span>
              </div>

              <div className={styles.serverGrid}>
                {domain.serverIds.map((serverId) => {
                  const server = servers.find((entry) => entry.id === serverId);
                  return (
                    <div key={serverId} className={styles.serverCard}>
                      <div className={styles.serverHeader}>
                        <span className={`${styles.stateDot} ${styles[server?.state ?? "disconnected"]}`} />
                        <span className={styles.serverName}>{server?.name ?? serverId}</span>
                      </div>
                      <div className={styles.serverMeta}>{server ? `${server.toolCount} tools` : "Awaiting link"}</div>
                    </div>
                  );
                })}
              </div>

              <div className={styles.sectionLabel}>Allowed tools</div>
              {toolNames.length > 0 ? (
                <div className={styles.toolCloud}>
                  {visibleToolNames.map((toolName) => (
                    <span key={`${domain.id}-${toolName}`} className={styles.toolPill}>
                      {toolName}
                    </span>
                  ))}
                  {hiddenToolCount > 0 ? (
                    <span className={`${styles.toolPill} ${styles.toolOverflow}`}>+{hiddenToolCount} more</span>
                  ) : null}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  {connectedServers.length === 0
                    ? "No connected MCP surfaces are reporting tools right now."
                    : "No tool inventory reported for this domain yet."}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
