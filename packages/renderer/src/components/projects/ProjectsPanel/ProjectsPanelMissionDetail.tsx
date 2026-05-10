import type {
  MissionServiceProcessSummary,
  MissionServiceProfileSummary,
  MissionServiceSnapshot,
  TicketRunGitState,
  TicketRunSubmoduleGitState,
  TicketRunSummary,
  YouTrackTicketSummary,
} from "@spira/shared";
import type { StationViewState } from "../../../stores/station-store.js";
import styles from "./ProjectsPanel.module.css";
import {
  describeAttemptStatus,
  describeMissionServiceLauncher,
  describeMissionServiceState,
  describeRunStatus,
  formatDiffDelta,
  formatMissionServiceUrls,
  getDiffLineTone,
  getDiffStatusTone,
  getMissionServiceStateTone,
  isMissionServiceProcessActive,
} from "./ProjectsPanel.utils.js";
import { ProjectsPanelSubmoduleDetail } from "./ProjectsPanelSubmoduleDetail.js";

type ProjectsPanelMissionDetailProps = {
  missionDetailBackLabel: string;
  missionSectionLabel: string;
  selectedMissionUrl: string | null;
  selectedMissionRun: TicketRunSummary | null;
  selectedMissionTicket: YouTrackTicketSummary | null;
  selectedMissionProjectKey: string | null;
  selectedMissionIsMapped: boolean;
  selectedMissionRepoCount: number;
  selectedMissionStation: StationViewState | null;
  runNotice: string | null;
  runError: string | null;
  selectedMissionBlocker: string | null;
  startingTicketId: string | null;
  syncingRunId: string | null;
  startingWorkRunId: string | null;
  continuingRunId: string | null;
  cancellingRunId: string | null;
  completingRunId: string | null;
  deletingRunId: string | null;
  abortingStartupRunId: string | null;
  isSelectedMissionReviewLoading: boolean;
  canDeleteSelectedMission: boolean;
  selectedMissionDeleteBlockers: string | null;
  hasSelectedMissionReviewCloseBlockers: boolean;
  currentContinueDraft: string;
  selectedMissionLatestAttempt: TicketRunSummary["attempts"][number] | null;
  selectedMissionGitRepoLabel: string | null;
  gitNotice: string | null;
  gitError: string | null;
  selectedMissionBlockingSubmoduleNames: string[];
  showRepoPullRequestActions: boolean;
  creatingPullRequestRunId: string | null;
  selectedGitState: TicketRunGitState | null;
  commitDraft: string;
  generatingCommitDraftRunId: string | null;
  savingCommitDraftRunId: string | null;
  committingGitRunId: string | null;
  syncingRemoteRunId: string | null;
  selectedMissionSubmodule: TicketRunSummary["submodules"][number] | null;
  selectedMissionSubmoduleLabel: string | null;
  selectedSubmoduleGitState: TicketRunSubmoduleGitState | null;
  selectedSubmoduleKey: string | null;
  loadingSubmoduleKey: string | null;
  showSubmodulePullRequestActions: boolean;
  creatingSubmodulePullRequestKey: string | null;
  submoduleCommitDraft: string;
  savingSubmoduleCommitDraftKey: string | null;
  generatingSubmoduleCommitDraftKey: string | null;
  committingSubmoduleKey: string | null;
  syncingSubmoduleKey: string | null;
  selectedSubmoduleCanSync: boolean;
  selectedSubmoduleSyncLabel: string;
  selectedSubmoduleNeedsAlignment: boolean;
  expandedDiffPaths: Record<string, boolean>;
  selectedMissionWorktree: TicketRunSummary["worktrees"][number] | null;
  selectedMissionRunWorktreeCount: number;
  loadingServicesRunId: string | null;
  serviceNotice: string | null;
  serviceError: string | null;
  selectedMissionServicesSnapshot: MissionServiceSnapshot | null;
  missionServiceProfilesByRepo: Array<[string, MissionServiceProfileSummary[]]>;
  activeMissionServiceProfileIds: Set<string>;
  startingServiceProfileId: string | null;
  selectedMissionServiceProcesses: MissionServiceProcessSummary[];
  stoppingServiceId: string | null;
  loadingGitRunId: string | null;
  onCloseMissionDetail: () => void;
  onFocusRunStation: (() => void) | null;
  onStartTicketRun: (() => Promise<void>) | null;
  onRetryTicketRunSync: (() => Promise<void>) | null;
  onStartRunWork: (() => Promise<void>) | null;
  onContinueDraftChange: (value: string) => void;
  onCancelRunWork: (() => Promise<void>) | null;
  onContinueRunWork: (() => Promise<void>) | null;
  onCompleteRun: (() => Promise<void>) | null;
  onDeleteRun: (() => Promise<void>) | null;
  onAbandonMissionStartup: (() => Promise<void>) | null;
  onOpenMissionPullRequest: (() => Promise<void>) | null;
  onCommitDraftChange: (value: string) => void;
  onPersistCommitDraft: (() => Promise<void>) | null;
  onGenerateCommitDraft: (() => Promise<void>) | null;
  onCommitMissionRun: (() => Promise<void>) | null;
  onSyncMissionRemote: (action: "publish" | "push") => Promise<void>;
  onRefreshSelectedSubmoduleGitState: (runId: string) => Promise<void>;
  onSelectSubmodule: (canonicalUrl: string) => void;
  onOpenSubmodulePullRequest: (runId: string) => Promise<void>;
  onSubmoduleCommitDraftChange: (value: string) => void;
  onPersistSubmoduleCommitDraft: (runId: string) => Promise<void>;
  onGenerateSubmoduleCommitDraft: (runId: string) => Promise<void>;
  onCommitMissionSubmodule: (runId: string) => Promise<void>;
  onSyncSubmoduleRemote: (runId: string, action: "publish" | "push") => Promise<void>;
  onToggleExpandedDiff: (expandedKey: string) => void;
  onSelectRepo: (repoRelativePath: string) => void;
  onRefreshMissionServices: (() => Promise<void>) | null;
  onStartMissionService: (profile: MissionServiceProfileSummary) => Promise<void>;
  onStopMissionService: (process: MissionServiceProcessSummary) => Promise<void>;
  onRefreshMissionGitState: (() => Promise<void>) | null;
};

