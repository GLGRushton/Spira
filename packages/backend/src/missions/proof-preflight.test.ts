import { describe, expect, it } from "vitest";
import { runProofPreflight } from "./proof-preflight.js";
import type { ResolvedMissionProofProfile } from "./proof-registry.js";

const baseProfile = (): ResolvedMissionProofProfile => ({
  profileId: "test:profile",
  label: "Test profile",
  description: "",
  kind: "playwright-dotnet-nunit",
  repoRelativePath: "web-app",
  projectRelativePath: "LegApp.Admin.UI.Tests\\LegApp.Admin.UI.Tests.csproj",
  runSettingsRelativePath: "LegApp.Admin.UI.Tests\\TestConfiguration.runsettings",
  command: "dotnet",
  args: ["test", "."],
  workingDirectory: "C:\\Repos\\.spira-worktrees\\spi-1\\web-app",
});

describe("runProofPreflight (Phase 2.2)", () => {
  it("passes when every check returns ok", async () => {
    const result = await runProofPreflight(baseProfile(), {
      hooks: {
        binaryAvailable: async () => true,
        pathExists: async () => true,
        freeDiskBytes: async () => 1024 ** 4, // 1 TB
      },
    });
    expect(result.ok).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("flags a missing dotnet binary as a blocker with a remediation hint", async () => {
    const result = await runProofPreflight(baseProfile(), {
      hooks: {
        binaryAvailable: async (binary) => binary !== "dotnet",
        pathExists: async () => true,
        freeDiskBytes: async () => 1024 ** 4,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((finding) => finding.id === "binary-missing:dotnet")).toBe(true);
    const dotnetBlocker = result.blockers.find((finding) => finding.id === "binary-missing:dotnet");
    expect(dotnetBlocker?.remediation).toMatch(/PATH/i);
  });

  it("flags a missing project.assets.json as 'project not restored'", async () => {
    const profile = baseProfile();
    const result = await runProofPreflight(profile, {
      hooks: {
        binaryAvailable: async () => true,
        // Pretend obj/project.assets.json is missing but the bypass-auth fixture exists.
        pathExists: async (target) => !target.includes("project.assets.json"),
        freeDiskBytes: async () => 1024 ** 4,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.blockers.some((finding) => finding.id === "dotnet-project-not-restored")).toBe(true);
  });

  it("surfaces low disk space as a warning rather than a blocker", async () => {
    const result = await runProofPreflight(baseProfile(), {
      hooks: {
        binaryAvailable: async () => true,
        pathExists: async () => true,
        freeDiskBytes: async () => 100 * 1024 * 1024, // 100 MB
      },
      minFreeDiskBytes: 1024 * 1024 * 1024,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((finding) => finding.id === "disk-space-low")).toBe(true);
  });

  it("returns a summary string suitable for mission_events.metadata", async () => {
    const result = await runProofPreflight(baseProfile(), {
      hooks: {
        binaryAvailable: async () => false,
        pathExists: async () => true,
        freeDiskBytes: async () => 1024 ** 4,
      },
    });
    expect(result.summary).not.toBeNull();
    expect(result.summary).toMatch(/blocker/);
  });
});
