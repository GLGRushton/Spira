import type { TicketRunSummary } from "@spira/shared";
import { usePermissionStore } from "../../../stores/permission-store.js";
import { useStationStore } from "../../../stores/station-store.js";
import styles from "./MissionDetailsRoom.module.css";

interface MissionPermissionBannerProps {
  run: TicketRunSummary;
}

/**
 * High-visibility banner on the mission detail view that surfaces an in-flight
 * permission request. The PermissionPrompt overlay only renders for the active
 * station; if the operator is on the mission detail view of a different station
 * that's now blocked on approval, they'd otherwise miss the prompt entirely.
 *
 * Renders nothing when no request is open for this run's station. Clicking jumps
 * to the station so the existing PermissionPrompt overlay can take over.
 */
export function MissionPermissionBanner({ run }: MissionPermissionBannerProps) {
  // Selector returns the matching request itself (or undefined). Zustand's default
  // Object.is comparator means unrelated permission events on other stations don't
  // trigger a re-render here.
  const matchingRequest = usePermissionStore((store) =>
    store.requests.find((request) => request.stationId === run.stationId),
  );
  const setActiveStation = useStationStore((store) => store.setActiveStation);

  if (!matchingRequest || !run.stationId) return null;
  const stationId = run.stationId;

  return (
    <div className={styles.permissionBanner} role="alert">
      <div className={styles.permissionBannerCopy}>
        <strong>Pass paused · awaiting approval</strong>
        <span>
          {matchingRequest.serverName} requested {matchingRequest.toolName ?? "a tool"} from this mission.
        </span>
      </div>
      <button
        type="button"
        className={styles.permissionBannerAction}
        onClick={() => setActiveStation(stationId)}
      >
        Open approval prompt
      </button>
    </div>
  );
}
