import { useMemo, useState } from "react";
import type { ToolCallEntry } from "../../stores/chat-store.js";
import styles from "./ToolCallCard.module.css";

interface ToolCallCardProps {
  entry: ToolCallEntry;
}

const formatValue = (value: unknown) => {
  if (value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

export function ToolCallCard({ entry }: ToolCallCardProps) {
  const [open, setOpen] = useState(entry.status !== "success");
  const result = useMemo(() => {
    if (entry.result && typeof entry.result === "object" && "value" in entry.result) {
      return entry.result.value;
    }

    return entry.result;
  }, [entry.result]);
  const statusClass =
    entry.status === "error" ? styles.error : entry.result !== undefined ? styles.success : styles.pending;
  const statusIcon = entry.status === "error" ? "!" : entry.result !== undefined ? "✓" : "…";

  return (
    <div className={styles.card}>
      <button type="button" className={styles.header} onClick={() => setOpen((value) => !value)}>
        <span className={styles.name}>⚙ {entry.name}</span>
        <span className={`${styles.status} ${statusClass}`}>{statusIcon}</span>
      </button>
      {open ? (
        <div className={styles.body}>
          <div>
            <span className={styles.label}>args</span>
            <pre>{formatValue(entry.args)}</pre>
          </div>
          {entry.result ? (
            <div>
              <span className={styles.label}>result</span>
              <pre>{formatValue(result)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
