import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { getNexusApiKey } from "./env.js";

const GRAPHQL_ENDPOINT = "https://api.nexusmods.com/v2/graphql";
const DOWNLOAD_LINK_TEMPLATE =
  "https://api.nexusmods.com/v1/games/{game}/mods/{modId}/files/{fileId}/download_link.json";
const APPLICATION_NAME = "Spira";
const APPLICATION_VERSION = "0.1.0";

interface GraphQlError {
  readonly message: string;
}

interface GraphQlResponse<TData> {
  readonly data?: TData;
  readonly errors?: GraphQlError[];
}

interface GameNode {
  readonly id: number;
  readonly name: string;
  readonly domainName: string;
  readonly genre: string | null;
  readonly modCount: number | null;
  readonly downloadCount: string | number | null;
  readonly uniqueDownloadCount: string | number | null;
  readonly forumUrl: string | null;
}

interface GameSearchResponse {
  readonly games: {
    readonly totalCount: number;
    readonly nodes: GameNode[];
  };
}

interface GetGameResponse {
  readonly game: GameNode | null;
}

interface ModNode {
  readonly id: string;
  readonly modId: number;
  readonly name: string;
  readonly summary: string;
  readonly version: string;
  readonly author: string | null;
  readonly category: string;
  readonly pictureUrl: string | null;
  readonly directDownloadEnabled: boolean;
  readonly endorsements: number;
  readonly downloads: number;
  readonly fileSize: number | null;
  readonly adultContent: boolean | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly game: {
    readonly id: number;
    readonly name: string;
    readonly domainName: string;
  };
}

interface ModSearchResponse {
  readonly mods: {
    readonly totalCount: number;
    readonly nodes: ModNode[];
  };
}

interface ModFileNode {
  readonly id: string;
  readonly uid: string;
  readonly fileId: number;
  readonly name: string;
  readonly version: string;
  readonly category: string;
  readonly categoryId: number;
  readonly primary: number;
  readonly size: number | null;
  readonly sizeInBytes: string | null;
  readonly totalDownloads: number | null;
  readonly uniqueDownloads: number | null;
  readonly uri: string;
}

interface ModFilesResponse {
  readonly modFiles: ModFileNode[];
}

interface DownloadLinkEntry {
  readonly name: string;
  readonly short_name: string;
  readonly URI: string;
}

export interface SearchGamesParams {
  readonly query: string;
  readonly limit: number;
  readonly offset: number;
}

export interface SearchModsParams {
  readonly gameDomainName: string;
  readonly query?: string;
  readonly directDownloadOnly: boolean;
  readonly limit: number;
  readonly offset: number;
}

export interface DownloadFileParams {
  readonly gameDomainName: string;
  readonly modId: string;
  readonly fileId: string;
  readonly fileUri?: string;
  readonly fileName?: string;
  readonly targetDirectory?: string;
}

const toErrorMessage = (errors: GraphQlError[] | undefined, fallback: string): string => {
  if (!errors || errors.length === 0) {
    return fallback;
  }

  return errors.map((error) => error.message).join(" | ");
};

const safeSegment = (value: string): string =>
  [...value]
    .map((character) => {
      if ('<>:"/\\|?*'.includes(character) || character.charCodeAt(0) < 32) {
        return "-";
      }

      return character;
    })
    .join("")
    .trim() || "download";

const resolveDownloadDirectory = (gameDomainName: string, targetDirectory?: string): string => {
  if (targetDirectory?.trim()) {
    return path.isAbsolute(targetDirectory) ? targetDirectory : path.resolve(process.cwd(), targetDirectory);
  }

  return path.join(os.homedir(), "Downloads", "Spira", "Nexus Mods", safeSegment(gameDomainName));
};

const resolveDownloadFileName = (
  params: Pick<DownloadFileParams, "fileName" | "fileUri" | "modId" | "fileId">,
): string => {
  if (params.fileName?.trim()) {
    return safeSegment(params.fileName);
  }

  if (params.fileUri?.trim()) {
    const normalized = decodeURIComponent(params.fileUri.replaceAll("\\", "/"));
    return safeSegment(path.posix.basename(normalized));
  }

  return `nexus-mod-${params.modId}-file-${params.fileId}.bin`;
};

export class NexusModsClient {
  private readonly apiKey = getNexusApiKey();

