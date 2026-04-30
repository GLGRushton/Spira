import type { ConversationRecord, ConversationSummary, SpiraMemoryDatabase } from "@spira/memory-db";
import type {
  ClientMessage,
  ConversationSearchMatch,
  StationSummary,
  StoredConversation,
  StoredConversationSummary,
} from "@spira/shared";
import type { Logger } from "pino";
import { DEFAULT_STATION_ID, type StationRegistry } from "../copilot/station-registry.js";
import { SpiraError, toErrorPayload } from "../util/errors.js";

type TransportLike = {
  send(message: unknown): void;
};

type TtsPlaybackLike = {
  stop(): void;
};

type ChatRuntimeRouterDependencies = {
  stationRegistry: StationRegistry | null;
  memoryDb: SpiraMemoryDatabase | null;
  transport: TransportLike | null;
  ttsPlayback: TtsPlaybackLike | null;
  logger: Pick<Logger, "error">;
  mapStoredConversation: (conversation: ConversationRecord | null) => StoredConversation | null;
  mapStoredConversationSummary: (conversation: ConversationSummary) => StoredConversationSummary;
};

const sendStationCloseError = (transport: TransportLike | null, stationId: string): void => {
  transport?.send({
    type: "error",
    stationId,
    ...toErrorPayload(
      new Error(`Unable to close station ${stationId}.`),
      "STATION_CLOSE_FAILED",
      `Failed to close station ${stationId}`,
      "backend",
    ),
  });
};

const sendUnhandledChatError = (
  transport: TransportLike | null,
  stationId: string | undefined,
  error: unknown,
  message: string,
  source = "assistant",
): void => {
  transport?.send({
    type: "error",
    stationId,
    ...toErrorPayload(error, "UNKNOWN_ERROR", message, source),
  });
};

export const handleChatRuntimeMessage = async (
  message: ClientMessage,
  deps: ChatRuntimeRouterDependencies,
): Promise<boolean> => {
  const {
    stationRegistry,
    memoryDb,
    transport,
    ttsPlayback,
    logger,
    mapStoredConversation,
    mapStoredConversationSummary,
  } = deps;

  if (message.type === "station:create") {
    const station = stationRegistry?.createStation({ label: message.label });
    if (station) {
      transport?.send({ type: "station:created", station });
    }
    return true;
  }

  if (message.type === "station:close") {
    const closed = await stationRegistry?.closeStation(message.stationId);
    if (closed) {
      transport?.send({ type: "station:closed", stationId: message.stationId });
      return true;
    }

    sendStationCloseError(transport, message.stationId);
    return true;
  }

  if (message.type === "station:list") {
    transport?.send({
      type: "station:list:result",
      requestId: message.requestId,
      stations: stationRegistry?.listStations() ?? ([] satisfies StationSummary[]),
    });
    stationRegistry?.replayRecoveredStationIssues();
    stationRegistry?.replayManagedSubagentState();
    return true;
  }

  if (message.type === "conversation:recent:get") {
    transport?.send({
      type: "conversation:recent:result",
      requestId: message.requestId,
      conversation: mapStoredConversation(memoryDb?.getMostRecentConversation() ?? null),
    });
    return true;
  }

  if (message.type === "conversation:list") {
    const limit = typeof message.limit === "number" ? message.limit : 30;
    const offset = typeof message.offset === "number" ? message.offset : 0;
    transport?.send({
      type: "conversation:list:result",
      requestId: message.requestId,
      conversations: (memoryDb?.listConversations(limit, offset) ?? []).map(mapStoredConversationSummary),
    });
    return true;
  }

  if (message.type === "conversation:get") {
    transport?.send({
      type: "conversation:get:result",
      requestId: message.requestId,
      conversation: mapStoredConversation(memoryDb?.getConversation(message.conversationId) ?? null),
    });
    return true;
  }

  if (message.type === "conversation:search") {
    const limit = typeof message.limit === "number" ? message.limit : 20;
    const matches: ConversationSearchMatch[] = memoryDb?.searchConversationMessages(message.query, limit) ?? [];
    transport?.send({
      type: "conversation:search:result",
      requestId: message.requestId,
      matches,
    });
    return true;
  }

  if (message.type === "conversation:mark-viewed") {
    transport?.send({
      type: "conversation:mark-viewed:result",
      requestId: message.requestId,
      success: memoryDb?.markConversationViewed(message.conversationId) ?? false,
    });
    return true;
  }

  if (message.type === "conversation:archive") {
    transport?.send({
      type: "conversation:archive:result",
      requestId: message.requestId,
      success: memoryDb?.archiveConversation(message.conversationId) ?? false,
    });
    return true;
  }

  if (message.type === "chat:send") {
    try {
      await stationRegistry?.sendMessage(message.text, {
        stationId: message.stationId,
        conversationId: message.conversationId,
      });
    } catch (error) {
      logger.error(
        { err: error, messageType: message.type, textLength: message.text.length },
        "Assistant chat request failed",
      );
      const alreadyReported =
        error instanceof SpiraError && (error as { reportedToClient?: boolean }).reportedToClient === true;

      if (!alreadyReported) {
        sendUnhandledChatError(transport, message.stationId, error, "Failed to send message to Shinra");
      }
    }
    return true;
  }

  if (message.type === "chat:abort") {
    ttsPlayback?.stop();
    try {
      await stationRegistry?.abortStation(message.stationId);
      transport?.send({ type: "chat:abort-complete", stationId: message.stationId ?? DEFAULT_STATION_ID });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to abort chat response");
      sendUnhandledChatError(transport, message.stationId, error, "Failed to stop the current response");
    }
    return true;
  }

  if (message.type === "chat:reset") {
    ttsPlayback?.stop();
    try {
      await stationRegistry?.resetStation(message.stationId);
      transport?.send({ type: "chat:reset-complete", stationId: message.stationId ?? DEFAULT_STATION_ID });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to clear chat session");
      sendUnhandledChatError(transport, message.stationId, error, "Failed to clear chat session");
    }
    return true;
  }

  if (message.type === "chat:new-session") {
    ttsPlayback?.stop();
    try {
      const preservedToMemory =
        (await stationRegistry?.startNewSession(message.stationId, message.conversationId)) ?? false;
      transport?.send({
        type: "chat:new-session-complete",
        preservedToMemory,
        stationId: message.stationId ?? DEFAULT_STATION_ID,
      });
    } catch (error) {
      logger.error({ err: error, messageType: message.type }, "Failed to start a new chat session");
      sendUnhandledChatError(transport, message.stationId, error, "Failed to start a new chat session");
    }
    return true;
  }

  return false;
};
