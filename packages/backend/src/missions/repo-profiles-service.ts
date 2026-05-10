import type { RepoProfileRecord, SpiraMemoryDatabase } from "@spira/memory-db";
import type { MissionRepoProfileRecord, MissionRepoProfilesSnapshot, UpsertMissionRepoProfileInput } from "@spira/shared";

/**
 * Repo profiles admin service.
 *
 * Renderer-facing CRUD for the `repo_profiles` table. Mirrors the shape of
 * {@link import("./proof-rules-service").ProofRulesService} so the admin UI patterns stay
 * consistent. Source semantics:
 *
 *  - `builtin`: shipped via builtin seed (none today; Spira's own profile lands in Phase 7).
 *  - `user`:    captured via the admin pane / onboarding wizard.
 *  - `learned`: written by the Phase 5 learning loop (not yet active).
 *
 * The service deliberately does NOT auto-create profiles when an unknown projectKey appears
 * during a mission; the operator decides explicitly via the admin pane / onboarding.
 */

const mapProfile = (record: RepoProfileRecord): MissionRepoProfileRecord => ({
  projectKey: record.projectKey,
  displayName: record.displayName,
  description: record.description,
  defaultBranch: record.defaultBranch,
  defaultBuildWorkingDirectory: record.defaultBuildWorkingDirectory,
  defaultRegistry: record.defaultRegistry,
  registryHints: [...record.registryHints],
  requiredEnvVars: [...record.requiredEnvVars],
  requiredSdks: [...record.requiredSdks],
  userFacingCopyGlobs: [...record.userFacingCopyGlobs],
  uiTestGlobs: [...record.uiTestGlobs],
  notes: record.notes,
  source: record.source,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export class RepoProfilesService {
  constructor(private readonly memoryDb: SpiraMemoryDatabase) {}

  list(): MissionRepoProfilesSnapshot {
    return { profiles: this.memoryDb.listRepoProfiles({ limit: 500 }).map(mapProfile) };
  }

  get(projectKey: string): MissionRepoProfileRecord | null {
    const record = this.memoryDb.getRepoProfile(projectKey);
    return record ? mapProfile(record) : null;
  }

  upsert(input: UpsertMissionRepoProfileInput): MissionRepoProfilesSnapshot {
    // Default source to "user" — admin pane writes are operator-curated. Builtin / learned
    // sources can still be set explicitly by callers (e.g. the seeder, the Phase 5 learner).
    this.memoryDb.upsertRepoProfile({
      projectKey: input.projectKey,
      displayName: input.displayName,
      description: input.description ?? null,
      defaultBranch: input.defaultBranch ?? null,
      defaultBuildWorkingDirectory: input.defaultBuildWorkingDirectory ?? null,
      defaultRegistry: input.defaultRegistry ?? null,
      registryHints: input.registryHints ?? [],
      requiredEnvVars: input.requiredEnvVars ?? [],
      requiredSdks: input.requiredSdks ?? [],
      userFacingCopyGlobs: input.userFacingCopyGlobs ?? [],
      uiTestGlobs: input.uiTestGlobs ?? [],
      notes: input.notes ?? null,
      source: input.source ?? "user",
    });
    return this.list();
  }

  delete(projectKey: string): MissionRepoProfilesSnapshot {
    this.memoryDb.deleteRepoProfile(projectKey);
    return this.list();
  }
}
