import type { AssistantState, StationId, WorkSessionPhase, WorkSessionSummary } from "@spira/shared";
import { useShinraStatusContext } from "../../hooks/useShinraStatusContext.js";
import { useStationStore } from "../../stores/station-store.js";
import { ChatPanel } from "../chat/ChatPanel.js";
import { ShinraOrb } from "../orb/ShinraOrb.js";
import { AuxDeck } from "./AuxDeck.js";
import styles from "./BridgeRoomDetail.module.css";
import { ToolSummaryChips } from "./ToolSummaryChips.js";

interface BridgeRoomDetailProps {
  assistantState: AssistantState;
  stationId?: StationId;
}

const formatWorkSessionPhase = (phase?: WorkSessionPhase | null): string =>
  phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : "Active";

const getVisibleWorkSession = (workSession?: WorkSessionSummary | null): WorkSessionSummary | null =>
  workSession?.mode === "work-session" && workSession.active ? workSession : null;

export function BridgeRoomDetail({ assistantState, stationId }: BridgeRoomDetailProps) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const resolvedStationId = stationId ?? activeStationId;
  const activeStation = useStationStore((store) => store.stations[resolvedStationId]);
  const { context } = useShinraStatusContext(resolvedStationId);
  const visibleWorkSession = getVisibleWorkSession(activeStation?.workSession);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Bridge / Command</div>
          <h2 className={styles.title}>{activeStation?.label ? `${activeStation.label} bridge` : "Shinra bridge"}</h2>
        </div>
        <p className={styles.caption}>
          The bridge merges command chat with Shinra’s visual core. Focus is locked to{" "}
          {activeStation?.label ?? "the primary station"} while background stations keep running elsewhere in the
          roster.
        </p>
      </div>

      <div className={styles.layout}>
        <section className={styles.chatStage}>
          <ChatPanel stationId={resolvedStationId} />
        </section>

        <aside className={styles.visualColumn}>
          <section
            className={`${styles.shinraStage} ${styles[context.phase]} ${context.isResponseState ? styles.live : ""}`}
          >
            <div className={styles.sectionHeader}>
              <div className={styles.sectionEyebrow}>Shinra interface</div>
              <div className={styles.phaseCluster}>
                <span
                  className={`${styles.liveDot} ${context.isResponseState ? styles.liveDotActive : ""}`}
                  aria-hidden="true"
                />
                <span className={styles.phaseBadge} aria-label={`Shinra phase ${context.phaseLabel}`}>
                  {context.phaseLabel}
                </span>
              </div>
            </div>
            <div className={styles.orbWrap}>
              <div className={styles.orbAura} aria-hidden="true" />
              <ShinraOrb />
            </div>
            <div className={styles.statusCluster}>
              <p className={styles.statusLine}>{context.workSummary ?? "Standing by"}</p>
              <ToolSummaryChips assistantState={assistantState} />
              {visibleWorkSession ? (
                <div className={styles.workSessionCard}>
                  <div className={styles.workSessionHeader}>
                    <span className={styles.workSessionEyebrow}>Work session</span>
                    <span className={styles.workSessionBadge}>{formatWorkSessionPhase(visibleWorkSession.phase)}</span>
                  </div>
                  <p className={styles.workSessionSummary}>
                    {visibleWorkSession.summary?.trim() || "Repository orchestration is active for this station."}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <AuxDeck assistantState={assistantState} />
        </aside>
      </div>
    </div>
  );
}
