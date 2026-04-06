import { useEffect, useState } from "react";
import styles from "./StreamingText.module.css";

interface StreamingTextProps {
  content: string;
}

export function StreamingText({ content }: StreamingTextProps) {
  const [visibleLength, setVisibleLength] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleLength intentionally excluded — the interval self-advances; re-running only on content changes avoids tearing down the interval per character.
  useEffect(() => {
    if (visibleLength >= content.length) {
      return;
    }

    const interval = window.setInterval(() => {
      setVisibleLength((current) => {
        if (current >= content.length) {
          window.clearInterval(interval);
          return current;
        }

        return current + 1;
      });
    }, 12);

    return () => {
      window.clearInterval(interval);
    };
  }, [content]);

  useEffect(() => {
    setVisibleLength((current) => {
      if (content.length < current) {
        return content.length;
      }

      return current;
    });
  }, [content]);

  return (
    <span aria-live="polite" aria-atomic="false" className={styles.text}>
      {content.slice(0, visibleLength)}
      <span className={styles.cursor} aria-hidden="true">
        ▋
      </span>
    </span>
  );
}
