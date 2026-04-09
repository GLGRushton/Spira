import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type LaunchCandidate, pickBestLaunchCandidate } from "../util/app-launch.js";
import { quotePsString, runPs } from "../util/powershell.js";
import { errorResult, successResult } from "../util/results.js";
import { CloseAppSchema, EmptySchema, LaunchAppSchema } from "../util/validation.js";

interface DirectLaunchResolution {
  kind: "path" | "command" | null;
  resolvedTarget?: string;
  displayName?: string;
}

interface LaunchCandidateSet {
  commands: Array<{ Name: string; Source: string }>;
  startApps: Array<{ Name: string; AppID: string }>;
}

const resolveDirectLaunch = async (name: string): Promise<DirectLaunchResolution> => {
  const escapedName = quotePsString(name);
  const { stdout } = await runPs(
    `
$inputName = '${escapedName}'
$resolved = $null

if (Test-Path -LiteralPath $inputName) {
  $path = (Resolve-Path -LiteralPath $inputName -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Path)
  $resolved = [PSCustomObject]@{
    kind = 'path'
    resolvedTarget = $path
    displayName = [System.IO.Path]::GetFileName($path)
  }
} else {
  $command = Get-Command -All -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandType -eq 'Application' -and $_.Name -ieq $inputName } |
    Select-Object -First 1

  if ($null -ne $command) {
    $resolved = [PSCustomObject]@{
      kind = 'command'
      resolvedTarget = $command.Source
      displayName = $command.Name
    }
  }
}

if ($null -eq $resolved) {
  [PSCustomObject]@{ kind = $null } | ConvertTo-Json -Compress
} else {
  $resolved | ConvertTo-Json -Compress
}
`,
    20_000,
  );

  return JSON.parse(stdout) as DirectLaunchResolution;
};

const toArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (typeof value === "undefined" || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const getLaunchCandidates = async (): Promise<LaunchCandidate[]> => {
  const { stdout } = await runPs(
    `
[PSCustomObject]@{
  commands = @(
    Get-Command -All -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandType -eq 'Application' } |
      Select-Object -Property Name, Source -Unique
  )
  startApps = @(
    Get-StartApps | Select-Object -Property Name, AppID
  )
} | ConvertTo-Json -Depth 4 -Compress
`,
    30_000,
  );

  const parsed = JSON.parse(stdout) as LaunchCandidateSet;
  const commandCandidates = toArray(parsed.commands).map(
    (command): LaunchCandidate => ({
      kind: "command",
      name: command.Name,
      path: command.Source,
    }),
  );
  const startAppCandidates = toArray(parsed.startApps).map(
    (startApp): LaunchCandidate => ({
      kind: "start-app",
      name: startApp.Name,
      appId: startApp.AppID,
    }),
  );

  return [...commandCandidates, ...startAppCandidates];
};

const launchResolvedTarget = async (
  candidate: LaunchCandidate,
): Promise<{ launchMethod: string; resolvedTarget: string }> => {
  if (candidate.kind === "command") {
    await runPs(
      `
Start-Process -FilePath '${quotePsString(candidate.path)}' -ErrorAction Stop | Out-Null
`,
      20_000,
    );

    return {
      launchMethod: "command",
      resolvedTarget: candidate.path,
    };
  }

  const escapedAppId = quotePsString(candidate.appId);
  const { stdout } = await runPs(
    `
$appId = '${escapedAppId}'
if (Test-Path -LiteralPath $appId) {
  Start-Process -FilePath $appId -ErrorAction Stop | Out-Null
  [PSCustomObject]@{
    launchMethod = 'start-app-path'
    resolvedTarget = $appId
  } | ConvertTo-Json -Compress
} else {
  $shellTarget = "shell:AppsFolder\\$appId"
  Start-Process -FilePath 'explorer.exe' -ArgumentList $shellTarget -ErrorAction Stop | Out-Null
  [PSCustomObject]@{
    launchMethod = 'start-app-shell'
    resolvedTarget = $shellTarget
  } | ConvertTo-Json -Compress
}
`,
    20_000,
  );

  return JSON.parse(stdout) as { launchMethod: string; resolvedTarget: string };
};

export const registerAppTools = (server: McpServer): void => {
  server.registerTool(
    "system_launch_app",
    {
      description:
        "Launch an installed Windows application or executable by path or name, with Start menu and guarded fuzzy app-name resolution.",
      inputSchema: LaunchAppSchema,
    },
    async ({ name }) => {
      try {
        const directResolution = await resolveDirectLaunch(name);
        if (directResolution.kind === "path" || directResolution.kind === "command") {
          await runPs(
            `
Start-Process -FilePath '${quotePsString(directResolution.resolvedTarget ?? name)}' -ErrorAction Stop | Out-Null
`,
            20_000,
          );

          return successResult(
            {
              success: true,
              name,
              resolvedTarget: directResolution.resolvedTarget ?? name,
              launchMethod: directResolution.kind,
              exactMatch: true,
            },
            `Launched ${name}.`,
          );
        }

        const rankedCandidate = pickBestLaunchCandidate(name, await getLaunchCandidates());
        if (!rankedCandidate) {
          return errorResult(`Could not confidently resolve an installed application named "${name}".`);
        }

        const launchResult = await launchResolvedTarget(rankedCandidate.candidate);
        return successResult(
          {
            success: true,
            name,
            resolvedTarget: launchResult.resolvedTarget,
            launchMethod: launchResult.launchMethod,
            exactMatch: rankedCandidate.exactMatch,
            confidence: Number(rankedCandidate.score.toFixed(3)),
          },
          `Launched ${name}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Failed to launch ${name}.`);
      }
    },
  );

  server.registerTool(
    "system_close_app",
    {
      description: "Force close a running Windows process by process name.",
      inputSchema: CloseAppSchema,
    },
    async ({ name }) => {
      const escapedName = quotePsString(name);

      try {
        await runPs(`
Get-Process -Name '${escapedName}' -ErrorAction Stop | Stop-Process -Force -ErrorAction Stop
`);

        return successResult({ success: true, name }, `Closed ${name}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : `Failed to close ${name}.`);
      }
    },
  );

  server.registerTool(
    "system_list_apps",
    {
      description: "List running Windows processes with their names, PIDs, and main window titles.",
      inputSchema: EmptySchema,
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$apps = @(Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Sort-Object Name | Select-Object Name, Id, MainWindowTitle)
$apps | ConvertTo-Json -Compress
`,
          20_000,
        );

        const parsed = JSON.parse(stdout) as Array<{ Name: string; Id: number; MainWindowTitle: string }>;
        const apps = (Array.isArray(parsed) ? parsed : [parsed]).map((app) => ({
          name: app.Name,
          pid: app.Id,
          mainWindowTitle: app.MainWindowTitle,
        }));

        return successResult({ apps }, `Found ${apps.length} running processes.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list running applications.");
      }
    },
  );
};
