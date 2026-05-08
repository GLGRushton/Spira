import type { TicketRunSummary, YouTrackTicketSummary } from "@spira/shared";
import type { StationViewState } from "../../../stores/station-store.js";
import { normalizeProjectKey } from "../project-utils.js";
import styles from "./ProjectsPanel.module.css";
import type { MissionsTabId } from "./ProjectsPanel.utils.js";
import { describeRunStatus, formatTicketUpdatedAt, getTicketStartBlocker } from "./ProjectsPanel.utils.js";

type ProjectsPanelMissionLanesProps = {
  activeTab: MissionsTabId;
  isMissionDetailOpen: boolean;
  isRefreshing: boolean;
  runNotice: string | null;
  runError: string | null;
  ticketError: string | null;
  youTrackConnected: boolean;
  pendingTickets: YouTrackTicketSummary[];
  activeRuns: TicketRunSummary[];
  completedRuns: TicketRunSummary[];
  mappedProjectKeySet: Set<string>;
  mappedRepoCountByProject: Map<string, number>;
  runByTicketId: Map<string, TicketRunSummary>;
  ticketById: Map<string, YouTrackTicketSummary>;
  stationMap: Record<string, StationViewState>;
  startingTicketId: string | null;
  syncingRunId: string | null;
  startingWorkRunId: string | null;
  cancellingRunId: string | null;
  onRefreshData: () => Promise<void>;
  onOpenRunMissionDetail: (runId: string) => void;
  onOpenTicketMissionDetail: (ticketId: string) => void;
  onStartTicketRun: (ticket: YouTrackTicketSummary) => Promise<void>;
  onRetryTicketRunSync: (runId: string) => Promise<void>;
  onStartRunWork: (runId: string) => Promise<void>;
  onCancelRunWork: (runId: string) => Promise<void>;
  onFocusRunStation: (run: TicketRunSummary) => void;
};

