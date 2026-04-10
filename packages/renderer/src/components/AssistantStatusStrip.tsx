import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { getShinraStatusContext } from "../shinra-status.js";
import type { ChatMessage } from "../stores/chat-store.js";
import { getChatSession, useChatStore } from "../stores/chat-store.js";
import { useConnectionStore } from "../stores/connection-store.js";
import { usePermissionStore } from "../stores/permission-store.js";
import { useRoomStore } from "../stores/room-store.js";
import { getStation, useStationStore } from "../stores/station-store.js";
import { useUpgradeStore } from "../stores/upgrade-store.js";
import { useVisionStore } from "../stores/vision-store.js";
import styles from "./AssistantStatusStrip.module.css";

import type { SpiraUiView } from "@spira/shared";

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
  const { isStreaming, messages, isAborting, isResetting } = useChatStore((store) =>
    getChatSession(store, activeStationId),
  );
  const connectionStatus = useConnectionStore((store) => store.status);
  const allPermissionRequests = usePermissionStore((store) => store.requests);
  const allActiveCaptures = useVisionStore((store) => store.activeCaptures);
  const allAgentRooms = useRoomStore((store) => store.agentRooms);
  const visibleBanner = useUpgradeStore((store) => store.banner ?? store.protocolBanner);
  const [displayMessage, setDisplayMessage] = useState<ChatMessage | null>(null);
  const [isLingering, setIsLingering] = useState(false);

  const permissionRequests = useMemo(
    () => allPermissionRequests.filter((request) => (request.stationId ?? activeStationId) === activeStationId),
    [activeStationId, allPermissionRequests],
  );
  const activeCaptures = useMemo(
    () => allActiveCaptures.filter((capture) => capture.stationId === activeStationId),
    [activeStationId, allActiveCaptures],
  );
  const agentRooms = useMemo(
    () => allAgentRooms.filter((room) => room.stationId === activeStationId),
    [activeStationId, allAgentRooms],
  );

  const context = useMemo(
    () =>
      getShinraStatusContext({
        assistantState,
        isStreaming,
        messages,
        connectionStatus,
        permissionRequests,
        activeCaptures,
        agentRooms,
        upgradeBanner: visibleBanner,
        isAborting,
        isResetting,
      }),
    [
      activeCaptures,
      agentRooms,
      assistantState,
      connectionStatus,
      isAborting,
      isResetting,
      isStreaming,
      messages,
      permissionRequests,
      visibleBanner,
    ],
  );

  const responseVisible = activeView !== "bridge" && context.isResponseState && context.hasCurrentResponse;
  const shouldExpand = responseVisible || (isLingering && activeView !== "bridge" && !!displayMessage);

  useEffect(() => {
    if (activeView === "bridge") {
      if (displayMessage !== null) {
        setDisplayMessage(null);
      }
      if (isLingering) {
        setIsLingering(false);
      }
      return;
    }

    if (responseVisible && context.lastAssistantMessage) {
      if (displayMessage !== context.lastAssistantMessage) {
        setDisplayMessage(context.lastAssistantMessage);
      }
      if (isLingering) {
        setIsLingering(false);
      }
      return;
    }

    if (!responseVisible && displayMessage) {
      if (!isLingering) {
        setIsLingering(true);
      }
      const timer = window.setTimeout(() => {
        setDisplayMessage(null);
        setIsLingering(false);
      }, STRIP_LINGER_MS);
      return () => {
        window.clearTimeout(timer);
      };
    }

    if (displayMessage !== null) {
      setDisplayMessage(null);
    }
    if (isLingering) {
      setIsLingering(false);
    }
  }, [activeView, context.lastAssistantMessage, displayMessage, isLingering, responseVisible]);

  if (activeView === "bridge") {
    return null;
  }

  return (
    <aside className={styles.strip} aria-label="Shinra status strip">
      <div className={styles.bar}>
        <span
          className={`${styles.orb} ${styles[context.phase]} ${context.isResponseState ? styles.active : ""}`}
          aria-hidden="true"
        />
        <div className={styles.copy}>
          <div className={styles.headline}>
            <span className={styles.name}>Shinra</span>
            <span
              className={`${styles.phaseBadge} ${styles[context.phase]}`}
              aria-label={`Shinra phase ${context.phaseLabel}`}
            >
              {context.phaseLabel}
            </span>
          </div>
          <span className={styles.summary} title={context.statusLine}>
            {context.workSummary ?? "Standing by"}
          </span>
          {context.indicators.length > 0 ? (
            <div className={styles.indicators} aria-label="Shinra activity indicators">
              {context.indicators.map((indicator) => (
                <span key={indicator} className={styles.indicator}>
                  {indicator}
                </span>
              ))}
            </div>
          ) : null}
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
