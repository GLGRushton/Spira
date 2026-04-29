import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("marks host tools as explicit overrides for Copilot built-ins", () => {
    const tools = createHostTools({ workingDirectory: "C:\\GitHub\\Spira" });

    expect(tools.every((tool) => tool.overridesBuiltInTool === true)).toBe(true);
  });
});
