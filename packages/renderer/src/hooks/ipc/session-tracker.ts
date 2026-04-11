export interface IpcSessionTracker {
  activeAssistantMessageId: string | null;
  lastAutoSpokenMessageId: string | null;
  toolCallMessageIds: Map<string, string>;
}

export type IpcStationTrackerMap = Map<string, IpcSessionTracker>;

export const createIpcSessionTracker = (): IpcSessionTracker => ({
  activeAssistantMessageId: null,
  lastAutoSpokenMessageId: null,
  toolCallMessageIds: new Map<string, string>(),
});

export const getIpcStationTracker = (trackers: IpcStationTrackerMap, stationId: string): IpcSessionTracker => {
  const existing = trackers.get(stationId);
  if (existing) {
    return existing;
  }

  const created = createIpcSessionTracker();
  trackers.set(stationId, created);
  return created;
};
