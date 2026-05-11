import type {
  MissionServiceProcessSummary,
  MissionServiceProfileSummary,
  TicketRunSummary,
} from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import {
  describeMissionServiceLauncher,
  describeMissionServiceState,
  isMissionServiceProcessActive,
} from "../mission-display-utils.js";
import type { MissionRunController } from "../useMissionRunController.js";
import styles from "./MissionProcessesRoom.module.css";
import { Sparkline } from "./Sparkline.js";
import {
  formatCpuPercent,
  formatDurationMs,
  formatMemoryBytes,
  formatUptime,
  meanUptime,
  sparklineSamples,
} from "./process-display.js";

interface MissionProcessesRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

function stateDotClass(state: MissionServiceProcessSummary["state"] | null): string {
  if (state === "running") return `${styles.dot} ${styles.dotRunning}`;
  if (state === "starting") return `${styles.dot} ${styles.dotStarting}`;
  if (state === "stopping") return `${styles.dot} ${styles.dotStopping}`;
  if (state === "error") return `${styles.dot} ${styles.dotError}`;
  return `${styles.dot} ${styles.dotStopped}`;
}

function logLineTone(line: string): string {
  if (line.startsWith("▲")) return styles.serviceCardLogLineBrand;
  if (/error|err!|fail/iu.test(line)) return styles.serviceCardLogLineError;
  if (line.startsWith("[nest]") || /warn(ing)?/iu.test(line)) return styles.serviceCardLogLineWarn;
  if (line.includes("✓") || /\bready\b|\bcompiled\b/iu.test(line)) return styles.serviceCardLogLineGood;
  return "";
}

