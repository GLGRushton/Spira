import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useIpc } from "../hooks/useIpc.js";
import { useAssistantStore } from "../stores/assistant-store.js";
import { useMcpStore } from "../stores/mcp-store.js";
import { useRoomStore } from "../stores/room-store.js";
import styles from "./AppShell.module.css";
import { GlassPanel } from "./GlassPanel.js";
import { PermissionPrompt } from "./PermissionPrompt.js";
import { ReconnectingOverlay } from "./ReconnectingOverlay.js";
import { ScreenCaptureIndicator } from "./ScreenCaptureIndicator.js";
import { SettingsPanel } from "./SettingsPanel.js";
import { Sidebar, type SidebarView } from "./Sidebar.js";
import { TitleBar } from "./TitleBar.js";
import { UpgradeBanner } from "./UpgradeBanner.js";
import { AgentClusterDetail } from "./base/AgentClusterDetail.js";
import { AgentRoomDetail } from "./base/AgentRoomDetail.js";
import { BaseDeck } from "./base/BaseDeck.js";
import { BridgeRoomDetail } from "./base/BridgeRoomDetail.js";
import { McpClusterDetail } from "./base/McpClusterDetail.js";
import { McpRoomDetail } from "./base/McpRoomDetail.js";

export function AppShell() {
  useIpc();

  const assistantState = useAssistantStore((store) => store.state);
  const servers = useMcpStore((store) => store.servers);
  const agentRooms = useRoomStore((store) => store.agentRooms);
  const flights = useRoomStore((store) => store.flights);
  const [view, setView] = useState<SidebarView>("ship");

  const selectedServer = view.startsWith("mcp:") ? servers.find((server) => server.id === view.slice(4)) : null;
  const selectedAgentRoom = view.startsWith("agent:") ? agentRooms.find((room) => room.roomId === view) : null;
  const isShipOverview = view === "ship";

  useEffect(() => {
    if (view.startsWith("mcp:") && !selectedServer) {
      setView("ship");
    }
    if (view.startsWith("agent:") && !selectedAgentRoom) {
      setView("ship");
    }
  }, [selectedAgentRoom, selectedServer, view]);

  return (
    <div className={styles.app}>
      <div className={styles.titleBarSlot}>
        <TitleBar />
      </div>
      <div className={styles.sidebarSlot}>
        <Sidebar activeView={view} onViewChange={setView} />
      </div>
      <main className={styles.main}>
        <AnimatePresence mode="wait" initial={false}>
          {isShipOverview ? (
            <motion.div
              key="ship"
              className={styles.stage}
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.015 }}
              transition={{ duration: 0.26, ease: "easeOut" }}
            >
              <BaseDeck
                activeView={view}
                assistantState={assistantState}
                servers={servers}
                agentRooms={agentRooms}
                flights={flights}
                onViewChange={setView}
              />
            </motion.div>
          ) : (
            <motion.div
              key={view}
              className={styles.stage}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -18, scale: 1.02 }}
              transition={{ duration: 0.26, ease: "easeOut" }}
            >
              <GlassPanel padding="md" className={styles.contentPanel}>
                <div className={styles.roomChrome}>
                  <button type="button" className={styles.backButton} onClick={() => setView("ship")}>
                    ← Back to ship
                  </button>
                </div>

                <div className={styles.contentInner}>
                  {view === "bridge" ? (
                    <BridgeRoomDetail assistantState={assistantState} />
                  ) : view === "mcp" ? (
                    <McpClusterDetail servers={servers} onSelectServer={(serverId) => setView(`mcp:${serverId}`)} />
                  ) : view === "agents" ? (
                    <AgentClusterDetail rooms={agentRooms} onSelectRoom={(roomId) => setView(roomId)} />
                  ) : view === "settings" ? (
                    <SettingsPanel />
                  ) : selectedServer ? (
                    <McpRoomDetail server={selectedServer} />
                  ) : selectedAgentRoom ? (
                    <AgentRoomDetail room={selectedAgentRoom} />
                  ) : (
                    <BridgeRoomDetail assistantState={assistantState} />
                  )}
                </div>
              </GlassPanel>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <ScreenCaptureIndicator />
      <PermissionPrompt />
      <UpgradeBanner />
      <ReconnectingOverlay />
    </div>
  );
}
