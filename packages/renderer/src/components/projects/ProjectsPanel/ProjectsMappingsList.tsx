import type { ProjectRepoMappingSummary } from "@spira/shared";
import styles from "./ProjectsPanel.module.css";

interface ProjectsMappingsListProps {
  mappings: ProjectRepoMappingSummary[];
  activeProjectKey: string | null;
  canCreateMapping: boolean;
  disabledReason: string | null;
  notice?: string | null;
  error?: string | null;
  onCreateMapping: () => void;
  onEditMapping: (projectKey: string) => void;
}

export function ProjectsMappingsList({
  mappings,
  activeProjectKey,
  canCreateMapping,
  disabledReason,
  notice = null,
  error = null,
  onCreateMapping,
  onEditMapping,
}: ProjectsMappingsListProps) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <div className={styles.sectionLabel}>Saved scope rules</div>
          <div className={styles.sectionCaption}>
            Each verified project gets a bounded set of repositories before work begins.
          </div>
        </div>
        <button type="button" className={styles.actionButton} onClick={onCreateMapping} disabled={!canCreateMapping}>
          Add mapping
        </button>
      </div>
      {!canCreateMapping && disabledReason ? <div className={styles.blockedState}>{disabledReason}</div> : null}
      {notice ? <div className={styles.notice}>{notice}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      <div className={styles.mappingGrid}>
        {mappings.length > 0 ? (
          mappings.map((mapping) => (
            <article
              key={mapping.projectKey}
              className={`${styles.mappingCard} ${activeProjectKey === mapping.projectKey ? styles.mappingCardActive : ""}`}
            >
              <div className={styles.mappingTopline}>
                <div className={styles.mappingHeaderCopy}>
                  <strong>{mapping.projectKey}</strong>
                  <span className={styles.mappingMeta}>Updated {new Date(mapping.updatedAt).toLocaleString()}</span>
                </div>
                <button
                  type="button"
                  className={styles.inspectButton}
                  onClick={() => onEditMapping(mapping.projectKey)}
                >
                  Edit
                </button>
              </div>
              <div className={styles.mappingPaths}>
                {mapping.repoRelativePaths.length > 0 ? (
                  mapping.repoRelativePaths.map((repoRelativePath) => (
                    <span key={repoRelativePath} className={styles.pathBadge}>
                      {repoRelativePath}
                    </span>
                  ))
                ) : (
                  <span className={styles.mappingMeta}>No repositories assigned.</span>
                )}
              </div>
              {mapping.missingRepoRelativePaths.length > 0 ? (
                <div className={styles.mappingWarning}>Missing: {mapping.missingRepoRelativePaths.join(", ")}</div>
              ) : null}
            </article>
          ))
        ) : (
          <div className={styles.emptyState}>No project mappings saved yet.</div>
        )}
      </div>
    </section>
  );
}
