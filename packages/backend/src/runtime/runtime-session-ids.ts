export const getStationRuntimeSessionId = (stationId: string): string => `station:${stationId}`;

export const getSubagentRuntimeSessionId = (runId: string): string => `subagent:${runId}`;
