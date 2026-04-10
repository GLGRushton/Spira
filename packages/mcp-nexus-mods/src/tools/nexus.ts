import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NexusModsClient } from "../util/nexus-client.js";
import { errorResult, successResult } from "../util/results.js";
import {
  DownloadModFileSchema,
  GetGameSchema,
  GetModFilesSchema,
  SearchGamesSchema,
  SearchModsSchema,
} from "../util/validation.js";

const client = new NexusModsClient();

export const registerNexusTools = (server: McpServer): void => {
  server.registerTool(
    "nexus_search_games",
    {
      description: "Search Nexus Mods games by name so you can identify the game you want to mod.",
      inputSchema: SearchGamesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ query, limit, offset }) => {
      try {
        const result = await client.searchGames({ query, limit, offset });
        return successResult(result);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to search Nexus games.");
      }
    },
  );

  server.registerTool(
    "nexus_get_game",
    {
      description: "Get a Nexus Mods game by domain name or numeric ID.",
      inputSchema: GetGameSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, domainName }) => {
      try {
        const game = await client.getGame({ id, domainName });
        if (!game) {
          return errorResult("No Nexus game matched that identifier.");
        }

        return successResult({ game });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get Nexus game.");
      }
    },
  );

  server.registerTool(
    "nexus_search_mods",
    {
      description: "Search Nexus Mods within a specific game's domain, optionally narrowing by search text.",
      inputSchema: SearchModsSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ gameDomainName, query, directDownloadOnly, limit, offset }) => {
      try {
        const result = await client.searchMods({ gameDomainName, query, directDownloadOnly, limit, offset });
        return successResult(result);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to search Nexus mods.");
      }
    },
  );

  server.registerTool(
    "nexus_get_mod_files",
    {
      description: "List Nexus file entries for a mod using the game ID and mod ID returned by search results.",
      inputSchema: GetModFilesSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ gameId, modId }) => {
      try {
        const files = await client.getModFiles({ gameId, modId });
        return successResult({ files, totalCount: files.length });
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to get Nexus mod files.");
      }
    },
  );

  server.registerTool(
    "nexus_download_file",
    {
      description:
        "Download a Nexus mod file to disk using the game's domain name, mod ID, file ID, and optional file URI or target directory.",
      inputSchema: DownloadModFileSchema,
    },
    async ({ gameDomainName, modId, fileId, fileUri, fileName, targetDirectory }) => {
      try {
        const download = await client.downloadFile({
          gameDomainName,
          modId,
          fileId,
          fileUri,
          fileName,
          targetDirectory,
        });
        return successResult(download);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to download Nexus file.");
      }
    },
  );
};
