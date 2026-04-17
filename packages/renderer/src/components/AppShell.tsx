import {
  type MissionUiRoom,
  type SpiraUiView,
  type TicketRunSummary,
  getMissionRunIdFromView,
  isMissionView,
} from "@spira/shared";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useIpc } from "../hooks/useIpc.js";
import { useMissionRunsSync } from "../hooks/useMissionRunsSync.js";
import { useMcpStore } from "../stores/mcp-store.js";
import { getMissionRunById, getMissionRunByStationId, useMissionRunsStore } from "../stores/mission-runs-store.js";
import { useNavigationStore } from "../stores/navigation-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { PRIMARY_STATION_ID, getStation, useStationStore } from "../stores/station-store.js";
import { useSubagentStore } from "../stores/subagent-store.js";
import styles from "./AppShell.module.css";
import { AssistantStatusStrip } from "./AssistantStatusStrip.js";
import { GlassPanel } from "./GlassPanel.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { ReconnectingOverlay } from "./ReconnectingOverlay.js";
import { ScreenCaptureIndicator } from "./ScreenCaptureIndicator.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { Sidebar } from "./Sidebar.js";
import { SpeechController } from "./SpeechController.js";
import { TitleBar } from "./TitleBar.js";
import { UpgradeBanner } from "./UpgradeBanner.js";
import { AgentClusterDetail } from "./base/AgentClusterDetail.js";
import { AgentRoomDetail } from "./base/AgentRoomDetail.js";
import { BarracksDetail } from "./base/BarracksDetail.js";
import { BaseDeck } from "./base/BaseDeck.js";
import { BridgeRoomDetail } from "./base/BridgeRoomDetail.js";
import { McpClusterDetail } from "./base/McpClusterDetail.js";
import { McpRoomDetail } from "./base/McpRoomDetail.js";
import { MissionNav } from "./missions/MissionNav.js";
import { MissionShell } from "./missions/MissionShell.js";
import { OperationsRoster } from "./operations/OperationsRoster.js";
import { ProjectsPanel } from "./projects/ProjectsPanel.js";

interface MissionStageProps {
  run: TicketRunSummary;
  activeRoom: MissionUiRoom;
  onSelectRoom: (room: MissionUiRoom) => void;
  onBackToShip: () => void;
}

function MissionStage({ run, activeRoom, onSelectRoom, onBackToShip }: MissionStageProps) {
  return (
    <>
      <div className={styles.sidebarSlot}>
        <MissionNav run={run} activeRoom={activeRoom} onSelectRoom={onSelectRoom} onBackToShip={onBackToShip} />
      </div>
      <main className={styles.main}>
        <MissionShell run={run} activeRoom={activeRoom} />
      </main>
    </>
  );
}

interface ShipStageProps {
  view: SpiraUiView;
  onViewChange: (view: SpiraUiView) => void;
}

