import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  McpServerConfig,
  SubagentDomain,
  TicketRunSnapshot,
  TicketRunSummary,
  YouTrackStateMapping,
} from "@spira/shared";
import BetterSqlite3 from "better-sqlite3";

export * from "./database/types.js";
export type {
  AppendWorkSessionEventInput,
  WorkSessionEventRecord,
} from "./database/work-session-events.js";

import type { DatabasePersistenceContext } from "./database/context.js";
import { createConversationPersistence } from "./database/conversations.js";
import { applyMigrations, configureDatabase } from "./database/helpers.js";
import type { SqliteDatabase } from "./database/helpers.js";
import { createIntelligencePersistence } from "./database/intelligence.js";
import { createMemoryEntryPersistence } from "./database/memories.js";
import { createMissionPersistence } from "./database/missions.js";
import { createRuntimePersistence } from "./database/runtime.js";
import { createToolingPersistence } from "./database/tooling.js";
import {
  type AppendWorkSessionEventInput,
  type WorkSessionEventRecord,
  createWorkSessionEventsRepository,
} from "./database/work-session-events.js";
import type {
  AppendConversationMessageInput,
  AppendMissionEventInput,
  AppendProviderUsageRecordInput,
  AppendRuntimeLedgerEventInput,
  ConversationRecord,
  ConversationSearchResult,
  ConversationSummary,
  CreateConversationInput,
  McpServerConfigRecord,
  MemoryEntryCategory,
  MemoryEntryRecord,
  MissionEventRecord,
  OpenSpiraMemoryDatabaseOptions,
  PersistedProviderUsageRecord,
  PersistedRuntimeCheckpointRecord,
  PersistedRuntimeHostResourceRecord,
  PersistedRuntimeLedgerEventRecord,
  PersistedRuntimeSessionRecord,
  PersistedStationRecord,
  ProjectRepoMappingRecord,
  ProofDecisionRecord,
  ProofRuleRecord,
  RememberMemoryInput,
  RepoIntelligenceRecord,
  RepoProfileRecord,
  RuntimePermissionRequestRecord,
  RuntimePermissionRequestStatus,
  RuntimeRecoverySummary,
  RuntimeStationStateRecord,
  RuntimeSubagentRunRecord,
  SubagentConfigRecord,
  UpdateMemoryInput,
  UpsertMcpServerConfigInput,
  UpsertPersistedStationInput,
  UpsertProofDecisionInput,
  UpsertProofRuleInput,
  UpsertRepoIntelligenceInput,
  UpsertRepoProfileInput,
  UpsertRuntimeCheckpointInput,
  UpsertRuntimeHostResourceInput,
  UpsertRuntimePermissionRequestInput,
  UpsertRuntimeSessionInput,
  UpsertRuntimeStationStateInput,
  UpsertRuntimeSubagentRunInput,
  UpsertSubagentConfigInput,
  UpsertTicketRunInput,
  UpsertToolCallInput,
  UpsertValidationProfileInput,
  ValidationProfileRecord,
} from "./database/types.js";

