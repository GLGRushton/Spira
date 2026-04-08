import type { McpServerStatus } from "@spira/shared";
import styles from "./McpRoomDetail.module.css";

interface McpRoomDetailProps {
  server: McpServerStatus;
}

const formatUptime = (uptimeMs?: number): string => {
  if (!uptimeMs || uptimeMs < 1000) {
    return "Fresh link";
  }

  const seconds = Math.floor(uptimeMs / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) {
    return `${seconds}s linked`;
  }

  if (minutes < 60) {
    return `${minutes}m linked`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h linked`;
};

export function McpRoomDetail({ server }: McpRoomDetailProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>MCP room</div>
          <h2 className={styles.title}>{server.name}</h2>
        </div>
        <div className={`${styles.statePill} ${styles[server.state]}`}>{server.state}</div>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Tool inventory</span>
          <strong className={styles.metricValue}>{server.toolCount}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Link status</span>
          <strong className={styles.metricValue}>{formatUptime(server.uptimeMs)}</strong>
        </article>
      </div>

      <div className={styles.toolSection}>
        <div className={styles.toolHeader}>
          <div className={styles.toolTitle}>Available tools</div>
          <div className={styles.toolCaption}>Operational endpoints exposed by this room.</div>
        </div>
        <div className={styles.toolGrid}>
          {server.tools.length === 0 ? (
            <div className={styles.empty}>No tools are currently registered.</div>
          ) : (
            server.tools.map((tool) => (
              <div key={tool} className={styles.toolChip}>
                {tool}
              </div>
            ))
          )}
        </div>
      </div>

      {server.error ? <div className={styles.errorBox}>{server.error}</div> : null}
    </div>
  );
}
