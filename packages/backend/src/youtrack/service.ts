import {
  DEFAULT_YOUTRACK_STATE_MAPPING,
  type Env,
  type YouTrackAccountSummary,
  type YouTrackLinkedIssueSummary,
  type YouTrackProjectSummary,
  type YouTrackStateMapping,
  type YouTrackStatusSummary,
  type YouTrackTicketSummary,
} from "@spira/shared";
import fetch from "node-fetch";
import type { Logger } from "pino";
import { YouTrackError } from "../util/errors.js";

interface YouTrackIssueFieldValue {
  name?: string;
  fullName?: string;
  login?: string;
}

interface YouTrackIssueField {
  name?: string;
  value?: YouTrackIssueFieldValue | null;
}

interface YouTrackApiIssue {
  idReadable?: string;
  summary?: string;
  updated?: number;
  project?: {
    shortName?: string;
    name?: string;
  } | null;
  customFields?: YouTrackIssueField[];
  parent?: YouTrackApiIssueLink | null;
  subtasks?: YouTrackApiIssueLink | null;
}

interface YouTrackApiIssueLink {
  issues?: YouTrackApiIssue[];
}

interface YouTrackCurrentUserResponse {
  login?: string;
  name?: string | null;
  fullName?: string | null;
}

interface YouTrackApiProject {
  id?: string;
  shortName?: string;
  name?: string;
}

const YOUTRACK_REQUEST_TIMEOUT_MS = 10_000;

const cloneStateMapping = (): YouTrackStateMapping => ({
  todo: [...DEFAULT_YOUTRACK_STATE_MAPPING.todo],
  inProgress: [...DEFAULT_YOUTRACK_STATE_MAPPING.inProgress],
});

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, "");

const buildHeaders = (token: string): Record<string, string> => ({
  Accept: "application/json",
  Authorization: `Bearer ${token}`,
});

const normalizeStateName = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const normalizeIssueTypeName = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const isLocalHostname = (hostname: string): boolean =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";

const validateApiBaseUrl = (baseUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new YouTrackError("YouTrack base URL must be a valid absolute URL.", error);
  }

  if (parsed.protocol === "https:") {
    return parsed.toString().replace(/\/+$/, "");
  }

  if (parsed.protocol === "http:" && isLocalHostname(parsed.hostname)) {
    return parsed.toString().replace(/\/+$/, "");
  }

  throw new YouTrackError("YouTrack base URL must use https:// unless it points to localhost.");
};

const getCustomFieldValue = (issue: YouTrackApiIssue, fieldName: string): YouTrackIssueFieldValue | null => {
  const field = issue.customFields?.find((candidate) => candidate.name === fieldName);
  return field?.value ?? null;
};

export const matchesYouTrackState = (state: string | null | undefined, mapping: YouTrackStateMapping): boolean => {
  const normalizedState = normalizeStateName(state);
  if (!normalizedState) {
    return false;
  }

  return [...mapping.todo, ...mapping.inProgress]
    .map((entry: string) => normalizeStateName(entry))
    .some((entry: string | null) => entry === normalizedState);
};

const matchesYouTrackInProgressState = (state: string | null | undefined, mapping: YouTrackStateMapping): boolean => {
  const normalizedState = normalizeStateName(state);
  if (!normalizedState) {
    return false;
  }

  return mapping.inProgress
    .map((entry: string) => normalizeStateName(entry))
    .some((entry: string | null) => entry === normalizedState);
};

const getIssueType = (issue: YouTrackApiIssue): string | null => getCustomFieldValue(issue, "Type")?.name ?? null;

const isEpicType = (type: string | null | undefined): boolean => normalizeIssueTypeName(type) === "epic";

const mapLinkedIssue = (baseUrl: string, issue: YouTrackApiIssue): YouTrackLinkedIssueSummary | null => {
  if (!issue.idReadable || !issue.summary || !issue.project?.shortName || !issue.project.name) {
    return null;
  }

  return {
    id: issue.idReadable,
    summary: issue.summary,
    url: `${baseUrl}/issue/${issue.idReadable}`,
    projectKey: issue.project.shortName,
    projectName: issue.project.name,
    type: getIssueType(issue),
    state: getCustomFieldValue(issue, "State")?.name ?? null,
  };
};