export class SpiraMemoryDatabase {
  static open(databasePath: string, options: OpenSpiraMemoryDatabaseOptions = {}): SpiraMemoryDatabase {
    const readonly = options.readonly === true;
    if (!readonly) {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    const db = new BetterSqlite3(databasePath, readonly ? { readonly: true, fileMustExist: true } : undefined);
    configureDatabase(db, readonly);
    if (!readonly) {
      applyMigrations(db);
    }

    return new SpiraMemoryDatabase(db, databasePath, readonly);
  }

  private readonly conversations;
  private readonly runtime;
  private readonly intelligence;
  private readonly missions;
  private readonly tooling;
  private readonly memories;
  private readonly workSessionEvents;

  private constructor(
    private readonly db: SqliteDatabase,
    readonly databasePath: string,
    readonly isReadonly: boolean,
  ) {
    const context: DatabasePersistenceContext = {
      db: this.db,
      isReadonly: this.isReadonly,
    };
    this.conversations = createConversationPersistence(context);
    this.runtime = createRuntimePersistence(context);
    this.intelligence = createIntelligencePersistence(context);
    this.missions = createMissionPersistence(context);
    this.tooling = createToolingPersistence(context);
    this.memories = createMemoryEntryPersistence(context);
    this.workSessionEvents = createWorkSessionEventsRepository(context);
  }

  close(): void {
    this.db.close();
  }

  createConversation(input: CreateConversationInput = {}): string {
    return this.conversations.createConversation(input);
  }

  appendMessage(input: AppendConversationMessageInput): void {
    this.conversations.appendMessage(input);
  }

  upsertToolCall(input: UpsertToolCallInput): void {
    this.conversations.upsertToolCall(input);
  }

  listConversations(limit = 20, offset = 0): ConversationSummary[] {
    return this.conversations.listConversations(limit, offset);
  }

  getConversation(conversationId: string): ConversationRecord | null {
    return this.conversations.getConversation(conversationId);
  }

  getMostRecentConversation(): ConversationRecord | null {
    return this.conversations.getMostRecentConversation();
  }

  searchConversationMessages(query: string, limit = 10): ConversationSearchResult[] {
    return this.conversations.searchConversationMessages(query, limit);
  }

  markConversationViewed(conversationId: string, timestamp = Date.now()): boolean {
    return this.conversations.markConversationViewed(conversationId, timestamp);
  }

  archiveConversation(conversationId: string, timestamp = Date.now()): boolean {
    return this.conversations.archiveConversation(conversationId, timestamp);
  }

  getSessionState(key: string): string | null {
    return this.conversations.getSessionState(key);
  }

  setSessionState(key: string, value: string | null): void {
    this.conversations.setSessionState(key, value);
  }

  upsertPersistedStation(input: UpsertPersistedStationInput): PersistedStationRecord {
    return this.runtime.upsertPersistedStation(input);
  }

  listPersistedStations(): PersistedStationRecord[] {
    return this.runtime.listPersistedStations();
  }

  deletePersistedStation(stationId: string): boolean {
    return this.runtime.deletePersistedStation(stationId);
  }

  upsertRuntimeStationState(input: UpsertRuntimeStationStateInput): RuntimeStationStateRecord {
    return this.runtime.upsertRuntimeStationState(input);
  }

  getRuntimeStationState(stationId: string): RuntimeStationStateRecord | null {
    return this.runtime.getRuntimeStationState(stationId);
  }

  listRuntimeStationStates(): RuntimeStationStateRecord[] {
    return this.runtime.listRuntimeStationStates();
  }

  deleteRuntimeStationState(stationId: string): boolean {
    return this.runtime.deleteRuntimeStationState(stationId);
  }

  upsertRuntimeSession(input: UpsertRuntimeSessionInput): PersistedRuntimeSessionRecord {
    return this.runtime.upsertRuntimeSession(input);
  }

  getRuntimeSession(runtimeSessionId: string): PersistedRuntimeSessionRecord | null {
    return this.runtime.getRuntimeSession(runtimeSessionId);
  }

  listRuntimeSessions(stationId?: string | null): PersistedRuntimeSessionRecord[] {
    return this.runtime.listRuntimeSessions(stationId);
  }

  appendRuntimeLedgerEvent(input: AppendRuntimeLedgerEventInput): PersistedRuntimeLedgerEventRecord {
    return this.runtime.appendRuntimeLedgerEvent(input);
  }

  listRuntimeLedgerEvents(runtimeSessionId: string): PersistedRuntimeLedgerEventRecord[] {
    return this.runtime.listRuntimeLedgerEvents(runtimeSessionId);
  }

  upsertRuntimeCheckpoint(input: UpsertRuntimeCheckpointInput): PersistedRuntimeCheckpointRecord {
    return this.runtime.upsertRuntimeCheckpoint(input);
  }

  getRuntimeCheckpoint(checkpointId: string): PersistedRuntimeCheckpointRecord | null {
    return this.runtime.getRuntimeCheckpoint(checkpointId);
  }

  getLatestRuntimeCheckpoint(runtimeSessionId: string): PersistedRuntimeCheckpointRecord | null {
    return this.runtime.getLatestRuntimeCheckpoint(runtimeSessionId);
  }

  upsertRuntimeHostResource(input: UpsertRuntimeHostResourceInput): PersistedRuntimeHostResourceRecord {
    return this.runtime.upsertRuntimeHostResource(input);
  }

  getRuntimeHostResource(resourceId: string): PersistedRuntimeHostResourceRecord | null {
    return this.runtime.getRuntimeHostResource(resourceId);
  }

  deleteRuntimeHostResource(resourceId: string): boolean {
    return this.runtime.deleteRuntimeHostResource(resourceId);
  }

  listRuntimeHostResources(runtimeSessionId: string): PersistedRuntimeHostResourceRecord[] {
    return this.runtime.listRuntimeHostResources(runtimeSessionId);
  }

  upsertRuntimePermissionRequest(input: UpsertRuntimePermissionRequestInput): RuntimePermissionRequestRecord {
    return this.runtime.upsertRuntimePermissionRequest(input);
  }

  getRuntimePermissionRequest(requestId: string): RuntimePermissionRequestRecord | null {
    return this.runtime.getRuntimePermissionRequest(requestId);
  }

  listPendingRuntimePermissionRequests(stationId?: string | null): RuntimePermissionRequestRecord[] {
    return this.runtime.listPendingRuntimePermissionRequests(stationId);
  }

  resolveRuntimePermissionRequest(
    requestId: string,
    status: Exclude<RuntimePermissionRequestStatus, "pending">,
    resolvedAt = Date.now(),
  ): boolean {
    return this.runtime.resolveRuntimePermissionRequest(requestId, status, resolvedAt);
  }

  upsertRuntimeSubagentRun(input: UpsertRuntimeSubagentRunInput): RuntimeSubagentRunRecord {
    return this.runtime.upsertRuntimeSubagentRun(input);
  }

  getRuntimeSubagentRun(runId: string): RuntimeSubagentRunRecord | null {
    return this.runtime.getRuntimeSubagentRun(runId);
  }

  listRuntimeSubagentRuns(stationId?: string | null): RuntimeSubagentRunRecord[] {
    return this.runtime.listRuntimeSubagentRuns(stationId);
  }

  deleteRuntimeSubagentRun(runId: string): boolean {
    return this.runtime.deleteRuntimeSubagentRun(runId);
  }

  appendProviderUsageRecord(input: AppendProviderUsageRecordInput): PersistedProviderUsageRecord {
    return this.runtime.appendProviderUsageRecord(input);
  }

  listProviderUsageRecords(limit = 100): PersistedProviderUsageRecord[] {
    return this.runtime.listProviderUsageRecords(limit);
  }

  recoverInterruptedRuntimeState(now = Date.now()): RuntimeRecoverySummary {
    return this.runtime.recoverInterruptedRuntimeState(now);
  }

  getYouTrackStateMapping(): YouTrackStateMapping | null {
    return this.runtime.getYouTrackStateMapping();
  }

  setYouTrackStateMapping(mapping: YouTrackStateMapping): YouTrackStateMapping {
    return this.runtime.setYouTrackStateMapping(mapping);
  }

  getProjectWorkspaceRoot(): string | null {
    return this.runtime.getProjectWorkspaceRoot();
  }

  setProjectWorkspaceRoot(workspaceRoot: string | null): void {
    this.runtime.setProjectWorkspaceRoot(workspaceRoot);
  }

  listProjectRepoMappings(): ProjectRepoMappingRecord[] {
    return this.runtime.listProjectRepoMappings();
  }

  setProjectRepoMapping(projectKey: string, repoRelativePaths: readonly string[]): ProjectRepoMappingRecord {
    return this.runtime.setProjectRepoMapping(projectKey, repoRelativePaths);
  }

  listRepoIntelligence(
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      tags?: readonly string[];
      includeUnapproved?: boolean;
      source?: RepoIntelligenceRecord["source"];
      limit?: number;
    } = {},
  ): RepoIntelligenceRecord[] {
    return this.intelligence.listRepoIntelligence(options);
  }

