import type { McpTool } from "@spira/shared";
import { describe, expect, it } from "vitest";
import { getProviderToolManifest } from "./capability-registry.js";

const createTool = (serverId: string, name: string): McpTool => ({
  serverId,
  serverName: serverId,
  name,
  description: `${name} description`,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
});

const tools = [createTool("spira-ui", "spira_ui_get_snapshot"), createTool("memories", "spira_memory_list_entries")];

const createAggregator = () =>
  ({
    getTools: () => tools,
    getToolsForServerIds: (serverIds: readonly string[]) => tools.filter((tool) => serverIds.includes(tool.serverId)),
    executeTool: async () => null,
  }) as unknown as McpToolAggregator;

type McpToolAggregator = import("../mcp/tool-aggregator.js").McpToolAggregator;

describe("runtime capability registry", () => {
  it("projects Copilot manifests by suppressing duplicate host built-ins but keeping unique host capabilities", () => {
    const manifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
        sessionStorage: {
          get: () => null,
          set: (_kind, value) => value ?? null,
          buildContinuitySections: () => [],
        },
      },
      providerId: "copilot",
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
    });

    const toolNames = manifest.tools.map((tool) => tool.name);

    expect(toolNames).not.toContain("view");
    expect(toolNames).not.toContain("glob");
    expect(toolNames).not.toContain("powershell");
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "spira_session_get_plan",
        "spira_session_set_plan",
        "spira_ui_get_snapshot",
        "spira_memory_list_entries",
      ]),
    );
    expect(manifest.suppressedCapabilityIds).toEqual(
      expect.arrayContaining(["view", "glob", "rg", "powershell", "apply_patch"]),
    );
    expect(manifest.projectionHash).not.toEqual(manifest.hostManifestHash);
  });

  it("keeps the literal manifest for providers that can ingest the host tool surface directly", () => {
    const manifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
      },
      providerId: "azure-openai",
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });

    const toolNames = manifest.tools.map((tool) => tool.name);

    expect(toolNames).toEqual(expect.arrayContaining(["view", "glob", "rg", "powershell", "spira_ui_get_snapshot"]));
    expect(manifest.suppressedCapabilityIds).toEqual([]);
  });

  it("threads runtime host-resource persistence through the manifest builder path", async () => {
    const persistedResources: Array<Record<string, unknown>> = [];
    const manifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
        runtimeSessionId: "station:primary",
        stationId: "primary",
        runtimeStore: {
          upsertRuntimeHostResource: (input: Record<string, unknown>) => {
            persistedResources.push(input);
            return input;
          },
          listRuntimeHostResources: () => [],
        } as never,
      },
      providerId: "azure-openai",
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });
    const powershell = manifest.tools.find((tool) => tool.name === "powershell");

    expect(powershell).toBeDefined();
    await expect(
      powershell!.handler({
        shellId: "capability-runtime-test",
        command: 'Write-Output "ok"',
        description: "Emit output",
        mode: "sync",
        initial_wait: 5,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
    });
    expect(persistedResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceId: "capability-runtime-test",
          runtimeSessionId: "station:primary",
          kind: "powershell",
        }),
      ]),
    );
  });

  it("keeps a stable host manifest signature across provider projections", () => {
    const aggregator = createAggregator();
    const copilotManifest = getProviderToolManifest({
      aggregator,
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
      },
      providerId: "copilot",
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
    });
    const azureManifest = getProviderToolManifest({
      aggregator,
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
      },
      providerId: "azure-openai",
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });

    expect(copilotManifest.hostManifestHash).toEqual(azureManifest.hostManifestHash);
    expect(copilotManifest.projectionHash).not.toEqual(azureManifest.projectionHash);
  });

  it("changes the manifest hash when a tool contract changes without a rename", () => {
    const baseAggregator = createAggregator();
    const changedAggregator = {
      getTools: () => [
        {
          ...tools[0],
          description: "Changed description",
          inputSchema: {
            type: "object",
            properties: {
              force: { type: "boolean" },
            },
            additionalProperties: false,
          },
        },
        tools[1],
      ],
      getToolsForServerIds: (serverIds: readonly string[]) =>
        [
          {
            ...tools[0],
            description: "Changed description",
            inputSchema: {
              type: "object",
              properties: {
                force: { type: "boolean" },
              },
              additionalProperties: false,
            },
          },
          tools[1],
        ].filter((tool) => serverIds.includes(tool.serverId)),
      executeTool: async () => null,
    } as unknown as McpToolAggregator;

    const baseManifest = getProviderToolManifest({
      aggregator: baseAggregator,
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
      },
      providerId: "azure-openai",
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });
    const changedManifest = getProviderToolManifest({
      aggregator: changedAggregator,
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
      },
      providerId: "azure-openai",
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });

    expect(changedManifest.hostManifestHash).not.toEqual(baseManifest.hostManifestHash);
    expect(changedManifest.projectionHash).not.toEqual(baseManifest.projectionHash);
  });

  it("keeps an MCP tool named like a Copilot built-in when only the host duplicate is suppressed", () => {
    const manifest = getProviderToolManifest({
      aggregator: {
        getTools: () => [createTool("custom-server", "view")],
        getToolsForServerIds: (serverIds: readonly string[]) =>
          serverIds.includes("custom-server") ? [createTool("custom-server", "view")] : [],
        executeTool: async () => null,
      } as unknown as McpToolAggregator,
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
      },
      providerId: "copilot",
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
    });

    expect(manifest.tools.filter((tool) => tool.name === "view")).toHaveLength(1);
    expect(manifest.suppressedCapabilityIds).toContain("view");
  });

  it("changes the manifest hash when the working directory changes", () => {
    const baseManifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
      },
      providerId: "azure-openai",
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });
    const changedManifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        workingDirectory: "C:\\GitHub\\Spira\\apps",
      },
      providerId: "azure-openai",
      capabilities: {
        persistentSessions: false,
        abortableTurns: false,
        sessionResumption: "host-managed",
        turnCancellation: "disconnect-and-reset",
        responseStreaming: "host-buffered",
        usageReporting: "partial",
        toolManifestMode: "literal",
        modelSelection: "provider-default",
        toolCalling: "native",
      },
    });

    expect(changedManifest.hostManifestHash).not.toEqual(baseManifest.hostManifestHash);
    expect(changedManifest.projectionHash).not.toEqual(baseManifest.projectionHash);
  });

  it("changes the manifest hash when delegation domain semantics change", () => {
    const baseManifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
        delegationDomains: [
          {
            id: "code-review",
            label: "Code Review",
            delegationToolName: "delegate_to_code_review",
            serverIds: ["spira-ui"],
            allowWrites: false,
            systemPrompt: "Review code carefully.",
          },
        ],
        delegateToDomain: async () => ({
          runId: "run-1",
          domain: "code-review" as const,
          task: "Review",
          status: "completed" as const,
          retryCount: 0,
          startedAt: 1,
          completedAt: 1,
          durationMs: 0,
          followupNeeded: false,
          summary: "done",
          artifacts: [],
          stateChanges: [],
          toolCalls: [],
          errors: [],
        }),
      },
      providerId: "copilot",
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
    });
    const changedManifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        workingDirectory: "C:\\GitHub\\Spira",
        delegationDomains: [
          {
            id: "code-review",
            label: "Code Review",
            delegationToolName: "delegate_to_code_review",
            serverIds: ["memories"],
            allowedToolNames: ["spira_memory_list_entries"],
            allowWrites: true,
            systemPrompt: "Review code and memory carefully.",
          },
        ],
        delegateToDomain: async () => ({
          runId: "run-1",
          domain: "code-review" as const,
          task: "Review",
          status: "completed" as const,
          retryCount: 0,
          startedAt: 1,
          completedAt: 1,
          durationMs: 0,
          followupNeeded: false,
          summary: "done",
          artifacts: [],
          stateChanges: [],
          toolCalls: [],
          errors: [],
        }),
      },
      providerId: "copilot",
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
    });

    expect(changedManifest.hostManifestHash).not.toEqual(baseManifest.hostManifestHash);
    expect(changedManifest.projectionHash).not.toEqual(baseManifest.projectionHash);
  });

  it("changes the manifest hash when a delegation domain only flips allowHostTools", () => {
    const baseOptions = {
      workingDirectory: "C:\\GitHub\\Spira",
      delegationDomains: [
        {
          id: "code-review",
          label: "Code Review",
          delegationToolName: "delegate_to_code_review",
          serverIds: [],
          allowHostTools: false,
          allowWrites: false,
          systemPrompt: "Review code carefully.",
        },
      ],
      delegateToDomain: async () => ({
        runId: "run-1",
        domain: "code-review" as const,
        task: "Review",
        status: "completed" as const,
        retryCount: 0,
        startedAt: 1,
        completedAt: 1,
        durationMs: 0,
        followupNeeded: false,
        summary: "done",
        artifacts: [],
        stateChanges: [],
        toolCalls: [],
        errors: [],
      }),
    };
    const baseManifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: baseOptions,
      providerId: "copilot",
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
    });
    const changedManifest = getProviderToolManifest({
      aggregator: createAggregator(),
      options: {
        ...baseOptions,
        delegationDomains: [
          {
            ...baseOptions.delegationDomains[0],
            allowHostTools: true,
          },
        ],
      },
      providerId: "copilot",
      capabilities: {
        persistentSessions: true,
        abortableTurns: true,
        sessionResumption: "provider-managed",
        turnCancellation: "provider-abort",
        responseStreaming: "native",
        usageReporting: "full",
        toolManifestMode: "projected",
        modelSelection: "session-scoped",
        toolCalling: "native",
      },
    });

    expect(changedManifest.hostManifestHash).not.toEqual(baseManifest.hostManifestHash);
    expect(changedManifest.projectionHash).not.toEqual(baseManifest.projectionHash);
  });
});
