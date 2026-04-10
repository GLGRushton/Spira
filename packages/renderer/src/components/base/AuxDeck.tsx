import type { AssistantState } from "@spira/shared";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useRoomStore } from "../../stores/room-store.js";
import { useStationStore } from "../../stores/station-store.js";
import {
  RECENT_COMPLETION_MS,
  classifyToolName,
  getToolTargetLabel,
  shouldDisplayToolName,
} from "../../tool-display.js";
import styles from "./AuxDeck.module.css";

interface AuxDeckProps {
  assistantState: AssistantState;
}

const formatElapsed = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

export function AuxDeck({ assistantState }: AuxDeckProps) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const allFlights = useRoomStore((store) => store.flights);
  const flights = useMemo(
    () => allFlights.filter((flight) => flight.stationId === activeStationId),
    [activeStationId, allFlights],
  );
  const [now, setNow] = useState(() => Date.now());
  const hasVisibleFlights = useMemo(
    () =>
      flights.some(
        (flight) =>
          shouldDisplayToolName(flight.toolName) &&
          (!flight.completedAt || Date.now() - flight.completedAt < RECENT_COMPLETION_MS),
      ),
    [flights],
  );

  useEffect(() => {
    if (!hasVisibleFlights) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasVisibleFlights]);

  const visibleFlights = useMemo(
    () =>
      flights
        .filter((flight) => {
          if (!shouldDisplayToolName(flight.toolName)) {
            return false;
          }

          if (!flight.completedAt) {
            return true;
          }

          return now - flight.completedAt < RECENT_COMPLETION_MS;
        })
        .sort((left, right) => {
          const leftWeight = left.completedAt ? 1 : 0;
          const rightWeight = right.completedAt ? 1 : 0;
          if (leftWeight !== rightWeight) {
            return leftWeight - rightWeight;
          }

          return right.startedAt - left.startedAt;
        }),
    [flights, now],
  );

  return (
    <section className={styles.stage} aria-label="Active tool monitor">
      <div className={styles.header}>
        <div className={styles.eyebrow}>Aux deck</div>
        <span className={styles.count}>
          {visibleFlights.length > 0 ? `${visibleFlights.length} live` : "Monitoring"}
        </span>
      </div>

      {visibleFlights.length === 0 ? (
        <div className={styles.emptyState}>
          <h3 className={styles.emptyTitle}>Tool monitor standing by</h3>
          <p className={styles.emptyCopy}>
            {assistantState === "idle"
              ? "No active tool traffic. Shinra will surface live operations here when the bridge spins up."
              : assistantState === "error"
                ? "Bridge systems are quiet after an error state. The next successful relay will repopulate this deck."
                : "Waiting for the next tool relay to break across the deck."}
          </p>
        </div>
      ) : (
        <div className={styles.list} aria-live="off">
          <AnimatePresence initial={false}>
            {visibleFlights.map((flight) => {
              const category = classifyToolName(flight.toolName);
              const status = flight.status === "success" ? "complete" : flight.status;
              const elapsed = formatElapsed((flight.completedAt ?? now) - flight.startedAt);

              return (
                <motion.div
                  key={flight.callId}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={`${styles.card} ${styles[category]} ${styles[status]}`}
                >
                  <div className={styles.cardTop}>
                    <strong className={styles.toolName}>{flight.toolName}</strong>
                    <span className={`${styles.statusPill} ${styles[status]}`}>{status}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.target}>{getToolTargetLabel(flight.toRoomId)}</span>
                    <span className={styles.elapsed}>{elapsed}</span>
                  </div>
                  <div className={styles.track}>
                    {flight.completedAt ? (
                      <motion.span
                        className={styles.fill}
                        initial={{ opacity: 0.35, scaleX: 0.35 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        transition={{ duration: 0.24, ease: "easeOut" }}
                      />
                    ) : (
                      <motion.span
                        className={styles.scan}
                        animate={{ x: ["-120%", "120%"] }}
                        transition={{ duration: 1.25, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
                      />
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