export function MissionProcessesRoom({ run, controller }: MissionProcessesRoomProps) {
  // Local 1s tick so uptimes stay live between supervisor updates.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();

  const services = controller.serviceProcesses;
  const profilesByRepo = controller.serviceProfilesByRepo;
  const activeProfileIds = controller.activeServiceProfileIds;

  const latestProcessByProfileId = useMemo(() => {
    const map = new Map<string, MissionServiceProcessSummary>();
    for (const process of services) {
      const existing = map.get(process.profileId);
      if (existing === undefined || (process.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        map.set(process.profileId, process);
      }
    }
    return map;
  }, [services]);

  const runningProcesses = useMemo(
    () => services.filter((process) => process.state === "running" || process.state === "starting"),
    [services],
  );
  const erroredProcesses = useMemo(() => services.filter((process) => process.state === "error"), [services]);
  const stoppedCount = services.filter((process) => process.state === "stopped").length;
  const profileCount = profilesByRepo.reduce((sum, [, profiles]) => sum + profiles.length, 0);
  const meanUptimeMs = meanUptime(services, now);

  return (
    <section className={styles.room}>
      <header className={styles.roomHeader}>
        <div className={styles.roomHeaderCopy}>
          <span className={styles.roomEyebrow}>Mission services</span>
          <h2 className={styles.roomTitle}>Processes</h2>
          <p className={styles.roomCaption}>
            Live cockpit for running services and the launch profiles ready to bring more online.
          </p>
        </div>
        <div className={styles.roomActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => void controller.refreshMissionServices()}
            disabled={controller.isServicesLoading}
          >
            {controller.isServicesLoading ? "Refreshing…" : "Refresh services"}
          </button>
        </div>
      </header>

      {controller.serviceNotice ? <div className={styles.notice}>{controller.serviceNotice}</div> : null}
      {controller.serviceError ? <div className={styles.errorBanner}>{controller.serviceError}</div> : null}

      <div className={styles.statStrip}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Running</div>
          <div className={`${styles.statValue} ${runningProcesses.length > 0 ? styles.statValueGood : ""}`}>
            {runningProcesses.length}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Stopped</div>
          <div className={styles.statValue}>{stoppedCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Profiles</div>
          <div className={styles.statValue}>{profileCount}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Mean uptime</div>
          <div className={`${styles.statValue} ${meanUptimeMs !== null ? styles.statValueWarm : ""}`}>
            {formatDurationMs(meanUptimeMs)}
          </div>
        </div>
      </div>

      {runningProcesses.length > 0 || erroredProcesses.length > 0 ? (
        <div>
          <div className={styles.sectionLabel}>Live services</div>
          <div className={styles.serviceGrid}>
            {[...runningProcesses, ...erroredProcesses].map((process) => {
              const url = process.launchUrl ?? process.urls[0] ?? null;
              const stdoutLines = process.recentLogLines.filter((line) => line.source === "stdout").slice(-4);
              const cpu = process.metrics.current?.cpuPercent ?? null;
              const memory = process.metrics.current?.memoryBytes ?? null;
              const sparkValues = sparklineSamples(process.metrics.history);
              const stateLabel = describeMissionServiceState(process.state);
              return (
                <article
                  key={process.serviceId}
                  className={`${styles.serviceCard} ${process.state === "error" ? styles.serviceCardError : ""}`}
                >
                  <header className={styles.serviceCardHeader}>
                    <span className={stateDotClass(process.state)} aria-label={stateLabel} />
                    <div className={styles.serviceCardHeaderCopy}>
                      <div className={styles.serviceCardName} title={process.profileName}>
                        {process.profileName}
                      </div>
                      <div className={styles.serviceCardRepo}>
                        {process.repoRelativePath} · {describeMissionServiceLauncher(process)}
                      </div>
                    </div>
                    <Sparkline
                      values={sparkValues}
                      tone={process.state === "error" ? "muted" : "default"}
                      maxValue={100}
                      ariaLabel={`CPU history, current ${cpu === null ? "unknown" : Math.round(cpu) + "%"}`}
                    />
                  </header>

                  {process.errorMessage ? (
                    <div className={styles.serviceCardError}>{process.errorMessage}</div>
                  ) : null}

                  <div className={styles.serviceCardMetrics}>
                    <div>
                      <div className={styles.metricLabel}>Uptime</div>
                      <div className={styles.metricValue}>{formatUptime(process.startedAt, now)}</div>
                    </div>
                    <div>
                      <div className={styles.metricLabel}>CPU</div>
                      <div className={styles.metricValue}>{cpu === null ? "—" : formatCpuPercent(cpu)}</div>
                    </div>
                    <div>
                      <div className={styles.metricLabel}>Memory</div>
                      <div className={styles.metricValue}>{memory === null ? "—" : formatMemoryBytes(memory)}</div>
                    </div>
                  </div>

                  <div className={styles.serviceCardUrlRow}>
                    <span className={`${styles.serviceCardUrl} ${url === null ? styles.serviceCardUrlEmpty : ""}`}>
                      {url ?? "No URL"}
                    </span>
                    {url !== null ? (
                      <button
                        type="button"
                        className={`${styles.secondaryButton} ${styles.smallButton}`}
                        onClick={() => void window.electronAPI.openExternal(url)}
                      >
                        Open
                      </button>
                    ) : null}
                    {isMissionServiceProcessActive(process) ? (
                      <button
                        type="button"
                        className={`${styles.dangerButton} ${styles.smallButton}`}
                        onClick={() => void controller.stopMissionService(process)}
                        disabled={controller.stoppingServiceId === process.serviceId}
                      >
                        {controller.stoppingServiceId === process.serviceId ? "Stopping…" : "Stop"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.secondaryButton} ${styles.smallButton}`}
                        onClick={() => void controller.dismissMissionService(process)}
                        title={process.state === "error" ? "Dismiss this errored service" : "Dismiss this stopped service"}
                      >
                        Dismiss
                      </button>
                    )}
                  </div>

                  <div className={styles.serviceCardLog}>
                    {stdoutLines.length === 0 ? (
                      <div className={styles.serviceCardLogEmpty}>No stdout yet…</div>
                    ) : (
                      stdoutLines.map((line, index) => (
                        <div
                          key={`${process.serviceId}:${line.timestamp}:${index}`}
                          className={`${styles.serviceCardLogLine} ${logLineTone(line.line)}`}
                          title={line.line}
                        >
                          {line.line}
                        </div>
                      ))
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ) : null}

      <div>
        <div className={styles.sectionHeading}>
          <div className={styles.sectionLabel}>Launch profiles</div>
        </div>
        {!controller.services ? (
          <div className={styles.emptyState}>
            {controller.isServicesLoading ? "Loading mission services…" : "Mission services are waiting to load."}
          </div>
        ) : profilesByRepo.length === 0 ? (
          <div className={styles.emptyState}>No runnable service profiles found.</div>
        ) : (
          <div className={styles.profilesPanel}>
            {profilesByRepo.map(([repoRelativePath, profiles]) => (
              <div key={`${run.runId}:${repoRelativePath}`} className={styles.profilesGroup}>
                <div className={styles.profilesGroupHeader}>
                  <span className={styles.profilesGroupRepo}>{repoRelativePath}</span>
                  <span className={styles.profilesGroupCount}>
                    {profiles.length} profile{profiles.length === 1 ? "" : "s"}
                  </span>
                </div>
                {profiles.map((profile) => (
                  <ProfileRow
                    key={profile.profileId}
                    profile={profile}
                    process={latestProcessByProfileId.get(profile.profileId) ?? null}
                    isActive={activeProfileIds.has(profile.profileId)}
                    controller={controller}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface ProfileRowProps {
  profile: MissionServiceProfileSummary;
  process: MissionServiceProcessSummary | null;
  isActive: boolean;
  controller: MissionRunController;
}

function ProfileRow({ profile, process, isActive, controller }: ProfileRowProps) {
  const state = process?.state ?? null;
  const profileUrl = profile.launchUrl ?? profile.urls[0] ?? null;
  const startInFlight = controller.startingServiceProfileId === profile.profileId;

  let primaryButton: JSX.Element;
  if (isActive) {
    primaryButton = (
      <button type="button" className={`${styles.secondaryButton} ${styles.smallButton}`} disabled>
        Running
      </button>
    );
  } else if (state === "error") {
    primaryButton = (
      <button
        type="button"
        className={`${styles.primaryButton} ${styles.smallButton}`}
        onClick={() => void controller.startMissionService(profile)}
        disabled={!profile.isLaunchable || startInFlight}
      >
        {startInFlight ? "Retrying…" : "Retry"}
      </button>
    );
  } else if (!profile.isLaunchable) {
    primaryButton = (
      <button type="button" className={`${styles.secondaryButton} ${styles.smallButton}`} disabled>
        Unavailable
      </button>
    );
  } else {
    primaryButton = (
      <button
        type="button"
        className={`${styles.primaryButton} ${styles.smallButton}`}
        onClick={() => void controller.startMissionService(profile)}
        disabled={startInFlight}
      >
        {startInFlight ? "Starting…" : "Start"}
      </button>
    );
  }

  return (
    <div className={`${styles.profileRow} ${profile.isLaunchable ? "" : styles.profileRowUnavailable}`}>
      <span className={stateDotClass(state)} aria-hidden="true" />
      <div>
        <div className={styles.profileName}>{profile.profileName}</div>
        <div className={styles.profileLauncher}>{describeMissionServiceLauncher(profile)}</div>
      </div>
      <span className={styles.profileEnv}>{profile.environmentName ?? "Default"}</span>
      <span className={styles.profileUrl} title={profileUrl ?? ""}>
        {profileUrl ?? "—"}
      </span>
      <div className={styles.profileActions}>
        {profileUrl !== null ? (
          <button
            type="button"
            className={`${styles.secondaryButton} ${styles.smallButton}`}
            onClick={() => void window.electronAPI.openExternal(profileUrl)}
          >
            Open
          </button>
        ) : null}
        {primaryButton}
      </div>
      {!profile.isLaunchable && profile.unavailableReason ? (
        <div className={styles.profileUnavailableReason}>{profile.unavailableReason}</div>
      ) : null}
      {state === "error" && process?.errorMessage ? (
        <div className={styles.profileUnavailableReason}>{process.errorMessage}</div>
      ) : null}
    </div>
  );
}
