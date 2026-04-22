import type { McpServerStatus } from "@spira/shared";
import { useState } from "react";
import { getMcpServerStateLabel, getMcpServerStateTone } from "./mcp-server-status.js";
import styles from "./McpClusterDetail.module.css";

interface McpClusterDetailProps {
  servers: McpServerStatus[];
  onSelectServer: (serverId: string) => void;
}

interface McpDraft {
  id: string;
  name: string;
  description: string;
  command: string;
  argsText: string;
  envText: string;
}

const createEmptyDraft = (): McpDraft => ({
  id: "",
  name: "",
  description: "",
  command: "",
  argsText: "",
  envText: "",
});

const normalizeIdentifier = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

const parseArgs = (value: string): string[] =>
  value
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseEnv = (value: string): Record<string, string> =>
  value
    .split(/\r?\n/gu)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, line) => {
      const separator = line.indexOf("=");
      if (separator <= 0) {
        return acc;
      }
      const key = line.slice(0, separator).trim();
      const envValue = line.slice(separator + 1).trim();
      if (key) {
        acc[key] = envValue;
      }
      return acc;
    }, {});

export function McpClusterDetail({ servers, onSelectServer }: McpClusterDetailProps) {
  const [draft, setDraft] = useState<McpDraft>(createEmptyDraft());
  const [isFormOpen, setIsFormOpen] = useState(false);

  const connected = servers.filter((server) => server.state === "connected").length;
  const totalTools = servers.reduce((sum, server) => sum + server.toolCount, 0);
  const customCount = servers.filter((server) => server.source === "user").length;

  const resetDraft = () => {
    setDraft(createEmptyDraft());
    setIsFormOpen(false);
  };

  const submitDraft = () => {
    const normalisedId = normalizeIdentifier(draft.id || draft.name);
    if (!normalisedId || !draft.name.trim() || !draft.command.trim()) {
      return;
    }

    window.electronAPI.addMcpServer({
      id: normalisedId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      transport: "stdio",
      command: draft.command.trim(),
      args: parseArgs(draft.argsText),
      env: parseEnv(draft.envText),
      enabled: true,
      autoRestart: true,
    });

    resetDraft();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Armoury</div>
          <h2 className={styles.title}>Armoury</h2>
        </div>
        <div className={styles.headerActions}>
          <p className={styles.caption}>
            Grouped access to attached MCP servers. Built-ins can be disabled but not removed; custom racks can be added
            or retired from the deck without a restart.
          </p>
          <button type="button" className={styles.actionButton} onClick={() => setIsFormOpen(true)}>
            Add MCP server
          </button>
        </div>
      </div>

      <div className={styles.metrics}>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Connected rooms</span>
          <strong className={styles.metricValue}>
            {connected}/{servers.length}
          </strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Tool inventory</span>
          <strong className={styles.metricValue}>{totalTools}</strong>
        </article>
        <article className={styles.metricCard}>
          <span className={styles.metricLabel}>Custom racks</span>
          <strong className={styles.metricValue}>{customCount}</strong>
        </article>
      </div>

      {isFormOpen ? (
        <div className={styles.formPanel}>
          <div className={styles.formHeader}>
            <div>
              <div className={styles.sectionLabel}>Register custom MCP server</div>
              <div className={styles.formCaption}>Point Armoury at a new surface such as YouTrack or Azure DevOps.</div>
            </div>
            <div className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} onClick={resetDraft}>
                Cancel
              </button>
              <button type="button" className={styles.actionButton} onClick={submitDraft}>
                Save server
              </button>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Name</span>
              <input
                className={styles.input}
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                    id: current.id || normalizeIdentifier(event.target.value),
                  }))
                }
                placeholder="YouTrack MCP"
              />
            </label>
            <label className={styles.field}>
              <span>Identifier</span>
              <input
                className={styles.input}
                value={draft.id}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, id: normalizeIdentifier(event.target.value) }))
                }
                placeholder="youtrack"
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>Description</span>
              <input
                className={styles.input}
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="Issue tracking and workflow automation."
              />
            </label>
            <label className={`${styles.field} ${styles.fullWidth}`}>
              <span>Launch command</span>
              <input
                className={styles.input}
                value={draft.command}
                onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
                placeholder="npx"
              />
            </label>
            <label className={styles.field}>
              <span>Arguments (one per line)</span>
              <textarea
                className={styles.textarea}
                value={draft.argsText}
                onChange={(event) => setDraft((current) => ({ ...current, argsText: event.target.value }))}
                placeholder="-y&#10;@scope/youtrack-mcp"
              />
              <span className={styles.fieldHint}>
                Enter raw arguments only, one per line. For <code>mcp-remote</code>, use <code>-y</code>, then{" "}
                <code>mcp-remote</code>, then a full <code>https://...</code> URL. Do not paste JSON arrays or quotes.
              </span>
            </label>
            <label className={styles.field}>
              <span>Environment (KEY=VALUE)</span>
              <textarea
                className={styles.textarea}
                value={draft.envText}
                onChange={(event) => setDraft((current) => ({ ...current, envText: event.target.value }))}
                placeholder="YOUTRACK_URL=https://example.youtrack.cloud&#10;YOUTRACK_TOKEN=..."
              />
              <span className={styles.fieldHint}>
                Use one <code>KEY=VALUE</code> pair per line. If an argument references{" "}
                <code>Authorization:${"{AUTH_HEADER}"}</code>, set <code>AUTH_HEADER=Bearer ...</code> here.
              </span>
            </label>
          </div>
        </div>
      ) : null}

      <div className={styles.roster}>
        {servers.map((server) => {
          const stateTone = getMcpServerStateTone(server);
          const stateLabel = getMcpServerStateLabel(server);

          return (
            <article key={server.id} className={styles.serverCard}>
              <div className={styles.serverTopline}>
                <div className={styles.serverStatus}>
                  <span className={`${styles.stateDot} ${styles[stateTone]}`} />
                  <span className={styles.serverState}>{stateLabel}</span>
                </div>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={`${styles.toggleButton} ${server.enabled ? styles.toggleButtonActive : ""}`}
                    disabled={server.state === "starting"}
                    onClick={() => window.electronAPI.setMcpServerEnabled(server.id, !server.enabled)}
                  >
                    {server.enabled ? "Enabled" : "Disabled"}
                  </button>
                  {server.source === "builtin" ? (
                    <span className={styles.cardBadge}>Built-in</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => window.electronAPI.removeMcpServer(server.id)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <div className={styles.serverName}>{server.name}</div>
              <div className={styles.serverDescription}>
                {server.description ?? "Attached MCP surface for delegated tools and live operational data."}
              </div>
              <div className={styles.serverMeta}>
                <span>{server.toolCount} tools</span>
                <span>{server.tools.slice(0, 2).join(" · ") || "No tools"}</span>
              </div>
              <button type="button" className={styles.inspectButton} onClick={() => onSelectServer(server.id)}>
                Inspect rack
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
