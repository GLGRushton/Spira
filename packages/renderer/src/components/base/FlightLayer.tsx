import type { ToolCallStatus } from "@spira/shared";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import type { ToolFlight } from "../../stores/room-store.js";
import { RECENT_COMPLETION_MS } from "../../tool-display.js";
import styles from "./FlightLayer.module.css";

interface FlightLayerProps {
  flights: ToolFlight[];
  trackRef: MutableRefObject<HTMLDivElement | null>;
  roomNodesRef: MutableRefObject<Map<string, HTMLButtonElement | null>>;
}

interface PositionedFlight {
  flight: ToolFlight;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

const statusClassName = (status: ToolCallStatus): string => {
  switch (status) {
    case "error":
      return styles.error;
    case "success":
      return styles.success;
    case "running":
      return styles.running;
    default:
      return styles.pending;
  }
};

export function FlightLayer({ flights, trackRef, roomNodesRef }: FlightLayerProps) {
  const [positionedFlights, setPositionedFlights] = useState<PositionedFlight[]>([]);

  const activeFlights = useMemo(
    () =>
      flights.filter((flight) => {
        if (!flight.completedAt) {
          return true;
        }

        return Date.now() - flight.completedAt < RECENT_COMPLETION_MS;
      }),
    [flights],
  );

  useEffect(() => {
    const updatePositions = () => {
      const trackNode = trackRef.current;
      if (!trackNode) {
        setPositionedFlights([]);
        return;
      }

      const trackRect = trackNode.getBoundingClientRect();
      const nextFlights = activeFlights
        .map((flight) => {
          const fromNode = roomNodesRef.current.get(flight.fromRoomId);
          const toNode = roomNodesRef.current.get(flight.toRoomId);
          if (!fromNode || !toNode) {
            return null;
          }

          const fromRect = fromNode.getBoundingClientRect();
          const toRect = toNode.getBoundingClientRect();
          return {
            flight,
            fromX: fromRect.left - trackRect.left + fromRect.width / 2,
            fromY: fromRect.top - trackRect.top + fromRect.height / 2,
            toX: toRect.left - trackRect.left + toRect.width / 2,
            toY: toRect.top - trackRect.top + toRect.height / 2,
          };
        })
        .filter((flight): flight is PositionedFlight => flight !== null);

      setPositionedFlights(nextFlights);
    };

    updatePositions();

    const trackNode = trackRef.current;
    trackNode?.addEventListener("scroll", updatePositions, { passive: true });
    window.addEventListener("resize", updatePositions);
    const intervalId = window.setInterval(updatePositions, 250);

    return () => {
      trackNode?.removeEventListener("scroll", updatePositions);
      window.removeEventListener("resize", updatePositions);
      window.clearInterval(intervalId);
    };
  }, [activeFlights, roomNodesRef, trackRef]);

  return (
    <div className={styles.layer} aria-hidden="true">
      {positionedFlights.map(({ flight, fromX, fromY, toX, toY }) => {
        const deltaX = toX - fromX;
        const deltaY = toY - fromY;
        const distance = Math.hypot(deltaX, deltaY);
        const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;

        return (
          <div key={flight.callId} className={styles.flight}>
            <div
              data-flight-call-id={flight.callId}
              className={`${styles.trail} ${statusClassName(flight.status)}`}
              style={{
                width: `${distance}px`,
                transform: `translate(${fromX}px, ${fromY}px) rotate(${angle}deg)`,
              }}
            />
            <motion.div
              data-flight-call-id={flight.callId}
              className={`${styles.orb} ${statusClassName(flight.status)}`}
              initial={{ x: fromX - 8, y: fromY - 8, opacity: 0, scale: 0.55 }}
              animate={{
                x: toX - 8,
                y: toY - 8,
                opacity: flight.completedAt ? 0.35 : 0.95,
                scale: flight.completedAt ? 0.72 : 1,
              }}
              transition={{
                duration: flight.completedAt ? 0.3 : 0.85,
                ease: "easeInOut",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