function ShipStage({ view, onViewChange }: ShipStageProps) {
  const { activeStationId, assistantState, stationMap } = useStationStore(
    useShallow((store) => ({
      activeStationId: store.activeStationId,
      assistantState: getStation(store, store.activeStationId).state,
      stationMap: store.stations,
    })),
  );
  const servers = useMcpStore((store) => store.servers);
  const subagents = useSubagentStore((store) => store.agents);
  const { agentRooms: allAgentRooms, flights: allFlights } = useRoomStore(
    useShallow((store) => ({
      agentRooms: store.agentRooms,
      flights: store.flights,
    })),
  );
  const setView = useNavigationStore((store) => store.setView);

  const stations = useMemo(() => Object.values(stationMap), [stationMap]);
  const agentRooms = useMemo(
    () => allAgentRooms.filter((room) => room.stationId === activeStationId),
    [activeStationId, allAgentRooms],
  );
  const flights = useMemo(
    () => allFlights.filter((flight) => flight.stationId === activeStationId),
    [activeStationId, allFlights],
  );
  const selectedServer = view.startsWith("mcp:") ? servers.find((server) => server.id === view.slice(4)) : null;
  const selectedAgentRoom = view.startsWith("agent:") ? agentRooms.find((room) => room.roomId === view) : null;
  const isShipOverview = view === "ship";

  useEffect(() => {
    if (view.startsWith("mcp:") && !selectedServer) {
      setView("ship");
    }
    if (view.startsWith("agent:") && !selectedAgentRoom) {
      setView("ship");
    }
  }, [selectedAgentRoom, selectedServer, setView, view]);

  return (
    <>
      <div className={styles.sidebarSlot}>
        <Sidebar activeView={view} onViewChange={onViewChange} />
      </div>
      <main className={styles.main}>
        <AssistantStatusStrip activeView={view} onOpenBridge={() => onViewChange("bridge")} />
        <div className={styles.stageStack}>
          <AnimatePresence mode="wait" initial={false}>
            {isShipOverview ? (
              <motion.div
                key="ship"
                className={`${styles.stage} ${styles.shipStage}`}
                initial={{ opacity: 0, scale: 0.985 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.015, filter: "blur(3px)" }}
                transition={{ duration: 0.26, ease: "easeOut" }}
              >
                <BaseDeck
                  activeView={view}
                  activeStationId={activeStationId}
                  assistantState={assistantState}
                  stations={stations}
                  servers={servers}
                  subagents={subagents}
                  agentRooms={agentRooms}
                  flights={flights}
                  onViewChange={onViewChange}
                />
              </motion.div>
            ) : (
              <motion.div
                key={view}
                className={styles.stage}
                initial={{ opacity: 0, y: 18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -18, scale: 1.02, filter: "blur(3px)" }}
                transition={{ duration: 0.26, ease: "easeOut" }}
              >
                <GlassPanel padding="md" className={styles.contentPanel}>
                  <div className={styles.roomChrome}>
                    <button type="button" className={styles.backButton} onClick={() => setView("ship")}>
                      &lt; Return to deck
                    </button>
                  </div>

                  <div className={styles.contentInner}>
                    {view === "bridge" ? (
                      <BridgeRoomDetail assistantState={assistantState} />
                    ) : view === "operations" ? (
                      <OperationsRoster onOpenBridge={() => onViewChange("bridge")} />
                    ) : view === "barracks" ? (
                      <BarracksDetail servers={servers} agents={subagents} agentRooms={agentRooms} />
                    ) : view === "mcp" ? (
                      <McpClusterDetail servers={servers} onSelectServer={(serverId) => setView(`mcp:${serverId}`)} />
                    ) : view === "agents" ? (
                      <AgentClusterDetail rooms={agentRooms} onSelectRoom={(roomId) => setView(roomId)} />
                    ) : view === "projects" ? (
                      <ProjectsPanel />
                    ) : view === "settings" ? (
                      <SettingsPanel />
                    ) : selectedServer ? (
                      <McpRoomDetail server={selectedServer} />
                    ) : selectedAgentRoom ? (
                      <AgentRoomDetail room={selectedAgentRoom} />
                    ) : (
                      <BridgeRoomDetail assistantState={assistantState} />
                    )}
                  </div>
                </GlassPanel>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </>
  );
}

export function AppShell() {
  useIpc();
  useMissionRunsSync();

  const setActiveStation = useStationStore((store) => store.setActiveStation);
  const { view, openMission, openPrimaryBridge, setMissionRoom, setView } = useNavigationStore(
    useShallow((store) => ({
      view: store.activeView,
      openMission: store.openMission,
      openPrimaryBridge: store.openPrimaryBridge,
      setMissionRoom: store.setMissionRoom,
      setView: store.setView,
    })),
  );
  const missionRunId = getMissionRunIdFromView(view);
  const missionViewActive = isMissionView(view);
  const selectedMissionRun = useMissionRunsStore((store) =>
    missionRunId ? getMissionRunById(store.snapshot, missionRunId) : null,
  );
  const activeMissionRoom = useNavigationStore((store) =>
    missionRunId ? (store.missionRooms[missionRunId] ?? "details") : null,
  );

  const handleViewChange = useCallback(
    (nextView: SpiraUiView) => {
      if (nextView === "bridge") {
        const currentStationId = useStationStore.getState().activeStationId;
        const currentSnapshot = useMissionRunsStore.getState().snapshot;
        const missionRun = getMissionRunByStationId(currentSnapshot, currentStationId);
        if (missionRun) {
          openMission(missionRun.runId, "bridge");
          return;
        }
      }

      setView(nextView);
    },
    [openMission, setView],
  );

  useLayoutEffect(() => {
    if (missionViewActive && missionRunId && !selectedMissionRun) {
      setView("projects");
    }
  }, [missionRunId, missionViewActive, selectedMissionRun, setView]);

  return (
    <div className={`${styles.app} ${missionViewActive ? styles.missionApp : ""}`}>
      <div className={styles.titleBarSlot}>
        <TitleBar />
      </div>
      {missionViewActive && selectedMissionRun && activeMissionRoom ? (
        <MissionStage
          run={selectedMissionRun}
          activeRoom={activeMissionRoom}
          onSelectRoom={(room) => setMissionRoom(selectedMissionRun.runId, room)}
          onBackToShip={() => {
            setMissionRoom(selectedMissionRun.runId, "bridge");
            setActiveStation(PRIMARY_STATION_ID);
            openPrimaryBridge();
          }}
        />
      ) : missionViewActive ? null : (
        <ShipStage view={view} onViewChange={handleViewChange} />
      )}
      <ScreenCaptureIndicator />
      <PermissionPrompt />
      <UpgradeBanner />
      <ReconnectingOverlay />
      <SpeechController />
    </div>
  );
}
