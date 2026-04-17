import { useEffect } from "react";
import { useMissionRunsStore } from "../stores/mission-runs-store.js";
import { useNavigationStore } from "../stores/navigation-store.js";

export function useMissionRunsSync() {
  const refresh = useMissionRunsStore((store) => store.refresh);
  const setSnapshot = useMissionRunsStore((store) => store.setSnapshot);
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
        setSnapshot(message.snapshot);
        pruneMissionRooms(message.snapshot.runs.map((run) => run.runId));
      }
    });
  }, [pruneMissionRooms, setSnapshot]);
}
