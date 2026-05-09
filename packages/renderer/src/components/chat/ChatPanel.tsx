import type { StationId } from "@spira/shared";
import { AnimatePresence, motion } from "framer-motion";
import { useLayoutEffect, useRef, useState } from "react";
import { getAwaitingAssistantQuestion, getChatSession, useChatStore } from "../../stores/chat-store.js";
import { useStationStore } from "../../stores/station-store.js";
import { BevelleArch, YevonSpiral } from "../decor/Glyphs.js";
import styles from "./ChatPanel.module.css";
import { ConversationArchivePanel } from "./ConversationArchivePanel.js";
import { InputBar } from "./InputBar.js";
import { MessageBubble } from "./MessageBubble.js";
import { clearClientSessionUi } from "./session-ui.js";

const EXAMPLE_PROMPTS = [
  "Trace how the bridge chat flows end to end.",
  "Refine this surface without losing the cloister tone.",
  "Find the slowest part of the renderer and tighten it.",
];

interface ChatPanelProps {
  stationId?: StationId;
}

export function ChatPanel({ stationId }: ChatPanelProps) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const resolvedStationId = stationId ?? activeStationId;
  const setStationConversation = useStationStore((store) => store.setStationConversation);
  const messages = useChatStore((store) => getChatSession(store, resolvedStationId).messages);
  const activeConversationId = useChatStore((store) => getChatSession(store, resolvedStationId).activeConversationId);
  const activeConversationTitle = useChatStore(
    (store) => getChatSession(store, resolvedStationId).activeConversationTitle,
  );
  const isStreaming = useChatStore((store) => getChatSession(store, resolvedStationId).isStreaming);
  const isResetting = useChatStore((store) => getChatSession(store, resolvedStationId).isResetting);
  const setActiveConversation = useChatStore((store) => store.setActiveConversation);
  const requestComposerFocus = useChatStore((store) => store.requestComposerFocus);
  const sessionNotice = useChatStore((store) => getChatSession(store, resolvedStationId).sessionNotice);
  const historyWasTrimmed = useChatStore((store) => getChatSession(store, resolvedStationId).historyWasTrimmed);
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
    setResetting(true, resolvedStationId);
    clearClientSessionUi(resolvedStationId);
    setActiveConversation(null, null, resolvedStationId);
    setStationConversation(resolvedStationId, null, null);
    window.electronAPI.startNewChat(activeConversationId ?? undefined, resolvedStationId);
    setArchiveOpen(false);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarCopy}>
          <div className={styles.toolbarEyebrow}>
            <YevonSpiral size={11} color="var(--gold-warm)" /> Hymnal Log
          </div>
          <div className={styles.toolbarTitle}>
            {activeConversationTitle?.trim() || (activeConversationId ? "Untitled chant" : "Fresh transmission")}
          </div>
        </div>
        <button type="button" className={styles.archiveToggle} onClick={() => setArchiveOpen((open) => !open)}>
          {archiveOpen ? "Close archive" : "Open archive"}
        </button>
      </div>
      {sessionNotice ? (
        <div className={`${styles.notice} ${styles[sessionNotice.kind]}`} role="alert" aria-live="polite">
          <span>{sessionNotice.message}</span>
          <button
            type="button"
            className={styles.noticeDismiss}
            onClick={() => setSessionNotice(null, resolvedStationId)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      <div ref={scrollRef} className={styles.messages}>
        {historyWasTrimmed ? (
          <output className={`${styles.notice} ${styles.info} ${styles.historyNotice}`} aria-live="polite">
            Older transcript entries were trimmed from this live view to keep the session responsive. Restored and
            stored conversations still come from the archive.
          </output>
        ) : null}
        {messages.length === 0 ? (
          <section className={styles.emptyState}>
            <BevelleArch className={styles.emptyArch} width={260} />
            <div className={styles.emptyEyebrow}>Bridge · Hymnal Log</div>
            <h3 className={styles.emptyTitle}>Awaiting Orders</h3>
            <p className={styles.emptyCopy}>
              Ask for a code change, a system investigation, or a reading of the repo. The Fayth will answer.
            </p>
            <div className={styles.examples}>
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className={styles.exampleChip}
                  onClick={() => {
                    setDraft(prompt, resolvedStationId);
                    requestComposerFocus(resolvedStationId);
                  }}
                >
                  <span className={styles.exampleChipSeal} aria-hidden="true">
                    <YevonSpiral size={12} color="var(--gold-warm)" />
                  </span>
                  <span>{prompt}</span>
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
                          setDraft(retryPrompt, resolvedStationId);
                          requestComposerFocus(resolvedStationId);
                        }
                      : undefined
                  }
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      <InputBar stationId={resolvedStationId} />
      <ConversationArchivePanel
        stationId={resolvedStationId}
        open={archiveOpen}
        disabled={isStreaming || isResetting}
        canStartNewChat={messages.length > 0 || activeConversationId !== null}
        onClose={() => setArchiveOpen(false)}
        onStartNewChat={startNewChat}
      />
    </div>
  );
}
