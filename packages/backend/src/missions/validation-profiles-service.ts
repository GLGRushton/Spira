import { randomUUID } from "node:crypto";
import type { SpiraMemoryDatabase, ValidationProfileRecord } from "@spira/memory-db";
import type {
  MissionValidationProfileRecord,
  MissionValidationProfilesSnapshot,
  UpsertMissionValidationProfileInput,
} from "@spira/shared";
import { isBuiltinRecordId } from "./builtin-id.js";

/**
 * Phase 3.4 — validation profiles admin service.
 *
 * Same shape as ProofRulesService / RepoProfilesService. Builtin validation profiles
 * (id prefix `global-`) are read-only here; their definitions ship in BUILTIN_VALIDATION_PROFILES.
 */

const mapProfile = (record: ValidationProfileRecord): MissionValidationProfileRecord => ({
  id: record.id,
  projectKey: record.projectKey,
  repoRelativePath: record.repoRelativePath,
  label: record.label,
  kind: record.kind,
  command: record.command,
  workingDirectory: record.workingDirectory,
  notes: record.notes,
  confidence: record.confidence,
  expectedRuntimeMs: record.expectedRuntimeMs,
  lastObservedRuntimeMs: record.lastObservedRuntimeMs,
  prerequisites: [...record.prerequisites],
  source: record.source,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export class ValidationProfilesService {
  constructor(private readonly memoryDb: SpiraMemoryDatabase) {}

  list(): MissionValidationProfilesSnapshot {
    const profiles = this.memoryDb.listValidationProfiles({ limit: 1_000 });
    return { profiles: profiles.map(mapProfile) };
  }

  upsert(input: UpsertMissionValidationProfileInput): MissionValidationProfilesSnapshot {
    const trimmedId = input.id?.trim() ?? "";
    const id = trimmedId.length > 0 ? trimmedId : `user-${randomUUID()}`;
    if (isBuiltinRecordId(id)) {
      throw new Error(
        `Cannot upsert builtin validation profile "${id}". Builtin profiles ship with the application code.`,
      );
    }
    this.memoryDb.upsertValidationProfile({
      id,
      projectKey: input.projectKey ?? null,
      repoRelativePath: input.repoRelativePath ?? null,
      label: input.label,
      kind: input.kind,
      command: input.command,
      workingDirectory: input.workingDirectory,
      notes: input.notes ?? null,
      confidence: input.confidence ?? 0.7,
      expectedRuntimeMs: input.expectedRuntimeMs ?? null,
      prerequisites: input.prerequisites ?? [],
      source: "user",
    });
    return this.list();
  }

  delete(profileId: string): MissionValidationProfilesSnapshot {
    if (isBuiltinRecordId(profileId)) {
      throw new Error(
        `Cannot delete builtin validation profile "${profileId}". Remove it from BUILTIN_VALIDATION_PROFILES and reseed.`,
      );
    }
    this.memoryDb.deleteValidationProfile(profileId);
    return this.list();
  }
}
