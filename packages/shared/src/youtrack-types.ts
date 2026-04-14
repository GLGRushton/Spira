export interface YouTrackStateMapping {
  todo: string[];
  inProgress: string[];
}

export const DEFAULT_YOUTRACK_STATE_MAPPING: YouTrackStateMapping = {
  todo: ["Submitted", "Open"],
  inProgress: ["In Progress"],
};

export interface YouTrackAccountSummary {
  login: string;
  name: string | null;
  fullName: string | null;
}

export interface YouTrackStatusSummary {
  enabled: boolean;
  configured: boolean;
  state: "disabled" | "missing-config" | "connected" | "error";
  baseUrl: string | null;
  account: YouTrackAccountSummary | null;
  stateMapping: YouTrackStateMapping;
  message: string;
}

export interface YouTrackTicketSummary {
  id: string;
  summary: string;
  url: string;
  projectKey: string;
  projectName: string;
  type: string | null;
  state: string | null;
  assignee: string | null;
  updatedAt: number | null;
  isEpic: boolean;
  parent: YouTrackLinkedIssueSummary | null;
  subtasks: YouTrackLinkedIssueSummary[];
  blockedReason: string | null;
}

export interface YouTrackProjectSummary {
  id: string;
  shortName: string;
  name: string;
}

export interface YouTrackLinkedIssueSummary {
  id: string;
  summary: string;
  url: string;
  projectKey: string;
  projectName: string;
  type: string | null;
  state: string | null;
}
