import type { MissionUiRoom, TicketRunSummary } from "@spira/shared";
import styles from "./MissionNav.module.css";

interface MissionNavProps {
  run: TicketRunSummary;
  activeRoom: MissionUiRoom;
  onSelectRoom: (room: MissionUiRoom) => void;
  onBackToShip: () => void;
}

const items: Array<{ id: MissionUiRoom; label: string; caption: string }> = [
  { id: "bridge", label: "Bridge", caption: "Mission station" },
  { id: "details", label: "Details", caption: "Mission overview" },
  { id: "changes", label: "Changes", caption: "Diff and files" },
  { id: "actions", label: "Actions", caption: "Git workflow" },
  { id: "processes", label: "Processes", caption: "Launch profiles" },
];

export function MissionNav({ run, activeRoom, onSelectRoom, onBackToShip }: MissionNavProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoBlock}>
        <div>
          <div className={styles.logoText}>Mission</div>
          <div className={styles.logoCaption}>{run.ticketId}</div>
        </div>
      </div>

      <nav className={styles.nav}>
        <button type="button" className={styles.backButton} onClick={onBackToShip}>
          <span className={styles.backLabel}>Back to ship</span>
          <span className={styles.backCaption}>Primary bridge</span>
        </button>

        <div className={styles.navSection}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem} ${activeRoom === item.id ? styles.active : ""}`}
              onClick={() => onSelectRoom(item.id)}
            >
              <span className={styles.navLabel}>{item.label}</span>
              <span className={styles.navCaption}>{item.caption}</span>
            </button>
          ))}
        </div>
      </nav>
    </aside>
  );
}