export function ProjectsPanelMissionLanes({
  activeTab,
  isMissionDetailOpen,
  isRefreshing,
  runNotice,
  runError,
  ticketError,
  youTrackConnected,
  pendingTickets,
  activeRuns,
  completedRuns,
  mappedProjectKeySet,
  mappedRepoCountByProject,
  runByTicketId,
  ticketById,
  stationMap,
  startingTicketId,
  syncingRunId,
  startingWorkRunId,
  cancellingRunId,
  onRefreshData,
  onOpenRunMissionDetail,
  onOpenTicketMissionDetail,
  onStartTicketRun,
  onRetryTicketRunSync,
  onStartRunWork,
  onCancelRunWork,
  onFocusRunStation,
}: ProjectsPanelMissionLanesProps) {
  return (
    <>
      <section
        id="missions-panel-launch-bay"
        role="tabpanel"
        aria-labelledby="missions-tab-launch-bay"
        className={styles.section}
        hidden={activeTab !== "launch-bay" || isMissionDetailOpen}
      >
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Pending pickup</div>
            <div className={styles.sectionCaption}>
              Tickets visible to the native intake appear here first, with mapping status beside them.
            </div>
          </div>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => void onRefreshData()}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh workflow"}
          </button>
        </div>
        {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
        {runError ? <div className={styles.error}>{runError}</div> : null}
        {!youTrackConnected ? (
          <div className={styles.blockedState}>
            Connect YouTrack and enable native intake here before Missions can show assigned work.
          </div>
        ) : ticketError ? (
          <div className={styles.error}>{ticketError}</div>
        ) : pendingTickets.length === 0 ? (
          <div className={styles.emptyState}>
            No tickets are waiting for pickup. Active missions have moved to the flight deck and completed work rests in
            dry dock.
          </div>
        ) : (
          <div className={styles.workList}>
            {pendingTickets.map((ticket) => {
              const isMapped = mappedProjectKeySet.has(normalizeProjectKey(ticket.projectKey));
              const repoCount = mappedRepoCountByProject.get(normalizeProjectKey(ticket.projectKey)) ?? 0;
              const existingRun = runByTicketId.get(ticket.id) ?? null;
              const startBlockedReason = getTicketStartBlocker(isMapped, repoCount, existingRun);
              const firstWorktree = existingRun?.worktrees[0] ?? null;
              const existingRunRepoCount = existingRun?.worktrees.length ?? 0;
              return (
                <article key={ticket.id} className={styles.workCard}>
                  <div className={styles.workHeader}>
                    <div className={styles.workHeaderCopy}>
                      <span className={styles.ticketId}>{ticket.id}</span>
                      <strong>{ticket.summary}</strong>
                    </div>
                    <div className={styles.workBadges}>
                      <span className={styles.statusBadge}>{ticket.state ?? "Unknown state"}</span>
                      <span
                        className={`${styles.ticketScopeBadge} ${isMapped ? styles.ticketScopeMapped : styles.ticketScopeUnmapped}`}
                      >
                        {isMapped ? "Mapped scope" : "No repo mapping"}
                      </span>
                      {existingRun ? (
                        <span className={styles.statusBadge}>{describeRunStatus(existingRun)}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.workMetaRow}>
                    <span className={styles.workMeta}>
                      {ticket.projectKey} - {ticket.projectName}
                    </span>
                    <span className={styles.workMeta}>
                      {ticket.assignee ?? "Unassigned"} - {formatTicketUpdatedAt(ticket.updatedAt)}
                    </span>
                  </div>
                  <div className={styles.workActions}>
                    <div className={styles.detailLinks}>
                      <a className={styles.inlineLink} href={ticket.url} target="_blank" rel="noreferrer">
                        Open in YouTrack
                      </a>
                    </div>
                    <div className={styles.detailLinks}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() =>
                          existingRun ? onOpenRunMissionDetail(existingRun.runId) : onOpenTicketMissionDetail(ticket.id)
                        }
                      >
                        {existingRun ? "Open mission" : "Mission details"}
                      </button>
                      <button
                        type="button"
                        className={existingRun || startBlockedReason ? styles.secondaryButton : styles.actionButton}
                        onClick={() => void onStartTicketRun(ticket)}
                        disabled={Boolean(startBlockedReason) || startingTicketId === ticket.id}
                      >
                        {startingTicketId === ticket.id
                          ? "Starting..."
                          : existingRun?.status === "error"
                            ? "Retry pickup"
                            : "Pick up ticket"}
                      </button>
                    </div>
                  </div>
                  {existingRun?.statusMessage ? (
                    <div className={styles.workHint}>{existingRun.statusMessage}</div>
                  ) : null}
                  {firstWorktree ? (
                    <div className={styles.inlineRunFacts}>
                      <span className={styles.inlineRunFact}>
                        <strong>Repos</strong> {existingRunRepoCount}
                      </span>
                      {existingRunRepoCount === 1 ? (
                        <>
                          <span className={styles.inlineRunFact}>
                            <strong>Branch</strong> {firstWorktree.branchName}
                          </span>
                          <span className={styles.inlineRunFact}>
                            <strong>Worktree</strong> {firstWorktree.worktreePath}
                          </span>
                        </>
                      ) : (
                        <span className={styles.inlineRunFact}>
                          <strong>Example worktree</strong> {firstWorktree.worktreePath}
                        </span>
                      )}
                    </div>
                  ) : null}
                  {startBlockedReason ? <div className={styles.workHint}>{startBlockedReason}</div> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        id="missions-panel-flight-deck"
        role="tabpanel"
        aria-labelledby="missions-tab-flight-deck"
        className={styles.section}
        hidden={activeTab !== "flight-deck" || isMissionDetailOpen}
      >
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Active runs</div>
            <div className={styles.sectionCaption}>
              Managed worktrees stay visible here so you can see what Missions has already claimed.
            </div>
          </div>
        </div>
        {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
        {runError ? <div className={styles.error}>{runError}</div> : null}
        {activeRuns.length === 0 ? (
          <div className={styles.emptyState}>No active ticket runs are on the flight deck yet.</div>
        ) : (
          <div className={styles.runList}>
            {activeRuns.map((run) => {
              const latestAttempt = run.attempts[run.attempts.length - 1] ?? null;
              const boundStation = run.stationId ? stationMap[run.stationId] : null;
              const detailLabel =
                run.status === "awaiting-review"
                  ? "Review mission"
                  : run.status === "error"
                    ? "Recover mission"
                    : "Open mission";
              return (
                <article key={run.runId} className={styles.runCard}>
                  <div className={styles.workHeader}>
                    <div className={styles.workHeaderCopy}>
                      <span className={styles.ticketId}>{run.ticketId}</span>
                      <strong>{run.ticketSummary}</strong>
                    </div>
                    <span className={styles.statusBadge}>{describeRunStatus(run)}</span>
                  </div>
                  <div className={styles.workMetaRow}>
                    <span className={styles.workMeta}>
                      {run.projectKey}
                      {boundStation ? ` - Station ${boundStation.label ?? run.stationId}` : ""}
                    </span>
                    <span className={styles.workMeta}>Updated {new Date(run.updatedAt).toLocaleString()}</span>
                  </div>
                  <div className={styles.workMeta}>
                    {run.status === "working"
                      ? latestAttempt
                        ? `Attempt ${latestAttempt.sequence} is active.`
                        : "Mission pass is active."
                      : run.status === "ready"
                        ? "The mission workspace is prepared and waiting for launch."
                        : run.status === "blocked"
                          ? "YouTrack state sync needs attention."
                          : run.status === "error"
                            ? "This mission needs recovery attention."
                            : run.status === "awaiting-review"
                              ? "This mission is waiting on your review."
                              : "Mission startup is still underway."}
                  </div>
                  {run.statusMessage ? <div className={styles.workHint}>{run.statusMessage}</div> : null}
                  <div className={styles.workActions}>
                    <div className={styles.detailLinks}>
                      {run.stationId ? (
                        <button type="button" className={styles.secondaryButton} onClick={() => onFocusRunStation(run)}>
                          Open station
                        </button>
                      ) : null}
                    </div>
                    <div className={styles.detailLinks}>
                      <button
                        type="button"
                        className={run.status === "awaiting-review" ? styles.actionButton : styles.secondaryButton}
                        onClick={() => onOpenRunMissionDetail(run.runId)}
                      >
                        {detailLabel}
                      </button>
                      {run.status === "blocked" ? (
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => void onRetryTicketRunSync(run.runId)}
                          disabled={syncingRunId === run.runId}
                        >
                          {syncingRunId === run.runId ? "Syncing..." : "Retry state sync"}
                        </button>
                      ) : null}
                      {run.status === "ready" ? (
                        <button
                          type="button"
                          className={styles.actionButton}
                          onClick={() => void onStartRunWork(run.runId)}
                          disabled={startingWorkRunId === run.runId}
                        >
                          {startingWorkRunId === run.runId ? "Starting work..." : "Start work"}
                        </button>
                      ) : null}
                      {run.status === "working" ? (
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => void onCancelRunWork(run.runId)}
                          disabled={cancellingRunId === run.runId}
                        >
                          {cancellingRunId === run.runId ? "Cancelling..." : "Cancel pass"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        id="missions-panel-dry-dock"
        role="tabpanel"
        aria-labelledby="missions-tab-dry-dock"
        className={styles.section}
        hidden={activeTab !== "dry-dock" || isMissionDetailOpen}
      >
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Completed missions</div>
            <div className={styles.sectionCaption}>
              Finished runs move here so Launch Bay and Flight Deck only carry live work.
            </div>
          </div>
        </div>
        {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
        {runError ? <div className={styles.error}>{runError}</div> : null}
        {completedRuns.length === 0 ? (
          <div className={styles.emptyState}>No missions have reached dry dock yet.</div>
        ) : (
          <div className={styles.runList}>
            {completedRuns.map((run) => {
              const ticket = ticketById.get(run.ticketId) ?? null;
              const runUrl = ticket?.url ?? run.ticketUrl;
              return (
                <article key={run.runId} className={styles.runCard}>
                  <div className={styles.workHeader}>
                    <div className={styles.workHeaderCopy}>
                      <span className={styles.ticketId}>{run.ticketId}</span>
                      <strong>{run.ticketSummary}</strong>
                    </div>
                    <span className={styles.statusBadge}>{describeRunStatus(run)}</span>
                  </div>
                  <div className={styles.workMetaRow}>
                    <span className={styles.workMeta}>{run.projectKey}</span>
                    <span className={styles.workMeta}>Completed {new Date(run.updatedAt).toLocaleString()}</span>
                  </div>
                  <div className={styles.workMeta}>
                    {run.attempts.length} attempt{run.attempts.length === 1 ? "" : "s"} across {run.worktrees.length}{" "}
                    worktree{run.worktrees.length === 1 ? "" : "s"}.
                  </div>
                  <div className={styles.workActions}>
                    <div className={styles.detailLinks}>
                      {runUrl ? (
                        <a className={styles.inlineLink} href={runUrl} target="_blank" rel="noreferrer">
                          Open in YouTrack
                        </a>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => onOpenRunMissionDetail(run.runId)}
                    >
                      Open mission
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
