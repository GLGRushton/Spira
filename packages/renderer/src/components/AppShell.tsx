import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useIpc } from "../hooks/useIpc.js";
import { useAssistantStore } from "../stores/assistant-store.js";
import styles from "./AppShell.module.css";
import { GlassPanel } from "./GlassPanel.js";
import { ReconnectingOverlay } from "./ReconnectingOverlay.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { Sidebar, type SidebarView } from "./Sidebar.js";
import { TitleBar } from "./TitleBar.js";
import { ChatPanel } from "./chat/ChatPanel.js";
import { ShinraOrb } from "./orb/ShinraOrb.js";

export function AppShell() {
  useIpc();

  const assistantState = useAssistantStore((store) => store.state);
  const [view, setView] = useState<SidebarView>("chat");

  return (
    <div className={styles.app}>
      <div className={styles.titleBarSlot}>
        <TitleBar />
      </div>
      <div className={styles.sidebarSlot}>
        <Sidebar activeView={view} onViewChange={setView} />
      </div>
      <main className={styles.main}>
        <GlassPanel glow padding="lg" className={styles.orbPanel}>
          <div className={styles.orbHeader}>
            <div>
              <span className={styles.eyebrow}>Core Status</span>
              <h1 className={styles.state}>{assistantState}</h1>
            </div>
            <p className={styles.caption}>Adaptive orbital matrix synchronised to Copilot voice and response state.</p>
          </div>
          <div className={styles.orbStage}>
            <ShinraOrb />
          </div>
        </GlassPanel>

        <GlassPanel padding="md" className={styles.contentPanel}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view}
              className={styles.contentInner}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              {view === "chat" ? <ChatPanel /> : <SettingsPanel />}
            </motion.div>
          </AnimatePresence>
        </GlassPanel>
      </main>
      <ReconnectingOverlay />
    </div>
  );
}
