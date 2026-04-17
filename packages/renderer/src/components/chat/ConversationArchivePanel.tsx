import type { ConversationSearchMatch, StationId, StoredConversationSummary } from "@spira/shared";
import { useEffect, useMemo, useState } from "react";
import { getChatSession, useChatStore } from "../../stores/chat-store.js";
import { useStationStore } from "../../stores/station-store.js";
import styles from "./ConversationArchivePanel.module.css";

interface ConversationArchivePanelProps {
  stationId?: StationId;
  open: boolean;
  disabled?: boolean;
  canStartNewChat?: boolean;
  onClose: () => void;
  onStartNewChat: () => void;
}

const formatTimestamp = (timestamp: number | null): string => {
  if (timestamp === null) {
    return "No activity";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
};

export function ConversationArchivePanel({
  stationId,
  open,
  disabled = false,
  canStartNewChat = true,
  onClose,
  onStartNewChat,
}: ConversationArchivePanelProps) {
  const activeStationId = useStationStore((store) => store.activeStationId);
  const resolvedStationId = stationId ?? activeStationId;
  const setStationConversation = useStationStore((store) => store.setStationConversation);
  const activeConversationId = useChatStore((store) => getChatSession(store, resolvedStationId).activeConversationId);
  const hydrateConversation = useChatStore((store) => store.hydrateConversation);
  const setSessionNotice = useChatStore((store) => store.setSessionNotice);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<StoredConversationSummary[]>([]);
  const [searchResults, setSearchResults] = useState<ConversationSearchMatch[]>([]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSettledQuery(query);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const load = async () => {
      try {
        if (settledQuery.trim()) {
          const results = await window.electronAPI.searchConversations(settledQuery.trim(), 30);
          if (!cancelled) {
            setSearchResults(results);
            setConversations([]);
          }
          return;
        }

        const items = await window.electronAPI.listConversations(30, 0);
        if (!cancelled) {
          setConversations(items);
          setSearchResults([]);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load archived conversations.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, settledQuery]);

  const rows = useMemo(() => {
    if (settledQuery.trim()) {
      return searchResults.map((result) => ({
        id: result.messageId,
        conversationId: result.conversationId,
        title: result.conversationTitle,
        detail: result.snippet,
        timestamp: result.timestamp,
        messageCount: null,
      }));
    }

    return conversations.map((conversation) => ({
      id: conversation.id,
      conversationId: conversation.id,
      title: conversation.title,
      detail: `${conversation.messageCount} message${conversation.messageCount === 1 ? "" : "s"}`,
      timestamp: conversation.lastViewedAt ?? conversation.lastMessageAt ?? conversation.updatedAt,
      messageCount: conversation.messageCount,
    }));
  }, [conversations, searchResults, settledQuery]);

  const openConversation = async (conversationId: string) => {
    if (disabled) {
      return;
    }

    try {
      const conversation = await window.electronAPI.getConversation(conversationId);
      if (!conversation) {
        setError("That conversation could not be loaded.");
        return;
      }

      hydrateConversation(conversation, resolvedStationId);
      setStationConversation(resolvedStationId, conversation.id, conversation.title);
      await window.electronAPI.markConversationViewed(conversationId);
      if (conversationId !== activeConversationId) {
        setSessionNotice(
          {
            kind: "warning",
            message:
              "Loaded an archived conversation. The visible transcript is restored from the database; Shinra may need a fresh live turn to regain backend context.",
          },
          resolvedStationId,
        );
      }
      onClose();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to open the selected conversation.");
    }
  };

  const archiveConversation = async (conversationId: string) => {
    if (disabled || conversationId === activeConversationId) {
      return;
    }

    try {
      setArchivingId(conversationId);
      const archived = await window.electronAPI.archiveConversation(conversationId);
      if (!archived) {
        setError("That conversation could not be archived.");
        return;
      }

      setConversations((current) => current.filter((conversation) => conversation.id !== conversationId));
      setSearchResults((current) => current.filter((result) => result.conversationId !== conversationId));
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Failed to archive the selected conversation.");
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <aside className={`${styles.panel} ${open ? styles.open : ""}`} aria-hidden={!open}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Conversation archive</div>
          <h3 className={styles.title}>Stored chats</h3>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.startButton}
            disabled={disabled || !canStartNewChat}
            onClick={onStartNewChat}
          >
            Start new chat
          </button>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <label className={styles.searchLabel}>
        <span>Search conversations</span>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="Search saved chats..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.list}>
        {loading ? <div className={styles.empty}>Loading archived conversations...</div> : null}
        {!loading && rows.length === 0 ? (
          <div className={styles.empty}>
            {settledQuery.trim() ? "No archived conversations match that search." : "No archived conversations yet."}
          </div>
        ) : null}
        {!loading
          ? rows.map((row) => {
              const isActive = row.conversationId === activeConversationId;
              return (
                <div key={row.id} className={`${styles.row} ${isActive ? styles.active : ""}`}>
                  <button
                    type="button"
                    className={styles.rowButton}
                    disabled={disabled}
                    onClick={() => void openConversation(row.conversationId)}
                  >
                    <div className={styles.rowTop}>
                      <strong className={styles.rowTitle}>{row.title ?? "Untitled conversation"}</strong>
                      <span className={styles.rowTime}>{formatTimestamp(row.timestamp)}</span>
                    </div>
                    <div className={styles.rowBottom}>
                      <span className={styles.rowDetail}>{row.detail}</span>
                    </div>
                  </button>
                  {!settledQuery.trim() ? (
                    <button
                      type="button"
                      className={styles.archiveButton}
                      disabled={disabled || isActive || archivingId === row.conversationId}
                      onClick={() => void archiveConversation(row.conversationId)}
                    >
                      {archivingId === row.conversationId ? "Archiving..." : "Archive"}
                    </button>
                  ) : null}
                </div>
              );
            })
          : null}
      </div>
    </aside>
  );
}
