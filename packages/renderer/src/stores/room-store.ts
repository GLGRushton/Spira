import type {
  McpServerStatus,
  StationId,
  SubagentCompletedEvent,
  SubagentDeltaEvent,
  SubagentDomainId,
  SubagentEnvelope,
  SubagentErrorEvent,
  SubagentErrorRecord,
  SubagentLockAcquiredEvent,
  SubagentLockDeniedEvent,
  SubagentLockReleasedEvent,
  SubagentRunStatus,
  SubagentStartedEvent,
  SubagentStatusEvent,
  SubagentToolCallEvent,
  SubagentToolCallRecord,
  SubagentToolResultEvent,
  ToolCallStatus,
} from "@spira/shared";
import { create } from "zustand";
import { RECENT_COMPLETION_MS } from "../tool-display.js";

export interface ToolFlight {
  stationId: StationId;
  callId: string;
  toolName: string;
  fromRoomId: "bridge";
  toRoomId: string;
  status: ToolCallStatus;
  startedAt: number;
  completedAt?: number;
}

export interface AgentRoom {
  stationId: StationId;
  roomId: `agent:${string}`;
  label: string;
  caption: string;
  status: "launching" | "active" | "idle" | "error";
  kind?: "agent" | "subagent";
  domainId?: SubagentDomainId;
  runId?: string;
  attempt?: number;
  createdAt: number;
  updatedAt: number;
  sourceCallId?: string;
  agentId?: string;
  lastToolName?: string;
  detail?: string;
  activeToolCount: number;
  expiresAt?: number;
  liveText?: string;
  envelope?: SubagentEnvelope;
  toolHistory: SubagentToolCallRecord[];
  errorHistory: SubagentErrorRecord[];
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
  clearAll: (stationId?: StationId) => void;
  syncServers: (servers: McpServerStatus[]) => void;
  handleToolCall: (payload: ToolCallPayload, servers: McpServerStatus[], stationId?: StationId) => void;
  handleSubagentStarted: (event: SubagentStartedEvent, stationId?: StationId) => void;
  handleSubagentToolCall: (event: SubagentToolCallEvent, stationId?: StationId) => void;
  handleSubagentToolResult: (event: SubagentToolResultEvent, stationId?: StationId) => void;
  handleSubagentDelta: (event: SubagentDeltaEvent, stationId?: StationId) => void;
  handleSubagentStatus: (event: SubagentStatusEvent, stationId?: StationId) => void;
  handleSubagentCompleted: (event: SubagentCompletedEvent, stationId?: StationId) => void;
  handleSubagentError: (event: SubagentErrorEvent, stationId?: StationId) => void;
  handleSubagentLockAcquired: (event: SubagentLockAcquiredEvent, stationId?: StationId) => void;
  handleSubagentLockDenied: (event: SubagentLockDeniedEvent, stationId?: StationId) => void;
  handleSubagentLockReleased: (event: SubagentLockReleasedEvent, stationId?: StationId) => void;
  pruneFlights: () => void;
}

type ActiveCallTarget = {
  roomId: string;
  toolName: string;
  sourceCallId?: string;
};

const AGENT_TOOL_NAMES = new Set([
  "task",
  "read_agent",
  "write_agent",
  "stop_agent",
  "read_subagent",
  "write_subagent",
  "stop_subagent",
]);
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
const DEFAULT_STATION_ID = "primary";

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
const resolveStationId = (stationId?: StationId): StationId => stationId ?? DEFAULT_STATION_ID;
const toScopedCallKey = (stationId: StationId, callId: string): string => `${stationId}:${callId}`;
const toScopedAgentKey = (stationId: StationId, agentId: string): string => `${stationId}:${agentId}`;

const getSubagentLabel = (domain: SubagentDomainId, label?: string): string => label?.trim() || domain;
const getRoomLabel = (
  rooms: AgentRoom[],
  roomId: `agent:${string}`,
  stationId: StationId,
  fallback = "Subagent",
): string => rooms.find((room) => room.roomId === roomId && room.stationId === stationId)?.label ?? fallback;

