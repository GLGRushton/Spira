import { useEffect } from "react";
import { useMissionRunsStore } from "../stores/mission-runs-store.js";
import { useNavigationStore } from "../stores/navigation-store.js";

export function useMissionRunsSync() {
  const refresh = useMissionRunsStore((store) => store.refresh);
  const setSnapshot = useMissionRunsStore((store) => store.setSnapshot);
  const setRun = useMissionRunsStore((store) => store.setRun);
  const pushLiveEvent = useMissionRunsStore((store) => store.pushLiveEvent);
  const pruneMissionRooms = useNavigationStore((store) => store.pruneMissionRooms);

  useEffect(() => {
    const sync = async () => {
      await refresh();
      pruneMissionRooms(useMissionRunsStore.getState().snapshot.runs.map((run) => run.runId));
    };

    void sync();
  }, [pruneMissionRooms, refresh]);

  useEffect(() => {
    return window.electronAPI.onMessage((message) => {
      if (message.type === "missions:runs:updated") {
        // Cold path — full snapshot. Replays mission shape entirely.
        setSnapshot(message.snapshot);
        pruneMissionRooms(message.snapshot.runs.map((run) => run.runId));
        return;
      }
      if (message.type === "missions:run:updated") {
        // Phase 0.3 delta path — single-run patch. No prune; deletions still come via the cold path.
        setRun(message.run);
        return;
      }
      if (message.type === "missions:run-event:recorded") {
        // Phase 1.1 live event push — buffer for "now playing" + phase-grouped timeline.
        pushLiveEvent(message.event);
      }
    });
  }, [pruneMissionRooms, pushLiveEvent, setRun, setSnapshot]);
}
