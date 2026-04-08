import type { McpServerStatus } from "@spira/shared";
import styles from "./McpClusterDetail.module.css";

interface McpClusterDetailProps {
  servers: McpServerStatus[];
  onSelectServer: (serverId: string) => void;
}

export function McpClusterDetail({ servers, onSelectServer }: McpClusterDetailProps) {
  const connected = servers.filter((server) => server.state === "connected").length;
  const totalTools = servers.reduce((sum, server) => sum + server.toolCount, 0);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>MCP cluster</div>
          <h2 className={styles.title}>Local tool network</h2>
        </div>
        <p className={styles.caption}>
          Grouped access to attached MCP servers. Drill into any room to inspect its inventory or troubleshoot a
          specific link.
        </p>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Connected rooms</span>
          <strong className={styles.metricValue}>
            {connected}/{servers.length}
          </strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Tool inventory</span>
          <strong className={styles.metricValue}>{totalTools}</strong>
        </article>
      </div>

      <div className={styles.roster}>
        {servers.map((server) => (
          <button key={server.id} type="button" className={styles.serverCard} onClick={() => onSelectServer(server.id)}>
            <div className={styles.serverTopline}>
              <span className={`${styles.stateDot} ${styles[server.state]}`} />
              <span className={styles.serverState}>{server.state}</span>
            </div>
            <div className={styles.serverName}>{server.name}</div>
            <div className={styles.serverMeta}>
              <span>{server.toolCount} tools</span>
              <span>{server.tools.slice(0, 2).join(" · ") || "No tools"}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
