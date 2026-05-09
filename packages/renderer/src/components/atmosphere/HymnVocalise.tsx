import { useChatStore } from "../../stores/chat-store.js";
import { useRoomStore } from "../../stores/room-store.js";
import styles from "./HymnVocalise.module.css";

const LONG_FLIGHT_THRESHOLD_MS = 15_000;

export function HymnVocalise() {
  const anyStreaming = useChatStore((store) =>
    Object.values(store.sessions).some((session) => session.isStreaming),
  );
  const longFlight = useRoomStore((store) =>
    store.flights.some((flight) => {
      if (flight.completedAt) {
        return false;
      }
      return Date.now() - flight.startedAt > LONG_FLIGHT_THRESHOLD_MS;
    }),
  );
  const heightened = anyStreaming || longFlight;

  return (
    <aside className={`${styles.column} ${heightened ? styles.heightened : ""}`} aria-hidden="true">
      <div className={styles.bar} />
    </aside>
  );
}
