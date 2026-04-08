import type { AssistantState, McpServerStatus } from "@spira/shared";
import { useCallback, useEffect, useRef } from "react";
import type { AgentRoom } from "../../stores/room-store.js";
import type { ToolFlight } from "../../stores/room-store.js";
import styles from "./BaseDeck.module.css";
import { FlightLayer } from "./FlightLayer.js";
import { RoomCard } from "./RoomCard.js";

interface BaseDeckProps {
  activeView: "ship" | "bridge" | "mcp" | "agents" | "settings" | `mcp:${string}` | `agent:${string}`;
  assistantState: AssistantState;
  servers: McpServerStatus[];
  agentRooms: AgentRoom[];
  flights: ToolFlight[];
  onViewChange: (view: "ship" | "bridge" | "mcp" | "agents" | "settings" | `mcp:${string}` | `agent:${string}`) => void;
}

const stateLabel = (state: AssistantState): string => state.charAt(0).toUpperCase() + state.slice(1);

export function BaseDeck({ activeView, assistantState, servers, agentRooms, flights, onViewChange }: BaseDeckProps) {
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
    (flight) => (flight.status === "running" || flight.status === "pending") && flight.toRoomId === "settings",
  ).length;
  const connectedServers = servers.filter((server) => server.state === "connected").length;
  const totalTools = servers.reduce((sum, server) => sum + server.toolCount, 0);
  const activeAgents = agentRooms.filter((room) => room.activeToolCount > 0).length;
  const activeAgentTools = agentRooms.reduce((sum, room) => sum + room.activeToolCount, 0);
  const latestAgents = agentRooms.slice(0, 3);

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
          <div className={styles.eyebrow}>Ship view</div>
          <h1 className={styles.title}>Shinra command deck</h1>
        </div>
        <p className={styles.caption}>
          A grouped cross-section of the ship. Click a room to zoom into its operations while live tool traffic flows
          across the deck toward MCP, subagent, and operations hubs.
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
          metric="75% tactical chat + 25% Shinra systems"
          tone="bridge"
          badge={activeBridgeFlights ? `${activeBridgeFlights} live` : stateLabel(assistantState)}
          onClick={() => onViewChange("bridge")}
        >
          <div className={styles.bridgePreview}>
            <div className={styles.commandLane}>
              <span className={styles.previewLabel}>Command lane</span>
              <strong className={styles.previewValue}>Live relay and mission control</strong>
            </div>
            <div className={styles.shinraLane}>
              <div className={styles.miniPanel}>
                <span className={styles.previewLabel}>Shinra</span>
                <strong className={styles.previewValue}>{stateLabel(assistantState)}</strong>
              </div>
              <div className={styles.miniPanel}>
                <span className={styles.previewLabel}>Lower bay</span>
                <strong className={styles.previewValue}>Reserved</strong>
              </div>
            </div>
          </div>
        </RoomCard>

        <RoomCard
          roomId="mcp"
          roomRef={bindMcpHubNode}
          active={activeView === "mcp" || activeView.startsWith("mcp:")}
          className={styles.mcpRoom}
          title="MCP Servers"
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

        <div className={`${styles.voidCell} ${styles.voidUpper}`}>
          <span className={styles.voidLabel}>Transit shaft</span>
          <strong className={styles.voidTitle}>Structural corridor</strong>
          <span className={styles.voidCopy}>Power routing and crew access spine.</span>
        </div>

        <RoomCard
          roomId="agents"
          roomRef={bindAgentHubNode}
          active={activeView === "agents" || activeView.startsWith("agent:")}
          className={styles.agentRoom}
          title="Sub Agents"
          caption="Grouped teams"
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
              <div className={styles.emptyPreview}>No field teams deployed.</div>
            )}
          </div>
        </RoomCard>

        <RoomCard
          roomId="settings"
          roomRef={bindRoomNode("settings")}
          active={activeView === "settings"}
          className={styles.opsRoom}
          title="Operations"
          caption="Systems control"
          status="connected"
          metric="Voice link, settings, and utility tooling"
          tone="ops"
          badge={activeOperationsFlights ? `${activeOperationsFlights} live` : "Stable"}
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

        <div className={`${styles.voidCell} ${styles.voidLowerMiddle}`}>
          <span className={styles.voidLabel}>Expansion bay</span>
          <strong className={styles.voidTitle}>Reserved slot</strong>
          <span className={styles.voidCopy}>Available for future rooms.</span>
        </div>

        <div className={`${styles.voidCell} ${styles.voidLowerRight}`}>
          <span className={styles.voidLabel}>Expansion bay</span>
          <strong className={styles.voidTitle}>Reserved slot</strong>
          <span className={styles.voidCopy}>Available for future rooms.</span>
        </div>
      </div>
    </section>
  );
}
