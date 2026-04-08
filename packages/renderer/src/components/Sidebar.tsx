import { McpStatus } from "./McpStatus.js";
import styles from "./Sidebar.module.css";
import { VoiceIndicator } from "./VoiceIndicator.js";

export type SidebarView = "ship" | "bridge" | "mcp" | "agents" | "settings" | `mcp:${string}` | `agent:${string}`;

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const items: Array<{ id: SidebarView; label: string; caption: string }> = [
  { id: "ship", label: "Ship", caption: "Base overview" },
  { id: "bridge", label: "Bridge", caption: "Command + Shinra" },
  { id: "mcp", label: "MCP Servers", caption: "Grouped local tools" },
  { id: "agents", label: "Sub Agents", caption: "Field teams" },
  { id: "settings", label: "Operations", caption: "Voice + MCP" },
];

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const isActive = (itemId: SidebarView): boolean => {
    if (itemId === "mcp") {
      return activeView === "mcp" || activeView.startsWith("mcp:");
    }
    if (itemId === "agents") {
      return activeView === "agents" || activeView.startsWith("agent:");
    }
    if (itemId === "ship") {
      return activeView === "ship";
    }
    return activeView === itemId;
  };

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
            className={`${styles.navItem} ${isActive(item.id) ? styles.active : ""}`}
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
