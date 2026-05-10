import type {
  MissionProofRuleRecord,
  MissionProofRulesSnapshot,
  TicketRunMissionClassificationKind,
  TicketRunMissionProofLevel,
  UpsertMissionProofRuleInput,
} from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import projectStyles from "../projects/ProjectsPanel/ProjectsPanel.module.css";
import styles from "./ProofRulesEditor.module.css";

const PROOF_LEVELS: TicketRunMissionProofLevel[] = [
  "none",
  "light",
  "targeted-screenshot",
  "full-ui-proof",
  "manual-review-only",
];

const CLASSIFICATION_KINDS: TicketRunMissionClassificationKind[] = [
  "backend",
  "frontend",
  "ui",
  "infra",
  "mixed",
  "unknown",
];

interface DraftRule {
  projectKey: string;
  repoRelativePath: string;
  classificationKind: TicketRunMissionClassificationKind | "";
  uiChange: "yes" | "no" | "any";
  proofRequired: "yes" | "no" | "any";
  summaryKeywords: string;
  recommendedLevel: TicketRunMissionProofLevel;
  rationale: string;
}

const DEFAULT_DRAFT: DraftRule = {
  projectKey: "",
  repoRelativePath: "",
  classificationKind: "",
  uiChange: "any",
  proofRequired: "any",
  summaryKeywords: "",
  recommendedLevel: "targeted-screenshot",
  rationale: "",
};

const draftToInput = (draft: DraftRule): UpsertMissionProofRuleInput => ({
  projectKey: draft.projectKey.trim() || null,
  repoRelativePath: draft.repoRelativePath.trim() || null,
  classificationKind: draft.classificationKind === "" ? null : draft.classificationKind,
  uiChange: draft.uiChange === "any" ? null : draft.uiChange === "yes",
  proofRequired: draft.proofRequired === "any" ? null : draft.proofRequired === "yes",
  summaryKeywords: draft.summaryKeywords
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
  recommendedLevel: draft.recommendedLevel,
  rationale: draft.rationale.trim(),
});

const formatBoolean = (value: boolean | null): string => (value === null ? "—" : value ? "yes" : "no");

/**
 * Proof rules admin pane.
 *
 * Lists every known proof rule (builtin + user) with delete affordances for user rules.
 * A small inline form below the list lets the operator add new user rules. Builtin rules
 * are read-only here; their definitions live alongside the code in BUILTIN_PROOF_RULES.
 *
 * The renderer keeps the snapshot in component state and refreshes on every mutation —
 * the list is small (single digits in practice), so polling overhead is irrelevant.
 */
