import type { MissionUiRoom, TicketRunSummary } from "@spira/shared";
import { useStationStore } from "../../stores/station-store.js";
import { GlassPanel } from "../GlassPanel.js";
import styles from "./MissionShell.module.css";
import { describeRunStatus } from "./mission-display-utils.js";
import { MissionActionsRoom } from "./rooms/MissionActionsRoom.js";
import { MissionBridgeRoom } from "./rooms/MissionBridgeRoom.js";
import { MissionChangesRoom } from "./rooms/MissionChangesRoom.js";
import { MissionDetailsRoom } from "./rooms/MissionDetailsRoom.js";
import { MissionProcessesRoom } from "./rooms/MissionProcessesRoom.js";
import { useMissionRunController } from "./useMissionRunController.js";

interface MissionShellProps {
  run: TicketRunSummary;
  activeRoom: MissionUiRoom;
}

export function MissionShell({ run, activeRoom }: MissionShellProps) {
  const controller = useMissionRunController(run);
  const stationLabel = useStationStore((store) =>
    run.stationId ? (store.stations[run.stationId]?.label ?? run.stationId) : null,
  );

  return (
    <div className={styles.shell}>
      <section className={styles.statusBar}>
        <div className={styles.statusCopy}>
          <div className={styles.eyebrow}>{stationLabel ? stationLabel : "Mission command"}</div>
          <div className={styles.titleRow}>
            <span className={styles.ticketId}>{run.ticketId}</span>
            <span className={styles.title}>{run.ticketSummary}</span>
          </div>
          <div className={styles.meta}>
            <span className={styles.metaChip}>{run.projectKey}</span>
            <span className={styles.metaChip}>
              {run.worktrees.length} repo{run.worktrees.length === 1 ? "" : "s"}
            </span>
            <span className={styles.metaChip}>{stationLabel ?? "No station bound"}</span>
          </div>
        </div>
        <span className={styles.statusBadge}>{describeRunStatus(run)}</span>
      </section>

      <GlassPanel padding="md" variant="quiet" className={styles.contentPanel}>
        <div className={styles.roomViewport}>
          {activeRoom === "bridge" ? (
            <MissionBridgeRoom run={run} />
          ) : activeRoom === "details" ? (
            <MissionDetailsRoom run={run} controller={controller} />
          ) : activeRoom === "changes" ? (
            <MissionChangesRoom run={run} controller={controller} />
          ) : activeRoom === "actions" ? (
            <MissionActionsRoom run={run} controller={controller} />
          ) : (
            <MissionProcessesRoom run={run} controller={controller} />
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
