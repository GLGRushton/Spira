import {
  normalizeYouTrackStateMapping,
  type YouTrackStateMapping,
  validateYouTrackStateMapping,
} from "@spira/shared";

export interface YouTrackStateMappingDraftAssessment {
  mapping: YouTrackStateMapping;
  invalidTodoStates: string[];
  invalidInProgressStates: string[];
  overlappingStates: string[];
  errors: string[];
}

const hasOrderedStateListChanged = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) {
    return true;
  }

  return left.some((state, index) => state !== right[index]);
};

export const haveYouTrackStateMappingsChanged = (
  left: YouTrackStateMapping,
  right: YouTrackStateMapping,
): boolean => {
  const normalizedLeft = normalizeYouTrackStateMapping(left);
  const normalizedRight = normalizeYouTrackStateMapping(right);
  return (
    hasOrderedStateListChanged(normalizedLeft.todo, normalizedRight.todo) ||
    hasOrderedStateListChanged(normalizedLeft.inProgress, normalizedRight.inProgress)
  );
};

export const assessYouTrackStateMappingDraft = (
  mapping: YouTrackStateMapping,
  availableStates: readonly string[],
): YouTrackStateMappingDraftAssessment => {
  const validation = validateYouTrackStateMapping(mapping, availableStates);
  const errors: string[] = [];

  if (validation.mapping.todo.length === 0) {
    errors.push("Select at least one To-do YouTrack state.");
  }

  if (validation.mapping.inProgress.length === 0) {
    errors.push("Select at least one In-progress YouTrack state.");
  }

  if (validation.invalidTodoStates.length > 0) {
    errors.push(`To-do states not found in YouTrack: ${validation.invalidTodoStates.join(", ")}.`);
  }

  if (validation.invalidInProgressStates.length > 0) {
    errors.push(`In-progress states not found in YouTrack: ${validation.invalidInProgressStates.join(", ")}.`);
  }

  if (validation.overlappingStates.length > 0) {
    errors.push(
      `State mapping cannot place the same state in both To-do and In-progress: ${validation.overlappingStates.join(", ")}.`,
    );
  }

  return {
    ...validation,
    errors,
  };
};
