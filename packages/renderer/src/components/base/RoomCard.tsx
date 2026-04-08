import type { ReactNode } from "react";
import type { Ref } from "react";
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
}: RoomCardProps) {
  return (
    <button
      ref={roomRef}
      type="button"
      data-room-id={roomId}
      className={[styles.card, styles[tone], active ? styles.active : "", className ?? ""].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <div className={styles.topline}>
        <span className={`${styles.statusDot} ${styles[status]}`} />
        <span className={styles.caption}>{caption}</span>
        {badge ? <span className={styles.badge}>{badge}</span> : null}
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{title}</div>
        <div className={styles.metric}>{metric}</div>
      </div>
      {children ? <div className={styles.preview}>{children}</div> : null}
    </button>
  );
}
