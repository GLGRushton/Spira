import type { AssistantState, TicketRunSummary } from "@spira/shared";
import { getStation, useStationStore } from "../../../stores/station-store.js";
import { BridgeRoomDetail } from "../../base/BridgeRoomDetail.js";
import shellStyles from "../MissionShell.module.css";

interface MissionBridgeRoomProps {
  run: TicketRunSummary;
}

const DEFAULT_ASSISTANT_STATE: AssistantState = "idle";

export function MissionBridgeRoom({ run }: MissionBridgeRoomProps) {
  const assistantState = useStationStore((store) =>
    run.stationId ? getStation(store, run.stationId).state : DEFAULT_ASSISTANT_STATE,
  );

  if (!run.stationId) {
    return (
      <section className={shellStyles.emptyState}>
        <div className={shellStyles.sectionCard}>
          <h3 className={shellStyles.sectionTitle}>Mission bridge unavailable</h3>
          <p className={shellStyles.sectionCopy}>
            This mission does not currently have a bound command station. The shell is live, but the station transcript
            is not available yet.
          </p>
        </div>
      </section>
    );
  }

  return <BridgeRoomDetail assistantState={assistantState} stationId={run.stationId} />;
}
