import {
  DEFAULT_YOUTRACK_STATE_MAPPING,
  type Env,
  type YouTrackAccountSummary,
  type YouTrackProjectSummary,
  type YouTrackStateMapping,
  type YouTrackStatusSummary,
  type YouTrackTicketSummary,
  normalizeYouTrackStateMapping,
  validateYouTrackStateMapping,
} from "@spira/shared";
import fetch from "node-fetch";
import type { Logger } from "pino";
import { YouTrackError } from "../util/errors.js";
import { installSystemCertificateAuthorities } from "../util/tls.js";

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

interface YouTrackCustomFieldDefinition {
  name?: string;
}

interface YouTrackCustomFieldBundleValue {
  name?: string;
}

interface YouTrackCustomFieldBundle {
  values?: YouTrackCustomFieldBundleValue[] | null;
}

interface YouTrackProjectCustomField {
  field?: YouTrackCustomFieldDefinition | null;
  bundle?: YouTrackCustomFieldBundle | null;
}

interface YouTrackProjectWithCustomFields extends YouTrackApiProject {
  customFields?: YouTrackProjectCustomField[];
}

interface YouTrackCommandPayload {
  query: string;
  issues: Array<{ idReadable: string }>;
}

const YOUTRACK_REQUEST_TIMEOUT_MS = 10_000;

const cloneStateMapping = (stateMapping: YouTrackStateMapping = DEFAULT_YOUTRACK_STATE_MAPPING): YouTrackStateMapping =>
  normalizeYouTrackStateMapping(stateMapping);
type YouTrackStateMappingInspection = ReturnType<typeof validateYouTrackStateMapping>;

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
    .map((entry) => normalizeStateName(entry))
    .some((entry) => entry === normalizedState);
};

