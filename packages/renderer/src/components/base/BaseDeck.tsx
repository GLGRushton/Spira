import type {
  AssistantState,
  McpServerStatus,
  SpiraUiView,
  SubagentDomain,
  TicketRunSummary,
} from "@spira/shared";
import { motion } from "framer-motion";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { getChatSession, useChatStore } from "../../stores/chat-store.js";
import { useMissionRunsStore } from "../../stores/mission-runs-store.js";
import { useNavigationStore } from "../../stores/navigation-store.js";
import type { AgentRoom, ToolFlight } from "../../stores/room-store.js";
import { useStationStore, type StationViewState } from "../../stores/station-store.js";
import { PyrefleBurst } from "../atmosphere/PyrefleBurst.js";
import {
  AirshipSilhouette,
  BevelleArch,
  HymnInscription,
  YevonSpiral,
} from "../decor/Glyphs.js";
import { ShinraOrb } from "../orb/ShinraOrb.js";
import styles from "./BaseDeck.module.css";

interface BaseDeckProps {
  activeView: SpiraUiView;
  activeStationId: string;
  assistantState: AssistantState;
  stations: StationViewState[];
  servers: McpServerStatus[];
  subagents: SubagentDomain[];
  agentRooms: AgentRoom[];
  flights: ToolFlight[];
  onViewChange: (view: SpiraUiView) => void;
}

const stateLabel = (state: AssistantState): string => state.charAt(0).toUpperCase() + state.slice(1);

