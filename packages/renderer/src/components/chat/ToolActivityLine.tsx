import type { ToolCallEntry } from "../../stores/chat-store.js";
import { shouldDisplayToolName } from "../../tool-display.js";
import styles from "./ToolActivityLine.module.css";

interface ToolActivityLineProps {
  toolCalls?: ToolCallEntry[];
}

const ACTIVE_STATUSES = new Set<ToolCallEntry["status"]>(["pending", "running"]);

export function ToolActivityLine({ toolCalls }: ToolActivityLineProps) {
  const activeCalls = (toolCalls ?? []).filter(
    (entry) => shouldDisplayToolName(entry.name) && ACTIVE_STATUSES.has(entry.status),
  );
  if (activeCalls.length === 0) {
    return null;
  }

  const counts = new Map<string, number>();
  for (const entry of activeCalls) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }

  const labels = Array.from(counts.entries()).map(([name, count]) => ({
    key: name,
    text: count > 1 ? `${name} x${count}` : name,
  }));

  return (
    <div className={styles.line} aria-live="polite">
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>
        Running {activeCalls.length} tool{activeCalls.length === 1 ? "" : "s"}
      </span>
      <span className={styles.items}>
        {labels.map((item, index) => (
          <span key={item.key} className={styles.item}>
            {index > 0 ? <span className={styles.separator}>•</span> : null}
            <span className={styles.details}>{item.text}</span>
          </span>
        ))}
      </span>
    </div>
  );
}
