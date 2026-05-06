import type { StationId } from "./protocol.js";

export const WORK_SESSION_MODES = ["conversational", "work-session", "mission"] as const;
export type WorkSessionMode = (typeof WORK_SESSION_MODES)[number];

export const WORK_SESSION_PHASES = ["classify", "discover", "summarise", "plan", "implement", "validate"] as const;
export type WorkSessionPhase = (typeof WORK_SESSION_PHASES)[number];

export const WORK_SESSION_PHASE_STATUSES = ["pending", "active", "complete", "skipped"] as const;
export type WorkSessionPhaseStatus = (typeof WORK_SESSION_PHASE_STATUSES)[number];

export type WorkSessionIntent = "question" | "edit" | "debug" | "plan" | "review";

export interface WorkSessionClassification {
  intent: WorkSessionIntent;
  explicitWorkIntent: boolean;
  requiresRepoContext: boolean;
  confidence: "heuristic";
}

export interface WorkSessionPhaseEntry {
  phase: WorkSessionPhase;
  status: WorkSessionPhaseStatus;
  summary?: string | null;
  startedAt: number;
  updatedAt: number;
  completedAt?: number | null;
}

export interface WorkSessionPatchAttempt {
  toolCallId?: string | null;
  toolName: string;
  changedFiles: string[];
  summary?: string | null;
  occurredAt: number;
}

export interface WorkSessionValidationResult {
  toolCallId?: string | null;
  toolName: string;
  command: string;
  success: boolean;
  summary: string;
  fingerprint?: string | null;
  errorMessage?: string | null;
  occurredAt: number;
}

export interface WorkSessionSnapshot {
  sessionId: string;
  stationId: StationId;
  taskText: string;
  currentPhase: WorkSessionPhase;
  classification: WorkSessionClassification;
  phaseHistory: WorkSessionPhaseEntry[];
  searchTerms: string[];
  candidateFiles: string[];
  selectedFiles?: string[];
  summary: string | null;
  planSummary: string | null;
  patchAttempts?: WorkSessionPatchAttempt[];
  changedFiles?: string[];
  validationResults?: WorkSessionValidationResult[];
  pendingValidationShellId?: string | null;
  pendingValidationCommand?: string | null;
  fixIterationCount?: number;
  repeatFailureCount?: number;
  lastValidationFingerprint?: string | null;
  readyForReview?: boolean;
  reviewSummary?: string | null;
  completedAt?: number | null;
  stalledReason?: string | null;
  stalledAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface WorkSessionSummary {
  mode: WorkSessionMode;
  active: boolean;
  sessionId?: string | null;
  phase?: WorkSessionPhase | null;
  summary?: string | null;
  updatedAt?: number | null;
}
