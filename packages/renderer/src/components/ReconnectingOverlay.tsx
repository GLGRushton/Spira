import { AnimatePresence, motion } from "framer-motion";
import { useConnectionStore } from "../stores/connection-store.js";
import styles from "./ReconnectingOverlay.module.css";

export function ReconnectingOverlay() {
  const status = useConnectionStore((store) => store.status);
  const visible = status !== "connected";

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className={styles.panel}>
            <motion.div
              className={styles.orb}
              animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            />
            <p className={styles.text}>Reconnecting to Spira...</p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
