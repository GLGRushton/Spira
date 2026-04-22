import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { TicketRunProofProfileSummary, TicketRunSummary } from "@spira/shared";

export interface ResolvedMissionProofProfile extends TicketRunProofProfileSummary {
  command: string;
  args: string[];
  workingDirectory: string;
}

const LEGAPP_UI_TEST_PROJECT = "LegApp.Admin.UI.Tests\\LegApp.Admin.UI.Tests.csproj";
const LEGAPP_UI_TEST_RUNSETTINGS = "LegApp.Admin.UI.Tests\\TestConfiguration.runsettings";
const LEGAPP_UI_TEST_BASE = "LegApp.Admin.UI.Tests\\PageTests\\Bases\\IsolatedPageTestBase.cs";

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
};

const usesPlaywrightHarness = (content: string): boolean => content.includes("Microsoft.Playwright.NUnit");

const usesProceduralAzureAdBypass = (content: string): boolean =>
  content.includes("AddTestProceduralAzureADAuthentication");

const normalizeRelativePath = (value: string): string => value.replace(/\//gu, "\\");

const tryDiscoverLegAppAdminProfile = async (
  run: TicketRunSummary,
  worktree: TicketRunSummary["worktrees"][number],
): Promise<ResolvedMissionProofProfile | null> => {
  const projectPath = path.join(worktree.worktreePath, LEGAPP_UI_TEST_PROJECT);
  const runSettingsPath = path.join(worktree.worktreePath, LEGAPP_UI_TEST_RUNSETTINGS);
  const isolatedBasePath = path.join(worktree.worktreePath, LEGAPP_UI_TEST_BASE);
  if (!(await pathExists(projectPath)) || !(await pathExists(isolatedBasePath))) {
    return null;
  }

  const [projectContent, isolatedBaseContent, runSettingsExists] = await Promise.all([
    readFile(projectPath, "utf8"),
    readFile(isolatedBasePath, "utf8"),
    pathExists(runSettingsPath),
  ]);
  if (!usesPlaywrightHarness(projectContent) || !usesProceduralAzureAdBypass(isolatedBaseContent)) {
    return null;
  }

  const projectRelativePath = normalizeRelativePath(path.relative(worktree.worktreePath, projectPath));
  const runSettingsRelativePath = runSettingsExists
    ? normalizeRelativePath(path.relative(worktree.worktreePath, runSettingsPath))
    : null;

  return {
    profileId: `builtin:legapp-admin-ui-proof:${run.runId}:${worktree.repoRelativePath}`,
    label: "LegApp Admin UI proof",
    description:
      "Runs the discovered LegApp Admin Playwright NUnit harness with the test Azure AD bypass already wired into the isolated page base.",
    kind: "playwright-dotnet-nunit",
    repoRelativePath: worktree.repoRelativePath,
    projectRelativePath,
    runSettingsRelativePath,
    command: "dotnet",
    args: [
      "test",
      `.${path.sep}${projectRelativePath}`,
      ...(runSettingsRelativePath ? ["--settings", `.${path.sep}${runSettingsRelativePath}`] : []),
    ],
    workingDirectory: worktree.worktreePath,
  };
};

export async function discoverMissionProofProfiles(run: TicketRunSummary): Promise<ResolvedMissionProofProfile[]> {
  const profiles = await Promise.all(run.worktrees.map((worktree) => tryDiscoverLegAppAdminProfile(run, worktree)));
  return profiles.flatMap((profile) => (profile ? [profile] : []));
}

export const toMissionProofProfileSummary = (
  profile: ResolvedMissionProofProfile,
): TicketRunProofProfileSummary => ({
  profileId: profile.profileId,
  label: profile.label,
  description: profile.description,
  kind: profile.kind,
  repoRelativePath: profile.repoRelativePath,
  projectRelativePath: profile.projectRelativePath,
  runSettingsRelativePath: profile.runSettingsRelativePath,
});
