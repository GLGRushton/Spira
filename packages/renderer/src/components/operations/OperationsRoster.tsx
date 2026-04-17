import { useMemo } from "react";
import { getChatSession, getLatestCompletedAssistantMessage, useChatStore } from "../../stores/chat-store.js";
import { getMissionRunByStationId, useMissionRunsStore } from "../../stores/mission-runs-store.js";
import { useNavigationStore } from "../../stores/navigation-store.js";
import { useStationStore } from "../../stores/station-store.js";
import styles from "./OperationsRoster.module.css";

interface OperationsRosterProps {
  onOpenBridge: () => void;
}

const formatTimestamp = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);

export function OperationsRoster({ onOpenBridge }: OperationsRosterProps) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const openMission = useNavigationStore((store) => store.openMission);
  const missionRunSnapshot = useMissionRunsStore((store) => store.snapshot);
  const stationMap = useStationStore((store) => store.stations);
  const setActiveStation = useStationStore((store) => store.setActiveStation);
  const sessions = useChatStore((store) => store.sessions);
  const stations = useMemo(() => Object.values(stationMap), [stationMap]);

  const stationCards = useMemo(
    () =>
      stations.map((station) => {
        const session = getChatSession({ sessions }, station.stationId);
        const latestAssistantMessage = getLatestCompletedAssistantMessage(session.messages);
        const latestUserMessage = [...session.messages].reverse().find((message) => message.role === "user");
        return {
          ...station,
          session,
          preview:
            latestAssistantMessage?.content.trim() ||
            latestUserMessage?.content.trim() ||
            station.title ||
            "Standing by for orders.",
        };
      }),
    [sessions, stations],
  );

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Operations / Command stations</div>
          <h2 className={styles.title}>Operations roster</h2>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.summary}>
            <strong>{stationCards.length}</strong>
            <span>stations online</span>
          </div>
          <button
            type="button"
            className={styles.createButton}
            onClick={() => window.electronAPI.send({ type: "station:create" })}
          >
            Create station
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {stationCards.map((station) => {
          const isFocused = station.stationId === activeStationId;
          const taskLabel = station.title?.trim() || station.session.activeConversationTitle || "Fresh briefing";
          const missionRun = getMissionRunByStationId(missionRunSnapshot, station.stationId);
          return (
            <article key={station.stationId} className={`${styles.card} ${isFocused ? styles.focused : ""}`}>
              <div className={styles.cardTop}>
                <div className={styles.cardIdentity}>
                  <div className={styles.cardEyebrow}>Command station</div>
                  <h3 className={styles.cardTitle}>{station.label}</h3>
                </div>
                <div className={styles.stateBlock}>
                  <span className={`${styles.stateDot} ${styles[station.state]}`} />
                  <span className={styles.stateLabel}>{station.state}</span>
                </div>
              </div>

              <div className={styles.metrics}>
                <div className={styles.metric}>
                  <span>Task</span>
                  <strong title={taskLabel}>{taskLabel}</strong>
                </div>
                <div className={styles.metric}>
                  <span>Last activity</span>
                  <strong>{formatTimestamp(station.updatedAt)}</strong>
                </div>
              </div>

              <p className={styles.preview} title={station.preview}>
                {station.preview}
              </p>

              <div className={styles.footer}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => {
                    setActiveStation(station.stationId);
                    if (missionRun) {
                      openMission(missionRun.runId);
                    }
                  }}
                >
                  {missionRun ? "Open mission" : "Focus"}
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    setActiveStation(station.stationId);
                    if (missionRun) {
                      openMission(missionRun.runId, "bridge");
                      return;
                    }
                    onOpenBridge();
                  }}
                >
                  {missionRun ? "Mission bridge" : "Open bridge"}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={station.stationId === "primary"}
                  onClick={() => window.electronAPI.send({ type: "station:close", stationId: station.stationId })}
                >
                  Close
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
