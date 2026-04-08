import type { McpServerStatus, ToolCallStatus } from "@spira/shared";
import { create } from "zustand";

export interface ToolFlight {
  callId: string;
  toolName: string;
  fromRoomId: "bridge";
  toRoomId: string;
  status: ToolCallStatus;
  startedAt: number;
  completedAt?: number;
}

export interface AgentRoom {
  roomId: `agent:${string}`;
  label: string;
  caption: string;
  status: "launching" | "active" | "idle" | "error";
  createdAt: number;
  updatedAt: number;
  sourceCallId?: string;
  agentId?: string;
  lastToolName?: string;
  detail?: string;
  activeToolCount: number;
}

interface ToolCallPayload {
  callId: string;
  name: string;
  status: ToolCallStatus;
  args?: unknown;
  details?: string;
}

interface RoomStore {
  flights: ToolFlight[];
  agentRooms: AgentRoom[];
  clearAll: () => void;
  syncServers: (servers: McpServerStatus[]) => void;
  handleToolCall: (payload: ToolCallPayload, servers: McpServerStatus[]) => void;
  pruneFlights: () => void;
}

type ActiveCallTarget = {
  roomId: string;
  toolName: string;
  sourceCallId?: string;
};

const AGENT_TOOL_NAMES = new Set(["task", "read_agent", "write_agent", "stop_agent"]);
const OPERATIONS_TOOL_NAMES = new Set([
  "rg",
  "glob",
  "view",
  "apply_patch",
  "powershell",
  "sql",
  "report_intent",
  "ask_user",
  "web_fetch",
  "web_search",
  "list_agents",
]);

const activeCallTargets = new Map<string, ActiveCallTarget>();
const agentLookup = new Map<string, `agent:${string}`>();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const getString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const extractAgentIdFromArgs = (args: unknown): string | undefined => {
  if (!isRecord(args)) {
    return undefined;
  }

  return getString(args.agent_id) ?? getString(args.agentId);
};

const extractAgentIdFromDetails = (details?: string): string | undefined => {
  if (!details) {
    return undefined;
  }

  const patterns = [
    /"agent_id"\s*:\s*"([^"]+)"/i,
    /agent_id\s*[:=]\s*"?(?<id>[\w-]+)"?/i,
    /agent id\s*[:=]\s*"?(?<id>[\w-]+)"?/i,
  ];

  for (const pattern of patterns) {
    const match = details.match(pattern);
    const id = match?.groups?.id ?? match?.[1];
    if (id) {
      return id;
    }
  }

  return undefined;
};

const extractAgentLabel = (args: unknown): string => {
  if (!isRecord(args)) {
    return "Field Team";
  }

  return getString(args.name) ?? getString(args.description) ?? getString(args.agent_type) ?? "Field Team";
};

const toAgentRoomId = (identifier: string): `agent:${string}` => `agent:${identifier}`;

const resolveTargetRoomId = (toolName: string, args: unknown, servers: McpServerStatus[]): string => {
  const agentId = extractAgentIdFromArgs(args);
  if (agentId) {
    return agentLookup.get(agentId) ?? toAgentRoomId(agentId);
  }

  if (toolName === "task") {
    return toAgentRoomId(`launch-${Date.now()}`);
  }

  const matchingServer = servers.find((server) => server.tools.includes(toolName));
  if (matchingServer) {
    return `mcp:${matchingServer.id}`;
  }

  if (OPERATIONS_TOOL_NAMES.has(toolName)) {
    return "settings";
  }

  return "bridge";
};

const upsertAgentRoom = (
  rooms: AgentRoom[],
  roomId: `agent:${string}`,
  update: Partial<AgentRoom> & Pick<AgentRoom, "label" | "caption" | "status">,
): AgentRoom[] => {
  const now = Date.now();
  const existing = rooms.find((room) => room.roomId === roomId);
  if (!existing) {
    return [
      {
        roomId,
        label: update.label,
        caption: update.caption,
        status: update.status,
        createdAt: now,
        updatedAt: now,
        sourceCallId: update.sourceCallId,
        agentId: update.agentId,
        lastToolName: update.lastToolName,
        detail: update.detail,
        activeToolCount: update.activeToolCount ?? 0,
      },
      ...rooms,
    ];
  }

  return rooms.map((room) =>
    room.roomId === roomId
      ? {
          ...room,
          ...update,
          updatedAt: now,
          activeToolCount: update.activeToolCount ?? room.activeToolCount,
        }
      : room,
  );
};

const updateAgentRoomActivity = (rooms: AgentRoom[], roomId: string, delta: number): AgentRoom[] =>
  rooms.map((room) =>
    room.roomId === roomId
      ? {
          ...room,
          activeToolCount: Math.max(0, room.activeToolCount + delta),
          updatedAt: Date.now(),
          status: room.status === "error" ? room.status : room.activeToolCount + delta > 0 ? "active" : "idle",
        }
      : room,
  );

