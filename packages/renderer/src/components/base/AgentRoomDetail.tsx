import type { AgentRoom } from "../../stores/room-store.js";
import styles from "./AgentRoomDetail.module.css";

interface AgentRoomDetailProps {
  room: AgentRoom;
}

export function AgentRoomDetail({ room }: AgentRoomDetailProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Field team</div>
          <h2 className={styles.title}>{room.label}</h2>
        </div>
        <div className={`${styles.statePill} ${styles[room.status]}`}>{room.status}</div>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Room ID</span>
          <strong className={styles.metricValue}>{room.roomId}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Active operations</span>
          <strong className={styles.metricValue}>{room.activeToolCount}</strong>
        </article>
      </div>

      <div className={styles.log}>
        <div className={styles.logTitle}>Latest activity</div>
        <div className={styles.logBody}>
          <div>
            <span className={styles.label}>Caption</span>
            <span>{room.caption}</span>
          </div>
          {room.agentId ? (
            <div>
              <span className={styles.label}>Agent ID</span>
              <span>{room.agentId}</span>
            </div>
          ) : null}
          {room.lastToolName ? (
            <div>
              <span className={styles.label}>Last tool</span>
              <span>{room.lastToolName}</span>
            </div>
          ) : null}
          <div>
            <span className={styles.label}>Detail</span>
            <span>{room.detail ?? "Awaiting first full result."}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
