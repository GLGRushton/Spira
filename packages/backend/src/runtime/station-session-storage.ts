import type { SpiraMemoryDatabase } from "@spira/memory-db";
import type { StationId } from "@spira/shared";

export type StationSessionArtifactKind = "plan" | "scratchpad" | "context";
const STATION_SESSION_ARTIFACT_KINDS: readonly StationSessionArtifactKind[] = ["plan", "scratchpad", "context"];

const normalizeStationId = (stationId: StationId | null | undefined): string | null => {
  const normalized = stationId?.trim();
  return normalized ? normalized : null;
};

const buildArtifactKey = (stationId: StationId, kind: StationSessionArtifactKind): string =>
  `station:${stationId}:artifact:${kind}`;

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;

export interface StationSessionStorage {
  get(kind: StationSessionArtifactKind): string | null;
  set(kind: StationSessionArtifactKind, value: string | null | undefined): string | null;
  buildContinuitySections(): string[];
}

export const createStationSessionStorage = (
  memoryDb: SpiraMemoryDatabase | null | undefined,
  stationId: StationId | null | undefined,
): StationSessionStorage | null => {
  const normalizedStationId = normalizeStationId(stationId);
  if (!memoryDb || !normalizedStationId) {
    return null;
  }

  return {
    get(kind) {
      return memoryDb.getSessionState(buildArtifactKey(normalizedStationId, kind));
    },
    set(kind, value) {
      const normalizedValue = value?.trim() ?? "";
      const key = buildArtifactKey(normalizedStationId, kind);
      if (!normalizedValue) {
        memoryDb.setSessionState(key, null);
        return null;
      }
      memoryDb.setSessionState(key, normalizedValue);
      return normalizedValue;
    },
    buildContinuitySections() {
      const plan = memoryDb.getSessionState(buildArtifactKey(normalizedStationId, "plan"));
      const scratchpad = memoryDb.getSessionState(buildArtifactKey(normalizedStationId, "scratchpad"));
      const context = memoryDb.getSessionState(buildArtifactKey(normalizedStationId, "context"));
      const sections: string[] = [];
      if (plan) {
        sections.push(`Active session plan:\n${truncate(plan, 1_800)}`);
      }
      if (scratchpad) {
        sections.push(`Session scratchpad:\n${truncate(scratchpad, 1_400)}`);
      }
      if (context) {
        sections.push(`Structured session context:\n${truncate(context, 1_400)}`);
      }
      return sections;
    },
  };
};

export const clearStationSessionArtifacts = (
  memoryDb: SpiraMemoryDatabase | null | undefined,
  stationId: StationId | null | undefined,
): void => {
  const normalizedStationId = normalizeStationId(stationId);
  if (!memoryDb || !normalizedStationId) {
    return;
  }

  for (const kind of STATION_SESSION_ARTIFACT_KINDS) {
    memoryDb.setSessionState(buildArtifactKey(normalizedStationId, kind), null);
  }
};