export const useRoomStore = create<RoomStore>((set) => ({
  flights: [],
  agentRooms: [],
  clearAll: () => {
    activeCallTargets.clear();
    agentLookup.clear();
    set({
      flights: [],
      agentRooms: [],
    });
  },
  syncServers: (servers) => {
    const activeServerIds = new Set(servers.map((server) => `mcp:${server.id}`));
    set((state) => ({
      flights: state.flights.filter((flight) =>
        flight.toRoomId.startsWith("mcp:") ? activeServerIds.has(flight.toRoomId) : true,
      ),
    }));
  },
  handleToolCall: (payload, servers) => {
    set((state) => {
      const startedAt = Date.now();
      const nextFlights = [...state.flights];
      let nextAgentRooms = state.agentRooms;

      if (payload.status === "running" || payload.status === "pending") {
        const targetRoomId = resolveTargetRoomId(payload.name, payload.args, servers);
        activeCallTargets.set(payload.callId, {
          roomId: targetRoomId,
          toolName: payload.name,
          sourceCallId: payload.callId,
        });

        if (payload.name === "task" || AGENT_TOOL_NAMES.has(payload.name)) {
          const explicitAgentId = extractAgentIdFromArgs(payload.args);
          const roomId = explicitAgentId
            ? (agentLookup.get(explicitAgentId) ?? toAgentRoomId(explicitAgentId))
            : (targetRoomId as `agent:${string}`);
          if (explicitAgentId) {
            agentLookup.set(explicitAgentId, roomId);
          }

          nextAgentRooms = upsertAgentRoom(nextAgentRooms, roomId, {
            label: extractAgentLabel(payload.args),
            caption: explicitAgentId ? "Subagent room" : "Launching field team",
            status: explicitAgentId ? "active" : "launching",
            sourceCallId: payload.callId,
            agentId: explicitAgentId,
            lastToolName: payload.name,
            detail: payload.details,
          });
          nextAgentRooms = updateAgentRoomActivity(nextAgentRooms, roomId, 1);
          activeCallTargets.set(payload.callId, { roomId, toolName: payload.name, sourceCallId: payload.callId });
        }

        nextFlights.push({
          callId: payload.callId,
          toolName: payload.name,
          fromRoomId: "bridge",
          toRoomId: activeCallTargets.get(payload.callId)?.roomId ?? targetRoomId,
          status: payload.status,
          startedAt,
        });

        return {
          flights: nextFlights,
          agentRooms: nextAgentRooms,
        };
      }

      const target = activeCallTargets.get(payload.callId);
      const targetRoomId = target?.roomId ?? resolveTargetRoomId(payload.name, payload.args, servers);
      const completedAt = Date.now();
      const flightIndex = nextFlights.findIndex((flight) => flight.callId === payload.callId);
      if (flightIndex >= 0) {
        nextFlights[flightIndex] = {
          ...nextFlights[flightIndex],
          status: payload.status,
          completedAt,
        };
      } else {
        nextFlights.push({
          callId: payload.callId,
          toolName: payload.name,
          fromRoomId: "bridge",
          toRoomId: targetRoomId,
          status: payload.status,
          startedAt: completedAt,
          completedAt,
        });
      }

      if (targetRoomId.startsWith("agent:")) {
        const agentId = extractAgentIdFromDetails(payload.details) ?? extractAgentIdFromArgs(payload.args);
        if (agentId) {
          agentLookup.set(agentId, targetRoomId as `agent:${string}`);
        }

        nextAgentRooms = upsertAgentRoom(nextAgentRooms, targetRoomId as `agent:${string}`, {
          label: extractAgentLabel(payload.args),
          caption: "Subagent room",
          status: payload.status === "error" ? "error" : "active",
          agentId,
          lastToolName: payload.name,
          detail: payload.details,
        });
        nextAgentRooms = updateAgentRoomActivity(nextAgentRooms, targetRoomId, -1);
      }

      activeCallTargets.delete(payload.callId);

      return {
        flights: nextFlights,
        agentRooms: nextAgentRooms,
      };
    });
  },
  pruneFlights: () => {
    const now = Date.now();
    set((state) => {
      const flights = state.flights.filter((flight) => !flight.completedAt || now - flight.completedAt < 1800);
      const agentRooms = state.agentRooms.filter(
        (room) => room.activeToolCount > 0 || now - room.updatedAt < 5 * 60_000,
      );

      if (flights.length === state.flights.length && agentRooms.length === state.agentRooms.length) {
        return state;
      }

      return { flights, agentRooms };
    });
  },
}));
