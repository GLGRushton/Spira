import { AnimatePresence, motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import { getAwaitingAssistantQuestion, useChatStore } from "../../stores/chat-store.js";
import styles from "./ChatPanel.module.css";
import { ConversationArchivePanel } from "./ConversationArchivePanel.js";
import { InputBar } from "./InputBar.js";
import { MessageBubble } from "./MessageBubble.js";

const EXAMPLE_PROMPTS = [
  "Trace how the bridge chat state flows end to end.",
  "Refine the current UI without losing the existing tone.",
  "Find the slowest part of the renderer path and tighten it.",
];

export function ChatPanel() {
  const messages = useChatStore((store) => store.messages);
  const activeConversationId = useChatStore((store) => store.activeConversationId);
  const activeConversationTitle = useChatStore((store) => store.activeConversationTitle);
  const isStreaming = useChatStore((store) => store.isStreaming);
  const isResetting = useChatStore((store) => store.isResetting);
  const requestComposerFocus = useChatStore((store) => store.requestComposerFocus);
  const sessionNotice = useChatStore((store) => store.sessionNotice);
  const setSessionNotice = useChatStore((store) => store.setSessionNotice);
  const setDraft = useChatStore((store) => store.setDraft);
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
          <button type="button" className={styles.noticeDismiss} onClick={() => setSessionNotice(null)}>
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
                    setDraft(prompt);
                    requestComposerFocus();
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
                          setDraft(retryPrompt);
                          requestComposerFocus();
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
        onClose={() => setArchiveOpen(false)}
      />
    </div>
  );
}
