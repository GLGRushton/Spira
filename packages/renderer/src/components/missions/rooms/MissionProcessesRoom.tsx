import type { TicketRunSummary } from "@spira/shared";
import projectStyles from "../../projects/ProjectsPanel.module.css";
import {
  describeMissionServiceLauncher,
  describeMissionServiceState,
  formatMissionServiceUrls,
  isMissionServiceProcessActive,
} from "../mission-display-utils.js";
import type { MissionRunController } from "../useMissionRunController.js";

interface MissionProcessesRoomProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

const getMissionServiceStateTone = (state: ReturnType<typeof describeMissionServiceState>): string => {
  switch (state) {
    case "Starting":
      return projectStyles.serviceStateStarting;
    case "Running":
      return projectStyles.serviceStateRunning;
    case "Stopping":
      return projectStyles.serviceStateStopping;
    case "Error":
      return projectStyles.serviceStateError;
    default:
      return projectStyles.serviceStateStopped;
  }
};

export function MissionProcessesRoom({ run, controller }: MissionProcessesRoomProps) {
  return (
    <section className={projectStyles.section}>
      <article className={projectStyles.detailCard}>
        <div className={projectStyles.sectionHeader}>
          <div>
            <div className={projectStyles.sectionLabel}>Mission processes</div>
            <div className={projectStyles.sectionCaption}>
              Launch profiles and tracked services stay grouped by repo, while running processes remain mission-wide.
            </div>
          </div>
          <button
            type="button"
            className={projectStyles.secondaryButton}
            onClick={() => void controller.refreshMissionServices()}
            disabled={controller.isServicesLoading}
          >
            {controller.isServicesLoading ? "Refreshing..." : "Refresh services"}
          </button>
        </div>

        {controller.serviceNotice ? <div className={projectStyles.notice}>{controller.serviceNotice}</div> : null}
        {controller.serviceError ? <div className={projectStyles.error}>{controller.serviceError}</div> : null}

        <div className={projectStyles.serviceSection}>
          <div className={projectStyles.sectionLabel}>Launch profiles</div>
          {controller.services ? (
            controller.serviceProfilesByRepo.length > 0 ? (
              <div className={projectStyles.serviceGroupList}>
                {controller.serviceProfilesByRepo.map(([repoRelativePath, profiles]) => (
                  <div key={`${run.runId}:${repoRelativePath}`} className={projectStyles.serviceGroup}>
                    <div className={projectStyles.serviceGroupHeader}>
                      <span className={projectStyles.pathBadge}>{repoRelativePath}</span>
                      <span className={projectStyles.repoTabMeta}>
                        {profiles.length} profile{profiles.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className={projectStyles.serviceCardList}>
                      {profiles.map((profile) => {
                        const profileUrl = profile.launchUrl ?? profile.urls[0] ?? null;
                        const isRunning = controller.activeServiceProfileIds.has(profile.profileId);
                        return (
                          <div
                            key={profile.profileId}
                            className={`${projectStyles.serviceCard} ${
                              profile.isLaunchable ? "" : projectStyles.serviceCardUnavailable
                            }`}
                          >
                            <div className={projectStyles.workHeader}>
                              <div className={projectStyles.workHeaderCopy}>
                                <strong>{profile.profileName}</strong>
                                <span className={projectStyles.repoTabMeta}>{describeMissionServiceLauncher(profile)}</span>
                              </div>
                              <div className={projectStyles.inlineActions}>
                                {profileUrl ? (
                                  <button
                                    type="button"
                                    className={projectStyles.secondaryButton}
                                    onClick={() => void window.electronAPI.openExternal(profileUrl)}
                                  >
                                    Open URL
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className={profile.isLaunchable ? projectStyles.actionButton : projectStyles.secondaryButton}
                                  onClick={() => void controller.startMissionService(profile)}
                                  disabled={
                                    !profile.isLaunchable ||
                                    isRunning ||
                                    controller.startingServiceProfileId === profile.profileId
                                  }
                                >
                                  {controller.startingServiceProfileId === profile.profileId
                                    ? "Starting..."
                                    : isRunning
                                      ? "Running"
                                      : "Start"}
                                </button>
                              </div>
                            </div>
                            <div className={projectStyles.inlineRunFacts}>
                              <div className={projectStyles.inlineRunFact}>
                                <strong>Project</strong>
                                {profile.projectRelativePath}
                              </div>
                              <div className={projectStyles.inlineRunFact}>
                                <strong>URLs</strong>
                                {formatMissionServiceUrls(profile.urls)}
                              </div>
                              <div className={projectStyles.inlineRunFact}>
                                <strong>Environment</strong>
                                {profile.environmentName ?? "Default"}
                              </div>
                              <div className={projectStyles.inlineRunFact}>
                                <strong>Launch settings</strong>
                                {profile.launchSettingsRelativePath}
                              </div>
                            </div>
                            {!profile.isLaunchable && profile.unavailableReason ? (
                              <div className={projectStyles.blockedState}>{profile.unavailableReason}</div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={projectStyles.emptyState}>No runnable service profiles found.</div>
            )
          ) : controller.isServicesLoading ? (
            <div className={projectStyles.emptyState}>Loading mission services...</div>
          ) : (
            <div className={projectStyles.emptyState}>Mission services are waiting to load.</div>
          )}
        </div>

        <div className={projectStyles.serviceSection}>
          <div className={projectStyles.sectionLabel}>Tracked processes</div>
          {controller.serviceProcesses.length > 0 ? (
            <div className={projectStyles.serviceCardList}>
              {controller.serviceProcesses.map((process) => {
                const processState = describeMissionServiceState(process.state);
                const processTone = getMissionServiceStateTone(processState);
                const processUrl = process.launchUrl ?? process.urls[0] ?? null;
                const stdoutLogLines = process.recentLogLines.filter((line) => line.source === "stdout");
                return (
                  <div key={process.serviceId} className={`${projectStyles.serviceCard} ${processTone}`}>
                    <div className={projectStyles.workHeader}>
                      <div className={projectStyles.workHeaderCopy}>
                        <strong>{process.profileName}</strong>
                        <span className={projectStyles.repoTabMeta}>
                          {process.repoRelativePath} • {describeMissionServiceLauncher(process)}
                        </span>
                      </div>
                      <div className={projectStyles.inlineActions}>
                        <span className={`${projectStyles.statusBadge} ${processTone}`}>{processState}</span>
                        {processUrl ? (
                          <button
                            type="button"
                            className={projectStyles.secondaryButton}
                            onClick={() => void window.electronAPI.openExternal(processUrl)}
                          >
                            Open URL
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={
                            isMissionServiceProcessActive(process) ? projectStyles.secondaryButton : projectStyles.actionButton
                          }
                          onClick={() => void controller.stopMissionService(process)}
                          disabled={!isMissionServiceProcessActive(process) || controller.stoppingServiceId === process.serviceId}
                        >
                          {controller.stoppingServiceId === process.serviceId
                            ? "Stopping..."
                            : isMissionServiceProcessActive(process)
                              ? "Stop"
                              : "Stopped"}
                        </button>
                      </div>
                    </div>
                    {process.errorMessage ? <div className={projectStyles.error}>{process.errorMessage}</div> : null}
                    {stdoutLogLines.length > 0 ? (
                      <div className={projectStyles.serviceLogTail}>
                        {stdoutLogLines.map((line, index) => (
                          <div key={`${process.serviceId}:${line.timestamp}:${index}`} className={projectStyles.serviceLogLine}>
                            {line.line}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={projectStyles.workHint}>No stdout yet.</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={projectStyles.emptyState}>No mission services have been started yet.</div>
          )}
        </div>
      </article>
    </section>
  );
}
