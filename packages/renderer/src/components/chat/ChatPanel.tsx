import { AnimatePresence, motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import { getAwaitingAssistantQuestion, getChatSession, useChatStore } from "../../stores/chat-store.js";
import { useStationStore } from "../../stores/station-store.js";
import styles from "./ChatPanel.module.css";
import { ConversationArchivePanel } from "./ConversationArchivePanel.js";
import { InputBar } from "./InputBar.js";
import { MessageBubble } from "./MessageBubble.js";
import { clearClientSessionUi } from "./session-ui.js";

const EXAMPLE_PROMPTS = [
  "Trace how the bridge chat state flows end to end.",
  "Refine the current UI without losing the existing tone.",
  "Find the slowest part of the renderer path and tighten it.",
];

export function ChatPanel() {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const setStationConversation = useStationStore((store) => store.setStationConversation);
  const messages = useChatStore((store) => getChatSession(store, activeStationId).messages);
  const activeConversationId = useChatStore((store) => getChatSession(store, activeStationId).activeConversationId);
  const activeConversationTitle = useChatStore(
    (store) => getChatSession(store, activeStationId).activeConversationTitle,
  );
  const isStreaming = useChatStore((store) => getChatSession(store, activeStationId).isStreaming);
  const isResetting = useChatStore((store) => getChatSession(store, activeStationId).isResetting);
  const setActiveConversation = useChatStore((store) => store.setActiveConversation);
  const requestComposerFocus = useChatStore((store) => store.requestComposerFocus);
  const sessionNotice = useChatStore((store) => getChatSession(store, activeStationId).sessionNotice);
  const setSessionNotice = useChatStore((store) => store.setSessionNotice);
  const setDraft = useChatStore((store) => store.setDraft);
  const setResetting = useChatStore((store) => store.setResetting);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages.at(-1);
  const awaitingQuestion = getAwaitingAssistantQuestion(messages);
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && !message.isStreaming);
  const retryPrompt = latestAssistantMessage
    ? [
        ...messages.slice(
          0,
          messages.findIndex((message) => message.id === latestAssistantMessage.id),
        ),
      ]
        .reverse()
        .find((message) => message.role === "user")
        ?.content.trim()
    : undefined;
  const [archiveOpen, setArchiveOpen] = useState(false);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node) {
      return;
    }

    node.scrollTo({ top: node.scrollHeight, behavior: "instant" as ScrollBehavior });
  }, []);

  useLayoutEffect(() => {
    const node = scrollRef.current;
    if (!node || !lastMessage) {
      return;
    }

    const isNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
    if (isNearBottom) {
      node.scrollTo({
        top: node.scrollHeight,
        behavior: lastMessage.isStreaming ? ("instant" as ScrollBehavior) : "smooth",
      });
    }
  }, [lastMessage]);

  const startNewChat = () => {
    if (isStreaming || isResetting) {
      return;
    }

    setSessionNotice(null);
    setResetting(true, activeStationId);
    clearClientSessionUi(activeStationId);
    setActiveConversation(null, null, activeStationId);
    setStationConversation(activeStationId, null, null);
    window.electronAPI.startNewChat(activeConversationId ?? undefined, activeStationId);
    setArchiveOpen(false);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div>
          <div className={styles.toolbarEyebrow}>Conversation archive</div>
          <div className={styles.toolbarTitle}>
            {activeConversationTitle?.trim() || (activeConversationId ? "Untitled conversation" : "New conversation")}
          </div>
        </div>
        <button type="button" className={styles.archiveToggle} onClick={() => setArchiveOpen((open) => !open)}>
          {archiveOpen ? "Hide archive" : "Open archive"}
        </button>
      </div>
      {sessionNotice ? (
        <div className={`${styles.notice} ${styles[sessionNotice.kind]}`} role="alert" aria-live="polite">
          <span>{sessionNotice.message}</span>
          <button
            type="button"
            className={styles.noticeDismiss}
            onClick={() => setSessionNotice(null, activeStationId)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div ref={scrollRef} className={styles.messages}>
        {messages.length === 0 ? (
          <section className={styles.emptyState}>
            <div className={styles.emptyEyebrow}>Bridge / Conversation</div>
            <h3 className={styles.emptyTitle}>Shinra is standing by.</h3>
            <p className={styles.emptyCopy}>
              Ask for a code change, a system investigation, or a quick read of the repo and I will get to work.
            </p>
            <div className={styles.examples}>
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={styles.exampleChip}
                  onClick={() => {
                    setDraft(prompt, activeStationId);
                    requestComposerFocus(activeStationId);
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <AnimatePresence initial={false}>
          {messages.map((message) => {
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.2 }}
              >
                <MessageBubble
                  message={message}
                  isAwaitingReply={awaitingQuestion?.id === message.id}
                  onRetry={
                    message.id === latestAssistantMessage?.id && retryPrompt && !isStreaming && !isResetting
                      ? () => {
                          setDraft(retryPrompt, activeStationId);
                          requestComposerFocus(activeStationId);
                        }
                      : undefined
                  }
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <InputBar />
      <ConversationArchivePanel
        open={archiveOpen}
        disabled={isStreaming || isResetting}
        canStartNewChat={messages.length > 0 || activeConversationId !== null}
        onClose={() => setArchiveOpen(false)}
        onStartNewChat={startNewChat}
      />
    </div>
  );
}
