import type { CopilotSession } from "@github/copilot-sdk";
import { createLogger } from "../util/logger.js";

const logger = createLogger("tool-bridge");

export function registerTools(_session: CopilotSession): void {
  logger.info("Tool bridge initialized — MCP tools will be registered in Phase 4");
}
