import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "../../stores/chat-store.js";
import styles from "./MessageBubble.module.css";
import { StreamingText } from "./StreamingText.js";
import { ToolCallCard } from "./ToolCallCard.js";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <article className={`${styles.bubble} ${isUser ? styles.user : styles.assistant}`}>
      <div className={styles.meta}>{isUser ? "USER" : "SPIRA"}</div>
      <div className={styles.content}>
        {message.isStreaming && !isUser ? (
          <StreamingText content={message.content} />
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        )}
      </div>
      {message.toolCalls?.map((entry) => (
        <ToolCallCard key={entry.callId ?? entry.name} entry={entry} />
      ))}
    </article>
  );
}
