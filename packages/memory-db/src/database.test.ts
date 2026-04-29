import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SpiraMemoryDatabase } from "./database.js";
import { getSpiraMemoryDbPath } from "./path.js";

const tempDirs: string[] = [];
const openDatabases: SpiraMemoryDatabase[] = [];

const createTestDatabase = (): SpiraMemoryDatabase => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "spira-memory-db-"));
  tempDirs.push(tempDir);
  const database = SpiraMemoryDatabase.open(getSpiraMemoryDbPath(tempDir));
  openDatabases.push(database);
  return database;
};

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    database?.close();
  }

  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (!directory) {
      continue;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SpiraMemoryDatabase", () => {
  it("persists conversations and searches message content", () => {
    const database = createTestDatabase();
    const conversationId = database.createConversation({ title: "Database plan" });
    database.appendMessage({
      id: "user-1",
      conversationId,
      role: "user",
      content: "Please design searchable conversation memory for Spira.",
      timestamp: 1_000,
    });
    database.appendMessage({
      id: "assistant-1",
      conversationId,
      role: "assistant",
      content: "SQLite with FTS5 is a strong fit for searchable conversations.",
      timestamp: 2_000,
      autoSpeak: true,
    });
    database.upsertToolCall({
      messageId: "assistant-1",
      callId: "call-1",
      name: "spira_memory_search_conversations",
      args: { query: "searchable" },
      result: { hits: 2 },
      status: "success",
      details: "Found two matches.",
    });

    const searchResults = database.searchConversationMessages("searchable", 5);
    const conversation = database.getConversation(conversationId);
    const recentConversation = database.getMostRecentConversation();

    expect(searchResults).toHaveLength(2);
    expect(searchResults[0]?.conversationId).toBe(conversationId);
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[1]?.autoSpeak).toBe(true);
    expect(conversation?.messages[1]?.toolCalls).toMatchObject([
      {
        callId: "call-1",
        name: "spira_memory_search_conversations",
        args: { query: "searchable" },
        result: { hits: 2 },
        status: "success",
      },
    ]);
    expect(recentConversation?.id).toBe(conversationId);
    expect(recentConversation?.lastViewedAt).toBe(2_000);
  });

  it("summarizes the first user-message title when the conversation already exists", () => {
    const database = createTestDatabase();
    const conversationId = database.createConversation({ createdAt: 1_000 });
    const firstMessage = "Can you help me untangle chat retention for Spira?";

    database.appendMessage({
      id: "user-1",
      conversationId,
      role: "user",
      content: firstMessage,
      timestamp: 1_000,
    });

    const conversation = database.getConversation(conversationId);
    expect(conversation?.title).toBe("Help Me Untangle");
  });

  it("stores and searches explicit memory entries", () => {
    const database = createTestDatabase();
    const saved = database.remember({
      category: "fact",
      content: "Shinra should not get raw SQL access to the Spira database.",
    });
    const updated = database.updateMemory({
      memoryId: saved.id,
      content: "Shinra should use guarded memory tools rather than raw SQL access.",
    });

    const entries = database.searchMemoryEntries("guarded memory tools", 5);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(saved.id);
    expect(entries[0]?.category).toBe("fact");
    expect(updated.content).toContain("guarded memory tools");

    expect(database.archiveMemory(saved.id)).toBe(true);
    expect(database.getMemoryEntry(saved.id)).toBeNull();
  });

  it("tracks the most recently viewed conversation and archives old ones", () => {
    const database = createTestDatabase();
    const firstConversationId = database.createConversation({ title: "First", createdAt: 1_000 });
    const secondConversationId = database.createConversation({ title: "Second", createdAt: 2_000 });

    database.markConversationViewed(firstConversationId, 3_000);
    database.markConversationViewed(secondConversationId, 4_000);

    expect(database.getMostRecentConversation()?.id).toBe(secondConversationId);

    expect(database.archiveConversation(secondConversationId, 5_000)).toBe(true);
    expect(database.getMostRecentConversation()?.id).toBe(firstConversationId);
  });

  it("uses the same recency ordering for startup hydration and archive listings", () => {
    const database = createTestDatabase();
    const olderViewedConversationId = database.createConversation({ title: "Viewed", createdAt: 1_000 });
    const newerMessageConversationId = database.createConversation({ title: "Recent message", createdAt: 2_000 });

    database.markConversationViewed(olderViewedConversationId, 3_000);
    database.appendMessage({
      id: "message-1",
      conversationId: newerMessageConversationId,
      role: "user",
      content: "Latest activity",
      timestamp: 4_000,
    });

    expect(database.listConversations()[0]?.id).toBe(newerMessageConversationId);
    expect(database.getMostRecentConversation()?.id).toBe(newerMessageConversationId);
  });

  it("persists and clears session state values", () => {
    const database = createTestDatabase();

    expect(database.getSessionState("copilot-session-id")).toBeNull();

    database.setSessionState("copilot-session-id", "session-123");
    expect(database.getSessionState("copilot-session-id")).toBe("session-123");

    database.setSessionState("copilot-session-id", "session-456");
    expect(database.getSessionState("copilot-session-id")).toBe("session-456");

    database.setSessionState("copilot-session-id", null);
    expect(database.getSessionState("copilot-session-id")).toBeNull();
  });

  it("persists explicit station records and falls back to live legacy session keys", () => {
    const database = createTestDatabase();

    database.upsertPersistedStation({
      stationId: "bravo",
      label: "Bravo",
      createdAt: 100,
    });
    database.setSessionState("station:charlie:copilot-session-id", "session-charlie");
    database.setSessionState("station:delta:copilot-session-id", null);

    expect(database.listPersistedStations()).toMatchObject([
      {
        stationId: "charlie",
        label: "Station charlie",
      },
      {
        stationId: "bravo",
        label: "Bravo",
        createdAt: 100,
      },
    ]);

    expect(database.deletePersistedStation("bravo")).toBe(true);
    expect(database.listPersistedStations()).toMatchObject([
      {
        stationId: "charlie",
        label: "Station charlie",
      },
    ]);
  });

  it("persists runtime permission requests and fails them closed during recovery", () => {
    const database = createTestDatabase();

    database.upsertRuntimePermissionRequest({
      requestId: "perm-1",
      stationId: "primary",
      createdAt: 1_000,
      payload: {
        requestId: "perm-1",
        stationId: "primary",
        kind: "mcp",
        serverName: "Spira Vision",
        toolName: "vision_read_screen",
        toolTitle: "Read screen",
        readOnly: true,
      },
    });

    expect(database.listPendingRuntimePermissionRequests("primary")).toMatchObject([
      {
        requestId: "perm-1",
        stationId: "primary",
        status: "pending",
      },
    ]);

    expect(database.resolveRuntimePermissionRequest("perm-1", "approved", 1_500)).toBe(true);
    expect(database.listPendingRuntimePermissionRequests("primary")).toEqual([]);

    database.upsertRuntimePermissionRequest({
      requestId: "perm-2",
      stationId: "primary",
      createdAt: 2_000,
      payload: {
        requestId: "perm-2",
        stationId: "primary",
        kind: "custom-tool",
        serverName: "Spira mission runtime",
        toolName: "spira_run_mission_proof",
        toolTitle: "Run mission proof",
        readOnly: false,
      },
    });

    const recovery = database.recoverInterruptedRuntimeState(3_000);
    expect(recovery.expiredPermissionRequestIds).toEqual(["perm-2"]);
    expect(database.getRuntimePermissionRequest("perm-2")).toMatchObject({
      requestId: "perm-2",
      status: "expired",
      resolvedAt: 3_000,
    });
  });

  it("persists runtime station state and recovers interrupted turns", () => {
    const database = createTestDatabase();

    database.upsertRuntimeStationState({
      stationId: "primary",
      state: "thinking",
      promptInFlight: true,
      activeSessionId: "session-1",
      activeToolCalls: [
        {
          callId: "tool-1",
          toolName: "vision_read_screen",
          args: { target: "screen" },
          startedAt: 1_100,
        },
      ],
      abortRequestedAt: 1_200,
      createdAt: 1_000,
      updatedAt: 1_200,
    });

    expect(database.getRuntimeStationState("primary")).toMatchObject({
      stationId: "primary",
      state: "thinking",
      promptInFlight: true,
      activeToolCalls: [
        {
          callId: "tool-1",
          toolName: "vision_read_screen",
        },
      ],
      abortRequestedAt: 1_200,
    });

    const recovery = database.recoverInterruptedRuntimeState(2_000);

    expect(recovery.recoveredStationIds).toEqual(["primary"]);
    expect(database.getRuntimeStationState("primary")).toMatchObject({
      stationId: "primary",
      state: "error",
      promptInFlight: false,
      activeSessionId: null,
      activeToolCalls: [],
      abortRequestedAt: null,
      recoveryMessage: "The previous response was interrupted while cancellation was in progress.",
      updatedAt: 2_000,
    });
    expect(database.getSessionState("copilot-session-id")).toBeNull();
  });

  it("persists runtime subagent runs, usage records, and recovers interrupted runs", () => {
    const database = createTestDatabase();

    database.upsertRuntimeSubagentRun({
      runId: "run-1",
      stationId: "primary",
      snapshot: {
        agent_id: "run-1",
        runId: "run-1",
        roomId: "agent:subagent-run-1",
        domain: "spira",
        task: "Inspect bridge",
        status: "running",
        startedAt: 1_000,
        updatedAt: 1_000,
        envelope: {
          runId: "run-1",
          domain: "spira",
          task: "Inspect bridge",
          status: "completed",
          retryCount: 0,
          startedAt: 1_000,
          completedAt: 1_000,
          durationMs: 0,
          followupNeeded: false,
          summary: "Old idle result",
          artifacts: [],
          stateChanges: [],
          toolCalls: [],
          errors: [],
          payload: null,
        },
      },
      createdAt: 1_000,
    });

    database.appendProviderUsageRecord({
      provider: "copilot",
      stationId: "primary",
      runId: "run-1",
      sessionId: "session-1",
      model: "gpt-5.4",
      inputTokens: 12,
      outputTokens: 4,
      totalTokens: 16,
      observedAt: 1_500,
      source: "provider",
    });

    expect(database.listRuntimeSubagentRuns("primary")).toMatchObject([
      {
        runId: "run-1",
        stationId: "primary",
        snapshot: {
          status: "running",
        },
      },
    ]);
    expect(database.listProviderUsageRecords()).toMatchObject([
      {
        provider: "copilot",
        stationId: "primary",
        runId: "run-1",
        sessionId: "session-1",
        totalTokens: 16,
      },
    ]);

    const recovery = database.recoverInterruptedRuntimeState(2_500);
    expect(recovery.recoveredSubagentRunIds).toEqual(["run-1"]);
    expect(database.getRuntimeSubagentRun("run-1")).toMatchObject({
      runId: "run-1",
      snapshot: {
        status: "failed",
        completedAt: 2_500,
        summary: "Delegated subagent run ended when the backend restarted.",
      },
    });
    expect(database.getRuntimeSubagentRun("run-1")?.snapshot.envelope).toBeUndefined();

    expect(database.deleteRuntimeSubagentRun("run-1")).toBe(true);
    expect(database.getRuntimeSubagentRun("run-1")).toBeNull();
  });

  it("preserves resumable idle subagent runs across recovery", () => {
    const database = createTestDatabase();

    database.upsertRuntimeSubagentRun({
      runId: "run-2",
      stationId: "primary",
      snapshot: {
        agent_id: "run-2",
        runId: "run-2",
        roomId: "agent:subagent-run-2",
        domain: "spira",
        task: "Recovered task",
        status: "idle",
        allowWrites: true,
        providerSessionId: "provider-session-2",
        activeToolCalls: [],
        toolCalls: [],
        startedAt: 1_000,
        updatedAt: 1_200,
        completedAt: 1_200,
        expiresAt: 5_000,
        summary: "Recovered turn finished.",
      },
      createdAt: 1_000,
    });

    const recovery = database.recoverInterruptedRuntimeState(2_500);

    expect(recovery.recoveredSubagentRunIds).toEqual([]);
    expect(database.getRuntimeSubagentRun("run-2")).toMatchObject({
      runId: "run-2",
      snapshot: {
        status: "idle",
        providerSessionId: "provider-session-2",
        summary: "Recovered turn finished.",
      },
    });
  });

  it("stores seeded MCP server configs and preserves built-in enabled overrides", () => {
    const database = createTestDatabase();

    database.seedBuiltinMcpServerConfigs([
      {
        id: "windows-system",
        name: "Windows System",
        description: "Host control",
        transport: "stdio",
        command: "node",
        args: ["packages/mcp-windows/dist/index.js"],
        env: {},
        enabled: true,
        autoRestart: true,
        maxRestarts: 3,
      },
    ]);
    database.setMcpServerEnabled("windows-system", false);
    database.seedBuiltinMcpServerConfigs([
      {
        id: "windows-system",
        name: "Windows System",
        description: "Updated description",
        transport: "stdio",
        command: "node",
        args: ["packages/mcp-windows/dist/index.js"],
        env: {},
        enabled: true,
        autoRestart: true,
        maxRestarts: 3,
      },
    ]);
    database.upsertMcpServerConfig({
      id: "youtrack",
      name: "YouTrack",
      description: "Custom tracker",
      source: "user",
      transport: "streamable-http",
      url: "https://example.youtrack.cloud/mcp",
      headers: { Authorization: "Bearer secret" },
      toolAccess: { readOnlyToolNames: ["find_projects"], writeToolNames: ["create_issue"] },
      enabled: true,
      autoRestart: true,
      maxRestarts: 5,
    });

    expect(database.listMcpServerConfigs()).toMatchObject([
      {
        id: "windows-system",
        source: "builtin",
        enabled: false,
        description: "Updated description",
      },
      {
        id: "youtrack",
        source: "user",
        name: "YouTrack",
        transport: "streamable-http",
        url: "https://example.youtrack.cloud/mcp",
        headers: { Authorization: "Bearer secret" },
        toolAccess: { readOnlyToolNames: ["find_projects"], writeToolNames: ["create_issue"] },
      },
    ]);
  });

  it("round-trips remote MCP server configs without requiring stdio fields", () => {
    const database = createTestDatabase();

    database.upsertMcpServerConfig({
      id: "youtrack",
      name: "YouTrack",
      description: "Remote tracker",
      source: "user",
      transport: "streamable-http",
      url: "https://example.youtrack.cloud/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: true,
      autoRestart: false,
      maxRestarts: 3,
    });

    expect(database.getMcpServerConfig("youtrack")).toMatchObject({
      id: "youtrack",
      transport: "streamable-http",
      url: "https://example.youtrack.cloud/mcp",
      headers: { Authorization: "Bearer secret" },
      enabled: true,
      autoRestart: false,
    });
  });

  it("stores custom subagent configs and preserves built-in ready overrides", () => {
    const database = createTestDatabase();

    database.seedBuiltinSubagentConfigs([
      {
        id: "windows",
        label: "Windows Agent",
        description: "Windows control",
        source: "builtin",
        serverIds: ["windows-system"],
        allowedToolNames: null,
        delegationToolName: "delegate_to_windows",
        allowWrites: true,
        systemPrompt: "",
        ready: true,
      },
    ]);
    database.setSubagentReady("windows", false);
    database.seedBuiltinSubagentConfigs([
      {
        id: "windows",
        label: "Windows Agent",
        description: "Updated description",
        source: "builtin",
        serverIds: ["windows-system", "vision"],
        allowedToolNames: null,
        delegationToolName: "delegate_to_windows",
        allowWrites: true,
        systemPrompt: "",
        ready: true,
      },
    ]);
    database.upsertSubagentConfig({
      id: "youtrack-ops",
      label: "YouTrack Ops",
      description: "Ticket triage",
      source: "user",
      serverIds: ["youtrack"],
      allowedToolNames: ["youtrack_list_issues"],
      delegationToolName: "delegate_to_youtrack_ops",
      allowWrites: false,
      systemPrompt: "Focus on ticket summarisation.",
      ready: true,
    });

    expect(database.listSubagentConfigs()).toMatchObject([
      {
        id: "windows",
        source: "builtin",
        ready: false,
        description: "Updated description",
        serverIds: ["windows-system", "vision"],
      },
      {
        id: "youtrack-ops",
        source: "user",
        allowedToolNames: ["youtrack_list_issues"],
      },
    ]);
  });

  it("stores the workspace root and replaces project repo mappings", () => {
    const database = createTestDatabase();

    expect(database.getProjectWorkspaceRoot()).toBeNull();

    database.setProjectWorkspaceRoot("C:\\Repos");
    expect(database.getProjectWorkspaceRoot()).toBe("C:\\Repos");

    database.setProjectRepoMapping("SPI", ["client-app", "shared\\sdk"]);
    database.setProjectRepoMapping("OPS", ["ops-tools"]);
    database.setProjectRepoMapping("SPI", ["shared\\sdk", "service-api"]);

    expect(database.listProjectRepoMappings()).toMatchObject([
      {
        projectKey: "OPS",
        repoRelativePaths: ["ops-tools"],
      },
      {
        projectKey: "SPI",
        repoRelativePaths: ["service-api", "shared\\sdk"],
      },
    ]);

    database.setProjectRepoMapping("SPI", []);

    expect(database.listProjectRepoMappings()).toMatchObject([
      {
        projectKey: "OPS",
        repoRelativePaths: ["ops-tools"],
      },
    ]);
  });

  it("stores and normalizes the YouTrack workflow state mapping", () => {
    const database = createTestDatabase();

    expect(database.getYouTrackStateMapping()).toBeNull();

    expect(
      database.setYouTrackStateMapping({
        todo: [" Submitted ", "submitted", "Open"],
        inProgress: ["In Progress", "Review", "review"],
      }),
    ).toEqual({
      todo: ["Submitted", "Open"],
      inProgress: ["In Progress", "Review"],
    });

    expect(database.getYouTrackStateMapping()).toEqual({
      todo: ["Submitted", "Open"],
      inProgress: ["In Progress", "Review"],
    });
  });

  it("persists ticket runs with worktree details", () => {
    const database = createTestDatabase();

    const saved = database.upsertTicketRun({
      runId: "run-1",
      stationId: "mission:run-1",
      ticketId: "SPI-101",
      ticketSummary: "Start Missions pickup",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-101",
      projectKey: "SPI",
      status: "ready",
      statusMessage: "Worktree ready.",
      createdAt: 1_000,
      startedAt: 1_000,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-101-service-api",
          branchName: "feat/spi-101-start-missions-pickup",
          commitMessageDraft: "feat(SPI-101): start missions pickup",
          cleanupState: "retained",
          createdAt: 1_000,
          updatedAt: 1_100,
        },
      ],
      submodules: [
        {
          canonicalUrl: "github.com/uk-parliament/legapp_legapp-common",
          name: "LegAppCommon",
          branchName: "feat/spi-101-start-missions-pickup",
          commitMessageDraft: "feat(SPI-101): update legapp common",
          parentRefs: [
            {
              parentRepoRelativePath: "service-api",
              submodulePath: "Submodules/LegAppCommon",
              submoduleWorktreePath: "C:\\Repos\\.spira-worktrees\\spi-101-service-api\\Submodules\\LegAppCommon",
            },
          ],
          createdAt: 1_000,
          updatedAt: 1_150,
        },
      ],
      attempts: [
        {
          attemptId: "attempt-1",
          subagentRunId: "subagent-1",
          sequence: 1,
          status: "completed",
          summary: "Ready for review.",
          followupNeeded: true,
          startedAt: 1_000,
          createdAt: 1_000,
          updatedAt: 1_200,
          completedAt: 1_200,
        },
      ],
    });

    expect(saved.worktrees).toHaveLength(1);
    expect(saved.attempts).toHaveLength(1);
    expect(database.getTicketRun("run-1")).toMatchObject({
      stationId: "mission:run-1",
      ticketId: "SPI-101",
      status: "ready",
      submodules: [
        {
          canonicalUrl: "github.com/uk-parliament/legapp_legapp-common",
          name: "LegAppCommon",
          branchName: "feat/spi-101-start-missions-pickup",
          commitMessageDraft: "feat(SPI-101): update legapp common",
          parentRefs: [
            {
              parentRepoRelativePath: "service-api",
              submodulePath: "Submodules/LegAppCommon",
            },
          ],
        },
      ],
      attempts: [
        {
          status: "completed",
          summary: "Ready for review.",
        },
      ],
      worktrees: [
        {
          repoRelativePath: "service-api",
          branchName: "feat/spi-101-start-missions-pickup",
          commitMessageDraft: "feat(SPI-101): start missions pickup",
        },
      ],
    });
    expect(database.getTicketRunByTicketId("SPI-101")?.runId).toBe("run-1");
    expect(database.getTicketRunSnapshot().runs).toHaveLength(1);
  });

  it("round-trips mission proof summaries and proof run artifacts", () => {
    const database = createTestDatabase();

    database.upsertTicketRun({
      runId: "run-proof",
      ticketId: "SPI-150",
      ticketSummary: "Prove UI completion",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-150",
      projectKey: "SPI",
      status: "awaiting-review",
      createdAt: 1_000,
      startedAt: 1_000,
      worktrees: [],
      proof: {
        status: "passed",
        lastProofRunId: "proof-1",
        lastProofProfileId: "builtin:legapp-admin-ui-proof:run-proof:web-app",
        lastProofAt: 1_500,
        lastProofSummary: "UI proof passed.",
        staleReason: null,
      },
      proofRuns: [
        {
          proofRunId: "proof-1",
          profileId: "builtin:legapp-admin-ui-proof:run-proof:web-app",
          profileLabel: "LegApp Admin UI proof",
          status: "passed",
          summary: "UI proof passed.",
          startedAt: 1_200,
          completedAt: 1_500,
          exitCode: 0,
          command: "dotnet test .\\LegApp.Admin.UI.Tests\\LegApp.Admin.UI.Tests.csproj",
          artifacts: [
            {
              artifactId: "artifact-1",
              label: "Proof report",
              kind: "report",
              path: "C:\\Repos\\.spira-worktrees\\spi-150\\.spira-proof\\proof-1\\summary.json",
              fileUrl: "file:///C:/Repos/.spira-worktrees/spi-150/.spira-proof/proof-1/summary.json",
            },
          ],
        },
      ],
    });

    expect(database.getTicketRun("run-proof")).toMatchObject({
      proof: {
        status: "passed",
        lastProofRunId: "proof-1",
        lastProofProfileId: "builtin:legapp-admin-ui-proof:run-proof:web-app",
        lastProofAt: 1_500,
        lastProofSummary: "UI proof passed.",
        staleReason: null,
      },
      proofRuns: [
        {
          proofRunId: "proof-1",
          profileLabel: "LegApp Admin UI proof",
          status: "passed",
          summary: "UI proof passed.",
          artifacts: [
            {
              artifactId: "artifact-1",
              kind: "report",
              path: "C:\\Repos\\.spira-worktrees\\spi-150\\.spira-proof\\proof-1\\summary.json",
            },
          ],
        },
      ],
    });
  });

  it("stores repo intelligence and validation profiles with scoped retrieval", () => {
    const database = createTestDatabase();

    database.seedBuiltinRepoIntelligence([
      {
        id: "spira-root-briefing",
        projectKey: "SPI",
        repoRelativePath: ".",
        type: "briefing",
        title: "Root briefing",
        content: "Mission workflow lives under packages/backend/src/missions.",
        tags: ["missions"],
      },
    ]);
    database.upsertRepoIntelligence({
      id: "apps-web-pitfall",
      projectKey: "SPI",
      repoRelativePath: "apps/web",
      type: "pitfall",
      title: "Web pitfall",
      content: "UI changes should check proof coverage early.",
      tags: ["ui", "proof"],
      source: "user",
    });
    database.seedBuiltinValidationProfiles([
      {
        id: "apps-web-test",
        projectKey: "SPI",
        repoRelativePath: "apps/web",
        label: "Apps web tests",
        kind: "unit-test",
        command: "pnpm test --filter apps-web",
        workingDirectory: "apps/web",
        confidence: 0.9,
      },
    ]);

    expect(
      database
        .listRepoIntelligence({
          projectKey: "SPI",
          repoRelativePaths: [".", "apps/web"],
        })
        .map((entry) => ({ id: entry.id, source: entry.source })),
    ).toEqual(
      expect.arrayContaining([
        { id: "spira-root-briefing", source: "builtin" },
        { id: "apps-web-pitfall", source: "user" },
      ]),
    );
    expect(
      database.listValidationProfiles({
        projectKey: "SPI",
        repoRelativePaths: ["apps/web"],
      }),
    ).toMatchObject([
      {
        id: "apps-web-test",
        workingDirectory: "apps/web",
      },
    ]);

    database.upsertRepoIntelligence({
      id: "learned-apps-web-example",
      projectKey: "SPI",
      repoRelativePath: "apps/web",
      type: "example",
      title: "Observed mission pattern",
      content: "Observed from a clean mission.",
      tags: ["learned", "run:run-1"],
      source: "learned",
      approved: false,
    });

    expect(
      database.listRepoIntelligence({
        projectKey: "SPI",
        repoRelativePaths: ["apps/web"],
        tags: ["run:run-1"],
        includeUnapproved: true,
      }),
    ).toMatchObject([
      {
        id: "learned-apps-web-example",
        approved: false,
        source: "learned",
      },
    ]);

    expect(
      database.listRepoIntelligence({
        projectKey: "SPI",
        repoRelativePaths: ["apps/web"],
        tags: ["run:run-1"],
      }),
    ).toEqual([]);

    expect(database.setRepoIntelligenceApproval("learned-apps-web-example", true)).toMatchObject({
      id: "learned-apps-web-example",
      approved: true,
    });
  });

  it("persists proof decisions and mission events for a run", () => {
    const database = createTestDatabase();

    database.upsertTicketRun({
      runId: "run-proofing",
      stationId: "mission:run-proofing",
      ticketId: "SPI-201",
      ticketSummary: "Adjust UI labels",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-201",
      projectKey: "SPI",
      status: "working",
      createdAt: 1_000,
      startedAt: 1_000,
      worktrees: [
        {
          repoRelativePath: "apps/web",
          repoAbsolutePath: "C:\\Repos\\apps\\web",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-201\\apps-web",
          branchName: "feat/spi-201-adjust-ui-labels",
          cleanupState: "retained",
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
      attempts: [
        {
          attemptId: "attempt-1",
          sequence: 1,
          status: "running",
          startedAt: 1_000,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
    });

    const proofDecision = database.upsertProofDecision({
      runId: "run-proofing",
      attemptId: "attempt-1",
      recommendedLevel: "light",
      preflightStatus: "runnable",
      rationale: "Copy-only UI change.",
      evidence: ["ticket-summary-keywords"],
      repoRelativePaths: ["apps/web"],
      createdAt: 1_100,
    });
    const missionEvent = database.appendMissionEvent({
      runId: "run-proofing",
      attemptId: "attempt-1",
      stage: "classification",
      eventType: "context-loaded",
      metadata: { recommendedLevel: "light" },
      occurredAt: 1_200,
    });

    expect(database.getProofDecision("run-proofing")).toMatchObject({
      runId: "run-proofing",
      attemptId: "attempt-1",
      recommendedLevel: "light",
      preflightStatus: "runnable",
      evidence: ["ticket-summary-keywords"],
    });
    expect(proofDecision.repoRelativePaths).toEqual(["apps/web"]);
    expect(database.listMissionEvents("run-proofing")).toMatchObject([
      {
        id: missionEvent.id,
        runId: "run-proofing",
        eventType: "context-loaded",
        metadata: { recommendedLevel: "light" },
      },
    ]);
  });

  it("deletes ticket runs and cascades child mission records", () => {
    const database = createTestDatabase();

    database.upsertTicketRun({
      runId: "run-delete",
      stationId: "mission:run-delete",
      ticketId: "SPI-102",
      ticketSummary: "Delete local mission",
      ticketUrl: "https://example.youtrack.cloud/issue/SPI-102",
      projectKey: "SPI",
      status: "awaiting-review",
      statusMessage: "Ready to tear down.",
      createdAt: 2_000,
      startedAt: 2_000,
      worktrees: [
        {
          repoRelativePath: "service-api",
          repoAbsolutePath: "C:\\Repos\\service-api",
          worktreePath: "C:\\Repos\\.spira-worktrees\\spi-102-service-api",
          branchName: "feat/spi-102-delete-local-mission",
          cleanupState: "retained",
          createdAt: 2_000,
          updatedAt: 2_100,
        },
      ],
      submodules: [
        {
          canonicalUrl: "github.com/uk-parliament/legapp_legapp-common",
          name: "LegAppCommon",
          branchName: "feat/spi-102-delete-local-mission",
          commitMessageDraft: null,
          parentRefs: [
            {
              parentRepoRelativePath: "service-api",
              submodulePath: "Submodules/LegAppCommon",
              submoduleWorktreePath: "C:\\Repos\\.spira-worktrees\\spi-102-service-api\\Submodules\\LegAppCommon",
            },
          ],
          createdAt: 2_000,
          updatedAt: 2_100,
        },
      ],
      attempts: [
        {
          attemptId: "attempt-delete",
          subagentRunId: null,
          sequence: 1,
          status: "completed",
          summary: "Ready for deletion.",
          followupNeeded: false,
          startedAt: 2_000,
          createdAt: 2_000,
          updatedAt: 2_100,
          completedAt: 2_100,
        },
      ],
    });

    expect(database.deleteTicketRun("run-delete")).toBe(true);
    expect(database.getTicketRun("run-delete")).toBeNull();
    expect(database.getTicketRunByTicketId("SPI-102")).toBeNull();
    expect(database.getTicketRunSnapshot().runs).toEqual([]);
  });
});
