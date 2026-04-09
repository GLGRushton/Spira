import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./StreamingText.module.css";

const MARKDOWN_PLUGINS = [remarkGfm];

interface StreamingTextProps {
  content: string;
  fallbackText?: string;
}

export function StreamingText({ content, fallbackText }: StreamingTextProps) {
  const displayContent = content.length > 0 ? content : (fallbackText ?? "");

  return (
    <div aria-live="off" className={styles.text}>
      <ReactMarkdown remarkPlugins={MARKDOWN_PLUGINS}>{displayContent}</ReactMarkdown>
    </div>
  );
}
