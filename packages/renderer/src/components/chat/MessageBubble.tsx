import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../../stores/chat-store.js";
import styles from "./MessageBubble.module.css";
import { StreamingText } from "./StreamingText.js";
import { ToolActivityLine } from "./ToolActivityLine.js";

const MARKDOWN_PLUGINS = [remarkGfm];

interface MessageBubbleProps {
  message: ChatMessage;
  isAwaitingReply?: boolean;
  onRetry?: () => void;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isAwaitingReply = false,
  onRetry,
}: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const copyResetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (message.isStreaming) {
      return;
    }

    try {
      await navigator.clipboard.writeText(message.content);
      setCopyState("copied");
    } catch (error) {
      console.error("Failed to copy chat message", error);
      setCopyState("error");
    }

    if (copyResetTimeoutRef.current) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
    copyResetTimeoutRef.current = window.setTimeout(() => {
      setCopyState("idle");
    }, 1_200);
  };

  return (
    <article
      className={`${styles.bubble} ${isUser ? styles.user : styles.assistant} ${isAwaitingReply ? styles.question : ""}`}
    >
      <div className={styles.headerRow}>
        <div className={styles.metaGroup}>
          <div className={styles.meta}>{isUser ? "USER" : "SPIRA"}</div>
          {isAwaitingReply ? <div className={styles.questionPill}>Awaiting reply</div> : null}
        </div>
        <div className={styles.messageActions}>
          {!isUser && onRetry ? (
            <button type="button" className={styles.actionButton} onClick={onRetry}>
              Retry
            </button>
          ) : null}
          <button
            type="button"
            className={styles.actionButton}
            disabled={message.isStreaming}
            onClick={() => void handleCopy()}
          >
            {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
          </button>
        </div>
      </div>
      <div className={styles.content}>
        {message.isStreaming && !isUser ? (
          <StreamingText content={message.content} fallbackText="Shinra is thinking..." />
        ) : (
          <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{message.content}</ReactMarkdown>
        )}
        {!message.isStreaming && message.wasAborted ? <div className={styles.stopped}>Generation stopped.</div> : null}
      </div>
      {!isUser ? <ToolActivityLine toolCalls={message.toolCalls} /> : null}
    </article>
  );
});
