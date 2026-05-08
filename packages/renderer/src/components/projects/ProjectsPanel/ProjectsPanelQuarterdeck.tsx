import type {
  ProjectRepoMappingsSnapshot,
  YouTrackProjectSummary,
  YouTrackStateMapping,
  YouTrackStatusSummary,
} from "@spira/shared";
import type { Ref } from "react";
import { ProjectTypeahead } from "../ProjectTypeahead.js";
import { YouTrackStateListEditor } from "../YouTrackStateListEditor.js";
import { normalizeProjectKey } from "../project-utils.js";
import { ProjectsMappingsList } from "./ProjectsMappingsList.js";
import styles from "./ProjectsPanel.module.css";
import { describeStatusLabel, describeStatusTone, formatStateList } from "./ProjectsPanel.utils.js";
import { ProjectsRepoChecklist } from "./ProjectsRepoChecklist.js";

type WorkflowValidationViewModel = {
  invalidTodoStates: string[];
  invalidInProgressStates: string[];
  errors: string[];
};

type ProjectsPanelQuarterdeckProps = {
  hidden: boolean;
  editorRef: Ref<HTMLElement>;
  youTrackEnabled: boolean;
  isRefreshing: boolean;
  youTrackStatus: YouTrackStatusSummary | null;
  hasWorkflowChanges: boolean;
  workflowBlocker: string | null;
  youTrackStateMappingDraft: YouTrackStateMapping;
  workflowValidation: WorkflowValidationViewModel;
  isSavingWorkflow: boolean;
  workflowNotice: string | null;
  workflowError: string | null;
  canSaveWorkflow: boolean;
  workspaceRootDraft: string;
  isBrowsingWorkspace: boolean;
  isSavingWorkspace: boolean;
  workspaceNotice: string | null;
  workspaceError: string | null;
  setupSummary: string;
  isEditorOpen: boolean;
  mappingBlocker: string | null;
  canSearchProjects: boolean;
  projectKeyDraft: string;
  isSavingMapping: boolean;
  snapshot: ProjectRepoMappingsSnapshot;
  selectedRepoPaths: string[];
  activeProjectKey: string | null;
  canSaveMapping: boolean;
  mappingNotice: string | null;
  mappingError: string | null;
  canManageMappings: boolean;
  onToggleYouTrackIntegration: () => void;
  onOpenSettings: () => void;
  onUpdateWorkflowStateList: (lane: keyof YouTrackStateMapping, nextStates: string[]) => void;
  onResetWorkflowMappingDraft: () => void;
  onSaveWorkflowMapping: () => Promise<void>;
  onRefreshData: () => Promise<void>;
  onWorkspaceRootDraftChange: (value: string) => void;
  onBrowseForWorkspace: () => Promise<void>;
  onResetWorkspaceRoot: () => void;
  onSaveWorkspaceRoot: () => Promise<void>;
  onProjectKeyDraftChange: (value: string) => void;
  onResolvedProjectChange: (project: YouTrackProjectSummary | null) => void;
  onToggleRepoSelection: (repoRelativePath: string) => void;
  onResetEditor: () => void;
  onSaveMapping: () => Promise<void>;
  onCreateMapping: () => void;
  onEditMapping: (projectKey: string) => void;
};

