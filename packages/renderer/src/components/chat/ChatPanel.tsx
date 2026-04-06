import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { useChatStore } from "../../stores/chat-store.js";
import styles from "./ChatPanel.module.css";
import { InputBar } from "./InputBar.js";
import { MessageBubble } from "./MessageBubble.js";

export function ChatPanel() {
  const messages = useChatStore((store) => store.messages);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessage = messages.at(-1);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !lastMessage) {
      return;
    }

    const isNearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
    if (isNearBottom) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    }
  }, [lastMessage]);

  return (
    <div className={styles.panel}>
      <div ref={scrollRef} className={styles.messages}>
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              <MessageBubble message={message} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <InputBar />
    </div>
  );
}
