import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SPIRA_UI_CONTROL_BRIDGE_VERSION,
  type SpiraUiBridgeCommand,
  type SpiraUiBridgeDiscovery,
  type SpiraUiBridgeRequest,
  type SpiraUiBridgeResponse,
  type SpiraUiBridgeResult,
} from "@spira/shared";
import WebSocket from "ws";

const resolveDiscoveryPath = (): string =>
  path.join(
    process.env.SPIRA_UI_CONTROL_DIR ?? process.env.LOCALAPPDATA ?? os.tmpdir(),
    "Spira",
    "spira-ui-control.json",
  );

const loadDiscovery = async (): Promise<SpiraUiBridgeDiscovery> => {
  const raw = await readFile(resolveDiscoveryPath(), "utf8");
  const discovery = JSON.parse(raw) as SpiraUiBridgeDiscovery;
  if (discovery.version !== SPIRA_UI_CONTROL_BRIDGE_VERSION) {
    throw new Error(
      `Spira UI bridge version mismatch. Expected ${SPIRA_UI_CONTROL_BRIDGE_VERSION}, received ${discovery.version}.`,
    );
  }
  return discovery;
};

export const callSpiraUiBridge = async (command: SpiraUiBridgeCommand): Promise<SpiraUiBridgeResult> => {
  const discovery = await loadDiscovery();
  const requestId = randomUUID();
  const timeoutMs = command.kind === "wait-for" ? (command.timeoutMs ?? 10_000) + 5_000 : 25_000;
  const request: SpiraUiBridgeRequest = {
    ...command,
    requestId,
    token: discovery.token,
  };

  const socket = new WebSocket(`ws://127.0.0.1:${discovery.port}`);
  return await new Promise<SpiraUiBridgeResult>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      finish(() => reject(new Error(`Spira UI control bridge request timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
      callback();
    };

    socket.once("open", () => {
      socket.send(JSON.stringify(request));
    });

    socket.on("message", (raw) => {
      let response: SpiraUiBridgeResponse;
      try {
        response = JSON.parse(raw.toString()) as SpiraUiBridgeResponse;
      } catch (error) {
        finish(() => reject(error));
        return;
      }

      if (response.requestId !== requestId) {
        return;
      }

      if (!response.ok) {
        finish(() =>
          reject(
            new Error(
              response.error.details ? `${response.error.message} ${response.error.details}` : response.error.message,
            ),
          ),
        );
        return;
      }

      finish(() => resolve(response.data));
    });

    socket.once("error", (error) => {
      finish(() => reject(error));
    });

    socket.once("close", () => {
      if (!settled) {
        finish(() => reject(new Error("Spira UI control bridge closed before returning a response.")));
      }
    });
  });
};