export function ProjectsPanelQuarterdeck({
  hidden,
  editorRef,
  youTrackEnabled,
  isRefreshing,
  youTrackStatus,
  hasWorkflowChanges,
  workflowBlocker,
  youTrackStateMappingDraft,
  workflowValidation,
  isSavingWorkflow,
  workflowNotice,
  workflowError,
  canSaveWorkflow,
  workspaceRootDraft,
  isBrowsingWorkspace,
  isSavingWorkspace,
  workspaceNotice,
  workspaceError,
  setupSummary,
  isEditorOpen,
  mappingBlocker,
  canSearchProjects,
  projectKeyDraft,
  isSavingMapping,
  snapshot,
  selectedRepoPaths,
  activeProjectKey,
  canSaveMapping,
  mappingNotice,
  mappingError,
  canManageMappings,
  onToggleYouTrackIntegration,
  onOpenSettings,
  onUpdateWorkflowStateList,
  onResetWorkflowMappingDraft,
  onSaveWorkflowMapping,
  onRefreshData,
  onWorkspaceRootDraftChange,
  onBrowseForWorkspace,
  onResetWorkspaceRoot,
  onSaveWorkspaceRoot,
  onProjectKeyDraftChange,
  onResolvedProjectChange,
  onToggleRepoSelection,
  onResetEditor,
  onSaveMapping,
  onCreateMapping,
  onEditMapping,
}: ProjectsPanelQuarterdeckProps) {
  return (
    <div
      id="missions-panel-quarterdeck"
      role="tabpanel"
      aria-labelledby="missions-tab-quarterdeck"
      className={styles.tabPanel}
      hidden={hidden}
    >
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Connection</div>
            <div className={styles.sectionCaption}>
              Missions owns the workflow now. Settings only keeps the YouTrack URL and token.
            </div>
          </div>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={youTrackEnabled ? styles.actionButton : styles.secondaryButton}
              onClick={onToggleYouTrackIntegration}
              disabled={isRefreshing}
            >
              {youTrackEnabled ? "Disable intake" : "Enable intake"}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={onOpenSettings}>
              Open settings
            </button>
          </div>
        </div>
        <div className={styles.setupGrid}>
          <article className={`${styles.statusCard} ${describeStatusTone(youTrackStatus)}`}>
            <div className={styles.statusTopline}>
              <span className={styles.sectionLabel}>YouTrack</span>
              <span className={styles.statusBadge}>{describeStatusLabel(youTrackStatus)}</span>
            </div>
            <strong className={styles.statusTitle}>
              {youTrackStatus?.account
                ? (youTrackStatus.account.fullName ?? youTrackStatus.account.login)
                : "Mission intake"}
            </strong>
            <p className={styles.sectionCaption}>{youTrackStatus?.message ?? "Loading YouTrack status..."}</p>
            <div className={styles.statusFacts}>
              <div className={styles.statusFact}>
                <span className={styles.sectionLabel}>Native intake</span>
                <span className={styles.statusFactValue}>{youTrackEnabled ? "Enabled" : "Disabled"}</span>
              </div>
              <div className={styles.statusFact}>
                <span className={styles.sectionLabel}>Instance</span>
                <span className={styles.statusFactValue}>{youTrackStatus?.baseUrl ?? "Not configured"}</span>
              </div>
              <div className={styles.statusFact}>
                <span className={styles.sectionLabel}>To-do states</span>
                <span className={styles.statusFactValue}>{formatStateList(youTrackStatus?.stateMapping.todo)}</span>
              </div>
              <div className={styles.statusFact}>
                <span className={styles.sectionLabel}>In-progress states</span>
                <span className={styles.statusFactValue}>
                  {formatStateList(youTrackStatus?.stateMapping.inProgress)}
                </span>
              </div>
            </div>
          </article>
          <article className={styles.workspaceCard}>
            <div className={styles.statusTopline}>
              <span className={styles.sectionLabel}>Workflow states</span>
              <span className={styles.statusBadge}>{hasWorkflowChanges ? "Unsaved" : "Synced"}</span>
            </div>
            <strong className={styles.statusTitle}>Quarterdeck mapping</strong>
            <p className={styles.sectionCaption}>
              Add or remove the live YouTrack states Missions should treat as To-do and In-progress.
            </p>
            {workflowBlocker ? (
              <div className={styles.blockedState}>{workflowBlocker}</div>
            ) : (
              <>
                <div className={styles.setupGrid}>
                  <YouTrackStateListEditor
                    label="To-do"
                    description="Tickets in these states stay in Launch bay."
                    placeholder="Add a To-do state"
                    values={youTrackStateMappingDraft.todo}
                    availableStates={youTrackStatus?.availableStates ?? []}
                    invalidStates={workflowValidation.invalidTodoStates}
                    disabled={isSavingWorkflow}
                    onChange={(nextStates) => onUpdateWorkflowStateList("todo", nextStates)}
                  />
                  <YouTrackStateListEditor
                    label="In-progress"
                    description="The first state in this list becomes the mission launch target."
                    placeholder="Add an In-progress state"
                    values={youTrackStateMappingDraft.inProgress}
                    availableStates={youTrackStatus?.availableStates ?? []}
                    invalidStates={workflowValidation.invalidInProgressStates}
                    disabled={isSavingWorkflow}
                    onChange={(nextStates) => onUpdateWorkflowStateList("inProgress", nextStates)}
                  />
                </div>
                {workflowValidation.errors.map((error) => (
                  <div key={error} className={styles.error}>
                    {error}
                  </div>
                ))}
                {workflowNotice ? <div className={styles.notice}>{workflowNotice}</div> : null}
                {workflowError ? <div className={styles.error}>{workflowError}</div> : null}
                <div className={styles.editorFooter}>
                  <div className={styles.selectionSummary}>
                    {youTrackStatus?.availableStates.length ?? 0} live states available from the connected instance
                  </div>
                  <div className={styles.inlineActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={onResetWorkflowMappingDraft}
                      disabled={isSavingWorkflow || !hasWorkflowChanges}
                    >
                      Reset states
                    </button>
                    <button
                      type="button"
                      className={styles.actionButton}
                      onClick={() => void onSaveWorkflowMapping()}
                      disabled={isSavingWorkflow || !canSaveWorkflow}
                    >
                      {isSavingWorkflow ? "Saving..." : "Save states"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </article>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Project scope</div>
            <div className={styles.sectionCaption}>
              Pick the workspace root and keep repo discovery inside the same workflow that consumes tickets.
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
        <article className={styles.workspaceCard}>
          <div className={styles.sectionLabel}>Workspace</div>
          <div className={styles.sectionCaption}>
            Pick the parent folder that holds the repositories this room is allowed to map.
          </div>
          <label className={styles.field}>
            <span>Absolute path</span>
            <input
              className={styles.input}
              value={workspaceRootDraft}
              onChange={(event) => onWorkspaceRootDraftChange(event.target.value)}
              placeholder="C:\\Users\\username\\source\\repos"
            />
          </label>
          <div className={styles.inlineActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void onBrowseForWorkspace()}
              disabled={isBrowsingWorkspace || isSavingWorkspace}
            >
              {isBrowsingWorkspace ? "Browsing..." : "Browse"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onResetWorkspaceRoot}
              disabled={isSavingWorkspace}
            >
              Reset path
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={() => void onSaveWorkspaceRoot()}
              disabled={isSavingWorkspace}
            >
              {isSavingWorkspace ? "Saving..." : "Set workspace"}
            </button>
          </div>
          <div className={styles.activePath}>{setupSummary}</div>
          {workspaceNotice ? <div className={styles.notice}>{workspaceNotice}</div> : null}
          {workspaceError ? <div className={styles.error}>{workspaceError}</div> : null}
        </article>
      </section>

      <section ref={editorRef} className={`${styles.section} ${isEditorOpen ? styles.sectionEmphasis : ""}`}>
        <div className={styles.sectionHeader}>
          <div>
            <div className={styles.sectionLabel}>Mapping editor</div>
            <div className={styles.sectionCaption}>
              Choose a verified YouTrack project and the repositories Spira may touch when that work arrives.
            </div>
          </div>
        </div>
        {mappingBlocker ? <div className={styles.blockedState}>{mappingBlocker}</div> : null}
        {!mappingBlocker && !isEditorOpen ? (
          <div className={styles.emptyState}>
            Pick a saved mapping below or start a new project mapping when you are ready.
          </div>
        ) : null}
        {!mappingBlocker && isEditorOpen ? (
          <>
            <div className={styles.formGrid}>
              <div className={styles.field}>
                <label htmlFor="projects-typeahead-input">YouTrack project</label>
                <ProjectTypeahead
                  inputId="projects-typeahead-input"
                  value={projectKeyDraft}
                  canSearch={canSearchProjects}
                  disabled={isSavingMapping}
                  onChange={onProjectKeyDraftChange}
                  onResolvedProjectChange={onResolvedProjectChange}
                />
              </div>
            </div>
            <ProjectsRepoChecklist
              repos={snapshot.repos}
              selectedRepoPaths={selectedRepoPaths}
              activeProjectKey={activeProjectKey ?? normalizeProjectKey(projectKeyDraft)}
              onToggleRepoSelection={onToggleRepoSelection}
            />
            <div className={styles.editorFooter}>
              <div className={styles.selectionSummary}>
                {selectedRepoPaths.length} {selectedRepoPaths.length === 1 ? "repo" : "repos"} selected
              </div>
              <div className={styles.inlineActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={onResetEditor}
                  disabled={isSavingMapping}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  onClick={() => void onSaveMapping()}
                  disabled={isSavingMapping || !canSaveMapping}
                >
                  {isSavingMapping ? "Saving..." : "Save mapping"}
                </button>
              </div>
            </div>
            {mappingNotice ? <div className={styles.notice}>{mappingNotice}</div> : null}
            {mappingError ? <div className={styles.error}>{mappingError}</div> : null}
          </>
        ) : null}
      </section>

      <ProjectsMappingsList
        mappings={snapshot.mappings}
        activeProjectKey={activeProjectKey}
        canCreateMapping={canManageMappings}
        disabledReason={mappingBlocker}
        notice={!isEditorOpen ? mappingNotice : null}
        error={!isEditorOpen ? mappingError : null}
        onCreateMapping={onCreateMapping}
        onEditMapping={onEditMapping}
      />
    </div>
  );
}