  private async graphqlRequest<TData>(query: string, variables: Record<string, unknown>): Promise<TData> {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        apikey: this.apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Nexus GraphQL request failed with ${response.status} ${response.statusText}.`);
    }

    const payload = (await response.json()) as GraphQlResponse<TData>;
    if (!payload.data) {
      throw new Error(toErrorMessage(payload.errors, "Nexus GraphQL response did not include data."));
    }

    if (payload.errors?.length) {
      throw new Error(toErrorMessage(payload.errors, "Nexus GraphQL returned errors."));
    }

    return payload.data;
  }

  async searchGames(params: SearchGamesParams): Promise<{ totalCount: number; games: GameNode[] }> {
    const data = await this.graphqlRequest<GameSearchResponse>(
      `
        query SearchGames($count: Int!, $offset: Int!, $search: String!) {
          games(
            count: $count
            offset: $offset
            filter: { name: [{ value: $search, op: MATCHES }] }
            sort: [{ relevance: { direction: DESC } }, { mods: { direction: DESC } }]
          ) {
            totalCount
            nodes {
              id
              name
              domainName
              genre
              modCount
              downloadCount
              uniqueDownloadCount
              forumUrl
            }
          }
        }
      `,
      { count: params.limit, offset: params.offset, search: params.query },
    );

    const games = data.games.nodes;
    if (games.length > 0) {
      return { totalCount: data.games.totalCount, games };
    }

    const exact = await this.getGame({ domainName: params.query }).catch(() => null);
    if (!exact) {
      return { totalCount: 0, games: [] };
    }

    return { totalCount: 1, games: [exact] };
  }

  async getGame(params: { id?: string; domainName?: string }): Promise<GameNode | null> {
    const data = await this.graphqlRequest<GetGameResponse>(
      `
        query GetGame($id: ID, $domainName: String) {
          game(id: $id, domainName: $domainName) {
            id
            name
            domainName
            genre
            modCount
            downloadCount
            uniqueDownloadCount
            forumUrl
          }
        }
      `,
      {
        id: params.id,
        domainName: params.domainName,
      },
    );

    return data.game;
  }

  async searchMods(params: SearchModsParams): Promise<{ totalCount: number; mods: ModNode[] }> {
    const search = params.query?.trim();
    const sortParts = search
      ? [
          "{ relevance: { direction: DESC } }",
          "{ endorsements: { direction: DESC } }",
          "{ downloads: { direction: DESC } }",
        ]
      : ["{ endorsements: { direction: DESC } }", "{ downloads: { direction: DESC } }"];

    const filterParts = ["gameDomainName: [{ value: $gameDomainName, op: EQUALS }]"];
    if (search) {
      filterParts.push("name: [{ value: $search, op: WILDCARD }]");
    }
    if (params.directDownloadOnly) {
      filterParts.push("directDownloadEnabled: [{ value: true, op: EQUALS }]");
    }

    const data = await this.graphqlRequest<ModSearchResponse>(
      `
        query SearchMods($count: Int!, $offset: Int!, $gameDomainName: String!${search ? ", $search: String!" : ""}) {
          mods(
            count: $count
            offset: $offset
            filter: { ${filterParts.join("\n")} }
            sort: [${sortParts.join(", ")}]
          ) {
            totalCount
            nodes {
              id
              modId
              name
              summary
              version
              author
              category
              pictureUrl
              directDownloadEnabled
              endorsements
              downloads
              fileSize
              adultContent
              createdAt
              updatedAt
              game {
                id
                name
                domainName
              }
            }
          }
        }
      `,
      {
        count: params.limit,
        offset: params.offset,
        gameDomainName: params.gameDomainName,
        ...(search ? { search } : {}),
      },
    );

    return { totalCount: data.mods.totalCount, mods: data.mods.nodes };
  }

  async getModFiles(params: { gameId: string; modId: string }): Promise<ModFileNode[]> {
    const data = await this.graphqlRequest<ModFilesResponse>(
      `
        query GetModFiles($gameId: ID!, $modId: ID!) {
          modFiles(gameId: $gameId, modId: $modId) {
            id
            uid
            fileId
            name
            version
            category
            categoryId
            primary
            size
            sizeInBytes
            totalDownloads
            uniqueDownloads
            uri
          }
        }
      `,
      params,
    );

    return data.modFiles;
  }

  private async getDownloadLinks(gameDomainName: string, modId: string, fileId: string): Promise<DownloadLinkEntry[]> {
    const endpoint = DOWNLOAD_LINK_TEMPLATE.replace("{game}", encodeURIComponent(gameDomainName))
      .replace("{modId}", encodeURIComponent(modId))
      .replace("{fileId}", encodeURIComponent(fileId));

    const response = await fetch(endpoint, {
      headers: {
        apikey: this.apiKey,
        accept: "application/json",
        "application-name": APPLICATION_NAME,
        "application-version": APPLICATION_VERSION,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 403) {
        throw new Error(
          `Nexus denied a direct download link for game ${gameDomainName}, mod ${modId}, file ${fileId} (403). The mod may require manual site download or account permissions. ${body}`.trim(),
        );
      }

      throw new Error(
        `Nexus download-link request failed with ${response.status} ${response.statusText}. ${body}`.trim(),
      );
    }

    return (await response.json()) as DownloadLinkEntry[];
  }

  async downloadFile(params: DownloadFileParams): Promise<{
    gameDomainName: string;
    modId: string;
    fileId: string;
    fileName: string;
    savedTo: string;
    mirrorName: string;
    bytesWritten: number | null;
  }> {
    const links = await this.getDownloadLinks(params.gameDomainName, params.modId, params.fileId);
    const link = links[0];
    if (!link) {
      throw new Error(`Nexus did not return any download mirrors for mod ${params.modId}, file ${params.fileId}.`);
    }

    const fileName = resolveDownloadFileName(params);
    const directory = resolveDownloadDirectory(params.gameDomainName, params.targetDirectory);
    const savedTo = path.join(directory, fileName);

    await mkdir(directory, { recursive: true });

    const response = await fetch(link.URI);
    if (!response.ok || !response.body) {
      throw new Error(`Downloading the Nexus file failed with ${response.status} ${response.statusText}.`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    const bytesWritten = contentLengthHeader ? Number(contentLengthHeader) : null;
    await response.body.pipeTo(Writable.toWeb(createWriteStream(savedTo)));

    return {
      gameDomainName: params.gameDomainName,
      modId: params.modId,
      fileId: params.fileId,
      fileName,
      savedTo,
      mirrorName: link.name,
      bytesWritten: Number.isFinite(bytesWritten) ? bytesWritten : null,
    };
  }
}
