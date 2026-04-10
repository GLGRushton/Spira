import { type McpServerStatus, SUBAGENT_DOMAINS } from "@spira/shared";
import type { AgentRoom } from "../../stores/room-store.js";
import styles from "./BarracksDetail.module.css";

interface BarracksDetailProps {
  servers: McpServerStatus[];
  agentRooms: AgentRoom[];
}

const domainTone = {
  windows: styles.windows,
  spira: styles.spira,
  nexus: styles.nexus,
} as const;

const domainDescriptions = {
  windows: "Handles desktop control, system inspection, and visual reads across the host machine.",
  spira: "Works the live Spira interface and reports what the ship is doing from inside the app.",
  nexus: "Searches Nexus Mods, inspects listings, and gathers mod file details for game research.",
} as const;

const MAX_VISIBLE_TOOLS = 8;

export function BarracksDetail({ servers, agentRooms }: BarracksDetailProps) {
  const delegatedToolCount = SUBAGENT_DOMAINS.reduce(
    (sum, domain) =>
      sum +
      domain.serverIds.reduce(
        (domainSum, serverId) => domainSum + (servers.find((server) => server.id === serverId)?.toolCount ?? 0),
        0,
      ),
    0,
  );
  const connectedSurfaces = SUBAGENT_DOMAINS.reduce(
    (sum, domain) =>
      sum +
      domain.serverIds.filter((serverId) =>
        servers.some((server) => server.id === serverId && server.state === "connected"),
      ).length,
    0,
  );
  const deployedRooms = agentRooms.filter((room) => room.kind === "subagent").length;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Barracks</div>
          <h2 className={styles.title}>Delegation roster</h2>
        </div>
        <p className={styles.caption}>
          A standing roster of Shinra&apos;s bespoke subagents and the MCP surfaces each one is cleared to access. This
          is the part where the org chart pretends to be glamorous.
        </p>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Custom subagents</span>
          <strong className={styles.metricValue}>{SUBAGENT_DOMAINS.length}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Linked surfaces</span>
          <strong className={styles.metricValue}>{connectedSurfaces}</strong>
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

      <div className={styles.roster}>
        {SUBAGENT_DOMAINS.map((domain) => {
          const linkedServers = domain.serverIds.map(
            (serverId) => servers.find((server) => server.id === serverId) ?? null,
          );
          const toolNames = [...new Set(linkedServers.flatMap((server) => server?.tools ?? []))];
          const visibleToolNames = toolNames.slice(0, MAX_VISIBLE_TOOLS);
          const hiddenToolCount = Math.max(toolNames.length - visibleToolNames.length, 0);
          const domainRooms = agentRooms.filter((room) => room.kind === "subagent" && room.domainId === domain.id);

          return (
            <article key={domain.id} className={`${styles.domainCard} ${domainTone[domain.id]}`}>
              <div className={styles.cardHeader}>
                <div>
                  <div className={styles.domainEyebrow}>{domain.delegationToolName}</div>
                  <h3 className={styles.domainTitle}>{domain.label}</h3>
                  <p className={styles.domainDescription}>{domainDescriptions[domain.id]}</p>
                </div>
                <div className={styles.cardBadge}>
                  {domainRooms.length > 0 ? `${domainRooms.length} live` : "Standby"}
                </div>
              </div>

              <div className={styles.cardMeta}>
                <span>{domain.allowWrites ? "Write-capable when granted" : "Read-only domain"}</span>
                <span>
                  {linkedServers.filter(Boolean).length}/{domain.serverIds.length} linked surfaces
                </span>
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
                <div className={styles.emptyState}>No tool inventory reported for this domain yet.</div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
