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

const formatRelativeTime = (timestamp?: number): string => {
  if (!timestamp) {
    return "No failures yet";
  }

  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) {
    return "Moments ago";
  }

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const describeLinkStatus = (server: McpServerStatus): string => {
  if (!server.enabled) {
    return "Disabled";
  }

  if (server.state === "connected") {
    return formatUptime(server.uptimeMs);
  }

  if (server.lastConnectedAt) {
    return `Last linked ${formatRelativeTime(server.lastConnectedAt)}`;
  }

  return server.state === "starting" ? "Attempting link" : "Awaiting link";
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
          <strong className={styles.metricValue}>{describeLinkStatus(server)}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Failure count</span>
          <strong className={styles.metricValue}>{server.diagnostics.failureCount}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Last failure</span>
          <strong className={styles.metricValue}>{formatRelativeTime(server.diagnostics.lastFailureAt)}</strong>
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

      {server.diagnostics.remediationHint ? (
        <div className={styles.diagnosticSection}>
          <div className={styles.diagnosticTitle}>Remediation hint</div>
          <div className={styles.diagnosticHint}>{server.diagnostics.remediationHint}</div>
        </div>
      ) : null}

      {server.diagnostics.recentStderr.length > 0 ? (
        <div className={styles.diagnosticSection}>
          <div className={styles.diagnosticTitle}>Recent stderr</div>
          <div className={styles.logList}>
            {server.diagnostics.recentStderr.map((line, index) => (
              <div key={`${index}:${line}`} className={styles.logLine}>
                {line}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
