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

export function InputBar() {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const addUserMessage = useChatStore((store) => store.addUserMessage);
  const awaitingQuestion = useChatStore((store) =>
    getAwaitingAssistantQuestion(getChatSession(store, activeStationId).messages),
  );
  const composerFocusToken = useChatStore((store) => getChatSession(store, activeStationId).composerFocusToken);
  const draft = useChatStore((store) => getChatSession(store, activeStationId).draft);
  const activeConversationId = useChatStore((store) => getChatSession(store, activeStationId).activeConversationId);
  const hasMessages = useChatStore((store) => getChatSession(store, activeStationId).messages.length > 0);
  const setDraft = useChatStore((store) => store.setDraft);
  const setActiveConversation = useChatStore((store) => store.setActiveConversation);
  const startAssistantMessage = useChatStore((store) => store.startAssistantMessage);
  const isAborting = useChatStore((store) => getChatSession(store, activeStationId).isAborting);
  const isResetConfirming = useChatStore((store) => getChatSession(store, activeStationId).isResetConfirming);
  const isResetting = useChatStore((store) => getChatSession(store, activeStationId).isResetting);
  const isStreaming = useChatStore((store) => getChatSession(store, activeStationId).isStreaming);
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
      setResetting(false, activeStationId);
    }, RESET_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeStationId, isResetting, setResetting]);

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
    clearClientSessionUi(activeStationId);
  };

  const promptResetSession = () => {
    if (getChatSession(useChatStore.getState(), activeStationId).isStreaming) {
      return;
    }

    setResetConfirming(true, activeStationId);
  };

  const confirmResetSession = () => {
    if (getChatSession(useChatStore.getState(), activeStationId).isStreaming) {
      return;
    }

    setResetConfirming(false, activeStationId);
    setSessionNotice(null, activeStationId);
    setResetting(true, activeStationId);
    clearUi();
    setActiveConversation(null, null, activeStationId);
    setStationConversation(activeStationId, null, null);
    window.electronAPI.resetChat(activeStationId);
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || isStreaming || isResetting) {
      return;
    }

    addUserMessage(trimmed, activeStationId);
    setSessionNotice(null, activeStationId);
    startAssistantMessage(PENDING_ASSISTANT_ID, activeStationId);
    const conversationId = activeConversationId ?? createChatEntityId();
    if (!activeConversationId) {
      const title = summarizeConversationTitle(trimmed);
      setActiveConversation(conversationId, title, activeStationId);
      setStationConversation(activeStationId, conversationId, title);
    }
    window.electronAPI.sendMessage(trimmed, conversationId, activeStationId);
    setDraft("", activeStationId);
  };

  return (
    <div
      className={styles.container}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isResetConfirming && !isResetting) {
          event.preventDefault();
          setResetConfirming(false, activeStationId);
        }
      }}
    >
      {awaitingQuestion && !isStreaming && !isResetting ? (
        <div className={styles.awaitingBanner}>Shinra is waiting for your answer.</div>
      ) : null}
      <textarea
        ref={inputRef}
        className={`${styles.input} ${awaitingQuestion && !isStreaming ? styles.awaitingInput : ""}`}
        rows={2}
        placeholder="Transmit to Shinra…"
        value={draft}
        disabled={isStreaming || isResetting}
        onChange={(event) => setDraft(event.target.value, activeStationId)}
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
                onClick={() => setResetConfirming(false, activeStationId)}
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
                    activeStationId,
                  );
                }}
              >
                Clear
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
                  setAborting(true, activeStationId);
                  window.electronAPI.abortChat(activeStationId);
                }
              : submit
          }
        >
          {isResetting ? "Resetting..." : isStreaming ? (isAborting ? "Stopping..." : "Stop") : "Send"}
        </button>
      </div>
    </div>
  );
}