export function ProofRulesEditor() {
  const [snapshot, setSnapshot] = useState<MissionProofRulesSnapshot>({ rules: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [draft, setDraft] = useState<DraftRule>(DEFAULT_DRAFT);

  const loadRules = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const fresh = await window.electronAPI.listMissionProofRules();
      setSnapshot(fresh);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load proof rules.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRules();
  }, []);

  const sortedRules = useMemo(
    () =>
      [...snapshot.rules].sort((left, right) => {
        if (left.source !== right.source) return left.source === "builtin" ? -1 : 1;
        return left.id.localeCompare(right.id);
      }),
    [snapshot.rules],
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await window.electronAPI.upsertMissionProofRule(draftToInput(draft));
      setSnapshot(next);
      setDraft(DEFAULT_DRAFT);
      setNotice("Rule saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save proof rule.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (ruleId: string) => {
    setPendingDeleteId(ruleId);
    setError(null);
    setNotice(null);
    try {
      const next = await window.electronAPI.deleteMissionProofRule(ruleId);
      setSnapshot(next);
      setNotice(`Deleted rule ${ruleId}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete proof rule.");
    } finally {
      setPendingDeleteId(null);
    }
  };

  const submitDisabled = isSaving || draft.rationale.trim().length === 0;

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>Proof rules</h3>
          <p className={styles.lead}>
            Builtin rules ship with the application. User rules extend them — useful when a project
            consistently needs a different proof level than the default scoring suggests.
          </p>
        </div>
        <button type="button" className={projectStyles.secondaryButton} onClick={() => void loadRules()} disabled={isLoading}>
          {isLoading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error ? <div className={projectStyles.error}>{error}</div> : null}
      {notice ? <div className={projectStyles.notice}>{notice}</div> : null}

      <ul className={styles.ruleList}>
        {sortedRules.length === 0 && !isLoading ? (
          <li className={styles.empty}>No proof rules registered yet.</li>
        ) : null}
        {sortedRules.map((rule) => (
          <li key={rule.id} className={styles.ruleRow}>
            <div className={styles.ruleHeader}>
              <span className={styles.ruleId}>{rule.id}</span>
              <span className={`${styles.sourceBadge} ${rule.source === "user" ? styles.sourceBadgeUser : ""}`}>
                {rule.source}
              </span>
              <span className={styles.levelBadge}>{rule.recommendedLevel}</span>
            </div>
            <div className={styles.ruleBody}>{rule.rationale}</div>
            <div className={styles.ruleMeta}>
              <RuleMetaCell label="Project" value={rule.projectKey ?? "(any)"} />
              <RuleMetaCell label="Repo path" value={rule.repoRelativePath ?? "(any)"} />
              <RuleMetaCell label="Kind" value={rule.classificationKind ?? "(any)"} />
              <RuleMetaCell label="UI change" value={formatBoolean(rule.uiChange)} />
              <RuleMetaCell label="Proof required" value={formatBoolean(rule.proofRequired)} />
              {rule.summaryKeywords.length > 0 ? (
                <RuleMetaCell label="Keywords" value={rule.summaryKeywords.join(", ")} />
              ) : null}
            </div>
            {rule.source === "user" ? (
              <div className={styles.ruleActions}>
                <button
                  type="button"
                  className={projectStyles.secondaryButton}
                  onClick={() => void handleDelete(rule.id)}
                  disabled={pendingDeleteId === rule.id}
                >
                  {pendingDeleteId === rule.id ? "Deleting…" : "Delete rule"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <form className={styles.form} onSubmit={handleSubmit}>
        <h4 className={styles.formTitle}>Add a user rule</h4>
        <div className={styles.formGrid}>
          <label>
            <span>Project key</span>
            <input
              type="text"
              value={draft.projectKey}
              onChange={(event) => setDraft({ ...draft, projectKey: event.target.value })}
              placeholder="(any)"
            />
          </label>
          <label>
            <span>Repo path</span>
            <input
              type="text"
              value={draft.repoRelativePath}
              onChange={(event) => setDraft({ ...draft, repoRelativePath: event.target.value })}
              placeholder="(any)"
            />
          </label>
          <label>
            <span>Classification kind</span>
            <select
              value={draft.classificationKind}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  classificationKind: event.target.value as DraftRule["classificationKind"],
                })
              }
            >
              <option value="">(any)</option>
              {CLASSIFICATION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>UI change</span>
            <select
              value={draft.uiChange}
              onChange={(event) => setDraft({ ...draft, uiChange: event.target.value as DraftRule["uiChange"] })}
            >
              <option value="any">(any)</option>
              <option value="yes">yes</option>
              <option value="no">no</option>
            </select>
          </label>
          <label>
            <span>Proof required</span>
            <select
              value={draft.proofRequired}
              onChange={(event) =>
                setDraft({ ...draft, proofRequired: event.target.value as DraftRule["proofRequired"] })
              }
            >
              <option value="any">(any)</option>
              <option value="yes">yes</option>
              <option value="no">no</option>
            </select>
          </label>
          <label>
            <span>Recommended level</span>
            <select
              value={draft.recommendedLevel}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  recommendedLevel: event.target.value as TicketRunMissionProofLevel,
                })
              }
            >
              {PROOF_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={styles.fullWidth}>
          <span>Summary keywords (comma- or newline-separated)</span>
          <textarea
            rows={2}
            value={draft.summaryKeywords}
            onChange={(event) => setDraft({ ...draft, summaryKeywords: event.target.value })}
            placeholder="copy, wording, label"
          />
        </label>
        <label className={styles.fullWidth}>
          <span>Rationale (required)</span>
          <textarea
            rows={3}
            value={draft.rationale}
            onChange={(event) => setDraft({ ...draft, rationale: event.target.value })}
            placeholder="When this rule matches, recommend the chosen level because…"
          />
        </label>
        <div className={styles.formActions}>
          <button type="submit" className={projectStyles.actionButton} disabled={submitDisabled}>
            {isSaving ? "Saving…" : "Add rule"}
          </button>
        </div>
      </form>
    </section>
  );
}

function RuleMetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaCell}>
      <span className={styles.metaLabel}>{label}</span>
      <span className={styles.metaValue}>{value}</span>
    </div>
  );
}
