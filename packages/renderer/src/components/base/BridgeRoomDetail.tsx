import type { AssistantState, StationId, WorkSessionPhase, WorkSessionSummary } from "@spira/shared";
import { useShinraStatusContext } from "../../hooks/useShinraStatusContext.js";
import { useStationStore } from "../../stores/station-store.js";
import { ChatPanel } from "../chat/ChatPanel.js";
import { PyrefleBurst } from "../atmosphere/PyrefleBurst.js";
import { BevelleArch, BevelleTripleArch, CloisterPedestal, HymnInscription, YevonSpiral } from "../decor/Glyphs.js";
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
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <div className={styles.eyebrow}>Bridge · Fayth Chamber</div>
          <h2 className={styles.title}>{activeStation?.label ?? "Shinra"}</h2>
        </div>
        <p className={styles.caption}>
          The Cloister focus is locked to {activeStation?.label ?? "the primary bridge"}; other stations keep their
          watch in the roster behind us.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.chatStage}>
          <ChatPanel stationId={resolvedStationId} />
        </section>

        <aside className={styles.faythColumn}>
          <section
            className={`${styles.fayth} ${styles[context.phase]} ${context.isResponseState ? styles.live : ""}`}
          >
            <BevelleTripleArch className={styles.archBackdrop} width={300} />
            <HymnInscription className={styles.hymnWatermark} variant="watermark" />

            <div className={styles.faythInner}>
              <div className={styles.faythHeader}>
                <span className={styles.statusEyebrow}>
                  <YevonSpiral size={11} color="var(--gold-warm)" /> Fayth
                </span>
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

              <div className={styles.orbStage}>
                <PyrefleBurst
                  count={10}
                  duration={1.2}
                  spread={180}
                  triggerKey={resolvedStationId}
                />
                <div className={styles.orbAura} aria-hidden="true" />
                <ShinraOrb size="chamber" />
                <CloisterPedestal
                  width={260}
                  height={48}
                  className={styles.pedestal}
                  glyph={<YevonSpiral size={20} color="var(--gold-bright)" strokeWidth={1.4} />}
                />
              </div>

              <div className={styles.statusCluster}>
                <BevelleArch width={180} className={styles.summaryArch} />
                <p className={styles.statusLine}>{context.workSummary ?? "Standing by"}</p>
                <ToolSummaryChips assistantState={assistantState} />
                {visibleWorkSession ? (
                  <div className={styles.workSessionCard}>
                    <div className={styles.workSessionHeader}>
                      <span className={styles.workSessionEyebrow}>Work session</span>
                      <span className={styles.workSessionBadge}>
                        {formatWorkSessionPhase(visibleWorkSession.phase)}
                      </span>
                    </div>
                    <p className={styles.workSessionSummary}>
                      {visibleWorkSession.summary?.trim() || "Repository orchestration is active for this station."}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <AuxDeck assistantState={assistantState} />
        </aside>
      </div>
    </div>
  );
}
