import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type { StationId, WorkSessionSnapshot } from "@spira/shared";

const WORK_SESSION_STATE_KEY = "work-session";
const getStationSessionKey = (stationId: StationId, key: string): string => `station:${stationId}:${key}`;

export interface WorkSessionStorage {
  load(): WorkSessionSnapshot | null;
  save(snapshot: WorkSessionSnapshot): void;
  clear(): void;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const tryParseJson = (value: string | null): unknown => {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const isWorkSessionSnapshot = (value: unknown): value is WorkSessionSnapshot => {
  if (!isObject(value)) {
    return false;
  }
  return (
    typeof value.sessionId === "string" &&
    typeof value.stationId === "string" &&
    typeof value.taskText === "string" &&
    typeof value.currentPhase === "string" &&
    Array.isArray(value.phaseHistory) &&
    isObject(value.classification) &&
    Array.isArray(value.searchTerms) &&
    Array.isArray(value.candidateFiles) &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number"
  );
};

export const createWorkSessionStorage = (
  memoryDb: SpiraMemoryDatabase | null | undefined,
  stationId: StationId | null | undefined,
): WorkSessionStorage => {
  const key = stationId ? getStationSessionKey(stationId, WORK_SESSION_STATE_KEY) : null;

  return {
    load() {
      if (!memoryDb || !key) {
        return null;
      }
      const stored = tryParseJson(memoryDb.getSessionState(key));
      return isWorkSessionSnapshot(stored) ? stored : null;
    },
    save(snapshot) {
      if (!memoryDb || !key) {
        return;
      }
      memoryDb.setSessionState(key, JSON.stringify(snapshot));
    },
    clear() {
      if (!memoryDb || !key) {
        return;
      }
      memoryDb.setSessionState(key, null);
    },
  };
};
