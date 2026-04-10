import type { AgentRoom } from "../../stores/room-store.js";
import styles from "./AgentRoomDetail.module.css";

interface AgentRoomDetailProps {
  room: AgentRoom;
}

export function AgentRoomDetail({ room }: AgentRoomDetailProps) {
  const roomKind = room.kind === "subagent" ? "Subagent" : "Field team";
  const payloadText = room.envelope?.payload ? JSON.stringify(room.envelope.payload, null, 2) : null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>{roomKind}</div>
          <h2 className={styles.title}>{room.label}</h2>
        </div>
        <div className={`${styles.statePill} ${styles[room.status]}`}>{room.status}</div>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Room ID</span>
          <strong className={styles.metricValue}>{room.roomId}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Active operations</span>
          <strong className={styles.metricValue}>{room.activeToolCount}</strong>
        </article>
        {room.domainId ? (
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Domain</span>
            <strong className={styles.metricValue}>{room.domainId}</strong>
          </article>
        ) : null}
        {room.attempt ? (
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Attempt</span>
            <strong className={styles.metricValue}>{room.attempt}</strong>
          </article>
        ) : null}
        {room.expiresAt ? (
          <article className={styles.metricCard}>
            <span className={styles.metricLabel}>Expires</span>
            <strong className={styles.metricValue}>{new Date(room.expiresAt).toLocaleTimeString()}</strong>
          </article>
        ) : null}
      </div>

      <div className={styles.log}>
        <div className={styles.logTitle}>Latest activity</div>
        <div className={styles.logBody}>
          <div>
            <span className={styles.label}>Caption</span>
            <span>{room.caption}</span>
          </div>
          {room.agentId ? (
            <div>
              <span className={styles.label}>Agent ID</span>
              <span>{room.agentId}</span>
            </div>
          ) : null}
          {room.runId ? (
            <div>
              <span className={styles.label}>Run ID</span>
              <span>{room.runId}</span>
            </div>
          ) : null}
          {room.lastToolName ? (
            <div>
              <span className={styles.label}>Last tool</span>
              <span>{room.lastToolName}</span>
            </div>
          ) : null}
          <div>
            <span className={styles.label}>Detail</span>
            <span>{room.detail ?? "Awaiting first full result."}</span>
          </div>
        </div>
      </div>

      {room.liveText ? (
        <div className={styles.log}>
          <div className={styles.logTitle}>Live stream</div>
          <pre className={styles.preformatted}>{room.liveText}</pre>
        </div>
      ) : null}

      {room.toolHistory.length > 0 ? (
        <div className={styles.log}>
          <div className={styles.logTitle}>Tool history</div>
          <div className={styles.logBody}>
            {room.toolHistory.map((toolCall) => (
              <div key={toolCall.callId} className={styles.historyItem}>
                <div className={styles.historyHeading}>
                  <span>{toolCall.toolName}</span>
                  <span>{toolCall.status}</span>
                </div>
                {toolCall.details ? <span>{toolCall.details}</span> : null}
                {toolCall.durationMs !== undefined ? <span>{toolCall.durationMs} ms</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {room.errorHistory.length > 0 ? (
        <div className={styles.log}>
          <div className={styles.logTitle}>Errors</div>
          <div className={styles.logBody}>
            {room.errorHistory.map((error, index) => (
              <div
                key={`${error.code ?? "subagent-error"}-${error.message}-${error.details ?? index}`}
                className={styles.historyItem}
              >
                <div className={styles.historyHeading}>
                  <span>{error.code ?? "subagent-error"}</span>
                </div>
                <span>{error.message}</span>
                {error.details ? <span>{error.details}</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {room.envelope ? (
        <div className={styles.log}>
          <div className={styles.logTitle}>Final envelope</div>
          <div className={styles.logBody}>
            <div>
              <span className={styles.label}>Summary</span>
              <span>{room.envelope.summary}</span>
            </div>
            <div>
              <span className={styles.label}>Status</span>
              <span>{room.envelope.status}</span>
            </div>
            <div>
              <span className={styles.label}>Follow-up</span>
              <span>{room.envelope.followupNeeded ? "Needed" : "Not needed"}</span>
            </div>
            {room.envelope.artifacts.length > 0 ? (
              <div>
                <span className={styles.label}>Artifacts</span>
                <span>{room.envelope.artifacts.length}</span>
              </div>
            ) : null}
            {room.envelope.stateChanges.length > 0 ? (
              <div>
                <span className={styles.label}>State changes</span>
                <span>{room.envelope.stateChanges.length}</span>
              </div>
            ) : null}
            {payloadText ? (
              <div>
                <span className={styles.label}>Payload</span>
                <pre className={styles.preformatted}>{payloadText}</pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