const formatRelative = (ms: number): string => {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return `${seconds || 1}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const ACTIVE_RUN_STATES = new Set(["starting", "ready", "blocked", "working", "awaiting-review"]);
const isActiveRun = (run: TicketRunSummary): boolean => ACTIVE_RUN_STATES.has(run.status);

const fade = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
};

export function BaseDeck({
  activeStationId,
  assistantState,
  stations,
  servers,
  subagents,
  agentRooms,
  flights,
  onViewChange,
}: BaseDeckProps) {
  const setActiveStation = useStationStore((store) => store.setActiveStation);
  const openMission = useNavigationStore((store) => store.openMission);
  const { sessions, setActiveConversation } = useChatStore(
    useShallow((store) => ({
      sessions: store.sessions,
      setActiveConversation: store.setActiveConversation,
    })),
  );

  const focusedStation = stations.find((s) => s.stationId === activeStationId) ?? stations[0];
  const focusedSession = focusedStation
    ? getChatSession(useChatStore.getState(), focusedStation.stationId)
    : undefined;
  const focusedAssistantMessage = focusedSession?.messages
    .slice()
    .reverse()
    .find((m) => m.role === "assistant" && m.content.trim().length > 0);
  const focusedSummary = focusedAssistantMessage?.content?.trim().slice(0, 220) ?? "Standing by";

  const missionSnapshot = useMissionRunsStore((store) => store.snapshot);
  const activeRuns = useMemo(
    () => missionSnapshot.runs.filter(isActiveRun).slice(0, 4),
    [missionSnapshot.runs],
  );
  const recentRuns = useMemo(
    () =>
      missionSnapshot.runs
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 4),
    [missionSnapshot.runs],
  );
  const missionRail = activeRuns.length > 0 ? activeRuns : recentRuns;

  const liveFlights = useMemo(
    () =>
      flights
        .filter((flight) => !flight.completedAt)
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, 6),
    [flights],
  );

  const recentChats = useMemo(() => {
    const rows: Array<{
      stationId: string;
      stationLabel: string;
      title: string;
      preview: string;
      conversationId: string | null;
      updatedAt: number;
    }> = [];
    for (const station of stations) {
      const session = sessions[station.stationId];
      if (!session) continue;
      const lastMessage = session.messages.at(-1);
      if (!lastMessage) continue;
      rows.push({
        stationId: station.stationId,
        stationLabel: station.label,
        title: session.activeConversationTitle?.trim() || (session.activeConversationId ? "Untitled" : "Fresh chant"),
        preview: lastMessage.content.trim().slice(0, 120) || "…",
        conversationId: session.activeConversationId,
        updatedAt: lastMessage.timestamp ?? 0,
      });
    }
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  }, [sessions, stations]);

  const connectedServers = servers.filter((s) => s.state === "connected").length;
  const totalTools = servers.reduce((sum, s) => sum + s.toolCount, 0);
  const readySubagents = subagents.filter((agent) => agent.ready !== false);
  const liveAgents = agentRooms.filter((r) => r.activeToolCount > 0).length;

  const handleStationOpen = (stationId: string) => {
    setActiveStation(stationId);
    onViewChange("bridge");
  };

  const handleChatResume = (
    stationId: string,
    conversationId: string | null,
    title: string,
  ) => {
    setActiveStation(stationId);
    setActiveConversation(conversationId, title, stationId);
    onViewChange("bridge");
  };

  return (
    <section className={styles.deck}>
      <div className={styles.airship} aria-hidden="true">
        <AirshipSilhouette opacity={0.05} />
      </div>

      <PyrefleBurst count={14} duration={1.4} spread={260} tint="rgba(245, 218, 156, 0.7)" />

      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <div className={styles.eyebrow}>
            <YevonSpiral size={12} color="var(--gold-warm)" /> The Cloister Above
          </div>
          <h1 className={styles.title}>Overview</h1>
        </div>
        <p className={styles.caption}>
          A reading of the airship in this moment — what Shinra is doing, where the pilgrimage stands, which stations
          watch the void, and where you left off.
        </p>
      </header>

      <motion.section
        className={`${styles.hero} ${styles[focusedStation?.state ?? "idle"]}`}
        initial={fade.initial}
        animate={fade.animate}
        transition={{ duration: 0.42, delay: 0.0, ease: "easeOut" }}
      >
        <div className={styles.heroOrb}>
          <ShinraOrb size="chamber" />
        </div>
        <div className={styles.heroBody}>
          <div className={styles.heroEyebrow}>
            <span className={styles.heroDot} />
            Now · {stateLabel(assistantState)}
          </div>
          <h2 className={styles.heroTitle}>
            {focusedStation?.label ?? "Primary"}
          </h2>
          <p className={styles.heroSummary}>{focusedSummary}</p>
          <div className={styles.heroActions}>
            <button
              type="button"
              className={styles.heroPrimary}
              onClick={() => onViewChange("bridge")}
            >
              Open Bridge
            </button>
            <button
              type="button"
              className={styles.heroSecondary}
              onClick={() => {
                useChatStore.getState().requestComposerFocus(focusedStation?.stationId);
                onViewChange("bridge");
              }}
            >
              Speak to the Fayth
            </button>
          </div>
        </div>
        <BevelleArch className={styles.heroArch} width={300} />
      </motion.section>

      <motion.section
        className={styles.panel}
        initial={fade.initial}
        animate={fade.animate}
        transition={{ duration: 0.42, delay: 0.08, ease: "easeOut" }}
      >
        <div className={styles.panelHeader}>
          <div className={styles.panelEyebrow}>
            <YevonSpiral size={11} color="var(--gold-warm)" /> Pilgrimage in motion
          </div>
          <button
            type="button"
            className={styles.panelLink}
            onClick={() => onViewChange("projects")}
          >
            Open log →
          </button>
        </div>
        {missionRail.length === 0 ? (
          <p className={styles.empty}>The pilgrimage book is closed. Pick up a mission to begin.</p>
        ) : (
          <div className={styles.missionRail}>
            {missionRail.map((run) => (
              <button
                type="button"
                key={run.runId}
                className={`${styles.missionCard} ${styles[`run-${run.status}`] ?? ""}`}
                onClick={() => openMission(run.runId)}
              >
                <div className={styles.missionTopline}>
                  <span className={styles.missionTicket}>{run.ticketId}</span>
                  <span className={`${styles.missionStatus} ${styles[`badge-${run.status}`] ?? ""}`}>
                    {run.status.replace("-", " ")}
                  </span>
                </div>
                <div className={styles.missionTitle}>{run.ticketSummary || "Untitled mission"}</div>
                <div className={styles.missionMeta}>
                  <span>{run.projectKey}</span>
                  <span>{formatRelative(run.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </motion.section>

      <div className={styles.twoColumn}>
        <motion.section
          className={styles.panel}
          initial={fade.initial}
          animate={fade.animate}
          transition={{ duration: 0.42, delay: 0.16, ease: "easeOut" }}
        >
          <div className={styles.panelHeader}>
            <div className={styles.panelEyebrow}>
              <YevonSpiral size={11} color="var(--gold-warm)" /> Stations on watch
            </div>
            <button
              type="button"
              className={styles.panelLink}
              onClick={() => onViewChange("operations")}
            >
              Open roster →
            </button>
          </div>
          <div className={styles.stationGrid}>
            {stations.map((station) => {
              const isFocused = station.stationId === activeStationId;
              const sessionTitle =
                sessions[station.stationId]?.activeConversationTitle?.trim() || "Awaiting orders";
              return (
                <button
                  type="button"
                  key={station.stationId}
                  className={`${styles.stationCard} ${isFocused ? styles.stationFocused : ""}`}
                  onClick={() => handleStationOpen(station.stationId)}
                >
                  <span className={`${styles.stationPulse} ${styles[station.state]}`} />
                  <div className={styles.stationCopy}>
                    <span className={styles.stationLabel}>
                      {station.label}
                      {isFocused ? <span className={styles.stationFocusFlag}>focus</span> : null}
                    </span>
                    <span className={styles.stationDetail}>{sessionTitle}</span>
                  </div>
                  <span className={styles.stationState}>{stateLabel(station.state)}</span>
                </button>
              );
            })}
            <button
              type="button"
              className={styles.stationAddCard}
              onClick={() => {
                onViewChange("operations");
                window.electronAPI.send({ type: "station:create" });
              }}
            >
              <span className={styles.stationAddPlus}>+</span>
              <span className={styles.stationAddLabel}>New station</span>
            </button>
          </div>
        </motion.section>

        <motion.section
          className={styles.panel}
          initial={fade.initial}
          animate={fade.animate}
          transition={{ duration: 0.42, delay: 0.22, ease: "easeOut" }}
        >
          <div className={styles.panelHeader}>
            <div className={styles.panelEyebrow}>
              <YevonSpiral size={11} color="var(--gold-warm)" /> Live operations
            </div>
            <span className={styles.panelMeta}>{liveFlights.length} in flight</span>
          </div>
          {liveFlights.length === 0 ? (
            <p className={styles.empty}>Quiet decks — no tool flights right now.</p>
          ) : (
            <ul className={styles.opsList}>
              {liveFlights.map((flight) => (
                <li key={flight.callId} className={styles.opsRow}>
                  <span className={styles.opsScan} aria-hidden="true" />
                  <div className={styles.opsCopy}>
                    <span className={styles.opsName}>{flight.toolName}</span>
                    <span className={styles.opsTarget}>{flight.toRoomId}</span>
                  </div>
                  <span className={styles.opsStatus}>{flight.status}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      </div>

      <motion.section
        className={styles.panel}
        initial={fade.initial}
        animate={fade.animate}
        transition={{ duration: 0.42, delay: 0.28, ease: "easeOut" }}
      >
        <div className={styles.panelHeader}>
          <div className={styles.panelEyebrow}>
            <YevonSpiral size={11} color="var(--gold-warm)" /> Recent hymns
          </div>
          <span className={styles.panelMeta}>Resume where you left off</span>
        </div>
        {recentChats.length === 0 ? (
          <p className={styles.empty}>No transmissions on the wire. Start a chat from the bridge.</p>
        ) : (
          <ul className={styles.chatList}>
            {recentChats.map((chat) => (
              <li key={`${chat.stationId}-${chat.conversationId ?? "draft"}`}>
                <button
                  type="button"
                  className={styles.chatRow}
                  onClick={() => handleChatResume(chat.stationId, chat.conversationId, chat.title)}
                >
                  <div className={styles.chatLead}>
                    <span className={styles.chatStation}>{chat.stationLabel}</span>
                    <span className={styles.chatTime}>{formatRelative(chat.updatedAt)}</span>
                  </div>
                  <div className={styles.chatTitle}>{chat.title}</div>
                  <div className={styles.chatPreview}>{chat.preview}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </motion.section>

      <motion.section
        className={styles.statusStrip}
        initial={fade.initial}
        animate={fade.animate}
        transition={{ duration: 0.42, delay: 0.34, ease: "easeOut" }}
      >
        <button
          type="button"
          className={styles.statusCell}
          onClick={() => onViewChange("mcp")}
        >
          <span className={styles.statusValue}>{connectedServers}/{servers.length}</span>
          <span className={styles.statusLabel}>Armoury · {totalTools} tools</span>
        </button>
        <button
          type="button"
          className={styles.statusCell}
          onClick={() => onViewChange("agents")}
        >
          <span className={styles.statusValue}>{liveAgents}/{agentRooms.length}</span>
          <span className={styles.statusLabel}>Cloister · live rooms</span>
        </button>
        <button
          type="button"
          className={styles.statusCell}
          onClick={() => onViewChange("barracks")}
        >
          <span className={styles.statusValue}>{readySubagents.length}</span>
          <span className={styles.statusLabel}>Barracks · ready</span>
        </button>
        <button
          type="button"
          className={styles.statusCell}
          onClick={() => onViewChange("settings")}
        >
          <span className={styles.statusValue}>9720</span>
          <span className={styles.statusLabel}>Sphere Grid · backend</span>
        </button>
      </motion.section>

      <HymnInscription
        className={styles.epitaph}
        variant="epitaph"
        text="Pray to the Fayth · Walk the path"
      />
    </section>
  );
}
