import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHostTools } from "./host-tools.js";

const parseToolResult = <T>(value: { textResultForLlm: string }): T => JSON.parse(value.textResultForLlm) as T;

describe("createHostTools", () => {
  let workspacePath: string | null = null;

  afterEach(async () => {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
      workspacePath = null;
    }
  });

  it("accepts apply_patch hunks that include the end-of-file marker", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "spira-host-tools-"));
    const filePath = path.join(workspacePath, "sample.txt");
    await writeFile(filePath, "alpha\nbeta", "utf8");

    const applyPatch = createHostTools({ workingDirectory: workspacePath }).find((tool) => tool.name === "apply_patch");
    expect(applyPatch).toBeDefined();

    const result = await applyPatch!.handler({
      patch: "*** Begin Patch\n*** Update File: sample.txt\n@@\n alpha\n-beta\n+gamma\n*** End of File\n*** End Patch\n",
    });

    expect(parseToolResult<{ changedFiles: string[] }>(result).changedFiles).toContain(filePath);
    await expect(readFile(filePath, "utf8")).resolves.toBe("alpha\ngamma");
  });

  it("does not retain completed sync PowerShell sessions", async () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const listPowerShell = tools.find((tool) => tool.name === "list_powershell");
    expect(powershell).toBeDefined();
    expect(listPowerShell).toBeDefined();

    const result = await powershell!.handler({
      shellId: "sync-cleanup-test",
      command: 'Write-Output "ok"',
      description: "Emit output",
      mode: "sync",
      initial_wait: 5,
    });
    const listed = await listPowerShell!.handler({});

    expect(parseToolResult<{ shellId: string; status: string }>(result)).toMatchObject({
      shellId: "sync-cleanup-test",
      status: "completed",
    });
    expect(parseToolResult<{ sessions: Array<{ shellId: string }> }>(listed).sessions).not.toContainEqual(
      expect.objectContaining({ shellId: "sync-cleanup-test" }),
    );
  });

  it("cleans up sync PowerShell sessions that finish after the initial wait timeout", async () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const listPowerShell = tools.find((tool) => tool.name === "list_powershell");
    const readPowerShell = tools.find((tool) => tool.name === "read_powershell");
    expect(powershell).toBeDefined();
    expect(listPowerShell).toBeDefined();
    expect(readPowerShell).toBeDefined();

    await expect(
      powershell!.handler({
        shellId: "sync-review",
        command: 'Start-Sleep -Milliseconds 1500; Write-Output "done"',
        description: "Delayed sync output",
        mode: "sync",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
    });

    await vi.waitFor(
      async () => {
        const listed = await listPowerShell!.handler({});
        expect(parseToolResult<{ sessions: Array<{ shellId: string }> }>(listed).sessions).not.toContainEqual(
          expect.objectContaining({ shellId: "sync-review" }),
        );
      },
      { timeout: 10_000, interval: 100 },
    );
    await expect(readPowerShell!.handler({ shellId: "sync-review", delay: 0 })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining('"status": "completed"'),
    });
    await expect(readPowerShell!.handler({ shellId: "sync-review", delay: 0 })).resolves.toMatchObject({
      resultType: "failure",
    });
  });

  it("marks host tools as explicit overrides for Copilot built-ins", () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });

    expect(tools.every((tool) => tool.overridesBuiltInTool === true)).toBe(true);
  });

  it("applies ripgrep-style line semantics for anchored rg searches in files and count modes", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "spira-host-tools-rg-"));
    const filePath = path.join(workspacePath, "sample.ts");
    await writeFile(filePath, "const a = 1;\nimport x from 'y';\n", "utf8");

    const tools = createHostTools({ workingDirectory: workspacePath });
    const rg = tools.find((tool) => tool.name === "rg");
    expect(rg).toBeDefined();

    await expect(rg!.handler({ pattern: "^import", output_mode: "files_with_matches" })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining(JSON.stringify(filePath)),
    });
    await expect(rg!.handler({ pattern: "^import", output_mode: "count" })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining('"count": 1'),
    });
  });

  it("persists idle PowerShell sessions between writes and completion", async () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const readPowerShell = tools.find((tool) => tool.name === "read_powershell");
    const stopPowerShell = tools.find((tool) => tool.name === "stop_powershell");

    expect(powershell).toBeDefined();
    expect(readPowerShell).toBeDefined();
    expect(stopPowerShell).toBeDefined();

    await expect(
      powershell!.handler({
        shellId: "idle-session-test",
        command: "Start-Sleep -Seconds 3",
        description: "Idle session test",
        mode: "async",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({ resultType: "success" });
    await expect(readPowerShell!.handler({ shellId: "idle-session-test", delay: 0 })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining('"status": "idle"'),
    });
    await expect(stopPowerShell!.handler({ shellId: "idle-session-test" })).resolves.toMatchObject({
      resultType: "success",
    });
  });

  it("allows writing to an idle PowerShell session after a read", async () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const readPowerShell = tools.find((tool) => tool.name === "read_powershell");
    const writePowerShell = tools.find((tool) => tool.name === "write_powershell");
    const stopPowerShell = tools.find((tool) => tool.name === "stop_powershell");

    expect(powershell).toBeDefined();
    expect(readPowerShell).toBeDefined();
    expect(writePowerShell).toBeDefined();
    expect(stopPowerShell).toBeDefined();

    await expect(
      powershell!.handler({
        command: "Write-Output 'ready'",
        description: "Keep shell interactive",
        shellId: "idle-write-session",
        mode: "async",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
    });
    await expect(readPowerShell!.handler({ shellId: "idle-write-session", delay: 0 })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining("ready"),
    });
    await expect(readPowerShell!.handler({ shellId: "idle-write-session", delay: 0 })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining('"status": "idle"'),
    });
    await expect(
      writePowerShell!.handler({ shellId: "idle-write-session", input: "Write-Output 'pong'{enter}", delay: 1 }),
    ).resolves.toMatchObject({
      resultType: "success",
    });
    await expect(readPowerShell!.handler({ shellId: "idle-write-session", delay: 0 })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining("pong"),
    });
    await expect(stopPowerShell!.handler({ shellId: "idle-write-session" })).resolves.toMatchObject({
      resultType: "success",
    });
  });

  it("starts PowerShell sessions inside the runtime working directory", async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), "spira-host-tools-cwd-"));
    const nestedPath = path.join(workspacePath, "nested");
    await mkdir(nestedPath, { recursive: true });
    const tools = createHostTools({ workingDirectory: nestedPath });
    const powershell = tools.find((tool) => tool.name === "powershell");

    expect(powershell).toBeDefined();

    await expect(
      powershell!.handler({
        shellId: "working-directory-test",
        command: "(Get-Location).Path",
        description: "Report working directory",
        mode: "sync",
        initial_wait: 5,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining(JSON.stringify(nestedPath)),
    });
  });

  it("scopes PowerShell sessions to the owning runtime session", async () => {
    const toolsA = createHostTools({
      workingDirectory: "C:\\GitHub\\Spira",
      runtimeSessionId: "runtime-a",
    });
    const toolsB = createHostTools({
      workingDirectory: "C:\\GitHub\\Spira",
      runtimeSessionId: "runtime-b",
    });
    const startA = toolsA.find((tool) => tool.name === "powershell");
    const readB = toolsB.find((tool) => tool.name === "read_powershell");
    const listB = toolsB.find((tool) => tool.name === "list_powershell");
    const stopA = toolsA.find((tool) => tool.name === "stop_powershell");

    expect(startA).toBeDefined();
    expect(readB).toBeDefined();
    expect(listB).toBeDefined();
    expect(stopA).toBeDefined();

    await expect(
      startA!.handler({
        command: "Write-Output 'owned'",
        description: "Owned shell",
        shellId: "scoped-session",
        mode: "async",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
    });

    await expect(readB!.handler({ shellId: "scoped-session", delay: 0 })).resolves.toMatchObject({
      resultType: "failure",
    });
    const listed = await listB!.handler({});
    expect(parseToolResult<{ sessions: Array<{ shellId: string }> }>(listed).sessions).toEqual([]);
    await expect(stopA!.handler({ shellId: "scoped-session" })).resolves.toMatchObject({
      resultType: "success",
    });
  });

  it("translates arrow-key tokens for interactive PowerShell writes", async () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const readPowerShell = tools.find((tool) => tool.name === "read_powershell");
    const writePowerShell = tools.find((tool) => tool.name === "write_powershell");
    const stopPowerShell = tools.find((tool) => tool.name === "stop_powershell");

    expect(powershell).toBeDefined();
    expect(readPowerShell).toBeDefined();
    expect(writePowerShell).toBeDefined();
    expect(stopPowerShell).toBeDefined();

    await expect(
      powershell!.handler({
        command:
          'node -e "process.stdin.on(\'data\', (chunk) => { console.log(Array.from(chunk).join(\',\')); process.exit(0); })"',
        description: "Capture arrow-key bytes",
        shellId: "arrow-session",
        mode: "async",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
    });
    await expect(writePowerShell!.handler({ shellId: "arrow-session", input: "{up}", delay: 1 })).resolves.toMatchObject(
      {
        resultType: "success",
      },
    );
    await expect(readPowerShell!.handler({ shellId: "arrow-session", delay: 0 })).resolves.toMatchObject({
      resultType: "success",
      textResultForLlm: expect.stringContaining("27,91,65"),
    });
    await expect(stopPowerShell!.handler({ shellId: "arrow-session" })).resolves.toMatchObject({
      resultType: "success",
    });
  });

  it("persists and journals cancelled PowerShell sessions", async () => {
    const capturedStatuses: string[] = [];
    const capturedEventTypes: string[] = [];
    const capturedResourceIds: string[] = [];
    const tools = createHostTools({
      workingDirectory: "C:\\GitHub\\Spira",
      runtimeSessionId: "station:primary",
      runtimeStore: {
        upsertRuntimeHostResource: (input: { status: string }) => {
          capturedStatuses.push(input.status);
          return {
            resourceId: "cancel-session-test",
            runtimeSessionId: "station:primary",
            stationId: "primary",
            kind: "powershell",
            status: input.status,
            state: {},
            createdAt: 1000,
            updatedAt: 1001,
          };
        },
        appendRuntimeLedgerEvent: (event: { type: string; payload?: { resourceId?: string } }) => {
          capturedEventTypes.push(event.type);
          if (event.payload?.resourceId) {
            capturedResourceIds.push(event.payload.resourceId);
          }
          return event;
        },
        listRuntimeHostResources: () => [],
      } as never,
    });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const stopPowerShell = tools.find((tool) => tool.name === "stop_powershell");

    expect(powershell).toBeDefined();
    expect(stopPowerShell).toBeDefined();

    await expect(
      powershell!.handler({
        shellId: "cancel-session-test",
        command: "Start-Sleep -Seconds 10",
        description: "Cancel session test",
        mode: "async",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({ resultType: "success" });
    await expect(stopPowerShell!.handler({ shellId: "cancel-session-test" })).resolves.toMatchObject({
      resultType: "success",
    });

    expect(capturedStatuses).toContain("cancelled");
    expect(capturedEventTypes).toContain("host.resource_recorded");
    expect(capturedResourceIds).toContain("powershell:station:primary:cancel-session-test");
  });

  it("fails stop_powershell for completed async sessions", async () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const stopPowerShell = tools.find((tool) => tool.name === "stop_powershell");
    expect(powershell).toBeDefined();
    expect(stopPowerShell).toBeDefined();

    await expect(
      powershell!.handler({
        shellId: "completed-async-stop-test",
        command: 'Write-Output "done"; exit',
        description: "Completed async session",
        mode: "async",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
    });

    await expect(stopPowerShell!.handler({ shellId: "completed-async-stop-test" })).resolves.toMatchObject({
      resultType: "failure",
    });
  });

  it("does not surface terminal sync PowerShell sessions from persistence fallback", async () => {
    const persisted = new Map<string, Record<string, unknown>>();
    const runtimeSessionId = "station:sync-fallback";
    const tools = createHostTools({
      workingDirectory: "C:\\GitHub\\Spira",
      runtimeSessionId,
      runtimeStore: {
        upsertRuntimeHostResource: (input: Record<string, unknown>) => {
          persisted.set(input.resourceId as string, input);
          return {
            resourceId: input.resourceId as string,
            runtimeSessionId: input.runtimeSessionId as string,
            stationId: (input.stationId as string | null | undefined) ?? null,
            kind: input.kind as string,
            status: input.status as
              | "running"
              | "idle"
              | "completed"
              | "failed"
              | "unrecoverable"
              | "cancelled",
            state: input.state as Record<string, unknown>,
            createdAt: 1000,
            updatedAt: 1001,
          };
        },
        deleteRuntimeHostResource: (resourceId: string) => persisted.delete(resourceId),
        listRuntimeHostResources: () =>
          [...persisted.values()].map((entry) => ({
            resourceId: entry.resourceId as string,
            runtimeSessionId: entry.runtimeSessionId as string,
            stationId: (entry.stationId as string | null | undefined) ?? null,
            kind: entry.kind as string,
            status: entry.status as
              | "running"
              | "idle"
              | "completed"
              | "failed"
              | "unrecoverable"
              | "cancelled",
            state: entry.state as Record<string, unknown>,
            createdAt: 1000,
            updatedAt: 1001,
          })),
        appendRuntimeLedgerEvent: () => undefined,
      } as never,
    });
    const powershell = tools.find((tool) => tool.name === "powershell");
    const listPowerShell = tools.find((tool) => tool.name === "list_powershell");
    const readPowerShell = tools.find((tool) => tool.name === "read_powershell");
    expect(powershell).toBeDefined();
    expect(listPowerShell).toBeDefined();
    expect(readPowerShell).toBeDefined();

    await expect(
      powershell!.handler({
        shellId: "sync-persist-test",
        command: 'Write-Output "ok"',
        description: "Completed sync persist test",
        mode: "sync",
        initial_wait: 1,
      }),
    ).resolves.toMatchObject({
      resultType: "success",
    });

    await vi.waitFor(async () => {
      const listed = await listPowerShell!.handler({});
      expect(parseToolResult<{ sessions: Array<{ shellId: string }> }>(listed).sessions).toEqual([]);
    });
    await expect(readPowerShell!.handler({ shellId: "sync-persist-test", delay: 0 })).resolves.toMatchObject({
      resultType: "failure",
    });
  });

  it("fails stop_powershell for unrecoverable persisted sessions", async () => {
    const tools = createHostTools({
      workingDirectory: "C:\\GitHub\\Spira",
      runtimeSessionId: "station:primary",
      runtimeStore: {
        listRuntimeHostResources: () => [
          {
            resourceId: "powershell:station:primary:stuck-shell",
            runtimeSessionId: "station:primary",
            stationId: "primary",
            kind: "powershell",
            status: "unrecoverable",
            state: {
              shellId: "stuck-shell",
              command: "Start-Sleep -Seconds 30",
              description: "stuck",
              mode: "async",
              detached: false,
              status: "unrecoverable",
              pid: 1234,
              exitCode: null,
              output: "",
              outputCursor: 0,
              hasUnreadOutput: false,
              startedAt: 1,
              updatedAt: 2,
              recoveryPolicy: "unrecoverable-after-restart",
            },
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        appendRuntimeLedgerEvent: () => undefined,
      } as never,
    });
    const stopPowerShell = tools.find((tool) => tool.name === "stop_powershell");
    expect(stopPowerShell).toBeDefined();

    await expect(stopPowerShell!.handler({ shellId: "stuck-shell" })).resolves.toMatchObject({
      resultType: "failure",
    });
  });

  it("lists persisted unrecoverable PowerShell resources from the runtime store", async () => {
    const tools = createHostTools({
      workingDirectory: "C:\\GitHub\\Spira",
      runtimeSessionId: "station:primary",
      runtimeStore: {
        listRuntimeHostResources: () => [
          {
            resourceId: "shell-recovered",
            runtimeSessionId: "station:primary",
            stationId: "primary",
            kind: "powershell",
            status: "unrecoverable",
            state: {
              shellId: "shell-recovered",
              command: 'Write-Output "stale"',
              description: "Recovered shell",
              mode: "async",
              detached: false,
              status: "unrecoverable",
              pid: 1234,
              exitCode: null,
              output: "",
              outputCursor: 0,
              hasUnreadOutput: false,
              recoveryPolicy: "unrecoverable-after-restart",
              startedAt: 1000,
              updatedAt: 1100,
            },
            createdAt: 1000,
            updatedAt: 1100,
          },
        ],
      } as never,
    });
    const listPowerShell = tools.find((tool) => tool.name === "list_powershell");

    expect(listPowerShell).toBeDefined();
    const listed = await listPowerShell!.handler({});

    expect(parseToolResult<{ sessions: Array<{ shellId: string; status: string }> }>(listed).sessions).toContainEqual(
      expect.objectContaining({
        shellId: "shell-recovered",
        status: "unrecoverable",
      }),
    );
  });

  it("reads persisted unrecoverable PowerShell resources and rejects follow-up writes", async () => {
    const resource = {
      resourceId: "shell-recovered",
      runtimeSessionId: "station:primary",
      stationId: "primary",
      kind: "powershell",
      status: "unrecoverable",
      state: {
        shellId: "shell-recovered",
        command: 'Write-Output "stale"',
        description: "Recovered shell",
        mode: "async",
        detached: false,
        status: "unrecoverable",
        pid: 1234,
        exitCode: null,
        output: "stale output",
        outputCursor: 12,
        hasUnreadOutput: false,
        recoveryPolicy: "unrecoverable-after-restart",
        startedAt: 1000,
        updatedAt: 1100,
      },
      createdAt: 1000,
      updatedAt: 1100,
    };
    const tools = createHostTools({
      workingDirectory: "C:\\GitHub\\Spira",
      runtimeSessionId: "station:primary",
      runtimeStore: {
        listRuntimeHostResources: () => [resource],
        upsertRuntimeHostResource: () => resource,
        appendRuntimeLedgerEvent: () => undefined,
      } as never,
    });
    const readPowerShell = tools.find((tool) => tool.name === "read_powershell");
    const writePowerShell = tools.find((tool) => tool.name === "write_powershell");

    expect(readPowerShell).toBeDefined();
    expect(writePowerShell).toBeDefined();
    await expect(readPowerShell!.handler({ shellId: "shell-recovered", delay: 0 })).resolves.toMatchObject({
      resultType: "success",
    });
    await expect(writePowerShell!.handler({ shellId: "shell-recovered", input: "x", delay: 0 })).resolves.toMatchObject(
      {
        resultType: "failure",
      },
    );
  });
});
