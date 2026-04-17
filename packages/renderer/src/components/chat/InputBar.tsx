import type { StationId } from "@spira/shared";
import { summarizeConversationTitle } from "@spira/shared";
import { useEffect, useRef } from "react";
import {
  PENDING_ASSISTANT_ID,
  createChatEntityId,
  getAwaitingAssistantQuestion,
  getChatSession,
  useChatStore,
} from "../../stores/chat-store.js";
import { useStationStore } from "../../stores/station-store.js";
import styles from "./InputBar.module.css";
import { clearClientSessionUi } from "./session-ui.js";

const RESET_TIMEOUT_MS = 5_000;

interface InputBarProps {
  stationId?: StationId;
}

export function InputBar({ stationId }: InputBarProps) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const resolvedStationId = stationId ?? activeStationId;
  const addUserMessage = useChatStore((store) => store.addUserMessage);
  const awaitingQuestion = useChatStore((store) =>
    getAwaitingAssistantQuestion(getChatSession(store, resolvedStationId).messages),
  );
  const composerFocusToken = useChatStore((store) => getChatSession(store, resolvedStationId).composerFocusToken);
  const draft = useChatStore((store) => getChatSession(store, resolvedStationId).draft);
  const activeConversationId = useChatStore((store) => getChatSession(store, resolvedStationId).activeConversationId);
  const hasMessages = useChatStore((store) => getChatSession(store, resolvedStationId).messages.length > 0);
  const setDraft = useChatStore((store) => store.setDraft);
  const setActiveConversation = useChatStore((store) => store.setActiveConversation);
  const startAssistantMessage = useChatStore((store) => store.startAssistantMessage);
  const isAborting = useChatStore((store) => getChatSession(store, resolvedStationId).isAborting);
  const isResetConfirming = useChatStore((store) => getChatSession(store, resolvedStationId).isResetConfirming);
  const isResetting = useChatStore((store) => getChatSession(store, resolvedStationId).isResetting);
  const isStreaming = useChatStore((store) => getChatSession(store, resolvedStationId).isStreaming);
  const setAborting = useChatStore((store) => store.setAborting);
  const setResetConfirming = useChatStore((store) => store.setResetConfirming);
  const setResetting = useChatStore((store) => store.setResetting);
  const setSessionNotice = useChatStore((store) => store.setSessionNotice);
  const setStationConversation = useStationStore((store) => store.setStationConversation);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousAwaitingQuestionId = useRef<string | null>(null);

  useEffect(() => {
    if (!isResetting) {
      return;
    }

    // Defense against a lost reset acknowledgement after the UI has already entered reset mode.
    const timeoutId = window.setTimeout(() => {
      setResetting(false, resolvedStationId);
    }, RESET_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isResetting, resolvedStationId, setResetting]);

  useEffect(() => {
    const awaitingQuestionId = awaitingQuestion?.id ?? null;
    if (
      awaitingQuestionId &&
      awaitingQuestionId !== previousAwaitingQuestionId.current &&
      !isStreaming &&
      !isResetting
    ) {
      inputRef.current?.focus();
    }
    previousAwaitingQuestionId.current = awaitingQuestionId;
  }, [awaitingQuestion, isResetting, isStreaming]);

  useEffect(() => {
    if (composerFocusToken > 0 && !isStreaming && !isResetting) {
      inputRef.current?.focus();
    }
  }, [composerFocusToken, isResetting, isStreaming]);

  const clearUi = () => {
    clearClientSessionUi(resolvedStationId);
  };

  const promptResetSession = () => {
    if (getChatSession(useChatStore.getState(), resolvedStationId).isStreaming) {
      return;
    }

    setResetConfirming(true, resolvedStationId);
  };

  const confirmResetSession = () => {
    if (getChatSession(useChatStore.getState(), resolvedStationId).isStreaming) {
      return;
    }

    setResetConfirming(false, resolvedStationId);
    setSessionNotice(null, resolvedStationId);
    setResetting(true, resolvedStationId);
    clearUi();
    setActiveConversation(null, null, resolvedStationId);
    setStationConversation(resolvedStationId, null, null);
    window.electronAPI.resetChat(resolvedStationId);
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || isStreaming || isResetting) {
      return;
    }

    addUserMessage(trimmed, resolvedStationId);
    setSessionNotice(null, resolvedStationId);
    startAssistantMessage(PENDING_ASSISTANT_ID, resolvedStationId);
    const conversationId = activeConversationId ?? createChatEntityId();
    if (!activeConversationId) {
      const title = summarizeConversationTitle(trimmed);
      setActiveConversation(conversationId, title, resolvedStationId);
      setStationConversation(resolvedStationId, conversationId, title);
    }
    window.electronAPI.sendMessage(trimmed, conversationId, resolvedStationId);
    setDraft("", resolvedStationId);
  };

  return (
    <div
      className={styles.container}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isResetConfirming && !isResetting) {
          event.preventDefault();
          setResetConfirming(false, resolvedStationId);
        }
      }}
    >
      {awaitingQuestion && !isStreaming && !isResetting ? (
        <div className={styles.awaitingBanner}>Shinra is awaiting your answer.</div>
      ) : null}
      <textarea
        ref={inputRef}
        className={`${styles.input} ${awaitingQuestion && !isStreaming ? styles.awaitingInput : ""}`}
        rows={2}
        placeholder="Transmit to Shinra…"
        value={draft}
        disabled={isStreaming || isResetting}
        onChange={(event) => setDraft(event.target.value, resolvedStationId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className={styles.actions}>
        <div className={styles.sessionActions}>
          {isResetConfirming ? (
            <>
              <button
                type="button"
                className={styles.secondary}
                disabled={isStreaming || isResetting}
                onClick={() => setResetConfirming(false, resolvedStationId)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`${styles.secondary} ${styles.destructive}`}
                disabled={isStreaming || isResetting}
                onClick={confirmResetSession}
              >
                Confirm reset
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={styles.secondary}
                disabled={isStreaming || isResetting}
                onClick={() => {
                  clearUi();
                  setSessionNotice(
                    hasMessages
                      ? {
                          kind: "info",
                          message:
                            "Transcript cleared locally. Shinra still retains the current backend context until you reset.",
                        }
                      : null,
                    resolvedStationId,
                  );
                }}
              >
                Clear local log
              </button>
              <button
                type="button"
                className={`${styles.secondary} ${styles.destructive}`}
                disabled={isStreaming || isResetting}
                onClick={promptResetSession}
              >
                Reset
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          className={isStreaming ? `${styles.send} ${styles.stop}` : styles.send}
          disabled={isResetting || isAborting || (!isStreaming && draft.trim().length === 0)}
          onClick={
            isStreaming
              ? () => {
                  setAborting(true, resolvedStationId);
                  window.electronAPI.abortChat(resolvedStationId);
                }
              : submit
          }
        >
          {isResetting ? "Resetting..." : isStreaming ? (isAborting ? "Stopping..." : "Stop") : "Transmit"}
        </button>
      </div>
    </div>
  );
}