export const mapYouTrackIssue = (
  baseUrl: string,
  issue: YouTrackApiIssue,
  stateMapping: YouTrackStateMapping = cloneStateMapping(),
): YouTrackTicketSummary | null => {
  if (!issue.idReadable || !issue.summary || !issue.project?.shortName || !issue.project.name) {
    return null;
  }

  const state = getCustomFieldValue(issue, "State")?.name ?? null;
  const type = getIssueType(issue);
  const assignee =
    getCustomFieldValue(issue, "Assignee")?.login ?? getCustomFieldValue(issue, "Assignee")?.name ?? null;
  const parent =
    issue.parent?.issues?.flatMap((linkedIssue) => {
      const mappedIssue = mapLinkedIssue(baseUrl, linkedIssue);
      return mappedIssue ? [mappedIssue] : [];
    })[0] ?? null;
  const subtasks =
    issue.subtasks?.issues?.flatMap((linkedIssue) => {
      const mappedIssue = mapLinkedIssue(baseUrl, linkedIssue);
      return mappedIssue ? [mappedIssue] : [];
    }) ?? [];
  const blockedReason =
    parent && isEpicType(parent.type) && matchesYouTrackInProgressState(parent.state, stateMapping)
      ? `${parent.id} is already active (${parent.state ?? "In Progress"}). Pick up the epic instead of the child task.`
      : null;

  return {
    id: issue.idReadable,
    summary: issue.summary,
    url: `${baseUrl}/issue/${issue.idReadable}`,
    projectKey: issue.project.shortName,
    projectName: issue.project.name,
    type,
    state,
    assignee,
    updatedAt: typeof issue.updated === "number" ? issue.updated : null,
    isEpic: isEpicType(type),
    parent,
    subtasks,
    blockedReason,
  };
};

export const mapYouTrackProject = (project: YouTrackApiProject): YouTrackProjectSummary | null => {
  if (!project.id || !project.shortName || !project.name) {
    return null;
  }

  return {
    id: project.id,
    shortName: project.shortName,
    name: project.name,
  };
};

