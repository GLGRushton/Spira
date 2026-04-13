import type { AssistantState, McpServerStatus, SpiraUiView, SubagentDomain } from "@spira/shared";
import { useCallback, useEffect, useRef } from "react";
import type { AgentRoom } from "../../stores/room-store.js";
import type { ToolFlight } from "../../stores/room-store.js";
import type { StationViewState } from "../../stores/station-store.js";
import styles from "./BaseDeck.module.css";
import { FlightLayer } from "./FlightLayer.js";
import { RoomCard } from "./RoomCard.js";

interface BaseDeckProps {
  activeView: SpiraUiView;
  activeStationId: string;
  assistantState: AssistantState;
  stations: StationViewState[];
  servers: McpServerStatus[];
  subagents: SubagentDomain[];
  agentRooms: AgentRoom[];
  flights: ToolFlight[];
  onViewChange: (view: SpiraUiView) => void;
}

const stateLabel = (state: AssistantState): string => state.charAt(0).toUpperCase() + state.slice(1);

export function BaseDeck({
  activeView,
  activeStationId,
  assistantState,
  stations,
  servers,
  subagents,
  agentRooms,
  flights,
  onViewChange,
}: BaseDeckProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const roomNodesRef = useRef(new Map<string, HTMLButtonElement | null>());
  const mcpHubNodeRef = useRef<HTMLButtonElement | null>(null);
  const agentHubNodeRef = useRef<HTMLButtonElement | null>(null);
  const activeBridgeFlights = flights.filter(
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId === "bridge",
  ).length;
  const activeMcpFlights = flights.filter(
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId.startsWith("mcp:"),
  ).length;
  const activeAgentFlights = flights.filter(
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId.startsWith("agent:"),
  ).length;
  const activeOperationsFlights = flights.filter(
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId === "operations",
  ).length;
  const activeSettingsFlights = flights.filter(
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId === "settings",
  ).length;
  const activeMissionsFlights = flights.filter(
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId === "projects",
  ).length;
  const activeBarracksFlights = flights.filter(
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId === "barracks",
  ).length;
  const connectedServers = servers.filter((server) => server.state === "connected").length;
  const totalTools = servers.reduce((sum, server) => sum + server.toolCount, 0);
  const readySubagents = subagents.filter((agent) => agent.ready !== false);
  const delegatedServerIds = new Set(readySubagents.flatMap((domain) => domain.serverIds));
  const delegatedServers = servers.filter((server) => delegatedServerIds.has(server.id));
  const delegatedSurfaceCount = delegatedServers.filter((server) => server.state === "connected").length;
  const delegatedToolCount = delegatedServers.reduce((sum, server) => sum + server.toolCount, 0);
  const activeAgents = agentRooms.filter((room) => room.activeToolCount > 0).length;
  const activeAgentTools = agentRooms.reduce((sum, room) => sum + room.activeToolCount, 0);
  const latestAgents = agentRooms.slice(0, 3);
  const previewSubagents = subagents.slice(0, 3);
  const activeStations = stations.filter((station) => station.state !== "idle" || station.isStreaming).length;
  const focusedStation = stations.find((station) => station.stationId === activeStationId) ?? stations[0];

  const bindRoomNode = useCallback(
    (roomId: string) => (node: HTMLButtonElement | null) => {
      if (!node) {
        roomNodesRef.current.delete(roomId);
        return;
      }

      roomNodesRef.current.set(roomId, node);
    },
    [],
  );

  const bindMcpHubNode = useCallback((node: HTMLButtonElement | null) => {
    mcpHubNodeRef.current = node;
    roomNodesRef.current.set("mcp", node);
  }, []);

  const bindAgentHubNode = useCallback((node: HTMLButtonElement | null) => {
    agentHubNodeRef.current = node;
    roomNodesRef.current.set("agents", node);
  }, []);

  useEffect(() => {
    for (const key of Array.from(roomNodesRef.current.keys())) {
      if (key.startsWith("mcp:")) {
        roomNodesRef.current.delete(key);
      }
    }

    if (!mcpHubNodeRef.current) {
      return;
    }

    for (const server of servers) {
      roomNodesRef.current.set(`mcp:${server.id}`, mcpHubNodeRef.current);
    }
  }, [servers]);

  useEffect(() => {
    for (const key of Array.from(roomNodesRef.current.keys())) {
      if (key.startsWith("agent:")) {
        roomNodesRef.current.delete(key);
      }
    }

    if (!agentHubNodeRef.current) {
      return;
    }

    for (const room of agentRooms) {
      roomNodesRef.current.set(room.roomId, agentHubNodeRef.current);
    }
  }, [agentRooms]);

  return (
    <section className={styles.deck}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Deck overview</div>
          <h1 className={styles.title}>Shinra command deck</h1>
        </div>
        <p className={styles.caption}>
          A living cross-section of the ship. Open any room to focus its work while live traffic runs between the
          Bridge, Armoury, Barracks, Field Office, and systems deck.
        </p>
      </div>

      <div ref={trackRef} className={styles.track}>
        <div className={styles.backdrop} aria-hidden="true">
          <div className={styles.spine} />
          <div className={styles.rowTwoLine} />
          <div className={styles.rowThreeLine} />
        </div>
        <FlightLayer flights={flights} trackRef={trackRef} roomNodesRef={roomNodesRef} />

        <RoomCard
          roomId="bridge"
          roomRef={bindRoomNode("bridge")}
          active={activeView === "bridge"}
          className={styles.bridgeRoom}
          title="Bridge / Command"
          caption="Primary room"
          status={assistantState}
          metric="Live relay and Shinra systems"
          tone="bridge"
          badge={activeBridgeFlights ? `${activeBridgeFlights} live` : stateLabel(assistantState)}
          onClick={() => onViewChange("bridge")}
        >
          <div className={styles.bridgePreview}>
            <div className={styles.commandLane}>
              <span className={styles.previewLabel}>Mission thread</span>
              <strong className={styles.previewValue}>Live relay and command flow</strong>
            </div>
            <div className={styles.shinraLane}>
              <div className={styles.miniPanel}>
                <span className={styles.previewLabel}>Shinra</span>
                <strong className={styles.previewValue}>{stateLabel(assistantState)}</strong>
              </div>
              <div className={styles.miniPanel}>
                <span className={styles.previewLabel}>Focused station</span>
                <strong className={styles.previewValue}>{focusedStation?.label ?? "Primary"}</strong>
              </div>
            </div>
          </div>
        </RoomCard>

        <RoomCard
          roomId="mcp"
          roomRef={bindMcpHubNode}
          active={activeView === "mcp" || activeView.startsWith("mcp:")}
          className={styles.mcpRoom}
          title="Armoury"
          caption="Grouped tools"
          status={connectedServers === servers.length && servers.length > 0 ? "connected" : "starting"}
          metric={`${connectedServers}/${servers.length} links • ${totalTools} tools`}
          tone="mcp"
          badge={activeMcpFlights ? `${activeMcpFlights} live` : "Linked"}
          onClick={() => onViewChange("mcp")}
        >
          <div className={styles.listPreview}>
            {servers.slice(0, 3).map((server) => (
              <div key={server.id} className={styles.listRow}>
                <span>{server.name}</span>
                <span>{server.toolCount}</span>
              </div>
            ))}
          </div>
        </RoomCard>

        <RoomCard
          roomId="barracks"
          roomRef={bindRoomNode("barracks")}
          active={activeView === "barracks"}
          className={styles.barracksRoom}
          title="Barracks"
          caption="Delegation roster"
          status={delegatedSurfaceCount > 0 ? "connected" : "starting"}
          metric={`${delegatedSurfaceCount} linked surfaces • ${delegatedToolCount} delegated tools`}
          tone="command"
          badge={activeBarracksFlights ? `${activeBarracksFlights} live` : "Roster"}
          onClick={() => onViewChange("barracks")}
        >
          <div className={styles.listPreview}>
            {previewSubagents.length > 0 ? (
              previewSubagents.map((agent) => (
                <div key={agent.id} className={styles.listRow}>
                  <span>{agent.label}</span>
                  <span>{agent.ready === false ? "standby" : `${agent.serverIds.length} links`}</span>
                </div>
              ))
            ) : (
              <div className={styles.emptyPreview}>No barracks roster configured.</div>
            )}
          </div>
        </RoomCard>

        <RoomCard
          roomId="agents"
          roomRef={bindAgentHubNode}
          active={activeView === "agents" || activeView.startsWith("agent:")}
          className={styles.agentRoom}
          title="Field Office"
          caption="Live rooms"
          status={activeAgents > 0 ? "connected" : "idle"}
          metric={
            agentRooms.length > 0 ? `${agentRooms.length} teams • ${activeAgentTools} live ops` : "No deployed teams"
          }
          tone="agent"
          badge={activeAgentFlights ? `${activeAgentFlights} live` : agentRooms.length ? "Ready" : "Idle"}
          onClick={() => onViewChange("agents")}
        >
          <div className={styles.listPreview}>
            {latestAgents.length > 0 ? (
              latestAgents.map((room) => (
                <div key={room.roomId} className={styles.listRow}>
                  <span>{room.label}</span>
                  <span>{room.activeToolCount > 0 ? `${room.activeToolCount} live` : room.status}</span>
                </div>
              ))
            ) : (
              <div className={styles.emptyPreview}>No field office rooms deployed.</div>
            )}
          </div>
        </RoomCard>

        <RoomCard
          roomId="operations"
          roomRef={bindRoomNode("operations")}
          active={activeView === "operations"}
          className={styles.opsRoom}
          title="Operations"
          caption="Command roster"
          status="connected"
          metric={`${stations.length} stations • ${activeStations} active`}
          tone="command"
          badge={activeOperationsFlights ? `${activeOperationsFlights} live` : "Roster"}
          onClick={() => onViewChange("operations")}
        >
          <div className={styles.listPreview}>
            {stations.slice(0, 3).map((station) => (
              <div key={station.stationId} className={styles.listRow}>
                <span>{station.label}</span>
                <span>{station.state}</span>
              </div>
            ))}
          </div>
        </RoomCard>

        <RoomCard
          roomId="projects"
          roomRef={bindRoomNode("projects")}
          active={activeView === "projects"}
          className={styles.projectsRoom}
          title="Missions"
          caption="Ticket intake + scope"
          status="connected"
          metric="YouTrack intake, repo boundaries, and mapped project scope"
          tone="ops"
          badge={activeMissionsFlights ? `${activeMissionsFlights} live` : "Flow"}
          onClick={() => onViewChange("projects")}
        >
          <div className={styles.listPreview}>
            <div className={styles.listRow}>
              <span>Assigned work</span>
              <span>Intake</span>
            </div>
            <div className={styles.listRow}>
              <span>Repo scope</span>
              <span>Mapped</span>
            </div>
          </div>
        </RoomCard>

        <RoomCard
          roomId="settings"
          roomRef={bindRoomNode("settings")}
          active={activeView === "settings"}
          className={styles.settingsRoom}
          title="Settings"
          caption="Systems control"
          status="connected"
          metric="Voice link, runtime tuning, and utility tooling"
          tone="ops"
          badge={activeSettingsFlights ? `${activeSettingsFlights} live` : "Calm"}
          onClick={() => onViewChange("settings")}
        >
          <div className={styles.listPreview}>
            <div className={styles.listRow}>
              <span>Voice pipeline</span>
              <span>Online</span>
            </div>
            <div className={styles.listRow}>
              <span>Backend link</span>
              <span>9720</span>
            </div>
          </div>
        </RoomCard>
      </div>
    </section>
  );
}
