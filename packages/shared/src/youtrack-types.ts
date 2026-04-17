export interface YouTrackStateMapping {
  todo: string[];
  inProgress: string[];
}

export const DEFAULT_YOUTRACK_STATE_MAPPING: YouTrackStateMapping = {
  todo: ["Submitted", "Open"],
  inProgress: ["In Progress"],
};

const normalizeYouTrackStateName = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const normalizeYouTrackStateList = (states: readonly string[] | null | undefined): string[] => {
  const normalizedStates: string[] = [];
  const seen = new Set<string>();

  for (const state of states ?? []) {
    const trimmed = state.trim();
    const normalizedName = normalizeYouTrackStateName(trimmed);
    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }

    seen.add(normalizedName);
    normalizedStates.push(trimmed);
  }

  return normalizedStates;
};

export const normalizeYouTrackStateMapping = (mapping: Partial<YouTrackStateMapping> | null | undefined): YouTrackStateMapping => ({
  todo: normalizeYouTrackStateList(mapping?.todo),
  inProgress: normalizeYouTrackStateList(mapping?.inProgress),
});

const buildYouTrackStateLookup = (availableStates: readonly string[]): Map<string, string> => {
  const lookup = new Map<string, string>();

  for (const state of normalizeYouTrackStateList(availableStates)) {
    const normalizedName = normalizeYouTrackStateName(state);
    if (normalizedName) {
      lookup.set(normalizedName, state);
    }
  }

  return lookup;
};

export interface YouTrackStateMappingValidation {
  mapping: YouTrackStateMapping;
  invalidTodoStates: string[];
  invalidInProgressStates: string[];
  overlappingStates: string[];
}

export const validateYouTrackStateMapping = (
  mapping: YouTrackStateMapping,
  availableStates: readonly string[],
): YouTrackStateMappingValidation => {
  const normalizedMapping = normalizeYouTrackStateMapping(mapping);
  const lookup = buildYouTrackStateLookup(availableStates);
  const invalidTodoStates: string[] = [];
  const invalidInProgressStates: string[] = [];

  const todo = normalizedMapping.todo.map((state) => {
    const canonical = lookup.get(normalizeYouTrackStateName(state) ?? "");
    if (!canonical) {
      invalidTodoStates.push(state);
      return state;
    }

    return canonical;
  });

  const inProgress = normalizedMapping.inProgress.map((state) => {
    const canonical = lookup.get(normalizeYouTrackStateName(state) ?? "");
    if (!canonical) {
      invalidInProgressStates.push(state);
      return state;
    }

    return canonical;
  });

  const todoKeys = new Set(todo.map((state) => normalizeYouTrackStateName(state)).filter((state): state is string => Boolean(state)));
  const overlappingStates: string[] = [];
  const seenOverlaps = new Set<string>();

  for (const state of inProgress) {
    const normalizedName = normalizeYouTrackStateName(state);
    if (!normalizedName || !todoKeys.has(normalizedName) || seenOverlaps.has(normalizedName)) {
      continue;
    }

    seenOverlaps.add(normalizedName);
    overlappingStates.push(lookup.get(normalizedName) ?? state);
  }

  return {
    mapping: {
      todo,
      inProgress,
    },
    invalidTodoStates,
    invalidInProgressStates,
    overlappingStates,
  };
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
  availableStates: string[];
  message: string;
}

export interface YouTrackTicketSummary {
  id: string;
  summary: string;
  url: string;
  projectKey: string;
  projectName: string;
  state: string | null;
  assignee: string | null;
  updatedAt: number | null;
}

export interface YouTrackProjectSummary {
  id: string;
  shortName: string;
  name: string;
}
