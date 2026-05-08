import { createHash } from "node:crypto";
import type {
  WorkSessionPatchAttempt,
  WorkSessionPhase,
  WorkSessionPhaseEntry,
  WorkSessionSnapshot,
  WorkSessionValidationResult,
} from "@spira/shared";
import type { RuntimeSessionContract } from "../../runtime/runtime-contract.js";
import {
  WORK_SESSION_MAX_IMPLEMENTATION_ATTEMPTS,
  WORK_SESSION_MAX_REPEAT_FAILURES,
  WORK_SESSION_VALIDATION_COMMAND_TOKENS,
  WORK_SESSION_WORKFLOW_PHASES,
  type WorkSessionToolCompletion,
} from "./shared.js";

export const extractWorkSessionSearchTerms = (text: string): string[] => {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length < 3 || seen.has(token)) {
      continue;
    }
    seen.add(token);
    terms.push(token);
    if (terms.length >= 8) {
      break;
    }
  }
  return terms;
};

export const getNonWorkSessionWorkflowPhaseHistory = (
  phaseHistory: RuntimeSessionContract["workflowState"]["phaseHistory"],
): RuntimeSessionContract["workflowState"]["phaseHistory"] =>
  phaseHistory.filter(
    (entry) =>
      !WORK_SESSION_WORKFLOW_PHASES.includes(entry.phase as WorkSessionPhase) &&
      entry.phase !== "review" &&
      entry.phase !== "complete",
  );

export const createInitialWorkSessionPhaseHistory = (now: number, summary: string): WorkSessionPhaseEntry[] => [
  {
    phase: "classify",
    status: "complete",
    summary,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  },
  {
    phase: "discover",
    status: "active",
    summary: "Discovering repository context.",
    startedAt: now,
    updatedAt: now,
  },
  {
    phase: "summarise",
    status: "pending",
    summary: null,
    startedAt: now,
    updatedAt: now,
  },
  {
    phase: "plan",
    status: "pending",
    summary: null,
    startedAt: now,
    updatedAt: now,
  },
  {
    phase: "implement",
    status: "pending",
    summary: null,
    startedAt: now,
    updatedAt: now,
  },
  {
    phase: "validate",
    status: "pending",
    summary: null,
    startedAt: now,
    updatedAt: now,
  },
];

export const setWorkSessionPhase = (
  snapshot: WorkSessionSnapshot,
  phase: WorkSessionPhase,
  status: "pending" | "active" | "complete" | "skipped",
  occurredAt: number,
  summary: string | null,
): WorkSessionSnapshot => ({
  ...snapshot,
  currentPhase: status === "active" ? phase : snapshot.currentPhase,
  summary,
  phaseHistory: snapshot.phaseHistory.map((entry) => {
    if (entry.phase !== phase) {
      return entry;
    }
    return {
      ...entry,
      status,
      summary,
      updatedAt: occurredAt,
      completedAt: status === "complete" || status === "skipped" ? occurredAt : null,
    };
  }),
});

export const compactAssistantSummary = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
};

export const getToolArgsRecord = (args: unknown): Record<string, unknown> =>
  args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

export const getToolStringArg = (args: Record<string, unknown>, key: string): string | null => {
  const value = args[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

export const mergeUniqueStrings = (existing: readonly string[] | undefined, incoming: readonly string[]): string[] => [
  ...new Set([...(existing ?? []), ...incoming.filter((entry) => entry.trim().length > 0)]),
];

export const extractChangedFilesFromPatch = (patch: string): string[] => {
  const changedFiles = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const updateMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (updateMatch?.[1]) {
      changedFiles.add(updateMatch[1].trim());
      continue;
    }
    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch?.[1]) {
      changedFiles.add(moveMatch[1].trim());
      continue;
    }
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (diffMatch?.[2]) {
      changedFiles.add(diffMatch[2].trim());
      continue;
    }
    const renameMatch = line.match(/^rename to (.+)$/);
    if (renameMatch?.[1]) {
      changedFiles.add(renameMatch[1].trim());
    }
  }
  return [...changedFiles];
};

