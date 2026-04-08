import type { AssistantState } from "@spira/shared";
import { ChatPanel } from "../chat/ChatPanel.js";
import { ShinraOrb } from "../orb/ShinraOrb.js";
import styles from "./BridgeRoomDetail.module.css";

interface BridgeRoomDetailProps {
  assistantState: AssistantState;
}

export function BridgeRoomDetail({ assistantState }: BridgeRoomDetailProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Bridge / Command</div>
          <h2 className={styles.title}>Shinra bridge</h2>
        </div>
        <p className={styles.caption}>
          The bridge merges command chat with Shinra’s visual core. This is the main room for directing the ship and
          watching missions branch into the rest of the base.
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
            <div className={`${styles.statePill} ${styles[assistantState]}`}>{assistantState}</div>
          </section>

          <section className={styles.placeholderStage}>
            <div className={styles.sectionEyebrow}>Aux deck</div>
            <h3 className={styles.placeholderTitle}>Systems expansion slot</h3>
            <p className={styles.placeholderCopy}>
              Reserved for future tactical overlays, room-wide diagnostics, or bridge automation controls.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
