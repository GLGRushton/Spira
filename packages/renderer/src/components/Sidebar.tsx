import { McpStatus } from "./McpStatus.js";
import styles from "./Sidebar.module.css";
import { VoiceIndicator } from "./VoiceIndicator.js";

export type SidebarView = "chat" | "settings";

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const items: Array<{ id: SidebarView; label: string; caption: string }> = [
  { id: "chat", label: "Chat", caption: "Shinra relay" },
  { id: "settings", label: "Settings", caption: "Voice + MCP" },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoBlock}>
        <div className={styles.logoMark}>S</div>
        <div>
          <div className={styles.logoText}>Spira</div>
          <div className={styles.logoCaption}>Shinra Operations</div>
        </div>
      </div>

      <nav className={styles.nav}>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.navItem} ${activeView === item.id ? styles.active : ""}`}
            onClick={() => onViewChange(item.id)}
          >
            <span className={styles.navLabel}>{item.label}</span>
            <span className={styles.navCaption}>{item.caption}</span>
          </button>
        ))}
      </nav>

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <VoiceIndicator />
        <McpStatus />
      </div>
    </aside>
  );
}
