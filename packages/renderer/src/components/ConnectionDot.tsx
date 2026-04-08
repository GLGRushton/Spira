import { useConnectionStore } from "../stores/connection-store.js";
import styles from "./ConnectionDot.module.css";

const labelMap = {
  connected: "Backend connected",
  connecting: "Backend connecting",
  disconnected: "Backend disconnected",
  upgrading: "Backend upgrading",
} as const;

export function ConnectionDot() {
  const status = useConnectionStore((store) => store.status);

  return <span className={`${styles.dot} ${styles[status]}`} title={labelMap[status]} aria-label={labelMap[status]} />;
}
