import { describe, expect, it } from "vitest";
import { runPs } from "./powershell.js";

describe("runPs", () => {
  it("runs successful commands", async () => {
    await expect(runPs("Write-Output 'ok'")).resolves.toMatchObject({ stdout: "ok", exitCode: 0 });
  });

  it("treats PowerShell errors as failures", async () => {
    await expect(runPs("Write-Error 'boom'")).rejects.toThrow("boom");
  });
});
