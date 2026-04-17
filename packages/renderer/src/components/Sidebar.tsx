import type { SpiraUiView } from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import { useStationStore } from "../stores/station-store.js";
import styles from "./Sidebar.module.css";
import { VoiceIndicator } from "./VoiceIndicator.js";

export type SidebarView = SpiraUiView;

interface SidebarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
}

const items: Array<{ id: SidebarView; label: string; caption: string }> = [
  { id: "ship", label: "Ship", caption: "Deck overview" },
  { id: "operations", label: "Operations", caption: "Command stations" },
  { id: "bridge", label: "Bridge", caption: "Mission control + Shinra" },
  { id: "barracks", label: "Barracks", caption: "Delegation roster" },
  { id: "mcp", label: "Armoury", caption: "Machina tools" },
  { id: "agents", label: "Field Office", caption: "Live delegation rooms" },
  { id: "projects", label: "Missions", caption: "Ticket intake and scope" },
  { id: "settings", label: "Settings", caption: "Voice, keys, and tuning" },
];

const alwaysVisibleItems = items.filter((item) => item.id === "ship" || item.id === "bridge");
const collapsibleItems = items.filter((item) => item.id !== "ship" && item.id !== "bridge");
const isCollapsibleView = (view: SidebarView): boolean =>
  view === "operations" ||
  view === "barracks" ||
  view === "projects" ||
  view === "settings" ||
  view === "mcp" ||
  view === "agents" ||
  view.startsWith("mcp:") ||
  view.startsWith("agent:");

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const stationMap = useStationStore((store) => store.stations);
  const activeStationId = useStationStore((store) => store.activeStationId);
  const setActiveStation = useStationStore((store) => store.setActiveStation);
  const [roomsExpanded, setRoomsExpanded] = useState(() => isCollapsibleView(activeView));
  const stations = useMemo(() => Object.values(stationMap), [stationMap]);
  const busyStations = useMemo(
    () => stations.filter((station) => station.state !== "idle" || station.isStreaming),
    [stations],
  );

  useEffect(() => {
    if (isCollapsibleView(activeView)) {
      setRoomsExpanded(true);
    }
  }, [activeView]);

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
    if (itemId === "barracks") {
      return activeView === "barracks";
    }
    return activeView === itemId;
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoBlock}>
        <div className={styles.logoMark} aria-hidden="true">
          <span className={styles.logoCore}>S</span>
          <span className={`${styles.logoMote} ${styles.logoMoteA}`} />
          <span className={`${styles.logoMote} ${styles.logoMoteB}`} />
          <span className={`${styles.logoMote} ${styles.logoMoteC}`} />
        </div>
        <div>
          <div className={styles.logoText}>Spira</div>
          <div className={styles.logoCaption}>Shinra command</div>
        </div>
      </div>

      <nav className={styles.nav}>
        {alwaysVisibleItems.map((item) => (
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

        <div className={styles.collapsibleNavSection}>
          <button
            type="button"
            className={`${styles.collapseToggle} ${roomsExpanded ? styles.collapseToggleExpanded : ""}`}
            onClick={() => setRoomsExpanded((expanded) => !expanded)}
            aria-expanded={roomsExpanded}
            aria-controls="sidebar-room-list"
          >
            <span className={styles.collapseToggleLabel}>Stations &amp; systems</span>
            <span className={styles.collapseToggleIcon} aria-hidden="true">
              {roomsExpanded ? "▾" : "▸"}
            </span>
          </button>

          {roomsExpanded ? (
            <div id="sidebar-room-list" className={styles.collapsibleNavItems}>
              {collapsibleItems.map((item) => (
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
            </div>
          ) : null}
        </div>
      </nav>

      <section className={styles.stationPanel}>
        <div className={styles.stationHeader}>
          <div>
            <div className={styles.stationEyebrow}>Command stations</div>
            <div className={styles.stationTitle}>
              {busyStations.length > 0 ? `${busyStations.length} active` : "Quiet watch"}
            </div>
          </div>
          <button
            type="button"
            className={styles.stationCreate}
            onClick={() => {
              onViewChange("operations");
              window.electronAPI.send({ type: "station:create" });
            }}
          >
            + New station
          </button>
        </div>
        <div className={styles.stationList}>
          {stations.map((station) => {
            const isFocused = station.stationId === activeStationId;
            return (
              <button
                key={station.stationId}
                type="button"
                className={`${styles.stationItem} ${isFocused ? styles.stationActive : ""}`}
                onClick={() => {
                  setActiveStation(station.stationId);
                  onViewChange("bridge");
                }}
              >
                <span className={`${styles.stationPulse} ${styles[station.state]}`} />
                <span className={styles.stationCopy}>
                  <span className={styles.stationLabel}>{station.label}</span>
                  <span className={styles.stationCaption}>
                    {station.title?.trim() ||
                      (station.stationId === activeStationId ? "Bridge focus" : "Awaiting orders")}
                  </span>
                </span>
                {station.hasUnread ? <span className={styles.stationUnread}>•</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <div className={styles.spacer} />

      <div className={styles.footer}>
        <VoiceIndicator />
      </div>
    </aside>
  );
}
