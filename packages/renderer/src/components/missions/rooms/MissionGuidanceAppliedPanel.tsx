import type { TicketRunMissionEventSummary, TicketRunSummary } from "@spira/shared";
import { useMemo, useState } from "react";
import ruleStyles from "../../settings/ProofRulesEditor.module.css";
import projectStyles from "../../projects/ProjectsPanel/ProjectsPanel.module.css";
import { useMissionRunsStore } from "../../../stores/mission-runs-store.js";
import type { MissionRunController } from "../useMissionRunController.js";
import styles from "./MissionDetailsRoom.module.css";

interface MissionGuidanceAppliedPanelProps {
  run: TicketRunSummary;
  controller: MissionRunController;
}

interface InjectedSnapshot {
  attemptOccurredAt: number;
  repoIntelligenceEntryIds: string[];
  validationProfileIds: string[];
  repoProfileKeys: { projectKey: string; repoRelativePath: string }[];
  sectionLength: number;
}

const EMPTY_LIVE_EVENTS: readonly TicketRunMissionEventSummary[] = [];

const summariseEvent = (event: TicketRunMissionEventSummary): InjectedSnapshot | null => {
  if (event.eventType !== "repo-guidance-injected") return null;
  const meta = (event.metadata ?? {}) as Record<string, unknown>;
  return {
    attemptOccurredAt: event.occurredAt,
    repoIntelligenceEntryIds: Array.isArray(meta["repoIntelligenceEntryIds"])
      ? (meta["repoIntelligenceEntryIds"] as string[])
      : [],
    validationProfileIds: Array.isArray(meta["validationProfileIds"])
      ? (meta["validationProfileIds"] as string[])
      : [],
    repoProfileKeys: Array.isArray(meta["repoProfileKeys"])
      ? (meta["repoProfileKeys"] as { projectKey: string; repoRelativePath: string }[])
      : [],
    sectionLength: typeof meta["sectionLength"] === "number" ? (meta["sectionLength"] as number) : 0,
  };
};

/**
 * Per-mission "Spira used X learned entries to brief this mission" panel. Reads the
 * `repo-guidance-injected` events fired by the prompt builder and resolves each id back
 * to its catalogue entry. Renders nothing for missions that didn't inject any guidance.
 */
export function MissionGuidanceAppliedPanel({ run, controller }: MissionGuidanceAppliedPanelProps) {
  const liveEvents = useMissionRunsStore((store) => store.liveEventsByRun[run.runId] ?? EMPTY_LIVE_EVENTS);
  const [collapsed, setCollapsed] = useState(true);

  const injections = useMemo<InjectedSnapshot[]>(() => {
    const cold = controller.missionTimeline ?? [];
    const merged = [...cold, ...liveEvents];
    const seen = new Set<number>();
    const summaries: InjectedSnapshot[] = [];
    for (const event of merged) {
      if (seen.has(event.id)) continue;
      const summary = summariseEvent(event);
      if (summary) {
        seen.add(event.id);
        summaries.push(summary);
      }
    }
    return summaries.sort((left, right) => right.attemptOccurredAt - left.attemptOccurredAt);
  }, [controller.missionTimeline, liveEvents]);

  if (injections.length === 0) return null;

  // Aggregate the unique entry ids across every attempt so the operator can see "what
  // ever shaped this mission" at a glance.
  const distinctIntelligence = new Set<string>();
  const distinctValidations = new Set<string>();
  const distinctProfiles = new Set<string>();
  for (const injection of injections) {
    for (const id of injection.repoIntelligenceEntryIds) distinctIntelligence.add(id);
    for (const id of injection.validationProfileIds) distinctValidations.add(id);
    for (const key of injection.repoProfileKeys) distinctProfiles.add(`${key.projectKey}/${key.repoRelativePath || "(default)"}`);
  }
  const total = distinctIntelligence.size + distinctValidations.size + distinctProfiles.size;

  return (
    <article className={styles.surface} aria-labelledby={`guidance-${run.runId}`}>
      <header className={styles.sectionTopline}>
        <div>
          <div>Mission learning</div>
          <h3 id={`guidance-${run.runId}`} className={styles.sectionTitle}>
            Spira used {total} learned entr{total === 1 ? "y" : "ies"} to brief this mission
          </h3>
          <p className={styles.sectionLead}>
            Across {injections.length} attempt{injections.length === 1 ? "" : "s"}, these catalogue entries shaped the
            prompt's repo guidance section. Counts include duplicates across attempts.
          </p>
        </div>
        <button
          type="button"
          className={projectStyles.secondaryButton}
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </header>
      {!collapsed ? (
        <div style={{ marginTop: 12 }}>
          {distinctProfiles.size > 0 ? (
            <section>
              <h4 className={ruleStyles.formTitle}>Repo profiles ({distinctProfiles.size})</h4>
              <ul className={ruleStyles.ruleList}>
                {[...distinctProfiles].map((label) => (
                  <li key={label} className={ruleStyles.ruleRow}>
                    {label}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {distinctIntelligence.size > 0 ? (
            <section style={{ marginTop: 12 }}>
              <h4 className={ruleStyles.formTitle}>Repo intelligence entries ({distinctIntelligence.size})</h4>
              <ul className={ruleStyles.ruleList}>
                {[...distinctIntelligence].map((id) => (
                  <li key={id} className={ruleStyles.ruleRow}>
                    <span className={ruleStyles.ruleId}>{id}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {distinctValidations.size > 0 ? (
            <section style={{ marginTop: 12 }}>
              <h4 className={ruleStyles.formTitle}>Validation profiles ({distinctValidations.size})</h4>
              <ul className={ruleStyles.ruleList}>
                {[...distinctValidations].map((id) => (
                  <li key={id} className={ruleStyles.ruleRow}>
                    <span className={ruleStyles.ruleId}>{id}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
