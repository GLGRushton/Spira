import type { RepoIntelligenceRecord, SpiraMemoryDatabase } from "@spira/memory-db";
import type { Logger } from "pino";
import type { SpiraEventBus } from "../util/event-bus.js";
import { ConfigError } from "../util/errors.js";
import { buildRevokedTags } from "./learned-candidate-promoter.js";
import { TAG_PREFIXES, parseLearnedTagState } from "./learned-tag-state.js";

/**
 * Service for the admin-pane operations on learned intelligence candidates:
 * list (with status flags), revoke (mark approval=false + record blocked-evidence runs),
 * and archive (revoke + mark with `archived` tag).
 *
 * Held outside the mission run-lock because revocations are operator-initiated from a
 * settings surface and don't depend on any active mission.
 */

export interface LearnedCandidateSummary {
  id: string;
  projectKey: string | null;
  repoRelativePath: string | null;
  type: RepoIntelligenceRecord["type"];
  title: string;
  content: string;
  source: RepoIntelligenceRecord["source"];
  approved: boolean;
  /** True when the entry was previously revoked; auto-promotion will skip it. */
  revoked: boolean;
  /** True when the entry was archived (revoked with intent of "this is wrong"). */
  archived: boolean;
  /** Snapshot of the run ids whose evidence is currently on the blocklist. */
  revokedRunIds: string[];
  /** Snapshot of the run ids that contributed to the active promotion (if any). */
  promotedRunIds: string[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface LearnedCandidatesSnapshot {
  candidates: LearnedCandidateSummary[];
}

export interface RevokeLearnedCandidateInput {
  candidateId: string;
  /** Free-text operator reason; required so the audit trail explains why it was revoked. */
  reason: string;
  /** When true the entry is archived (kept revoked permanently and tagged "archived"). */
  archive?: boolean;
}

const summarize = (record: RepoIntelligenceRecord): LearnedCandidateSummary => {
  const state = parseLearnedTagState(record);
  return {
    id: record.id,
    projectKey: record.projectKey,
    repoRelativePath: record.repoRelativePath,
    type: record.type,
    title: record.title,
    content: record.content,
    source: record.source,
    approved: record.approved,
    revoked: state.revoked,
    archived: state.archived,
    revokedRunIds: state.revokedRunIds,
    promotedRunIds: state.promotedRunIds,
    tags: record.tags,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

export class LearnedCandidatesService {
  constructor(
    private readonly options: {
      memoryDb: SpiraMemoryDatabase | null;
      logger: Logger;
      bus?: SpiraEventBus;
      now?: () => number;
    },
  ) {}

  list(): LearnedCandidatesSnapshot {
    const memoryDb = this.requireMemoryDb();
    const records = memoryDb.listRepoIntelligence({
      includeUnapproved: true,
      source: "learned",
      limit: 1_000,
    });
    return {
      candidates: records
        .map((record) => summarize(record))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    };
  }

  revoke(input: RevokeLearnedCandidateInput): LearnedCandidatesSnapshot {
    const reason = input.reason.trim();
    if (reason.length === 0) {
      throw new ConfigError("Revoking a learned candidate requires a non-empty reason.");
    }
    const memoryDb = this.requireMemoryDb();
    const candidate = memoryDb.getRepoIntelligenceEntry(input.candidateId);
    if (!candidate || candidate.source !== "learned") {
      throw new ConfigError(`No learned candidate with id ${input.candidateId}.`);
    }

    const contributingRunIds = parseLearnedTagState(candidate).promotedRunIds;
    const tags = buildRevokedTags(candidate, contributingRunIds);
    const archived = input.archive === true;
    const finalTags = archived ? [...new Set([...tags, TAG_PREFIXES.archived])] : tags;

    memoryDb.upsertRepoIntelligence({
      id: candidate.id,
      projectKey: candidate.projectKey,
      repoRelativePath: candidate.repoRelativePath,
      type: candidate.type,
      title: candidate.title,
      content: candidate.content,
      tags: finalTags,
      source: candidate.source,
      approved: false,
      createdAt: candidate.createdAt,
    });

    // Append a system_event-shaped row to mission_events under a synthetic system run is
    // out of scope here — the snapshot return + listing is the audit surface, with the
    // tag history preserved on the entry itself for replay.
    this.options.logger.info(
      {
        candidateId: candidate.id,
        type: candidate.type,
        archived,
        blockedRunIds: contributingRunIds,
      },
      "Revoked learned intelligence candidate",
    );

    return this.list();
  }

  private requireMemoryDb(): SpiraMemoryDatabase {
    if (!this.options.memoryDb) {
      throw new ConfigError("Learned candidate service requires the memory db.");
    }
    return this.options.memoryDb;
  }
}
