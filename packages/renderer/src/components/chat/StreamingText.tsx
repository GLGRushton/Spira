import styles from "./StreamingText.module.css";

interface StreamingTextProps {
  content: string;
  fallbackText?: string;
}

export function StreamingText({ content, fallbackText }: StreamingTextProps) {
  const displayContent = content.length > 0 ? content : (fallbackText ?? "");

  return (
    <div aria-live="off" className={`${styles.text} ${styles.plain}`}>
      {displayContent}
    </div>
  );
}
