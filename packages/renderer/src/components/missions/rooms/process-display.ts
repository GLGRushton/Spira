import type { MissionServiceMetricsSample, MissionServiceProcessSummary } from "@spira/shared";

export function formatUptime(startedAt: number | null, now: number): string {
  if (startedAt === null) {
    return "—";
  }
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes.toString().padStart(2, "0")}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  }
  return `${secs}s`;
}

export function formatMemoryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  if (mb >= 100) {
    return `${Math.round(mb)} MB`;
  }
  return `${mb.toFixed(1)} MB`;
}

export function formatCpuPercent(percent: number): string {
  if (!Number.isFinite(percent) || percent < 0) {
    return "—";
  }
  if (percent < 1) {
    return `${percent.toFixed(2)}%`;
  }
  if (percent < 10) {
    return `${percent.toFixed(1)}%`;
  }
  return `${Math.round(percent)}%`;
}

export function meanUptime(processes: readonly MissionServiceProcessSummary[], now: number): number | null {
  const active = processes.filter((process) => process.state === "running" && process.startedAt !== null);
  if (active.length === 0) {
    return null;
  }
  const total = active.reduce((sum, process) => sum + Math.max(0, now - (process.startedAt ?? now)), 0);
  return Math.floor(total / active.length);
}

export function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null) {
    return "—";
  }
  return formatUptime(0, durationMs);
}

export function sparklineSamples(metricsHistory: readonly MissionServiceMetricsSample[]): number[] {
  return metricsHistory.map((sample) => sample.cpuPercent);
}