export const mapYouTrackIssue = (baseUrl: string, issue: YouTrackApiIssue): YouTrackTicketSummary | null => {
  if (!issue.idReadable || !issue.summary || !issue.project?.shortName || !issue.project.name) {
    return null;
  }

  const state = getCustomFieldValue(issue, "State")?.name ?? null;
  const assignee =
    getCustomFieldValue(issue, "Assignee")?.login ?? getCustomFieldValue(issue, "Assignee")?.name ?? null;

  return {
    id: issue.idReadable,
    summary: issue.summary,
    url: `${baseUrl}/issue/${issue.idReadable}`,
    projectKey: issue.project.shortName,
    projectName: issue.project.name,
    state,
    assignee,
    updatedAt: typeof issue.updated === "number" ? issue.updated : null,
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

export const getPreferredInProgressState = (stateMapping: YouTrackStateMapping): string => {
  const preferred = stateMapping.inProgress.find((state) => normalizeStateName(state));
  if (!preferred) {
    throw new YouTrackError("YouTrack in-progress state mapping is empty.");
  }

  return preferred.trim();
};

const buildInvalidStateMappingMessage = (
  stateMapping: Pick<YouTrackStateMappingInspection, "invalidTodoStates" | "invalidInProgressStates">,
): string | null => {
  const messages: string[] = [];
  if (stateMapping.invalidTodoStates.length > 0) {
    messages.push(`To-do states not found in YouTrack: ${stateMapping.invalidTodoStates.join(", ")}.`);
  }
  if (stateMapping.invalidInProgressStates.length > 0) {
    messages.push(`In-progress states not found in YouTrack: ${stateMapping.invalidInProgressStates.join(", ")}.`);
  }
  return messages.length > 0 ? messages.join(" ") : null;
};

export class YouTrackService {
  private stateMapping: YouTrackStateMapping;

  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
    stateMapping: YouTrackStateMapping = cloneStateMapping(),
  ) {
    this.stateMapping = cloneStateMapping(stateMapping);
  }

  getStateMapping(): YouTrackStateMapping {
    return {
      todo: [...this.stateMapping.todo],
      inProgress: [...this.stateMapping.inProgress],
    };
  }

  getBaseUrl(): string | null {
    return this.env.YOUTRACK_BASE_URL?.trim() ? normalizeBaseUrl(this.env.YOUTRACK_BASE_URL) : null;
  }

  setStateMapping(stateMapping: YouTrackStateMapping): YouTrackStateMapping {
    this.stateMapping = cloneStateMapping(stateMapping);
    return this.getStateMapping();
  }

  isConfigured(): boolean {
    return Boolean(this.getBaseUrl() && this.env.YOUTRACK_TOKEN?.trim());
  }

  async listAvailableStates(): Promise<string[]> {
    const baseUrl = this.getBaseUrl();
    const token = this.env.YOUTRACK_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new YouTrackError("YouTrack is not fully configured.");
    }

    const apiBaseUrl = validateApiBaseUrl(baseUrl);
    const fields = encodeURIComponent("id,customFields(field(name),bundle(values(name)))");
    const pageSize = 50;
    const discoveredStates = new Map<string, string>();

    for (let skip = 0; ; skip += pageSize) {
      const projects = await this.fetchJson<YouTrackProjectWithCustomFields[]>(
        `${apiBaseUrl}/api/admin/projects?$top=${pageSize}&$skip=${skip}&fields=${fields}`,
        token,
        "state discovery",
      );

      if (projects.length === 0) {
        break;
      }

      for (const project of projects) {
        for (const customField of project.customFields ?? []) {
          if (customField.field?.name !== "State") {
            continue;
          }

          for (const value of customField.bundle?.values ?? []) {
            const trimmedName = value.name?.trim();
            const normalizedName = normalizeStateName(trimmedName);
            if (!trimmedName || !normalizedName || discoveredStates.has(normalizedName)) {
              continue;
            }

            discoveredStates.set(normalizedName, trimmedName);
          }
        }
      }

      if (projects.length < pageSize) {
        break;
      }
    }

    const availableStates = [...discoveredStates.values()].sort((left, right) => left.localeCompare(right));
    if (availableStates.length === 0) {
      throw new YouTrackError("YouTrack did not return any State values for accessible projects.");
    }

    return availableStates;
  }

  async validateStateMapping(stateMapping: YouTrackStateMapping): Promise<YouTrackStateMapping> {
    return this.resolveStateMapping(stateMapping, await this.listAvailableStates());
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
        availableStates: [],
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
        availableStates: [],
        message: "Add a YouTrack base URL and permanent token to connect Spira natively.",
      };
    }

    try {
      const [account, availableStates] = await Promise.all([this.fetchCurrentUser(), this.listAvailableStates()]);
      const assessedStateMapping = this.inspectStateMapping(this.stateMapping, availableStates);
      this.stateMapping = assessedStateMapping.mapping;
      const authenticatedAs = account.fullName ?? account.login;
      const hasWorkflowMappingIssue =
        assessedStateMapping.mapping.todo.length === 0 ||
        assessedStateMapping.mapping.inProgress.length === 0 ||
        assessedStateMapping.invalidTodoStates.length > 0 ||
        assessedStateMapping.invalidInProgressStates.length > 0 ||
        assessedStateMapping.overlappingStates.length > 0;
      return {
        enabled,
        configured,
        state: "connected",
        baseUrl,
        account,
        stateMapping: this.getStateMapping(),
        availableStates,
        message: hasWorkflowMappingIssue
          ? `Authenticated as ${authenticatedAs}. Review the quarterdeck workflow state mapping.`
          : `Authenticated as ${authenticatedAs}.`,
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
        availableStates: [],
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
      "idReadable,summary,updated,project(shortName,name),customFields(name,value(name,fullName,login))",
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
        const mappedIssue = mapYouTrackIssue(baseUrl, issue);
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

  async transitionTicketToInProgress(ticketId: string): Promise<void> {
    const normalizedTicketId = ticketId.trim();
    if (!normalizedTicketId) {
      throw new YouTrackError("Ticket id is required to update a YouTrack issue.");
    }

    const baseUrl = this.getBaseUrl();
    const token = this.env.YOUTRACK_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new YouTrackError("YouTrack is not fully configured.");
    }

    const apiBaseUrl = validateApiBaseUrl(baseUrl);
    const targetState = this.resolveTransitionState(this.stateMapping, await this.listAvailableStates());
    await this.sendJson(
      `${apiBaseUrl}/api/commands`,
      token,
      {
        query: `State ${targetState}`,
        issues: [{ idReadable: normalizedTicketId }],
      },
      "ticket transition",
    );
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
    const response = await this.request(url, token, operation);
    return (await response.json()) as T;
  }

  private async sendJson(url: string, token: string, body: YouTrackCommandPayload, operation: string): Promise<void> {
    await this.request(url, token, operation, {
      method: "POST",
      headers: {
        ...buildHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  private async request(url: string, token: string, operation: string, init?: Parameters<typeof fetch>[1]) {
    installSystemCertificateAuthorities();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), YOUTRACK_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        headers: buildHeaders(token),
        signal: controller.signal,
        ...init,
      });

      if (!response.ok) {
        const body = (await response.text()).slice(0, 1000);
        throw new YouTrackError(`YouTrack ${operation} failed with status ${response.status}: ${body}`);
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new YouTrackError(`YouTrack ${operation} timed out after ${YOUTRACK_REQUEST_TIMEOUT_MS}ms.`, error);
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private inspectStateMapping(
    stateMapping: YouTrackStateMapping,
    availableStates: readonly string[],
  ): YouTrackStateMappingInspection {
    return validateYouTrackStateMapping(stateMapping, availableStates);
  }

  private resolveTransitionState(stateMapping: YouTrackStateMapping, availableStates: readonly string[]): string {
    const resolvedStateMapping = this.inspectStateMapping(stateMapping, availableStates);
    const invalidInProgressStateNames = new Set(
      resolvedStateMapping.invalidInProgressStates
        .map((state) => normalizeStateName(state))
        .filter((state): state is string => Boolean(state)),
    );
    const supportedInProgressStates = resolvedStateMapping.mapping.inProgress.filter((state) => {
      const normalizedState = normalizeStateName(state);
      return normalizedState !== null && !invalidInProgressStateNames.has(normalizedState);
    });

    if (supportedInProgressStates.length > 0) {
      return getPreferredInProgressState({
        todo: resolvedStateMapping.mapping.todo,
        inProgress: supportedInProgressStates,
      });
    }

    if (resolvedStateMapping.mapping.inProgress.length === 0) {
      throw new YouTrackError("Select at least one In-progress YouTrack state.");
    }

    const invalidStateMessage = buildInvalidStateMappingMessage(resolvedStateMapping);
    if (invalidStateMessage) {
      throw new YouTrackError(invalidStateMessage);
    }

    throw new YouTrackError("Select at least one In-progress YouTrack state.");
  }

  private resolveStateMapping(
    stateMapping: YouTrackStateMapping,
    availableStates: readonly string[],
  ): YouTrackStateMapping {
    const resolvedMapping = this.inspectStateMapping(stateMapping, availableStates);
    if (resolvedMapping.mapping.todo.length === 0) {
      throw new YouTrackError("Select at least one To-do YouTrack state.");
    }

    if (resolvedMapping.mapping.inProgress.length === 0) {
      throw new YouTrackError("Select at least one In-progress YouTrack state.");
    }

    const invalidStateMessage = buildInvalidStateMappingMessage(resolvedMapping);
    if (invalidStateMessage) {
      throw new YouTrackError(invalidStateMessage);
    }

    if (resolvedMapping.overlappingStates.length > 0) {
      throw new YouTrackError(
        `State mapping cannot place the same state in both To-do and In-progress: ${resolvedMapping.overlappingStates.join(", ")}.`,
      );
    }

    this.stateMapping = resolvedMapping.mapping;
    return this.getStateMapping();
  }
}
