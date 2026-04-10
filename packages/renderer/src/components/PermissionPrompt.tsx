import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { usePermissionStore } from "../stores/permission-store.js";
import { useStationStore } from "../stores/station-store.js";
import styles from "./PermissionPrompt.module.css";

const formatArgs = (args: Record<string, unknown> | undefined): string => {
  if (!args || Object.keys(args).length === 0) {
    return "No arguments";
  }

  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
};

export function PermissionPrompt() {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const requests = usePermissionStore((store) => store.requests);
  const removeRequest = usePermissionStore((store) => store.removeRequest);
  const currentRequest = requests.find((request) => request.stationId === activeStationId) ?? requests[0];
  const args = useMemo(() => formatArgs(currentRequest?.args), [currentRequest?.args]);

  const respond = (approved: boolean) => {
    if (!currentRequest) {
      return;
    }

    window.electronAPI.send({
      type: "permission:respond",
      requestId: currentRequest.requestId,
      approved,
    });
    removeRequest(currentRequest.requestId);
  };

  return (
    <AnimatePresence initial={false}>
      {currentRequest ? (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.section
            className={styles.panel}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.18 }}
          >
            <div className={styles.header}>
              <span className={styles.eyebrow}>Permission request</span>
              <h2 className={styles.title}>Allow Shinra to use {currentRequest.toolTitle}?</h2>
              <p className={styles.copy}>
                This tool comes from <strong>{currentRequest.serverName}</strong> and may inspect your screen or local
                content. Approve only if you expect Shinra to look at what is currently on screen.
              </p>
            </div>

            <dl className={styles.meta}>
              <div>
                <dt>Tool</dt>
                <dd>{currentRequest.toolName}</dd>
              </div>
              <div>
                <dt>Read-only</dt>
                <dd>{currentRequest.readOnly ? "Yes" : "No"}</dd>
              </div>
            </dl>

            <div className={styles.args}>
              <span className={styles.label}>Arguments</span>
              <pre>{args}</pre>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.deny} onClick={() => respond(false)}>
                Deny
              </button>
              <button type="button" className={styles.approve} onClick={() => respond(true)}>
                Approve
              </button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
