import type { TicketRunProofArtifact, TicketRunProofRunSummary, TicketRunSummary } from "@spira/shared";
import { formatDuration } from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import projectStyles from "../../projects/ProjectsPanel/ProjectsPanel.module.css";
import styles from "./MissionDetailsRoom.module.css";

interface ProofRunsViewerProps {
  run: TicketRunSummary;
}

interface ArtifactGroups {
  reports: TicketRunProofArtifact[];
  captures: TicketRunProofArtifact[];
  other: TicketRunProofArtifact[];
}

interface InlineLogState {
  proofRunId: string;
  artifactId: string;
  label: string;
  isLoading: boolean;
  error: string | null;
  content: string | null;
  truncated: boolean;
  totalBytes: number;
  mimeKind: "text" | "binary" | "missing" | null;
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatProofDuration = (startedAt: number, completedAt: number | null): string => {
  if (completedAt === null) return "running";
  return formatDuration(Math.max(0, completedAt - startedAt), "compact");
};

const groupArtifacts = (artifacts: readonly TicketRunProofArtifact[]): ArtifactGroups => {
  const reports: TicketRunProofArtifact[] = [];
  const captures: TicketRunProofArtifact[] = [];
  const other: TicketRunProofArtifact[] = [];
  for (const artifact of artifacts) {
    if (artifact.kind === "report" || artifact.kind === "log") {
      reports.push(artifact);
    } else if (artifact.kind === "screenshot" || artifact.kind === "video" || artifact.kind === "trace") {
      captures.push(artifact);
    } else {
      other.push(artifact);
    }
  }
  return { reports, captures, other };
};

const isInlineViewable = (artifact: TicketRunProofArtifact): boolean =>
  artifact.kind === "log" || artifact.kind === "report";

/**
 * proof viewer. Shows every proof run for the mission with command,
 * exit code, duration, status, and grouped artifact chips. Text artifacts (logs,
 * reports) open inline with the lazy-loaded log viewer (size-capped at ~256 KB).
 */
export function ProofRunsViewer({ run }: ProofRunsViewerProps) {
  const sortedRuns = useMemo(
    () => [...run.proofRuns].sort((left, right) => right.startedAt - left.startedAt),
    [run.proofRuns],
  );
  const [inlineLog, setInlineLog] = useState<InlineLogState | null>(null);

  // Reset open log if the underlying artifact disappears (proof was re-run, etc.).
  useEffect(() => {
    if (!inlineLog) return;
    const stillExists = sortedRuns.some(
      (proofRun) =>
        proofRun.proofRunId === inlineLog.proofRunId &&
        proofRun.artifacts.some((artifact) => artifact.artifactId === inlineLog.artifactId),
    );
    if (!stillExists) {
      setInlineLog(null);
    }
  }, [inlineLog, sortedRuns]);

  const openInlineLog = async (proofRun: TicketRunProofRunSummary, artifact: TicketRunProofArtifact) => {
    setInlineLog({
      proofRunId: proofRun.proofRunId,
      artifactId: artifact.artifactId,
      label: artifact.label,
      isLoading: true,
      error: null,
      content: null,
      truncated: false,
      totalBytes: 0,
      mimeKind: null,
    });
    try {
      const result = await window.electronAPI.readTicketRunProofArtifact(
        run.runId,
        proofRun.proofRunId,
        artifact.artifactId,
      );
      setInlineLog({
        proofRunId: proofRun.proofRunId,
        artifactId: artifact.artifactId,
        label: artifact.label,
        isLoading: false,
        error: null,
        content: result.content,
        truncated: result.truncated,
        totalBytes: result.totalBytes,
        mimeKind: result.mimeKind,
      });
    } catch (error) {
      setInlineLog({
        proofRunId: proofRun.proofRunId,
        artifactId: artifact.artifactId,
        label: artifact.label,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to read proof artifact.",
        content: null,
        truncated: false,
        totalBytes: 0,
        mimeKind: null,
      });
    }
  };

  if (sortedRuns.length === 0) {
    return null;
  }

  return (
    <div className={styles.proofRunList}>
      {sortedRuns.map((proofRun) => {
        const groups = groupArtifacts(proofRun.artifacts);
        const isExpanded =
          inlineLog?.proofRunId === proofRun.proofRunId;
        return (
          <div key={proofRun.proofRunId} className={styles.proofRunRow}>
            <div className={styles.proofRunHeader}>
              <div>
                <strong>{proofRun.profileLabel}</strong>
                <div className={styles.proofRunMeta}>
                  Started {new Date(proofRun.startedAt).toLocaleString()} ·{" "}
                  {proofRun.completedAt ? formatProofDuration(proofRun.startedAt, proofRun.completedAt) : "running"}
                  {proofRun.exitCode !== null ? ` · exit ${proofRun.exitCode}` : ""}
                </div>
              </div>
              <span className={styles.metricBadge}>{proofRun.status}</span>
            </div>
            {proofRun.command ? <div className={styles.proofRunCommand}>$ {proofRun.command}</div> : null}
            {proofRun.summary ? <div className={styles.phaseCopy}>{proofRun.summary}</div> : null}
            {groups.reports.length > 0 ? (
              <div className={styles.proofArtifactGroup}>
                <span className={styles.proofArtifactGroupLabel}>Reports + logs</span>
                {groups.reports.map((artifact) => (
                  <button
                    key={artifact.artifactId}
                    type="button"
                    className={`${styles.proofArtifactChip} ${styles.proofArtifactChipReport}`}
                    onClick={() => {
                      if (isInlineViewable(artifact)) {
                        void openInlineLog(proofRun, artifact);
                      } else {
                        void window.electronAPI.openExternal(artifact.fileUrl);
                      }
                    }}
                  >
                    {artifact.label}
                  </button>
                ))}
              </div>
            ) : null}
            {groups.captures.length > 0 ? (
              <div className={styles.proofArtifactGroup}>
                <span className={styles.proofArtifactGroupLabel}>Captures</span>
                {groups.captures.map((artifact) => (
                  <button
                    key={artifact.artifactId}
                    type="button"
                    className={styles.proofArtifactChip}
                    onClick={() => void window.electronAPI.openExternal(artifact.fileUrl)}
                  >
                    {artifact.label}
                  </button>
                ))}
              </div>
            ) : null}
            {groups.other.length > 0 ? (
              <div className={styles.proofArtifactGroup}>
                <span className={styles.proofArtifactGroupLabel}>Other</span>
                {groups.other.map((artifact) => (
                  <button
                    key={artifact.artifactId}
                    type="button"
                    className={styles.proofArtifactChip}
                    onClick={() => void window.electronAPI.openExternal(artifact.fileUrl)}
                  >
                    {artifact.label}
                  </button>
                ))}
              </div>
            ) : null}
            {isExpanded && inlineLog ? (
              <div className={styles.proofLogViewer}>
                <div className={styles.proofLogViewerHeader}>
                  <span>
                    {inlineLog.label}
                    {inlineLog.totalBytes > 0 ? ` · ${formatBytes(inlineLog.totalBytes)}` : ""}
                    {inlineLog.truncated ? " · truncated" : ""}
                  </span>
                  <button
                    type="button"
                    className={styles.proofLogViewerCloseButton}
                    onClick={() => setInlineLog(null)}
                  >
                    Close
                  </button>
                </div>
                {inlineLog.isLoading ? (
                  <div className={styles.proofLogViewerEmpty}>Loading…</div>
                ) : inlineLog.error ? (
                  <div className={styles.proofLogViewerEmpty}>{inlineLog.error}</div>
                ) : inlineLog.mimeKind === "binary" ? (
                  <div className={styles.proofLogViewerEmpty}>
                    Binary artifact — open externally to view.
                    <div>
                      <button
                        type="button"
                        className={projectStyles.secondaryButton}
                        onClick={() => {
                          const proofRunForArtifact = sortedRuns.find(
                            (candidate) => candidate.proofRunId === inlineLog.proofRunId,
                          );
                          const artifact = proofRunForArtifact?.artifacts.find(
                            (candidate) => candidate.artifactId === inlineLog.artifactId,
                          );
                          if (artifact) {
                            void window.electronAPI.openExternal(artifact.fileUrl);
                          }
                        }}
                      >
                        Open externally
                      </button>
                    </div>
                  </div>
                ) : inlineLog.mimeKind === "missing" ? (
                  <div className={styles.proofLogViewerEmpty}>Artifact file is no longer present on disk.</div>
                ) : (
                  <pre className={styles.proofLogViewerBody}>{inlineLog.content ?? ""}</pre>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