const describeSubagentAttempt = (attempt: number, allowWrites?: boolean): string =>
  `${allowWrites ? "Write-enabled" : "Read-focused"} ${attempt > 1 ? `retry ${attempt}` : "run"} in progress`;

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
  stationId: StationId,
  update: Partial<AgentRoom> & Pick<AgentRoom, "label" | "caption" | "status">,
): AgentRoom[] => {
  const now = Date.now();
  const existing = rooms.find((room) => room.roomId === roomId && room.stationId === stationId);
  if (!existing) {
    return [
      {
        stationId,
        roomId,
        ...update,
        createdAt: now,
        updatedAt: now,
        activeToolCount: update.activeToolCount ?? 0,
        toolHistory: update.toolHistory ?? [],
        errorHistory: update.errorHistory ?? [],
      },
      ...rooms,
    ];
  }

  return rooms.map((room) =>
    room.roomId === roomId && room.stationId === stationId
      ? {
          ...room,
          ...update,
          updatedAt: now,
          activeToolCount: update.activeToolCount ?? room.activeToolCount,
          toolHistory: update.toolHistory ?? room.toolHistory,
          errorHistory: update.errorHistory ?? room.errorHistory,
        }
      : room,
  );
};

const updateAgentRoomActivity = (
  rooms: AgentRoom[],
  roomId: string,
  stationId: StationId,
  delta: number,
): AgentRoom[] =>
  rooms.map((room) =>
    room.roomId === roomId && room.stationId === stationId
      ? {
          ...room,
          activeToolCount: Math.max(0, room.activeToolCount + delta),
          updatedAt: Date.now(),
          status:
            room.status === "error" ? room.status : Math.max(0, room.activeToolCount + delta) > 0 ? "active" : "idle",
        }
      : room,
  );

const upsertToolHistory = (
  toolHistory: SubagentToolCallRecord[],
  entry: SubagentToolCallRecord,
): SubagentToolCallRecord[] => {
  const existingIndex = toolHistory.findIndex((toolCall) => toolCall.callId === entry.callId);
  if (existingIndex < 0) {
    return [...toolHistory, entry];
  }

  return toolHistory.map((toolCall, index) => (index === existingIndex ? { ...toolCall, ...entry } : toolCall));
};

const mergeToolHistory = (
  existing: SubagentToolCallRecord[],
  incoming: readonly SubagentToolCallRecord[],
): SubagentToolCallRecord[] => incoming.reduce((history, entry) => upsertToolHistory(history, entry), existing);

const isSameError = (left: SubagentErrorRecord, right: SubagentErrorRecord): boolean =>
  left.code === right.code && left.message === right.message && left.details === right.details;

const mergeErrorHistory = (
  existing: SubagentErrorRecord[],
  incoming: readonly SubagentErrorRecord[],
): SubagentErrorRecord[] => {
  const history = [...existing];
  for (const entry of incoming) {
    if (!history.some((error) => isSameError(error, entry))) {
      history.push(entry);
    }
  }

  return history;
};

const describeSubagentStatus = (status: SubagentRunStatus): { caption: string; status: AgentRoom["status"] } => {
  switch (status) {
    case "running":
      return { caption: "Delegated run active", status: "active" };
    case "idle":
      return { caption: "Delegated run idle", status: "idle" };
    case "partial":
      return { caption: "Partial result", status: "error" };
    case "failed":
      return { caption: "Run failed", status: "error" };
    case "cancelled":
      return { caption: "Run cancelled", status: "idle" };
    case "expired":
      return { caption: "Run expired", status: "idle" };
    case "completed":
      return { caption: "Completed", status: "idle" };
    default:
      return { caption: "Delegated run", status: "idle" };
  }
};

const trimLiveText = (value: string, maxLength = 8_000): string =>
  value.length <= maxLength ? value : value.slice(value.length - maxLength);

