import type { SpiraUiView } from "@spira/shared";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { getShinraStatusContext } from "../shinra-status.js";
import type { ChatMessage } from "../stores/chat-store.js";
import { getChatSession, useChatStore } from "../stores/chat-store.js";
import { getStation, useStationStore } from "../stores/station-store.js";
import styles from "./AssistantStatusStrip.module.css";

interface AssistantStatusStripProps {
  activeView: SpiraUiView;
  onOpenBridge: () => void;
}

const STRIP_LINGER_MS = 2_800;

const getResponseBody = (message: ChatMessage | null): string => {
  if (!message) {
    return "";
  }

  const trimmed = message.content.trim();
  if (trimmed) {
    return trimmed;
  }

  return message.isStreaming ? "Shinra is thinking..." : "";
};

export function AssistantStatusStrip({ activeView, onOpenBridge }: AssistantStatusStripProps) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const assistantState = useStationStore((store) => getStation(store, activeStationId).state);
  const isStreaming = useChatStore((store) => getChatSession(store, activeStationId).isStreaming);
  const messages = useChatStore((store) => getChatSession(store, activeStationId).messages);
  const [displayMessage, setDisplayMessage] = useState<ChatMessage | null>(null);
  const [isLingering, setIsLingering] = useState(false);

  const context = useMemo(
    () =>
      getShinraStatusContext({
        assistantState,
        isStreaming,
        messages,
      }),
    [assistantState, isStreaming, messages],
  );

  const responseVisible = activeView !== "bridge" && context.isResponseState && context.hasCurrentResponse;
  const shouldExpand = responseVisible || (isLingering && activeView !== "bridge" && !!displayMessage);

  useEffect(() => {
    if (activeView === "bridge") {
      setDisplayMessage(null);
      setIsLingering(false);
      return;
    }

    if (responseVisible && context.lastAssistantMessage) {
      setDisplayMessage(context.lastAssistantMessage);
      setIsLingering(false);
      return;
    }

    if (!responseVisible && displayMessage) {
      setIsLingering(true);
      const timer = window.setTimeout(() => {
        setDisplayMessage(null);
        setIsLingering(false);
      }, STRIP_LINGER_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }

    setDisplayMessage(null);
    setIsLingering(false);
  }, [activeStationId, activeView, context.lastAssistantMessage, displayMessage, responseVisible]);

  if (activeView === "bridge") {
    return null;
  }

  return (
    <aside className={styles.strip} aria-label="Shinra status strip">
      <div className={styles.bar}>
        <span
          className={`${styles.orb} ${styles[assistantState]} ${context.isResponseState ? styles.active : ""}`}
          aria-hidden="true"
        />
        <div className={styles.copy}>
          <span className={styles.name}>Shinra</span>
          <span className={styles.summary} title={context.statusLine}>
            {context.statusLine}
          </span>
        </div>
        <button type="button" className={styles.bridgeButton} onClick={onOpenBridge} aria-label="Open bridge">
          ↗
        </button>
      </div>

      <AnimatePresence initial={false}>
        {shouldExpand && displayMessage ? (
          <motion.div
            className={styles.expanded}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className={styles.responseViewport}>
              <p>{getResponseBody(displayMessage)}</p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </aside>
  );
}
