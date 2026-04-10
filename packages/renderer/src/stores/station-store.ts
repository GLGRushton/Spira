import type { AssistantState, StationId, StationSummary } from "@spira/shared";
import { create } from "zustand";

export interface StationViewState extends StationSummary {
  hasUnread: boolean;
}

interface StationStore {
  activeStationId: StationId;
  stations: Record<StationId, StationViewState>;
  hydrateStations: (stations: StationSummary[]) => void;
  upsertStation: (station: StationSummary) => void;
  ensureStation: (stationId: StationId, overrides?: Partial<StationSummary>) => void;
  setActiveStation: (stationId: StationId) => void;
  setStationState: (stationId: StationId, state: AssistantState) => void;
  markActivity: (stationId: StationId, updatedAt?: number) => void;
  setStationConversation: (stationId: StationId, conversationId: string | null, title?: string | null) => void;
  removeStation: (stationId: StationId) => void;
}

export const PRIMARY_STATION_ID = "primary";

const createFallbackStation = (
  stationId: StationId,
  overrides: Partial<StationSummary> = {},
): StationViewState => ({
  stationId,
  conversationId: null,
  label: stationId === PRIMARY_STATION_ID ? "Primary" : "Command Station",
  title: null,
  state: "idle",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  isStreaming: false,
  hasUnread: false,
  ...overrides,
});

const sortStations = (stations: Record<StationId, StationViewState>): Record<StationId, StationViewState> =>
  Object.fromEntries(
    Object.values(stations)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((station) => [station.stationId, station]),
  );

export const getStation = (
  store: Pick<StationStore, "stations">,
  stationId: StationId | undefined,
): StationViewState => store.stations[stationId ?? PRIMARY_STATION_ID] ?? createFallbackStation(stationId ?? PRIMARY_STATION_ID);

export const useStationStore = create<StationStore>((set, get) => ({
  activeStationId: PRIMARY_STATION_ID,
  stations: {
    [PRIMARY_STATION_ID]: createFallbackStation(PRIMARY_STATION_ID),
  },
  hydrateStations: (stations) => {
    set((state) => {
      const nextStations = stations.reduce<Record<StationId, StationViewState>>((result, station) => {
        const existing = state.stations[station.stationId];
        result[station.stationId] = {
          ...createFallbackStation(station.stationId),
          ...existing,
          ...station,
          hasUnread: existing?.hasUnread ?? false,
        };
        return result;
      }, {});

      if (!nextStations[PRIMARY_STATION_ID]) {
        nextStations[PRIMARY_STATION_ID] = state.stations[PRIMARY_STATION_ID] ?? createFallbackStation(PRIMARY_STATION_ID);
      }

      const activeStationId = nextStations[state.activeStationId]
        ? state.activeStationId
        : nextStations[PRIMARY_STATION_ID]
          ? PRIMARY_STATION_ID
          : Object.keys(nextStations)[0] ?? PRIMARY_STATION_ID;

      nextStations[activeStationId] = {
        ...nextStations[activeStationId],
        hasUnread: false,
      };

      return {
        activeStationId,
        stations: sortStations(nextStations),
      };
    });
  },
  upsertStation: (station) => {
    set((state) => {
      const existing = state.stations[station.stationId];
      return {
        stations: sortStations({
          ...state.stations,
          [station.stationId]: {
            ...createFallbackStation(station.stationId),
            ...existing,
            ...station,
            hasUnread: existing?.hasUnread ?? false,
          },
        }),
      };
    });
  },
  ensureStation: (stationId, overrides = {}) => {
    if (get().stations[stationId]) {
      return;
    }

    set((state) => ({
      stations: sortStations({
        ...state.stations,
        [stationId]: createFallbackStation(stationId, overrides),
      }),
    }));
  },
  setActiveStation: (stationId) => {
    set((state) => ({
      activeStationId: stationId,
      stations: {
        ...state.stations,
        [stationId]: {
          ...getStation(state, stationId),
          hasUnread: false,
        },
      },
    }));
  },
  setStationState: (stationId, stateValue) => {
    set((state) => {
      const station = getStation(state, stationId);
      const isActive = state.activeStationId === stationId;
      return {
        stations: {
          ...state.stations,
          [stationId]: {
            ...station,
            state: stateValue,
            isStreaming: stateValue === "thinking" || stateValue === "speaking",
            updatedAt: Date.now(),
            hasUnread: isActive ? false : station.hasUnread || stateValue !== "idle",
          },
        },
      };
    });
  },
  markActivity: (stationId, updatedAt = Date.now()) => {
    set((state) => {
      const station = getStation(state, stationId);
      return {
        stations: {
          ...state.stations,
          [stationId]: {
            ...station,
            updatedAt,
            hasUnread: state.activeStationId === stationId ? false : true,
          },
        },
      };
    });
  },
  setStationConversation: (stationId, conversationId, title) => {
    set((state) => {
      const station = getStation(state, stationId);
      return {
        stations: {
          ...state.stations,
          [stationId]: {
            ...station,
            conversationId,
            title: title === undefined ? station.title : title,
          },
        },
      };
    });
  },
  removeStation: (stationId) => {
    set((state) => {
      if (stationId === PRIMARY_STATION_ID) {
        return state;
      }

      const nextStations = { ...state.stations };
      delete nextStations[stationId];
      const nextActiveStationId =
        state.activeStationId === stationId
          ? (nextStations[PRIMARY_STATION_ID]?.stationId ?? Object.keys(nextStations)[0] ?? PRIMARY_STATION_ID)
          : state.activeStationId;

      if (!nextStations[nextActiveStationId]) {
        nextStations[nextActiveStationId] = createFallbackStation(nextActiveStationId);
      }
      nextStations[nextActiveStationId] = {
        ...nextStations[nextActiveStationId],
        hasUnread: false,
      };

      return {
        activeStationId: nextActiveStationId,
        stations: sortStations(nextStations),
      };
    });
  },
}));