export function ProjectsPanelMissionDetail({
  missionDetailBackLabel,
  missionSectionLabel,
  selectedMissionUrl,
  selectedMissionRun,
  selectedMissionTicket,
  selectedMissionProjectKey,
  selectedMissionIsMapped,
  selectedMissionRepoCount,
  selectedMissionStation,
  runNotice,
  runError,
  selectedMissionBlocker,
  startingTicketId,
  syncingRunId,
  startingWorkRunId,
  continuingRunId,
  cancellingRunId,
  completingRunId,
  deletingRunId,
  abortingStartupRunId,
  isSelectedMissionReviewLoading,
  canDeleteSelectedMission,
  selectedMissionDeleteBlockers,
  hasSelectedMissionReviewCloseBlockers,
  currentContinueDraft,
  selectedMissionLatestAttempt,
  selectedMissionGitRepoLabel,
  gitNotice,
  gitError,
  selectedMissionBlockingSubmoduleNames,
  showRepoPullRequestActions,
  creatingPullRequestRunId,
  selectedGitState,
  commitDraft,
  generatingCommitDraftRunId,
  savingCommitDraftRunId,
  committingGitRunId,
  syncingRemoteRunId,
  selectedMissionSubmodule,
  selectedMissionSubmoduleLabel,
  selectedSubmoduleGitState,
  selectedSubmoduleKey,
  loadingSubmoduleKey,
  showSubmodulePullRequestActions,
  creatingSubmodulePullRequestKey,
  submoduleCommitDraft,
  savingSubmoduleCommitDraftKey,
  generatingSubmoduleCommitDraftKey,
  committingSubmoduleKey,
  syncingSubmoduleKey,
  selectedSubmoduleCanSync,
  selectedSubmoduleSyncLabel,
  selectedSubmoduleNeedsAlignment,
  expandedDiffPaths,
  selectedMissionWorktree,
  selectedMissionRunWorktreeCount,
  loadingServicesRunId,
  serviceNotice,
  serviceError,
  selectedMissionServicesSnapshot,
  missionServiceProfilesByRepo,
  activeMissionServiceProfileIds,
  startingServiceProfileId,
  selectedMissionServiceProcesses,
  stoppingServiceId,
  loadingGitRunId,
  onCloseMissionDetail,
  onFocusRunStation,
  onStartTicketRun,
  onRetryTicketRunSync,
  onStartRunWork,
  onContinueDraftChange,
  onCancelRunWork,
  onContinueRunWork,
  onCompleteRun,
  onDeleteRun,
  onAbandonMissionStartup,
  onOpenMissionPullRequest,
  onCommitDraftChange,
  onPersistCommitDraft,
  onGenerateCommitDraft,
  onCommitMissionRun,
  onSyncMissionRemote,
  onRefreshSelectedSubmoduleGitState,
  onSelectSubmodule,
  onOpenSubmodulePullRequest,
  onSubmoduleCommitDraftChange,
  onPersistSubmoduleCommitDraft,
  onGenerateSubmoduleCommitDraft,
  onCommitMissionSubmodule,
  onSyncSubmoduleRemote,
  onToggleExpandedDiff,
  onSelectRepo,
  onRefreshMissionServices,
  onStartMissionService,
  onStopMissionService,
  onRefreshMissionGitState,
}: ProjectsPanelMissionDetailProps) {
  return (
    <section className={`${styles.section} ${styles.detailPage}`}>
      <div className={styles.detailTopline}>
        <button type="button" className={styles.secondaryButton} onClick={onCloseMissionDetail}>
          {`< Back to ${missionDetailBackLabel}`}
        </button>
        <div className={styles.detailLinks}>
          {selectedMissionUrl ? (
            <a className={styles.inlineLink} href={selectedMissionUrl} target="_blank" rel="noreferrer">
              Open in YouTrack
            </a>
          ) : null}
          {onFocusRunStation ? (
            <button type="button" className={styles.secondaryButton} onClick={onFocusRunStation}>
              Open station
            </button>
          ) : null}
        </div>
      </div>

      <article className={styles.detailCard}>
        <div className={styles.detailHeader}>
          <div className={styles.detailHeaderCopy}>
            <div className={styles.sectionLabel}>{missionSectionLabel}</div>
            <div className={styles.detailTitleRow}>
              <span className={styles.ticketId}>
                {selectedMissionRun?.ticketId ?? selectedMissionTicket?.id ?? "Mission"}
              </span>
              <h3 className={styles.detailTitle}>
                {selectedMissionRun?.ticketSummary ?? selectedMissionTicket?.summary ?? "Mission detail"}
              </h3>
            </div>
          </div>
          <div className={styles.workBadges}>
            {selectedMissionTicket?.state ? (
              <span className={styles.statusBadge}>{selectedMissionTicket.state}</span>
            ) : null}
            {selectedMissionProjectKey ? (
              <span
                className={`${styles.ticketScopeBadge} ${
                  selectedMissionIsMapped ? styles.ticketScopeMapped : styles.ticketScopeUnmapped
                }`}
              >
                {selectedMissionIsMapped ? "Mapped scope" : "No repo mapping"}
              </span>
            ) : null}
            {selectedMissionRun ? (
              <span className={styles.statusBadge}>{describeRunStatus(selectedMissionRun)}</span>
            ) : null}
          </div>
        </div>

        {runNotice || runError ? (
          <>
            {runNotice ? <div className={styles.notice}>{runNotice}</div> : null}
            {runError ? <div className={styles.error}>{runError}</div> : null}
          </>
        ) : null}

        <div className={styles.statusFacts}>
          <div className={styles.statusFact}>
            <span className={styles.sectionLabel}>Project</span>
            <span className={styles.statusFactValue}>
              {selectedMissionProjectKey ?? "Unknown project"}
              {selectedMissionTicket?.projectName ? ` - ${selectedMissionTicket.projectName}` : ""}
            </span>
          </div>
          <div className={styles.statusFact}>
            <span className={styles.sectionLabel}>Updated</span>
            <span className={styles.statusFactValue}>
              {selectedMissionRun
                ? new Date(selectedMissionRun.updatedAt).toLocaleString()
                : selectedMissionTicket?.updatedAt
                  ? new Date(selectedMissionTicket.updatedAt).toLocaleString()
                  : "Unavailable"}
            </span>
          </div>
          <div className={styles.statusFact}>
            <span className={styles.sectionLabel}>Assignee</span>
            <span className={styles.statusFactValue}>{selectedMissionTicket?.assignee ?? "Unassigned"}</span>
          </div>
          <div className={styles.statusFact}>
            <span className={styles.sectionLabel}>Repo scope</span>
            <span className={styles.statusFactValue}>
              {selectedMissionRun
                ? `${selectedMissionRun.worktrees.length} worktree${selectedMissionRun.worktrees.length === 1 ? "" : "s"}`
                : `${selectedMissionRepoCount} mapped repo${selectedMissionRepoCount === 1 ? "" : "s"}`}
            </span>
          </div>
          {selectedMissionRun?.stationId ? (
            <div className={styles.statusFact}>
              <span className={styles.sectionLabel}>Station</span>
              <span className={styles.statusFactValue}>
                {selectedMissionStation?.label ?? selectedMissionRun.stationId}
                {selectedMissionStation ? ` - ${selectedMissionStation.state}` : ""}
              </span>
            </div>
          ) : null}
        </div>

        {selectedMissionRun?.statusMessage ? (
          <div className={styles.workHint}>{selectedMissionRun.statusMessage}</div>
        ) : null}
        {!selectedMissionRun && selectedMissionBlocker ? (
          <div className={styles.workHint}>{selectedMissionBlocker}</div>
        ) : null}

        {!selectedMissionRun && selectedMissionTicket && onStartTicketRun ? (
          <div className={styles.workActions}>
            <span className={styles.workMeta}>
              {selectedMissionBlocker ?? "This ticket is ready for Missions to pick up."}
            </span>
            <button
              type="button"
              className={selectedMissionBlocker ? styles.secondaryButton : styles.actionButton}
              onClick={() => void onStartTicketRun()}
              disabled={Boolean(selectedMissionBlocker) || startingTicketId === selectedMissionTicket.id}
            >
              {startingTicketId === selectedMissionTicket.id ? "Starting..." : "Pick up ticket"}
            </button>
          </div>
        ) : null}

        {selectedMissionRun?.status === "error" && selectedMissionTicket && onStartTicketRun ? (
          <div className={styles.workActions}>
            <span className={styles.workMeta}>The previous pickup failed. Missions can retry from here.</span>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => void onStartTicketRun()}
              disabled={startingTicketId === selectedMissionTicket.id}
            >
              {startingTicketId === selectedMissionTicket.id ? "Starting..." : "Retry pickup"}
            </button>
            {selectedMissionRun.attempts.length === 0 && onAbandonMissionStartup ? (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  if (
                    window.confirm(
                      `Abandon mission ${selectedMissionRun.ticketId} startup? Local worktrees will be cleared.`,
                    )
                  ) {
                    void onAbandonMissionStartup();
                  }
                }}
                disabled={abortingStartupRunId === selectedMissionRun.runId}
              >
                {abortingStartupRunId === selectedMissionRun.runId ? "Abandoning..." : "Abandon startup"}
              </button>
            ) : null}
          </div>
        ) : null}

        {selectedMissionRun?.status === "starting" && selectedMissionTicket
          ? (() => {
              const elapsedMs = Date.now() - selectedMissionRun.startedAt;
              const looksSlow = elapsedMs >= 3 * 60_000;
              return (
                <div className={styles.workActions}>
                  <span className={styles.workMeta}>
                    {looksSlow
                      ? "Startup is taking longer than expected — retry or abandon."
                      : "Preparing managed worktrees..."}
                  </span>
                  {looksSlow && onStartTicketRun ? (
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => void onStartTicketRun()}
                      disabled={startingTicketId === selectedMissionTicket.id}
                    >
                      {startingTicketId === selectedMissionTicket.id ? "Starting..." : "Retry startup"}
                    </button>
                  ) : null}
                  {onAbandonMissionStartup ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Abandon mission ${selectedMissionRun.ticketId} startup? Local worktrees will be cleared.`,
                          )
                        ) {
                          void onAbandonMissionStartup();
                        }
                      }}
                      disabled={abortingStartupRunId === selectedMissionRun.runId}
                    >
                      {abortingStartupRunId === selectedMissionRun.runId ? "Abandoning..." : "Abandon startup"}
                    </button>
                  ) : null}
                </div>
              );
            })()
          : null}

        {selectedMissionRun?.status === "blocked" && onRetryTicketRunSync ? (
          <div className={styles.workActions}>
            <span className={styles.workMeta}>YouTrack state sync is retryable.</span>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => void onRetryTicketRunSync()}
              disabled={syncingRunId === selectedMissionRun.runId}
            >
              {syncingRunId === selectedMissionRun.runId ? "Syncing..." : "Retry state sync"}
            </button>
          </div>
        ) : null}

        {selectedMissionRun?.status === "ready" && onStartRunWork ? (
          <div className={styles.reviewPanel}>
            <div className={styles.workMeta}>The mission workspace is prepared. Spira has not started coding yet.</div>
            <label className={styles.field}>
              <span>Additional mission context</span>
              <textarea
                className={`${styles.input} ${styles.textarea}`}
                value={currentContinueDraft}
                onChange={(event) => onContinueDraftChange(event.target.value)}
                placeholder="Anything not captured in the ticket that Shinra should know before the first pass."
              />
            </label>
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => void onStartRunWork()}
                disabled={startingWorkRunId === selectedMissionRun.runId}
              >
                {startingWorkRunId === selectedMissionRun.runId ? "Starting work..." : "Start work"}
              </button>
            </div>
          </div>
        ) : null}

        {selectedMissionRun?.status === "working" && onCancelRunWork ? (
          <div className={styles.workActions}>
            <span className={styles.workMeta}>
              {selectedMissionLatestAttempt
                ? `Attempt ${selectedMissionLatestAttempt.sequence} is active.`
                : "Mission pass is active."}
            </span>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void onCancelRunWork()}
              disabled={cancellingRunId === selectedMissionRun.runId}
            >
              {cancellingRunId === selectedMissionRun.runId ? "Cancelling..." : "Cancel pass"}
            </button>
          </div>
        ) : null}

        {selectedMissionRun?.status === "awaiting-review" && onContinueRunWork && onCompleteRun ? (
          <div className={styles.reviewPanel}>
            <label className={styles.field}>
              <span>Next prompt</span>
              <textarea
                className={`${styles.input} ${styles.textarea}`}
                value={currentContinueDraft}
                onChange={(event) => onContinueDraftChange(event.target.value)}
                placeholder="Tighten anything you want on the next pass."
              />
            </label>
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void onContinueRunWork()}
                disabled={continuingRunId === selectedMissionRun.runId}
              >
                {continuingRunId === selectedMissionRun.runId ? "Continuing..." : "Continue work"}
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() => void onCompleteRun()}
                disabled={completingRunId === selectedMissionRun.runId}
              >
                {completingRunId === selectedMissionRun.runId ? "Closing..." : "Close mission"}
              </button>
            </div>
            {hasSelectedMissionReviewCloseBlockers ? (
              <div className={styles.workHint}>
                Repo or managed submodule review work remains, but you can still mark the mission done.
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedMissionRun && onDeleteRun ? (
          <div className={styles.reviewPanel}>
            <div className={styles.sectionLabel}>Local teardown</div>
            <div className={styles.workHint}>
              Delete removes local mission worktrees and unpublished mission branches, then forgets the run.
            </div>
            <div className={styles.inlineActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete mission ${selectedMissionRun.ticketId}? This removes local worktrees and unpublished mission branches.`,
                    )
                  ) {
                    void onDeleteRun();
                  }
                }}
                disabled={
                  deletingRunId === selectedMissionRun.runId ||
                  isSelectedMissionReviewLoading ||
                  !canDeleteSelectedMission
                }
              >
                {deletingRunId === selectedMissionRun.runId
                  ? "Deleting..."
                  : isSelectedMissionReviewLoading
                    ? "Checking..."
                    : "Delete mission"}
              </button>
            </div>
            {!canDeleteSelectedMission ? (
              <div className={styles.workHint}>
                Delete is disabled because published branches were found:{" "}
                {selectedMissionDeleteBlockers ?? "state is unresolved"}.
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedMissionRun?.status === "awaiting-review" ? (
          <div className={styles.reviewPanel}>
            {gitNotice ? <div className={styles.notice}>{gitNotice}</div> : null}
            {gitError ? <div className={styles.error}>{gitError}</div> : null}
            {selectedMissionGitRepoLabel ? (
              <div className={styles.workHint}>Active repo: {selectedMissionGitRepoLabel}</div>
            ) : null}
            {selectedMissionBlockingSubmoduleNames.length > 0 ? (
              <div className={styles.blockedState}>
                Finish the managed submodule workflow first: {selectedMissionBlockingSubmoduleNames.join(", ")}.
              </div>
            ) : null}
            {showRepoPullRequestActions ? (
              <>
                <div className={styles.sectionLabel}>Pull request</div>
                <div className={styles.inlineActions}>
                  <button
                    type="button"
                    className={styles.actionLinkButton}
                    onClick={() => void onOpenMissionPullRequest?.()}
                    disabled={creatingPullRequestRunId === selectedMissionRun.runId}
                  >
                    {creatingPullRequestRunId === selectedMissionRun.runId ? "Opening PR..." : "Open PR"}
                  </button>
                  <a
                    className={styles.secondaryLinkButton}
                    href={selectedGitState?.pullRequestUrls.draft ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open draft PR
                  </a>
                </div>
                <div className={styles.workHint}>
                  Everything in this mission has reached the remote branch. Open the pull request when you are ready to
                  send it up the chain.
                </div>
              </>
            ) : (
              <>
                <label className={styles.field}>
                  <span>
                    {selectedMissionGitRepoLabel ? `Commit draft - ${selectedMissionGitRepoLabel}` : "Commit draft"}
                  </span>
                  <textarea
                    className={`${styles.input} ${styles.textarea}`}
                    value={commitDraft}
                    disabled={savingCommitDraftRunId === selectedMissionRun.runId}
                    onChange={(event) => onCommitDraftChange(event.target.value)}
                    onBlur={() => void onPersistCommitDraft?.()}
                    placeholder={`feat(${selectedMissionRun.ticketId}): summary`}
                  />
                </label>
                <div className={styles.inlineActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void onGenerateCommitDraft?.()}
                    disabled={
                      generatingCommitDraftRunId === selectedMissionRun.runId ||
                      savingCommitDraftRunId === selectedMissionRun.runId
                    }
                  >
                    {generatingCommitDraftRunId === selectedMissionRun.runId ? "Regenerating..." : "Regenerate"}
                  </button>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => void onCommitMissionRun?.()}
                    disabled={
                      !commitDraft.trim() ||
                      (selectedGitState !== null && !selectedGitState.hasDiff) ||
                      selectedMissionBlockingSubmoduleNames.length > 0 ||
                      committingGitRunId === selectedMissionRun.runId ||
                      savingCommitDraftRunId === selectedMissionRun.runId
                    }
                  >
                    {committingGitRunId === selectedMissionRun.runId ? "Committing..." : "Commit"}
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() =>
                      void onSyncMissionRemote(selectedGitState?.pushAction === "publish" ? "publish" : "push")
                    }
                    disabled={
                      syncingRemoteRunId === selectedMissionRun.runId ||
                      !selectedGitState ||
                      selectedMissionBlockingSubmoduleNames.length > 0 ||
                      selectedGitState.pushAction === "none"
                    }
                  >
                    {syncingRemoteRunId === selectedMissionRun.runId
                      ? "Syncing..."
                      : selectedGitState?.pushAction === "publish"
                        ? "Publish"
                        : "Push"}
                  </button>
                </div>
                <div className={styles.workHint}>
                  {selectedMissionBlockingSubmoduleNames.length > 0
                    ? "Managed submodules still need to be committed, published, or aligned before this repo can move."
                    : selectedGitState?.hasDiff
                      ? "Changes are still waiting to be committed."
                      : selectedGitState?.pushAction === "publish"
                        ? "This branch is ready to publish to origin."
                        : selectedGitState?.pushAction === "push"
                          ? "This branch has local commits ready to push."
                          : "The branch is currently up to date."}
                </div>
              </>
            )}
          </div>
        ) : null}
      </article>

      {selectedMissionRun ? (
        <ProjectsPanelSubmoduleDetail
          run={selectedMissionRun}
          selectedMissionSubmodule={selectedMissionSubmodule}
          selectedSubmoduleGitState={selectedSubmoduleGitState}
          selectedMissionSubmoduleLabel={selectedMissionSubmoduleLabel}
          selectedSubmoduleKey={selectedSubmoduleKey}
          loadingSubmoduleKey={loadingSubmoduleKey}
          showSubmodulePullRequestActions={showSubmodulePullRequestActions}
          creatingSubmodulePullRequestKey={creatingSubmodulePullRequestKey}
          submoduleCommitDraft={submoduleCommitDraft}
          savingSubmoduleCommitDraftKey={savingSubmoduleCommitDraftKey}
          generatingSubmoduleCommitDraftKey={generatingSubmoduleCommitDraftKey}
          committingSubmoduleKey={committingSubmoduleKey}
          syncingSubmoduleKey={syncingSubmoduleKey}
          selectedSubmoduleCanSync={selectedSubmoduleCanSync}
          selectedSubmoduleSyncLabel={selectedSubmoduleSyncLabel}
          selectedSubmoduleNeedsAlignment={selectedSubmoduleNeedsAlignment}
          expandedDiffPaths={expandedDiffPaths}
          gitError={gitError}
          onRefreshSelectedSubmoduleGitState={onRefreshSelectedSubmoduleGitState}
          onSelectSubmodule={onSelectSubmodule}
          onOpenSubmodulePullRequest={onOpenSubmodulePullRequest}
          onSubmoduleCommitDraftChange={onSubmoduleCommitDraftChange}
          onPersistSubmoduleCommitDraft={onPersistSubmoduleCommitDraft}
          onGenerateSubmoduleCommitDraft={onGenerateSubmoduleCommitDraft}
          onCommitMissionSubmodule={onCommitMissionSubmodule}
          onSyncSubmoduleRemote={onSyncSubmoduleRemote}
          onToggleExpandedDiff={onToggleExpandedDiff}
        />
      ) : null}

      {selectedMissionRun?.attempts.length ? (
        <article className={styles.detailCard}>
          <div className={styles.sectionLabel}>Mission attempts</div>
          <div className={styles.attemptList}>
            {[...selectedMissionRun.attempts].reverse().map((attempt) => (
              <div key={attempt.attemptId} className={styles.attemptCard}>
                <div className={styles.workHeader}>
                  <strong>Attempt {attempt.sequence}</strong>
                  <span className={styles.statusBadge}>{describeAttemptStatus(attempt.status)}</span>
                </div>
                {attempt.prompt ? <div className={styles.workHint}>Prompt: {attempt.prompt}</div> : null}
                {attempt.summary ? <div className={styles.workHint}>{attempt.summary}</div> : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {selectedMissionRun?.worktrees.length ? (
        <article className={styles.detailCard}>
          <div className={styles.sectionLabel}>Managed worktrees</div>
          <div className={styles.runWorktrees}>
            {selectedMissionRun.worktrees.map((worktree) => (
              <div key={`${selectedMissionRun.runId}-${worktree.repoRelativePath}`} className={styles.runWorktree}>
                <strong>{worktree.repoRelativePath}</strong>
                <span>{worktree.branchName}</span>
                <span>{worktree.worktreePath}</span>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {selectedMissionRun && selectedMissionRun.worktrees.length > 1 ? (
        <article className={styles.detailCard}>
          <div className={styles.sectionLabel}>Parent repos</div>
          <div className={styles.repoTabBar} role="tablist" aria-label="Mission repositories">
            {selectedMissionRun.worktrees.map((worktree) => {
              const isActive = selectedMissionWorktree?.repoRelativePath === worktree.repoRelativePath;
              return (
                <button
                  key={`${selectedMissionRun.runId}-${worktree.repoRelativePath}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`${styles.repoTabButton} ${isActive ? styles.repoTabButtonActive : ""}`}
                  onClick={() => onSelectRepo(worktree.repoRelativePath)}
                >
                  <span>{worktree.repoRelativePath}</span>
                  <span className={styles.repoTabMeta}>{worktree.branchName}</span>
                </button>
              );
            })}
          </div>
        </article>
      ) : null}

      {selectedMissionRun ? (
        <article className={styles.detailCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionLabel}>Services</div>
              <div className={styles.sectionCaption}>
                {selectedMissionWorktree && selectedMissionRunWorktreeCount > 1
                  ? `Launch profiles are filtered to ${selectedMissionWorktree.repoRelativePath}. `
                  : ""}
                Active processes remain mission-wide, no matter which repo tab you are staring at.
              </div>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void onRefreshMissionServices?.()}
              disabled={loadingServicesRunId === selectedMissionRun.runId}
            >
              {loadingServicesRunId === selectedMissionRun.runId ? "Refreshing..." : "Refresh services"}
            </button>
          </div>

          {serviceNotice ? <div className={styles.notice}>{serviceNotice}</div> : null}
          {serviceError ? <div className={styles.error}>{serviceError}</div> : null}

          <div className={styles.serviceSection}>
            <div className={styles.sectionLabel}>Launch profiles</div>
            {selectedMissionServicesSnapshot ? (
              missionServiceProfilesByRepo.length > 0 ? (
                <div className={styles.serviceGroupList}>
                  {missionServiceProfilesByRepo.map(([repoRelativePath, profiles]) => (
                    <div key={`${selectedMissionRun.runId}:${repoRelativePath}`} className={styles.serviceGroup}>
                      <div className={styles.serviceGroupHeader}>
                        <span className={styles.pathBadge}>{repoRelativePath}</span>
                        <span className={styles.repoTabMeta}>
                          {profiles.length} profile{profiles.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className={styles.serviceCardList}>
                        {profiles.map((profile) => {
                          const profileUrl = profile.launchUrl ?? profile.urls[0] ?? null;
                          const isRunning = activeMissionServiceProfileIds.has(profile.profileId);
                          return (
                            <div
                              key={profile.profileId}
                              className={`${styles.serviceCard} ${profile.isLaunchable ? "" : styles.serviceCardUnavailable}`}
                            >
                              <div className={styles.workHeader}>
                                <div className={styles.workHeaderCopy}>
                                  <strong>{profile.profileName}</strong>
                                  <span className={styles.repoTabMeta}>{describeMissionServiceLauncher(profile)}</span>
                                </div>
                                <div className={styles.inlineActions}>
                                  {profileUrl ? (
                                    <button
                                      type="button"
                                      className={styles.secondaryButton}
                                      onClick={() => void window.electronAPI.openExternal(profileUrl)}
                                    >
                                      Open URL
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={profile.isLaunchable ? styles.actionButton : styles.secondaryButton}
                                    onClick={() => void onStartMissionService(profile)}
                                    disabled={
                                      !profile.isLaunchable ||
                                      isRunning ||
                                      startingServiceProfileId === profile.profileId
                                    }
                                  >
                                    {startingServiceProfileId === profile.profileId
                                      ? "Starting..."
                                      : isRunning
                                        ? "Running"
                                        : "Start"}
                                  </button>
                                </div>
                              </div>
                              <div className={styles.inlineRunFacts}>
                                <div className={styles.inlineRunFact}>
                                  <strong>Project</strong>
                                  {profile.projectRelativePath}
                                </div>
                                <div className={styles.inlineRunFact}>
                                  <strong>URLs</strong>
                                  {formatMissionServiceUrls(profile.urls)}
                                </div>
                                <div className={styles.inlineRunFact}>
                                  <strong>Environment</strong>
                                  {profile.environmentName ?? "Default"}
                                </div>
                                <div className={styles.inlineRunFact}>
                                  <strong>Launch settings</strong>
                                  {profile.launchSettingsRelativePath}
                                </div>
                              </div>
                              {!profile.isLaunchable && profile.unavailableReason ? (
                                <div className={styles.blockedState}>{profile.unavailableReason}</div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  {selectedMissionWorktree && selectedMissionRunWorktreeCount > 1
                    ? `No runnable service profiles found in ${selectedMissionWorktree.repoRelativePath}.`
                    : "No runnable service profiles found."}
                </div>
              )
            ) : loadingServicesRunId === selectedMissionRun.runId ? (
              <div className={styles.emptyState}>Loading mission services...</div>
            ) : (
              <div className={styles.emptyState}>Mission services are waiting to load.</div>
            )}
          </div>

          <div className={styles.serviceSection}>
            <div className={styles.sectionLabel}>Tracked processes</div>
            <div className={styles.sectionCaption}>Started services remain visible across all repo tabs.</div>
            {selectedMissionServiceProcesses.length > 0 ? (
              <div className={styles.serviceCardList}>
                {selectedMissionServiceProcesses.map((process) => {
                  const processTone = getMissionServiceStateTone(process.state);
                  const processUrl = process.launchUrl ?? process.urls[0] ?? null;
                  const stdoutLogLines = process.recentLogLines.filter((line) => line.source === "stdout");
                  return (
                    <div key={process.serviceId} className={`${styles.serviceCard} ${processTone}`}>
                      <div className={styles.workHeader}>
                        <div className={styles.workHeaderCopy}>
                          <strong>{process.profileName}</strong>
                          <span className={styles.repoTabMeta}>
                            {process.repoRelativePath} - {describeMissionServiceLauncher(process)}
                          </span>
                        </div>
                        <div className={styles.inlineActions}>
                          <span className={`${styles.statusBadge} ${processTone}`}>
                            {describeMissionServiceState(process.state)}
                          </span>
                          {processUrl ? (
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              onClick={() => void window.electronAPI.openExternal(processUrl)}
                            >
                              Open URL
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={
                              isMissionServiceProcessActive(process) ? styles.secondaryButton : styles.actionButton
                            }
                            onClick={() => void onStopMissionService(process)}
                            disabled={
                              !isMissionServiceProcessActive(process) || stoppingServiceId === process.serviceId
                            }
                          >
                            {stoppingServiceId === process.serviceId
                              ? "Stopping..."
                              : isMissionServiceProcessActive(process)
                                ? "Stop"
                                : "Stopped"}
                          </button>
                        </div>
                      </div>
                      {process.errorMessage ? <div className={styles.error}>{process.errorMessage}</div> : null}
                      {stdoutLogLines.length > 0 ? (
                        <div className={styles.serviceLogTail}>
                          {stdoutLogLines.map((line, index) => (
                            <div
                              key={`${process.serviceId}:${line.timestamp}:${index}`}
                              className={styles.serviceLogLine}
                            >
                              {line.line}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={styles.workHint}>No stdout yet.</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyState}>No mission services have been started yet.</div>
            )}
          </div>
        </article>
      ) : null}

      {selectedMissionRun?.worktrees.length ? (
        <article className={styles.detailCard}>
          <div className={styles.sectionHeader}>
            <div>
              <div className={styles.sectionLabel}>Worktree diff</div>
              <div className={styles.sectionCaption}>
                {selectedMissionGitRepoLabel ? `Active repo: ${selectedMissionGitRepoLabel}. ` : ""}
                Tracked worktree changes only. Untracked files stay out of the theatre.
              </div>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void onRefreshMissionGitState?.()}
              disabled={loadingGitRunId === selectedMissionRun.runId}
            >
              {loadingGitRunId === selectedMissionRun.runId ? "Refreshing..." : "Refresh diff"}
            </button>
          </div>
          {selectedGitState ? (
            selectedGitState.files.length > 0 ? (
              <div className={styles.diffList}>
                {selectedGitState.files.map((file) => {
                  const expandedKey = `${selectedGitState.repoRelativePath}:${file.path}`;
                  const expanded = expandedDiffPaths[expandedKey] ?? false;
                  const diffStatusTone = getDiffStatusTone(file.status);
                  return (
                    <div
                      key={`${selectedGitState.repoRelativePath}:${file.path}-${file.status}`}
                      className={`${styles.diffFileCard} ${diffStatusTone}`}
                    >
                      <button
                        type="button"
                        className={`${styles.diffFileButton} ${diffStatusTone}`}
                        onClick={() => onToggleExpandedDiff(expandedKey)}
                      >
                        <span className={`${styles.statusBadge} ${diffStatusTone}`}>{file.status}</span>
                        <span className={styles.diffFilePath}>
                          {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
                        </span>
                        <span className={styles.diffFileDelta}>{formatDiffDelta(file.additions, file.deletions)}</span>
                      </button>
                      {expanded ? (
                        <div className={styles.diffPatch}>
                          {file.patch.split(/\r?\n/u).map((line, index) => (
                            <div
                              key={`${file.path}-${file.status}-${index}`}
                              className={`${styles.diffPatchLine} ${getDiffLineTone(line)}`}
                            >
                              {line || " "}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyState}>No tracked diff remains in the selected managed repo.</div>
            )
          ) : loadingGitRunId === selectedMissionRun.runId ? (
            <div className={styles.emptyState}>Loading mission diff…</div>
          ) : gitError ? (
            <div className={styles.error}>{gitError}</div>
          ) : (
            <div className={styles.emptyState}>Mission diff is waiting to load.</div>
          )}
        </article>
      ) : null}
    </section>
  );
}
