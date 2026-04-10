import type { AssistantState } from "@spira/shared";
import { ChatPanel } from "../chat/ChatPanel.js";
import { ShinraOrb } from "../orb/ShinraOrb.js";
import { useStationStore } from "../../stores/station-store.js";
import { AuxDeck } from "./AuxDeck.js";
import styles from "./BridgeRoomDetail.module.css";
import { ToolSummaryChips } from "./ToolSummaryChips.js";

interface BridgeRoomDetailProps {
  assistantState: AssistantState;
}

export function BridgeRoomDetail({ assistantState }: BridgeRoomDetailProps) {
  const activeStation = useStationStore((store) => store.stations[store.activeStationId]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Bridge / Command</div>
          <h2 className={styles.title}>{activeStation?.label ? `${activeStation.label} bridge` : "Shinra bridge"}</h2>
        </div>
        <p className={styles.caption}>
          The bridge merges command chat with Shinra’s visual core. Focus is locked to{" "}
          {activeStation?.label ?? "the primary station"} while background stations keep running elsewhere in the roster.
        </p>
      </div>

      <div className={styles.layout}>
        <section className={styles.chatStage}>
          <ChatPanel />
        </section>

        <aside className={styles.visualColumn}>
          <section className={styles.shinraStage}>
            <div className={styles.sectionEyebrow}>Shinra interface</div>
            <div className={styles.orbWrap}>
              <ShinraOrb />
            </div>
            <div className={styles.statusCluster}>
              <div className={`${styles.statePill} ${styles[assistantState]}`}>{assistantState}</div>
              <ToolSummaryChips assistantState={assistantState} />
            </div>
          </section>

          <AuxDeck assistantState={assistantState} />
        </aside>
      </div>
    </div>
  );
}