export const useRoomStore = create<RoomStore>((set) => ({
  flights: [],
  agentRooms: [],
  clearAll: (stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    if (!stationId) {
      activeCallTargets.clear();
      agentLookup.clear();
      set({
        flights: [],
        agentRooms: [],
      });
      return;
    }

    for (const key of Array.from(activeCallTargets.keys())) {
      if (key.startsWith(`${resolvedStationId}:`)) {
        activeCallTargets.delete(key);
      }
    }
    for (const key of Array.from(agentLookup.keys())) {
      if (key.startsWith(`${resolvedStationId}:`)) {
        agentLookup.delete(key);
      }
    }
    set((state) => ({
      flights: state.flights.filter((flight) => flight.stationId !== resolvedStationId),
      agentRooms: state.agentRooms.filter((room) => room.stationId !== resolvedStationId),
    }));
  },
  syncServers: (servers) => {
    const activeServerIds = new Set(servers.map((server) => `mcp:${server.id}`));
    set((state) => ({
      flights: state.flights.filter((flight) =>
        flight.toRoomId.startsWith("mcp:") ? activeServerIds.has(flight.toRoomId) : true,
      ),
    }));
  },
  handleToolCall: (payload, servers, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => {
      const startedAt = Date.now();
      const nextFlights = [...state.flights];
      let nextAgentRooms = state.agentRooms;

      if (payload.status === "running" || payload.status === "pending") {
        const targetRoomId = resolveTargetRoomId(payload.name, payload.args, servers);
        activeCallTargets.set(toScopedCallKey(resolvedStationId, payload.callId), {
          roomId: targetRoomId,
          toolName: payload.name,
          sourceCallId: payload.callId,
        });

        if (payload.name === "task" || AGENT_TOOL_NAMES.has(payload.name)) {
          const explicitAgentId = extractAgentIdFromArgs(payload.args);
          const roomId = explicitAgentId
            ? (agentLookup.get(toScopedAgentKey(resolvedStationId, explicitAgentId)) ?? toAgentRoomId(explicitAgentId))
            : (targetRoomId as `agent:${string}`);
          if (explicitAgentId) {
            agentLookup.set(toScopedAgentKey(resolvedStationId, explicitAgentId), roomId);
          }

          nextAgentRooms = upsertAgentRoom(nextAgentRooms, roomId, resolvedStationId, {
            label: extractAgentLabel(payload.args),
            caption: explicitAgentId ? "Subagent room" : "Launching field team",
            status: explicitAgentId ? "active" : "launching",
            sourceCallId: payload.callId,
            agentId: explicitAgentId,
            lastToolName: payload.name,
            detail: payload.details,
          });
          nextAgentRooms = updateAgentRoomActivity(nextAgentRooms, roomId, resolvedStationId, 1);
          activeCallTargets.set(toScopedCallKey(resolvedStationId, payload.callId), {
            roomId,
            toolName: payload.name,
            sourceCallId: payload.callId,
          });
        }

        nextFlights.push({
          stationId: resolvedStationId,
          callId: payload.callId,
          toolName: payload.name,
          fromRoomId: "bridge",
          toRoomId: activeCallTargets.get(toScopedCallKey(resolvedStationId, payload.callId))?.roomId ?? targetRoomId,
          status: payload.status,
          startedAt,
        });

        return {
          flights: nextFlights,
          agentRooms: nextAgentRooms,
        };
      }

      const target = activeCallTargets.get(toScopedCallKey(resolvedStationId, payload.callId));
      const targetRoomId = target?.roomId ?? resolveTargetRoomId(payload.name, payload.args, servers);
      const completedAt = Date.now();
      const flightIndex = nextFlights.findIndex(
        (flight) => flight.callId === payload.callId && flight.stationId === resolvedStationId,
      );
      if (flightIndex >= 0) {
        nextFlights[flightIndex] = {
          ...nextFlights[flightIndex],
          status: payload.status,
          completedAt,
        };
      } else {
        nextFlights.push({
          stationId: resolvedStationId,
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
          agentLookup.set(toScopedAgentKey(resolvedStationId, agentId), targetRoomId as `agent:${string}`);
        }

        nextAgentRooms = upsertAgentRoom(nextAgentRooms, targetRoomId as `agent:${string}`, resolvedStationId, {
          label: extractAgentLabel(payload.args),
          caption: "Subagent room",
          status: payload.status === "error" ? "error" : "active",
          agentId,
          lastToolName: payload.name,
          detail: payload.details,
        });
        nextAgentRooms = updateAgentRoomActivity(nextAgentRooms, targetRoomId, resolvedStationId, -1);
      }

      activeCallTargets.delete(toScopedCallKey(resolvedStationId, payload.callId));

      return {
        flights: nextFlights,
        agentRooms: nextAgentRooms,
      };
    });
  },
  handleSubagentStarted: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    agentLookup.set(toScopedAgentKey(resolvedStationId, event.runId), event.roomId);
    set((state) => ({
      agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
        label: getSubagentLabel(event.domain, event.label),
        caption: describeSubagentAttempt(event.attempt, event.allowWrites),
        status: "active",
        kind: "subagent",
        domainId: event.domain,
        runId: event.runId,
        attempt: event.attempt,
        detail: event.task,
        activeToolCount: 0,
        liveText: "",
        envelope: undefined,
      }),
    }));
  },
  handleSubagentToolCall: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      agentRooms: updateAgentRoomActivity(
        upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
          label: getRoomLabel(state.agentRooms, event.roomId, resolvedStationId),
          caption: "Executing delegated tools",
          status: "active",
          lastToolName: event.toolName,
          detail: event.serverId ? `${event.toolName} via ${event.serverId}` : event.toolName,
          toolHistory: upsertToolHistory(
            state.agentRooms.find((room) => room.roomId === event.roomId && room.stationId === resolvedStationId)
              ?.toolHistory ?? [],
            {
              callId: event.callId,
              toolName: event.toolName,
              ...(event.serverId ? { serverId: event.serverId } : {}),
              ...(event.args ? { args: event.args } : {}),
              status: "running",
              startedAt: event.startedAt,
            },
          ),
        }),
        event.roomId,
        resolvedStationId,
        1,
      ),
    }));
  },
  handleSubagentToolResult: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      agentRooms: updateAgentRoomActivity(
        upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
          label: getRoomLabel(state.agentRooms, event.roomId, resolvedStationId),
          caption: "Delegated run",
          status: event.status === "error" ? "error" : "active",
          lastToolName: event.toolName,
          detail: event.details ?? `${event.toolName} ${event.status}`,
          toolHistory: upsertToolHistory(
            state.agentRooms.find((room) => room.roomId === event.roomId && room.stationId === resolvedStationId)
              ?.toolHistory ?? [],
            {
              callId: event.callId,
              toolName: event.toolName,
              ...(event.serverId ? { serverId: event.serverId } : {}),
              ...(event.result !== undefined ? { result: event.result } : {}),
              ...(event.details ? { details: event.details } : {}),
              status: event.status,
              startedAt: event.startedAt,
              completedAt: event.completedAt,
              durationMs: event.durationMs,
            },
          ),
        }),
        event.roomId,
        resolvedStationId,
        -1,
      ),
    }));
  },
  handleSubagentDelta: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => {
      const existingRoom = state.agentRooms.find(
        (room) => room.roomId === event.roomId && room.stationId === resolvedStationId,
      );
      return {
        agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
          label: getRoomLabel(state.agentRooms, event.roomId, resolvedStationId),
          caption: "Delegated run",
          status: existingRoom?.status === "error" ? "error" : "active",
          liveText: trimLiveText(`${existingRoom?.liveText ?? ""}${event.delta}`),
        }),
      };
    });
  },
  handleSubagentStatus: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => {
      const descriptor = describeSubagentStatus(event.status);
      return {
        agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
          label: getSubagentLabel(event.domain, event.label),
          caption: descriptor.caption,
          status: descriptor.status,
          kind: "subagent",
          domainId: event.domain,
          runId: event.runId,
          detail: event.summary,
          expiresAt: event.expiresAt,
        }),
      };
    });
  },
  handleSubagentCompleted: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
        label: getSubagentLabel(event.domain, event.label),
        caption: event.envelope.followupNeeded ? "Completed with follow-up" : "Completed",
        status: event.envelope.status === "failed" ? "error" : "idle",
        kind: "subagent",
        domainId: event.domain,
        runId: event.runId,
        attempt: event.envelope.retryCount + 1,
        detail: event.envelope.summary,
        activeToolCount: 0,
        liveText: "",
        envelope: event.envelope,
        toolHistory: mergeToolHistory(
          state.agentRooms.find((room) => room.roomId === event.roomId && room.stationId === resolvedStationId)
            ?.toolHistory ?? [],
          event.envelope.toolCalls,
        ),
        errorHistory: mergeErrorHistory(
          state.agentRooms.find((room) => room.roomId === event.roomId && room.stationId === resolvedStationId)
            ?.errorHistory ?? [],
          event.envelope.errors,
        ),
      }),
    }));
  },
  handleSubagentError: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
        label: getSubagentLabel(event.domain, event.label),
        caption: event.willRetry ? "Retrying subagent run" : "Run failed",
        status: event.willRetry ? "active" : "error",
        kind: "subagent",
        domainId: event.domain,
        runId: event.runId,
        attempt: event.attempt,
        detail: event.error.message,
        errorHistory: mergeErrorHistory(
          state.agentRooms.find((room) => room.roomId === event.roomId && room.stationId === resolvedStationId)
            ?.errorHistory ?? [],
          [event.error],
        ),
      }),
    }));
  },
  handleSubagentLockAcquired: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
        label: getRoomLabel(state.agentRooms, event.roomId, resolvedStationId),
        caption: "Write lock granted",
        status: "active",
        runId: event.runId,
        detail: `${event.request.toolName} locked ${event.request.targetId}`,
      }),
    }));
  },
  handleSubagentLockDenied: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
        label: getRoomLabel(state.agentRooms, event.roomId, resolvedStationId),
        caption: "Write lock denied",
        status: "error",
        runId: event.runId,
        detail: event.denial.reason,
      }),
    }));
  },
  handleSubagentLockReleased: (event, stationId) => {
    const resolvedStationId = resolveStationId(stationId);
    set((state) => ({
      agentRooms: upsertAgentRoom(state.agentRooms, event.roomId, resolvedStationId, {
        label: getRoomLabel(state.agentRooms, event.roomId, resolvedStationId),
        caption: "Write lock released",
        status: state.agentRooms.find((room) => room.roomId === event.roomId && room.stationId === resolvedStationId)
          ?.activeToolCount
          ? "active"
          : "idle",
        runId: event.runId,
        detail: `Lock ${event.intentId} released`,
      }),
    }));
  },
  pruneFlights: () => {
    const now = Date.now();
    set((state) => {
      const flights = state.flights.filter(
        (flight) => !flight.completedAt || now - flight.completedAt < RECENT_COMPLETION_MS,
      );
      const agentRooms = state.agentRooms.filter(
        (room) => room.activeToolCount > 0 || now - room.updatedAt < 5 * 60_000,
      );
      const remainingRoomIds = new Set(agentRooms.map((room) => `${room.stationId}:${room.roomId}`));
      for (const [agentId, roomId] of agentLookup.entries()) {
        if (!remainingRoomIds.has(`${agentId.split(":")[0]}:${roomId}`)) {
          agentLookup.delete(agentId);
        }
      }

      if (flights.length === state.flights.length && agentRooms.length === state.agentRooms.length) {
        return state;
      }

      return { flights, agentRooms };
    });
  },
}));