  getRepoIntelligenceEntry(entryId: string): RepoIntelligenceRecord | null {
    return this.intelligence.getRepoIntelligenceEntry(entryId);
  }

  upsertRepoIntelligence(input: UpsertRepoIntelligenceInput): RepoIntelligenceRecord {
    return this.intelligence.upsertRepoIntelligence(input);
  }

  seedBuiltinRepoIntelligence(
    entries: readonly Omit<UpsertRepoIntelligenceInput, "source">[],
  ): RepoIntelligenceRecord[] {
    return this.intelligence.seedBuiltinRepoIntelligence(entries);
  }

  setRepoIntelligenceApproval(entryId: string, approved: boolean): RepoIntelligenceRecord {
    return this.intelligence.setRepoIntelligenceApproval(entryId, approved);
  }

  listValidationProfiles(
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      limit?: number;
    } = {},
  ): ValidationProfileRecord[] {
    return this.intelligence.listValidationProfiles(options);
  }

  getValidationProfile(profileId: string): ValidationProfileRecord | null {
    return this.intelligence.getValidationProfile(profileId);
  }

  upsertValidationProfile(input: UpsertValidationProfileInput): ValidationProfileRecord {
    return this.intelligence.upsertValidationProfile(input);
  }

  seedBuiltinValidationProfiles(
    entries: readonly Omit<UpsertValidationProfileInput, "source">[],
  ): ValidationProfileRecord[] {
    return this.intelligence.seedBuiltinValidationProfiles(entries);
  }

  deleteValidationProfile(profileId: string): boolean {
    return this.intelligence.deleteValidationProfile(profileId);
  }

  recordValidationProfileObservedRuntime(profileId: string, runtimeMs: number): boolean {
    return this.intelligence.recordValidationProfileObservedRuntime(profileId, runtimeMs);
  }

  listProofRules(
    options: {
      projectKey?: string | null;
      repoRelativePaths?: readonly string[];
      limit?: number;
    } = {},
  ): ProofRuleRecord[] {
    return this.intelligence.listProofRules(options);
  }

  getProofRule(ruleId: string): ProofRuleRecord | null {
    return this.intelligence.getProofRule(ruleId);
  }

  upsertProofRule(input: UpsertProofRuleInput): ProofRuleRecord {
    return this.intelligence.upsertProofRule(input);
  }

  seedBuiltinProofRules(entries: readonly Omit<UpsertProofRuleInput, "createdAt">[]): ProofRuleRecord[] {
    return this.intelligence.seedBuiltinProofRules(entries);
  }

  deleteProofRule(ruleId: string): boolean {
    return this.intelligence.deleteProofRule(ruleId);
  }

  getProofDecision(runId: string): ProofDecisionRecord | null {
    return this.intelligence.getProofDecision(runId);
  }

  upsertProofDecision(input: UpsertProofDecisionInput): ProofDecisionRecord {
    return this.intelligence.upsertProofDecision(input);
  }

  // repo profiles CRUD.
  getRepoProfile(projectKey: string, repoRelativePath: string = ""): RepoProfileRecord | null {
    return this.intelligence.getRepoProfile(projectKey, repoRelativePath);
  }

  listRepoProfiles(options: { limit?: number; projectKey?: string } = {}): RepoProfileRecord[] {
    return this.intelligence.listRepoProfiles(options);
  }

  upsertRepoProfile(input: UpsertRepoProfileInput): RepoProfileRecord {
    return this.intelligence.upsertRepoProfile(input);
  }

  deleteRepoProfile(projectKey: string, repoRelativePath: string = ""): boolean {
    return this.intelligence.deleteRepoProfile(projectKey, repoRelativePath);
  }

  seedBuiltinRepoProfiles(
    profiles: readonly Omit<UpsertRepoProfileInput, "source">[],
  ): RepoProfileRecord[] {
    return this.intelligence.seedBuiltinRepoProfiles(profiles);
  }

  appendMissionEvent(input: AppendMissionEventInput): MissionEventRecord {
    return this.missions.appendMissionEvent(input);
  }

  listMissionEvents(
    runId: string,
    optionsOrLimit: number | { beforeId?: number | null; limit?: number } = 50,
  ): MissionEventRecord[] {
    return this.missions.listMissionEvents(runId, optionsOrLimit);
  }

  listMissionEventsByProjectKey(input: {
    projectKey: string;
    runStatus: string;
    eventTypes: readonly string[];
    perRunLimit?: number;
  }): MissionEventRecord[] {
    return this.missions.listMissionEventsByProjectKey(input);
  }

  /** Cross-project event lookup filtered only by event_type. Used by the audit feed. */
  listMissionEventsByEventType(input: {
    eventTypes: readonly string[];
    limit?: number;
  }): MissionEventRecord[] {
    return this.missions.listMissionEventsByEventType(input);
  }

  /** Window-scoped cross-mission events for the weekly digest. Single SQL replaces N+1. */
  listMissionEventsForRunWindow(input: {
    runStatus: string;
    windowStartMs: number;
    windowEndMs: number;
    perRunLimit?: number;
  }): MissionEventRecord[] {
    return this.missions.listMissionEventsForRunWindow(input);
  }

  /** For a repo_intelligence_entries id, return every mission whose prompt referenced it. */
  listRepoIntelligenceUsage(entryId: string): Array<{
    runId: string;
    ticketId: string;
    occurredAt: number;
  }> {
    return this.missions.listRepoIntelligenceUsage(entryId);
  }

  /**
   * Delete mission_events with occurred_at < cutoffMs. Returns rows removed.
   * Wire to a daily job in the backend; the DB module never deletes on its own.
   */
  deleteMissionEventsOlderThan(cutoffMs: number): number {
    return this.missions.deleteMissionEventsOlderThan(cutoffMs);
  }

  deleteWorkSessionEventsOlderThan(cutoffMs: number): number {
    return this.workSessionEvents.deleteWorkSessionEventsOlderThan(cutoffMs);
  }

  appendWorkSessionEvent(input: AppendWorkSessionEventInput): WorkSessionEventRecord {
    return this.workSessionEvents.appendWorkSessionEvent(input);
  }

  appendWorkSessionEvents(inputs: readonly AppendWorkSessionEventInput[]): WorkSessionEventRecord[] {
    return this.workSessionEvents.appendWorkSessionEvents(inputs);
  }

  listWorkSessionEvents(
    sessionId: string,
    options: { beforeId?: number | null; limit?: number } = {},
  ): WorkSessionEventRecord[] {
    return this.workSessionEvents.listWorkSessionEvents(sessionId, options);
  }

  listWorkSessionEventsByStation(
    stationId: string,
    options: { limit?: number } = {},
  ): WorkSessionEventRecord[] {
    return this.workSessionEvents.listWorkSessionEventsByStation(stationId, options);
  }

  listTicketRuns(): TicketRunSummary[] {
    return this.missions.listTicketRuns();
  }

  getTicketRun(runId: string): TicketRunSummary | null {
    return this.missions.getTicketRun(runId);
  }

  getTicketRunByTicketId(ticketId: string): TicketRunSummary | null {
    return this.missions.getTicketRunByTicketId(ticketId);
  }

  deleteTicketRun(runId: string): boolean {
    return this.missions.deleteTicketRun(runId);
  }

  upsertTicketRun(input: UpsertTicketRunInput): TicketRunSummary {
    return this.missions.upsertTicketRun(input);
  }

  getTicketRunSnapshot(): TicketRunSnapshot {
    return this.missions.getTicketRunSnapshot();
  }

  listMcpServerConfigs(): McpServerConfigRecord[] {
    return this.tooling.listMcpServerConfigs();
  }

  getMcpServerConfig(serverId: string): McpServerConfigRecord | null {
    return this.tooling.getMcpServerConfig(serverId);
  }

  upsertMcpServerConfig(input: UpsertMcpServerConfigInput): McpServerConfigRecord {
    return this.tooling.upsertMcpServerConfig(input);
  }

  seedBuiltinMcpServerConfigs(configs: readonly McpServerConfig[]): McpServerConfigRecord[] {
    return this.tooling.seedBuiltinMcpServerConfigs(configs);
  }

  removeMcpServerConfig(serverId: string): boolean {
    return this.tooling.removeMcpServerConfig(serverId);
  }

  setMcpServerEnabled(serverId: string, enabled: boolean): boolean {
    return this.tooling.setMcpServerEnabled(serverId, enabled);
  }

  listSubagentConfigs(): SubagentConfigRecord[] {
    return this.tooling.listSubagentConfigs();
  }

  getSubagentConfig(agentId: string): SubagentConfigRecord | null {
    return this.tooling.getSubagentConfig(agentId);
  }

  upsertSubagentConfig(input: UpsertSubagentConfigInput): SubagentConfigRecord {
    return this.tooling.upsertSubagentConfig(input);
  }

  seedBuiltinSubagentConfigs(configs: readonly SubagentDomain[]): SubagentConfigRecord[] {
    return this.tooling.seedBuiltinSubagentConfigs(configs);
  }

  removeSubagentConfig(agentId: string): boolean {
    return this.tooling.removeSubagentConfig(agentId);
  }

  setSubagentReady(agentId: string, ready: boolean): boolean {
    return this.tooling.setSubagentReady(agentId, ready);
  }

  remember(input: RememberMemoryInput): MemoryEntryRecord {
    return this.memories.remember(input);
  }

  getMemoryEntry(memoryId: string): MemoryEntryRecord | null {
    return this.memories.getMemoryEntry(memoryId);
  }

  updateMemory(input: UpdateMemoryInput): MemoryEntryRecord {
    return this.memories.updateMemory(input);
  }

  archiveMemory(memoryId: string): boolean {
    return this.memories.archiveMemory(memoryId);
  }

  listMemoryEntries(limit = 20, category?: MemoryEntryCategory): MemoryEntryRecord[] {
    return this.memories.listMemoryEntries(limit, category);
  }

  searchMemoryEntries(query: string, limit = 10, category?: MemoryEntryCategory): MemoryEntryRecord[] {
    return this.memories.searchMemoryEntries(query, limit, category);
  }
}