export class YouTrackService {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
    private readonly stateMapping: YouTrackStateMapping = cloneStateMapping(),
  ) {}

  getStateMapping(): YouTrackStateMapping {
    return {
      todo: [...this.stateMapping.todo],
      inProgress: [...this.stateMapping.inProgress],
    };
  }

  getBaseUrl(): string | null {
    return this.env.YOUTRACK_BASE_URL?.trim() ? normalizeBaseUrl(this.env.YOUTRACK_BASE_URL) : null;
  }

  isConfigured(): boolean {
    return Boolean(this.getBaseUrl() && this.env.YOUTRACK_TOKEN?.trim());
  }

  async getStatus(enabled: boolean): Promise<YouTrackStatusSummary> {
    const baseUrl = this.getBaseUrl();
    const configured = this.isConfigured();
    const stateMapping = this.getStateMapping();

    if (!enabled) {
      return {
        enabled,
        configured,
        state: "disabled",
        baseUrl,
        account: null,
        stateMapping,
        message: configured
          ? "YouTrack integration is configured but currently disabled."
          : "Enable YouTrack after adding an instance URL and permanent token.",
      };
    }

    if (!configured || !baseUrl) {
      return {
        enabled,
        configured,
        state: "missing-config",
        baseUrl,
        account: null,
        stateMapping,
        message: "Add a YouTrack base URL and permanent token to connect Spira natively.",
      };
    }

    try {
      const account = await this.fetchCurrentUser();
      return {
        enabled,
        configured,
        state: "connected",
        baseUrl,
        account,
        stateMapping,
        message: `Authenticated as ${account.fullName ?? account.login}.`,
      };
    } catch (error) {
      this.logger.warn({ err: error }, "Failed to authenticate with YouTrack");
      return {
        enabled,
        configured,
        state: "error",
        baseUrl,
        account: null,
        stateMapping,
        message: error instanceof Error ? error.message : "Failed to authenticate with YouTrack.",
      };
    }
  }

  async listAssignedTickets(enabled: boolean, limit = 10): Promise<YouTrackTicketSummary[]> {
    if (!enabled) {
      return [];
    }

    const baseUrl = this.getBaseUrl();
    const token = this.env.YOUTRACK_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new YouTrackError("YouTrack is not fully configured.");
    }
    const apiBaseUrl = validateApiBaseUrl(baseUrl);

    const effectiveLimit = Math.max(limit, 1);
    const query = encodeURIComponent("assignee: me");
    const fields = encodeURIComponent(
      "idReadable,summary,updated,project(shortName,name),customFields(name,value(name,fullName,login)),parent(issues(idReadable,summary,project(shortName,name),customFields(name,value(name)))),subtasks(issues(idReadable,summary,project(shortName,name),customFields(name,value(name))))",
    );
    const pageSize = Math.max(effectiveLimit * 2, 20);
    const matchedIssues: YouTrackTicketSummary[] = [];
    const seenIssueIds = new Set<string>();

    for (let skip = 0; matchedIssues.length < effectiveLimit; skip += pageSize) {
      const issues = await this.fetchJson<YouTrackApiIssue[]>(
        `${apiBaseUrl}/api/issues?query=${query}&$top=${pageSize}&$skip=${skip}&fields=${fields}`,
        token,
        "ticket query",
      );

      if (issues.length === 0) {
        break;
      }

      for (const issue of issues) {
        const mappedIssue = mapYouTrackIssue(baseUrl, issue, this.stateMapping);
        if (!mappedIssue || !matchesYouTrackState(mappedIssue.state, this.stateMapping)) {
          continue;
        }
        if (seenIssueIds.has(mappedIssue.id)) {
          continue;
        }

        seenIssueIds.add(mappedIssue.id);
        matchedIssues.push(mappedIssue);
      }

      if (issues.length < pageSize) {
        break;
      }
    }

    return matchedIssues.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)).slice(0, effectiveLimit);
  }

  async searchProjects(enabled: boolean, query: string, limit = 8): Promise<YouTrackProjectSummary[]> {
    if (!enabled) {
      return [];
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return [];
    }

    const baseUrl = this.getBaseUrl();
    const token = this.env.YOUTRACK_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new YouTrackError("YouTrack is not fully configured.");
    }
    const apiBaseUrl = validateApiBaseUrl(baseUrl);
    const effectiveLimit = Math.max(limit, 1);
    const fields = encodeURIComponent("id,shortName,name");
    const projects = await this.fetchJson<YouTrackApiProject[]>(
      `${apiBaseUrl}/api/admin/projects?query=${encodeURIComponent(trimmedQuery)}&$top=${effectiveLimit}&fields=${fields}`,
      token,
      "project search",
    );

    return projects
      .flatMap((project) => {
        const mappedProject = mapYouTrackProject(project);
        return mappedProject ? [mappedProject] : [];
      })
      .sort((left, right) => left.shortName.localeCompare(right.shortName));
  }

  private async fetchCurrentUser(): Promise<YouTrackAccountSummary> {
    const baseUrl = this.getBaseUrl();
    const token = this.env.YOUTRACK_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new YouTrackError("YouTrack is not fully configured.");
    }
    const apiBaseUrl = validateApiBaseUrl(baseUrl);

    const user = await this.fetchJson<YouTrackCurrentUserResponse>(
      `${apiBaseUrl}/api/users/me?fields=login,name,fullName`,
      token,
      "authentication",
    );
    if (!user.login) {
      throw new YouTrackError("YouTrack did not return an authenticated user.");
    }

    return {
      login: user.login,
      name: user.name ?? null,
      fullName: user.fullName ?? null,
    };
  }

  private async fetchJson<T>(url: string, token: string, operation: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), YOUTRACK_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: buildHeaders(token),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        throw new YouTrackError(`YouTrack ${operation} failed with status ${response.status}: ${body}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new YouTrackError(`YouTrack ${operation} timed out after ${YOUTRACK_REQUEST_TIMEOUT_MS}ms.`, error);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