export const getChangedFilesFromToolCall = (toolName: string, args: Record<string, unknown>): string[] => {
  if (toolName === "write_file") {
    const path = getToolStringArg(args, "path");
    return path ? [path] : [];
  }
  if (toolName === "apply_patch") {
    const patch = getToolStringArg(args, "patch");
    return patch ? extractChangedFilesFromPatch(patch) : [];
  }
  return [];
};

export const getValidationCommand = (toolName: string, args: Record<string, unknown>): string | null => {
  if (toolName === "powershell") {
    return getToolStringArg(args, "command") ?? getToolStringArg(args, "description");
  }
  return null;
};

export const isValidationCommand = (command: string): boolean => {
  const tokens = command
    .toLowerCase()
    .split(/[\s|&;]+/)
    .map((token) => token.trim().replace(/^['"]+|['"]+$/g, ""))
    .filter((token) => token.length > 0);
  return tokens.some((token) => WORK_SESSION_VALIDATION_COMMAND_TOKENS.has(token));
};

export const unwrapProviderToolResult = (result: unknown): unknown => {
  if (!result || typeof result !== "object") {
    return result;
  }
  const textResultForLlm = (result as Record<string, unknown>).textResultForLlm;
  if (typeof textResultForLlm !== "string" || textResultForLlm.trim().length === 0) {
    return result;
  }
  try {
    return JSON.parse(textResultForLlm);
  } catch {
    return textResultForLlm;
  }
};

export const getPowerShellSessionShellId = (result: unknown): string | null => {
  const resolvedResult = unwrapProviderToolResult(result);
  if (!resolvedResult || typeof resolvedResult !== "object") {
    return null;
  }
  const shellId = (resolvedResult as Record<string, unknown>).shellId;
  return typeof shellId === "string" && shellId.trim().length > 0 ? shellId.trim() : null;
};

export const getPowerShellSessionStatus = (result: unknown): string | null => {
  const resolvedResult = unwrapProviderToolResult(result);
  if (!resolvedResult || typeof resolvedResult !== "object") {
    return null;
  }
  const status = (resolvedResult as Record<string, unknown>).status;
  return typeof status === "string" && status.trim().length > 0 ? status.trim() : null;
};

export const getPowerShellExitCode = (result: unknown): number | null => {
  const resolvedResult = unwrapProviderToolResult(result);
  if (!resolvedResult || typeof resolvedResult !== "object") {
    return null;
  }
  const exitCode = (resolvedResult as Record<string, unknown>).exitCode;
  return typeof exitCode === "number" ? exitCode : null;
};

export const didValidationToolSucceed = (tool: WorkSessionToolCompletion): boolean => {
  if (tool.toolName === "powershell" || tool.toolName === "read_powershell") {
    const status = getPowerShellSessionStatus(tool.result);
    const exitCode = getPowerShellExitCode(tool.result);
    if (status === "running" || status === "idle") {
      return false;
    }
    if (status === "failed" || status === "stopped" || status === "cancelled" || status === "unrecoverable") {
      return false;
    }
    if (status === "completed") {
      return exitCode === null ? tool.success : exitCode === 0;
    }
  }
  return tool.success;
};

export const summarizeChangedFiles = (changedFiles: readonly string[]): string => {
  if (changedFiles.length === 0) {
    return "repository changes";
  }
  if (changedFiles.length === 1) {
    return changedFiles[0] ?? "repository changes";
  }
  return `${changedFiles[0]}, ${changedFiles[1]}${changedFiles.length > 2 ? ", ..." : ""}`;
};

export const getValidationDetail = (result: unknown, errorMessage: string | null): string | null => {
  if (errorMessage?.trim()) {
    return errorMessage.trim();
  }
  const resolvedResult = unwrapProviderToolResult(result);
  if (typeof resolvedResult === "string" && resolvedResult.trim()) {
    return resolvedResult.trim();
  }
  if (resolvedResult && typeof resolvedResult === "object") {
    const resultRecord = resolvedResult as Record<string, unknown>;
    for (const key of ["error", "message", "summary", "stderr", "stdout", "output", "textResultForLlm"]) {
      const value = resultRecord[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    const stableFallback = [resultRecord.command, resultRecord.description, resultRecord.status, resultRecord.exitCode]
      .map((value) => (typeof value === "string" || typeof value === "number" ? String(value).trim() : ""))
      .filter((value) => value.length > 0)
      .join(" | ");
    if (stableFallback.length > 0) {
      return stableFallback;
    }
    try {
      return JSON.stringify(resolvedResult);
    } catch {
      return null;
    }
  }
  return null;
};

export const buildValidationFingerprint = (text: string): string => {
  const codeMatch = text.match(/\b(TS\d{4}|ERR_[A-Z0-9_]+|[A-Z]+-\d+)\b/);
  const normalized = text.replace(/\s+/g, " ").trim();
  const detailHash = createHash("sha1").update(normalized).digest("hex").slice(0, 8);
  if (codeMatch?.[1]) {
    return `${codeMatch[1]}:${detailHash}`;
  }
  return createHash("sha1").update(normalized).digest("hex").slice(0, 12);
};

export const summarizeValidationOutcome = (
  tool: WorkSessionToolCompletion,
  command: string,
): { summary: string; fingerprint: string | null } => {
  const validationSucceeded = didValidationToolSucceed(tool);
  const detail = getValidationDetail(tool.result, tool.errorMessage);
  if (validationSucceeded) {
    return {
      summary: `Validation passed: ${command}.`,
      fingerprint: null,
    };
  }
  const detailSummary = detail ? compactAssistantSummary(detail) : `Validation failed: ${command}.`;
  const fingerprintSource = detail?.trim().length ? detail : detailSummary;
  return {
    summary: detailSummary,
    fingerprint: buildValidationFingerprint(fingerprintSource),
  };
};

export const buildPatchAttempt = (
  snapshot: WorkSessionSnapshot,
  tool: WorkSessionToolCompletion,
  occurredAt: number,
): { snapshot: WorkSessionSnapshot; patchAttempt?: WorkSessionPatchAttempt } => {
  if (!tool.success) {
    return {
      snapshot: {
        ...snapshot,
        summary: `Implementation attempt failed while running ${tool.toolName}.`,
      },
    };
  }
  const changedFiles = getChangedFilesFromToolCall(tool.toolName, tool.args);
  const patchAttempt: WorkSessionPatchAttempt = {
    toolCallId: tool.callId,
    toolName: tool.toolName,
    changedFiles,
    summary:
      changedFiles.length > 0
        ? `Applied changes to ${summarizeChangedFiles(changedFiles)}.`
        : `Applied repository changes with ${tool.toolName}.`,
    occurredAt,
  };
  return {
    patchAttempt,
    snapshot: {
      ...snapshot,
      patchAttempts: [...(snapshot.patchAttempts ?? []), patchAttempt],
      selectedFiles: mergeUniqueStrings(snapshot.selectedFiles, changedFiles),
      changedFiles: mergeUniqueStrings(snapshot.changedFiles, changedFiles),
      summary: patchAttempt.summary ?? snapshot.summary,
      readyForReview: false,
      reviewSummary: null,
      completedAt: null,
      fixIterationCount: snapshot.stalledReason ? 0 : snapshot.fixIterationCount,
      repeatFailureCount: snapshot.stalledReason ? 0 : snapshot.repeatFailureCount,
      lastValidationFingerprint: snapshot.stalledReason ? null : snapshot.lastValidationFingerprint,
      stalledReason: null,
      stalledAt: null,
    },
  };
};

export const buildValidationResult = (
  snapshot: WorkSessionSnapshot,
  tool: WorkSessionToolCompletion,
  occurredAt: number,
): {
  command: string;
  pendingShellId: string | null;
  pendingStatus: string | null;
  validationSucceeded: boolean;
  summary: string;
  fingerprint: string | null;
  validationResult: WorkSessionValidationResult;
} => {
  const command = getValidationCommand(tool.toolName, tool.args) ?? snapshot.pendingValidationCommand ?? tool.toolName;
  const pendingShellId = getPowerShellSessionShellId(tool.result);
  const pendingStatus = getPowerShellSessionStatus(tool.result);
  const validationSucceeded = didValidationToolSucceed(tool);
  const { summary, fingerprint } = summarizeValidationOutcome(tool, command);
  const validationResult: WorkSessionValidationResult = {
    toolCallId: tool.callId,
    toolName: tool.toolName,
    command,
    success: validationSucceeded,
    summary,
    fingerprint,
    errorMessage: tool.errorMessage,
    occurredAt,
  };
  return {
    command,
    pendingShellId,
    pendingStatus,
    validationSucceeded,
    summary,
    fingerprint,
    validationResult,
  };
};

export const startWorkSessionImplementation = (
  snapshot: WorkSessionSnapshot,
  toolName: string,
  args: Record<string, unknown>,
  occurredAt: number,
): WorkSessionSnapshot => {
  const changedFiles = getChangedFilesFromToolCall(toolName, args);
  let nextSnapshot = snapshot;
  if (snapshot.currentPhase === "plan") {
    nextSnapshot = setWorkSessionPhase(
      nextSnapshot,
      "plan",
      "complete",
      occurredAt,
      snapshot.planSummary ?? snapshot.summary ?? "Implementation plan prepared.",
    );
  }
  nextSnapshot = setWorkSessionPhase(
    nextSnapshot,
    "implement",
    "active",
    occurredAt,
    changedFiles.length > 0
      ? `Applying repository changes to ${summarizeChangedFiles(changedFiles)}.`
      : `Applying repository changes with ${toolName}.`,
  );
  return {
    ...nextSnapshot,
    currentPhase: "implement",
    selectedFiles: mergeUniqueStrings(nextSnapshot.selectedFiles, changedFiles),
    readyForReview: false,
    reviewSummary: null,
    completedAt: null,
    repeatFailureCount: snapshot.repeatFailureCount,
    lastValidationFingerprint: snapshot.lastValidationFingerprint,
    stalledReason: snapshot.stalledReason,
    stalledAt: snapshot.stalledAt,
    pendingValidationShellId: null,
    pendingValidationCommand: null,
  };
};

export const startWorkSessionValidation = (
  snapshot: WorkSessionSnapshot,
  toolName: string,
  args: Record<string, unknown>,
  occurredAt: number,
): WorkSessionSnapshot => {
  const command = getValidationCommand(toolName, args) ?? toolName;
  let nextSnapshot = snapshot;
  if (snapshot.currentPhase === "implement") {
    nextSnapshot = setWorkSessionPhase(
      nextSnapshot,
      "implement",
      "complete",
      occurredAt,
      snapshot.summary ?? "Implementation pass finished.",
    );
  }
  nextSnapshot = setWorkSessionPhase(nextSnapshot, "validate", "active", occurredAt, `Running validation: ${command}.`);
  return {
    ...nextSnapshot,
    currentPhase: "validate",
    summary: `Running validation: ${command}.`,
    readyForReview: false,
    reviewSummary: null,
    completedAt: null,
    stalledReason: null,
    stalledAt: null,
    pendingValidationShellId: null,
    pendingValidationCommand: command,
  };
};

export const recordWorkSessionValidationResult = (
  snapshot: WorkSessionSnapshot,
  tool: WorkSessionToolCompletion,
  occurredAt: number,
): WorkSessionSnapshot => {
  const { command, pendingShellId, pendingStatus, validationSucceeded, summary, fingerprint, validationResult } =
    buildValidationResult(snapshot, tool, occurredAt);
  if (
    (tool.toolName === "powershell" || tool.toolName === "read_powershell") &&
    pendingShellId &&
    (pendingStatus === "running" || pendingStatus === "idle")
  ) {
    return {
      ...snapshot,
      summary: `Validation still running: ${command}.`,
      readyForReview: false,
      reviewSummary: null,
      completedAt: null,
      stalledReason: null,
      stalledAt: null,
      pendingValidationShellId: pendingShellId,
      pendingValidationCommand: command,
    };
  }
  const nextFixIterationCount = validationSucceeded
    ? (snapshot.fixIterationCount ?? 0)
    : (snapshot.fixIterationCount ?? 0) + 1;
  const repeatFailureCount =
    validationSucceeded || !fingerprint
      ? 0
      : snapshot.lastValidationFingerprint === fingerprint
        ? (snapshot.repeatFailureCount ?? 0) + 1
        : 1;
  let nextSnapshot: WorkSessionSnapshot = {
    ...snapshot,
    validationResults: [...(snapshot.validationResults ?? []), validationResult],
    fixIterationCount: nextFixIterationCount,
    repeatFailureCount,
    lastValidationFingerprint: fingerprint,
    readyForReview: false,
    reviewSummary: null,
    completedAt: null,
    pendingValidationShellId: null,
    pendingValidationCommand: null,
  };
  if (validationSucceeded) {
    nextSnapshot = setWorkSessionPhase(
      nextSnapshot,
      "validate",
      "complete",
      occurredAt,
      "Validation passed; ready for review.",
    );
    return {
      ...nextSnapshot,
      currentPhase: "validate",
      summary: "Validation passed; ready for review.",
      readyForReview: true,
      fixIterationCount: 0,
      repeatFailureCount: 0,
      lastValidationFingerprint: null,
      stalledReason: null,
      stalledAt: null,
      pendingValidationShellId: null,
      pendingValidationCommand: null,
    };
  }
  const hitAttemptLimit = nextFixIterationCount >= WORK_SESSION_MAX_IMPLEMENTATION_ATTEMPTS;
  const hitRepeatFailureLimit = repeatFailureCount >= WORK_SESSION_MAX_REPEAT_FAILURES;
  if (hitAttemptLimit || hitRepeatFailureLimit) {
    const stalledReason = hitAttemptLimit
      ? "Validation exhausted the bounded fix loop."
      : "Validation repeated the same failure twice; escalation or manual intervention is required.";
    nextSnapshot = setWorkSessionPhase(nextSnapshot, "validate", "active", occurredAt, stalledReason);
    return {
      ...nextSnapshot,
      currentPhase: "validate",
      summary: stalledReason,
      readyForReview: false,
      stalledReason,
      stalledAt: occurredAt,
      pendingValidationShellId: null,
      pendingValidationCommand: null,
    };
  }
  nextSnapshot = setWorkSessionPhase(nextSnapshot, "validate", "complete", occurredAt, summary);
  nextSnapshot = setWorkSessionPhase(
    nextSnapshot,
    "implement",
    "active",
    occurredAt,
    "Validation failed; applying a corrective patch.",
  );
  return {
    ...nextSnapshot,
    currentPhase: "implement",
    summary: "Validation failed; applying a corrective patch.",
    readyForReview: false,
    stalledReason: null,
    stalledAt: null,
    pendingValidationShellId: null,
    pendingValidationCommand: null,
  };
};

export const getWorkSessionWorkflowBlock = (
  snapshot: WorkSessionSnapshot,
  occurredAt: number,
): RuntimeSessionContract["workflowState"]["blockedBy"] => {
  if (!snapshot.stalledReason) {
    return null;
  }
  return {
    kind: "error",
    reason: snapshot.stalledReason,
    pendingRequestIds: [],
    blockedAt: snapshot.stalledAt ?? occurredAt,
  };
};

export const isWorkSessionReadyForReview = (snapshot: WorkSessionSnapshot | null | undefined): boolean => {
  if (!snapshot) {
    return false;
  }
  if (snapshot.readyForReview !== undefined) {
    return snapshot.readyForReview;
  }
  const validateEntry = snapshot.phaseHistory.find((entry) => entry.phase === "validate");
  return snapshot.currentPhase === "validate" && validateEntry?.status === "complete" && !snapshot.stalledReason;
};
