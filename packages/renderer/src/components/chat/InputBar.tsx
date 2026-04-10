import { summarizeConversationTitle } from "@spira/shared";
import { useEffect, useRef } from "react";
import {
  PENDING_ASSISTANT_ID,
  createChatEntityId,
  getAwaitingAssistantQuestion,
  useChatStore,
} from "../../stores/chat-store.js";
import styles from "./InputBar.module.css";
import { clearClientSessionUi } from "./session-ui.js";

const RESET_TIMEOUT_MS = 5_000;

export function InputBar() {
  const addUserMessage = useChatStore((store) => store.addUserMessage);
  const awaitingQuestion = useChatStore((store) => getAwaitingAssistantQuestion(store.messages));
  const composerFocusToken = useChatStore((store) => store.composerFocusToken);
  const draft = useChatStore((store) => store.draft);
  const activeConversationId = useChatStore((store) => store.activeConversationId);
  const hasMessages = useChatStore((store) => store.messages.length > 0);
  const setDraft = useChatStore((store) => store.setDraft);
  const setActiveConversation = useChatStore((store) => store.setActiveConversation);
  const startAssistantMessage = useChatStore((store) => store.startAssistantMessage);
  const isAborting = useChatStore((store) => store.isAborting);
  const isResetConfirming = useChatStore((store) => store.isResetConfirming);
  const isResetting = useChatStore((store) => store.isResetting);
  const isStreaming = useChatStore((store) => store.isStreaming);
  const setAborting = useChatStore((store) => store.setAborting);
  const setResetConfirming = useChatStore((store) => store.setResetConfirming);
  const setResetting = useChatStore((store) => store.setResetting);
  const setSessionNotice = useChatStore((store) => store.setSessionNotice);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousAwaitingQuestionId = useRef<string | null>(null);

  useEffect(() => {
    if (!isResetting) {
      return;
    }

    // Defense against a lost reset acknowledgement after the UI has already entered reset mode.
    const timeoutId = window.setTimeout(() => {
      setResetting(false);
    }, RESET_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isResetting, setResetting]);

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
    clearClientSessionUi();
  };

  const promptResetSession = () => {
    if (useChatStore.getState().isStreaming) {
      return;
    }

    setResetConfirming(true);
  };

  const confirmResetSession = () => {
    if (useChatStore.getState().isStreaming) {
      return;
    }

    setResetConfirming(false);
    setSessionNotice(null);
    setResetting(true);
    clearUi();
    setActiveConversation(null, null);
    window.electronAPI.resetChat();
  };

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || isStreaming || isResetting) {
      return;
    }

    addUserMessage(trimmed);
    setSessionNotice(null);
    startAssistantMessage(PENDING_ASSISTANT_ID);
    const conversationId = activeConversationId ?? createChatEntityId();
    if (!activeConversationId) {
      setActiveConversation(conversationId, summarizeConversationTitle(trimmed));
    }
    window.electronAPI.sendMessage(trimmed, conversationId);
    setDraft("");
  };

  return (
    <div
      className={styles.container}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isResetConfirming && !isResetting) {
          event.preventDefault();
          setResetConfirming(false);
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
        onChange={(event) => setDraft(event.target.value)}
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
                onClick={() => setResetConfirming(false)}
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
                  setAborting(true);
                  window.electronAPI.abortChat();
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
