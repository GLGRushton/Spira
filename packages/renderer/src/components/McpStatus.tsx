import { useMcpStore } from "../stores/mcp-store.js";
import styles from "./McpStatus.module.css";

export function McpStatus() {
  const servers = useMcpStore((store) => store.servers);

  return (
    <section className={styles.panel}>
      <div className={styles.title}>MCP Servers</div>
      <div className={styles.list}>
        {servers.length === 0 ? (
          <div className={styles.empty}>Awaiting registry sync</div>
        ) : (
          servers.map((server) => (
            <article key={server.id} className={styles.item}>
              <span className={`${styles.dot} ${styles[server.state]}`} />
              <div className={styles.meta}>
                <div className={styles.name}>{server.name}</div>
                <div className={styles.caption}>{server.toolCount} tools</div>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
