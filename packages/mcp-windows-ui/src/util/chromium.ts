import { randomUUID } from "node:crypto";

export interface ChromiumTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  description?: string;
  webSocketDebuggerUrl?: string;
}

export interface ChromiumProcessInfo {
  processName: string;
  pid: number;
  port: number;
  commandLine: string;
}

interface ChromiumSessionRecord {
  readonly sessionId: string;
  readonly host: string;
  readonly port: number;
  readonly target: ChromiumTarget;
  readonly socket: WebSocket;
  readonly createdAt: number;
  nextId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>;
}

const sessions = new Map<string, ChromiumSessionRecord>();

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function listChromiumTargets(host: string, port: number): Promise<ChromiumTarget[]> {
  return await readJson<ChromiumTarget[]>(`http://${host}:${port}/json/list`);
}

function chooseTarget(
  targets: ChromiumTarget[],
  criteria: { targetId?: string; titleIncludes?: string; urlIncludes?: string },
): ChromiumTarget {
  if (criteria.targetId) {
    const target = targets.find((candidate) => candidate.id === criteria.targetId);
    if (!target) {
      throw new Error(`No Chromium target found for id ${criteria.targetId}.`);
    }

    return target;
  }

  const filtered = targets.filter((candidate) => {
    if (typeof criteria.titleIncludes === "string" && !candidate.title.includes(criteria.titleIncludes)) {
      return false;
    }

    if (typeof criteria.urlIncludes === "string" && !candidate.url.includes(criteria.urlIncludes)) {
      return false;
    }

    return candidate.type === "page" || candidate.type === "webview" || candidate.type === "iframe";
  });

  const match = filtered[0];
  if (!match) {
    throw new Error("No Chromium debug target matched the requested criteria.");
  }

  return match;
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };

    const handleError = () => {
      cleanup();
      reject(new Error("Failed to open the Chromium debugging WebSocket."));
    };

    const cleanup = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
  });
}

function decodeSocketData(data: MessageEvent["data"]): string {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  }

  return String(data);
}

function attachMessagePump(session: ChromiumSessionRecord): void {
  session.socket.addEventListener("message", (event) => {
    const payload = JSON.parse(decodeSocketData(event.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };

    if (typeof payload.id !== "number") {
      return;
    }

    const pending = session.pending.get(payload.id);
    if (!pending) {
      return;
    }

    session.pending.delete(payload.id);
    if (payload.error) {
      pending.reject(new Error(payload.error.message ?? "Chromium command failed."));
      return;
    }

    pending.resolve(payload.result);
  });

  const rejectPending = (reason: string) => {
    for (const pending of session.pending.values()) {
      pending.reject(new Error(reason));
    }
    session.pending.clear();
  };

  session.socket.addEventListener("close", () => {
    rejectPending("Chromium debugging session closed.");
    sessions.delete(session.sessionId);
  });

  session.socket.addEventListener("error", () => {
    rejectPending("Chromium debugging session errored.");
  });
}

export async function attachChromiumSession(args: {
  host: string;
  port: number;
  targetId?: string;
  titleIncludes?: string;
  urlIncludes?: string;
}): Promise<{ sessionId: string; target: ChromiumTarget; host: string; port: number }> {
  const targets = await listChromiumTargets(args.host, args.port);
  const target = chooseTarget(targets, args);
  if (!target.webSocketDebuggerUrl) {
    throw new Error("Selected target does not expose a WebSocket debugger URL.");
  }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await waitForSocketOpen(socket);

  const sessionId = randomUUID();
  const session: ChromiumSessionRecord = {
    sessionId,
    host: args.host,
    port: args.port,
    target,
    socket,
    createdAt: Date.now(),
    nextId: 1,
    pending: new Map(),
  };

  attachMessagePump(session);
  sessions.set(sessionId, session);
  await sendChromiumCommand(sessionId, "Runtime.enable");
  await sendChromiumCommand(sessionId, "Page.enable");

  return {
    sessionId,
    target,
    host: args.host,
    port: args.port,
  };
}

export function listChromiumSessions(): Array<{
  sessionId: string;
  host: string;
  port: number;
  target: ChromiumTarget;
  connectedAt: string;
}> {
  return [...sessions.values()].map((session) => ({
    sessionId: session.sessionId,
    host: session.host,
    port: session.port,
    target: session.target,
    connectedAt: new Date(session.createdAt).toISOString(),
  }));
}

export async function detachChromiumSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown Chromium session ${sessionId}.`);
  }

  session.socket.close();
  sessions.delete(sessionId);
}

function requireSession(sessionId: string): ChromiumSessionRecord {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown Chromium session ${sessionId}.`);
  }

  return session;
}

export async function sendChromiumCommand<T = unknown>(
  sessionId: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const session = requireSession(sessionId);
  const id = session.nextId;
  session.nextId += 1;

  const result = await new Promise<T>((resolve, reject) => {
    session.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    session.socket.send(JSON.stringify({ id, method, params }));
  });

  return result;
}

export async function evaluateChromiumJson<T>(sessionId: string, expression: string): Promise<T> {
  const result = await sendChromiumCommand<{
    result: {
      value?: T;
      description?: string;
    };
    exceptionDetails?: { text?: string };
  }>(sessionId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Chromium evaluation failed.");
  }

  if (!("result" in result) || typeof result.result === "undefined") {
    throw new Error("Chromium evaluation returned no result.");
  }

  return result.result.value as T;
}
