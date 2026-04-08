import type { AgentRoom } from "../../stores/room-store.js";
import styles from "./AgentClusterDetail.module.css";

interface AgentClusterDetailProps {
  rooms: AgentRoom[];
  onSelectRoom: (roomId: `agent:${string}`) => void;
}

export function AgentClusterDetail({ rooms, onSelectRoom }: AgentClusterDetailProps) {
  const activeRooms = rooms.filter((room) => room.activeToolCount > 0).length;
  const totalOperations = rooms.reduce((sum, room) => sum + room.activeToolCount, 0);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Subagent cluster</div>
          <h2 className={styles.title}>Field teams</h2>
        </div>
        <p className={styles.caption}>
          Dynamic mission rooms appear here as Shinra spins up subagents. Open a team to inspect its latest activity and
          current operational load.
        </p>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Deployed teams</span>
          <strong className={styles.metricValue}>{rooms.length}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Active operations</span>
          <strong className={styles.metricValue}>
            {totalOperations} across {activeRooms} teams
          </strong>
        </article>
      </div>

      <div className={styles.roster}>
        {rooms.length === 0 ? (
          <div className={styles.emptyState}>No field teams are deployed yet. Start a task tool run to spawn one.</div>
        ) : (
          rooms.map((room) => (
            <button
              key={room.roomId}
              type="button"
              className={styles.roomCard}
              onClick={() => onSelectRoom(room.roomId)}
            >
              <div className={styles.roomTopline}>
                <span className={`${styles.statePill} ${styles[room.status]}`}>{room.status}</span>
                <span className={styles.roomMeta}>
                  {room.activeToolCount > 0 ? `${room.activeToolCount} live` : "idle"}
                </span>
              </div>
              <div className={styles.roomName}>{room.label}</div>
              <div className={styles.roomDetail}>{room.detail ?? room.caption}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
