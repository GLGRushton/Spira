import { useState } from "react";
import { useChatStore } from "../../stores/chat-store.js";
import styles from "./InputBar.module.css";

export function InputBar() {
  const addUserMessage = useChatStore((store) => store.addUserMessage);
  const isStreaming = useChatStore((store) => store.isStreaming);
  const [value, setValue] = useState("");

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || isStreaming) {
      return;
    }

    addUserMessage(trimmed);
    window.electronAPI.sendMessage(trimmed);
    setValue("");
  };

  return (
    <div className={styles.container}>
      <textarea
        className={styles.input}
        rows={2}
        placeholder="Transmit to Shinra…"
        value={value}
        disabled={isStreaming}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className={styles.send}
        disabled={isStreaming || value.trim().length === 0}
        onClick={submit}
      >
        Send
      </button>
    </div>
  );
}
