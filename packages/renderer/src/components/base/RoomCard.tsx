import type { ReactNode, Ref } from "react";
import { BevelleArch } from "../decor/Glyphs.js";
import styles from "./RoomCard.module.css";

type RoomCardStatus =
  | "idle"
  | "thinking"
  | "listening"
  | "transcribing"
  | "speaking"
  | "error"
  | "starting"
  | "connected"
  | "disconnected";
type RoomCardTone = "bridge" | "command" | "mcp" | "ops" | "agent";
type RoomCardSize = "primary" | "secondary";

interface RoomCardProps {
  active?: boolean;
  title: string;
  caption: string;
  metric: string;
  badge?: string;
  status: RoomCardStatus;
  tone: RoomCardTone;
  onClick: () => void;
  roomRef?: Ref<HTMLButtonElement>;
  roomId?: string;
  children?: ReactNode;
  className?: string;
  silhouette?: ReactNode;
  size?: RoomCardSize;
}

export function RoomCard({
  active = false,
  title,
  caption,
  metric,
  badge,
  status,
  tone,
  onClick,
  roomRef,
  roomId,
  children,
  className,
  silhouette,
  size = "secondary",
}: RoomCardProps) {
  return (
    <button
      ref={roomRef}
      type="button"
      data-room-id={roomId}
      className={[
        styles.card,
        styles[tone],
        styles[`size-${size}`],
        active ? styles.active : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
    >
      <BevelleArch className={styles.arch} width={size === "primary" ? 280 : 200} />
      <div className={styles.body}>
        <div className={styles.topline}>
          <span className={`${styles.statusDot} ${styles[status]}`} />
          <span className={styles.caption}>{caption}</span>
          {badge ? <span className={styles.badge}>{badge}</span> : null}
        </div>
        <div className={styles.titleRow}>
          {silhouette ? <span className={styles.silhouette}>{silhouette}</span> : null}
          <span className={styles.title}>{title}</span>
        </div>
        <div className={styles.metric}>{metric}</div>
        {children ? <div className={styles.preview}>{children}</div> : null}
      </div>
    </button>
  );
}
