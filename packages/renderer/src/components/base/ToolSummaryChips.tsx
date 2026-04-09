import type { AssistantState } from "@spira/shared";
import { useMemo } from "react";
import { getLatestCompletedAssistantMessage, useChatStore } from "../../stores/chat-store.js";
import { shouldDisplayToolName } from "../../tool-display.js";
import styles from "./ToolSummaryChips.module.css";

interface ToolSummaryChipsProps {
  assistantState: AssistantState;
}

const MAX_VISIBLE_CHIPS = 5;

export function ToolSummaryChips({ assistantState }: ToolSummaryChipsProps) {
  const latestAssistantMessage = useChatStore((store) => getLatestCompletedAssistantMessage(store.messages));

  const summary = useMemo(() => {
    if (assistantState !== "idle") {
      return null;
    }

    const toolCalls = (latestAssistantMessage?.toolCalls ?? []).filter(
      (toolCall) =>
        shouldDisplayToolName(toolCall.name) && (toolCall.status === "success" || toolCall.status === "error"),
    );
    if (toolCalls.length === 0) {
      return null;
    }

    const counts = new Map<string, number>();
    for (const toolCall of toolCalls) {
      counts.set(toolCall.name, (counts.get(toolCall.name) ?? 0) + 1);
    }

    const chips = Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([name, count]) => ({
        key: name,
        label: count > 1 ? `${name} x${count}` : name,
      }));

    return {
      visible: chips.slice(0, MAX_VISIBLE_CHIPS),
      hiddenCount: Math.max(0, chips.length - MAX_VISIBLE_CHIPS),
      hiddenLabels: chips.slice(MAX_VISIBLE_CHIPS).map((chip) => chip.label),
    };
  }, [assistantState, latestAssistantMessage]);

  if (!summary) {
    return null;
  }

  return (
    <div className={styles.panel}>
      <span className={styles.title}>Recent tools</span>
      <div className={styles.chips}>
        {summary.visible.map((chip) => (
          <span key={chip.key} className={styles.chip}>
            {chip.label}
          </span>
        ))}
        {summary.hiddenCount > 0 ? (
          <span
            className={styles.overflow}
            aria-label={`${summary.hiddenCount} additional tools used: ${summary.hiddenLabels.join(", ")}`}
            title={summary.hiddenLabels.join(", ")}
          >
            +{summary.hiddenCount} more
          </span>
        ) : null}
      </div>
    </div>
  );
}
