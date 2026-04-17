import type { StationId } from "@spira/shared";
import { useMemo } from "react";
import { getShinraStatusContext } from "../shinra-status.js";
import { getChatSession, useChatStore } from "../stores/chat-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { usePermissionStore } from "../stores/permission-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { getStation, useStationStore } from "../stores/station-store.js";
import { useUpgradeStore } from "../stores/upgrade-store.js";
import { useVisionStore } from "../stores/vision-store.js";

export function useShinraStatusContext(stationId?: StationId) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const resolvedStationId = stationId ?? activeStationId;
  const assistantState = useStationStore((store) => getStation(store, resolvedStationId).state);
  const { isStreaming, messages, isAborting, isResetting } = useChatStore((store) =>
    getChatSession(store, resolvedStationId),
  );
  const connectionStatus = useConnectionStore((store) => store.status);
  const allPermissionRequests = usePermissionStore((store) => store.requests);
  const allActiveCaptures = useVisionStore((store) => store.activeCaptures);
  const allAgentRooms = useRoomStore((store) => store.agentRooms);
  const visibleBanner = useUpgradeStore((store) => store.banner ?? store.protocolBanner);

  const permissionRequests = useMemo(
    () => allPermissionRequests.filter((request) => (request.stationId ?? resolvedStationId) === resolvedStationId),
    [allPermissionRequests, resolvedStationId],
  );
  const activeCaptures = useMemo(
    () => allActiveCaptures.filter((capture) => capture.stationId === resolvedStationId),
    [allActiveCaptures, resolvedStationId],
  );
  const agentRooms = useMemo(
    () => allAgentRooms.filter((room) => room.stationId === resolvedStationId),
    [allAgentRooms, resolvedStationId],
  );

  const context = useMemo(
    () =>
      getShinraStatusContext({
        assistantState,
        isStreaming,
        messages,
        connectionStatus,
        permissionRequests,
        activeCaptures,
        agentRooms,
        upgradeBanner: visibleBanner,
        isAborting,
        isResetting,
      }),
    [
      activeCaptures,
      agentRooms,
      assistantState,
      connectionStatus,
      isAborting,
      isResetting,
      isStreaming,
      messages,
      permissionRequests,
      visibleBanner,
    ],
  );

  return { assistantState, context };
}
