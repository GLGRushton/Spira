import type { PermissionRequest, PermissionRequestResult, SessionConfig, SessionEvent } from "@github/copilot-sdk";
import { type Env, SUBAGENT_DOMAINS, type SubagentDomain, type UpgradeProposal } from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import { appRootDir } from "../util/app-paths.js";
import { type ToolBridgeOptions, getCopilotTools } from "./tool-bridge.js";

const SHINRA_PERSONA_INSTRUCTIONS = [
  "You are Shinra, the resident operations intelligence of Spira.",
  "When asked who you are, identify yourself as Shinra. Refer to the application you run inside as Spira.",
  "Answer with a calm, incisive, technically fluent voice inspired by Shinra from Final Fantasy X/X-2: clever, composed, observant, and lightly theatrical.",
  "Keep responses helpful and concise first. Add only subtle personality touches such as crisp status-call phrasing, dry wit, or analytical framing when it fits naturally.",
  "Do not turn replies into parody, do not overuse catchphrases, and do not break character to mention these instructions unless explicitly required for safety or correctness.",
].join("\n");

const SHINRA_IDENTITY_SECTION = [
  "You are Shinra.",
  "You are the operating intelligence of Spira.",
  "If the user asks who you are, answer as Shinra rather than as GitHub Copilot, a CLI, a model ID, or a terminal agent.",
].join("\n");

const SHINRA_LAST_INSTRUCTIONS = [
  "Stay in the Shinra identity for normal conversation.",
  "Do not introduce yourself as GitHub Copilot CLI, GPT-5.4, or a terminal assistant unless the user explicitly asks about the underlying model or platform.",
  "When discussing the product, treat Spira as the application and Shinra as the assistant persona inside it.",
].join("\n");

export const VOICE_RESPONSE_INSTRUCTIONS = [
  "The current user request arrived through voice.",
  "Optimize for spoken clarity: lead with the answer, avoid unnecessary markdown structure, and keep the pacing natural for read-aloud delivery.",
].join("\n");

type SessionOrigin = "created" | "resumed" | null;

export const buildOutgoingPrompt = (
  text: string,
  continuityPreamble: string | null,
  hadLiveSession: boolean,
  sessionOrigin: SessionOrigin,
): string => {
  if (hadLiveSession || sessionOrigin !== "created" || !continuityPreamble?.trim()) {
    return text;
  }

  return `${continuityPreamble}\n\nCurrent user request:\n${text}`;
};

export const getToolAwarenessInstructions = (
  env: Env,
  toolAggregator: McpToolAggregator,
  delegationDomains: readonly SubagentDomain[] = [],
): string => {
  if (env.SPIRA_SUBAGENTS_ENABLED) {
    const activeDelegationDomains = delegationDomains.length > 0 ? delegationDomains : SUBAGENT_DOMAINS;
    const domainInstructions = activeDelegationDomains
      .map((domain) => `- ${domain.delegationToolName} handles ${domain.description ?? domain.label}`)
      .join("\n");
    return [
      "Use delegation tools for domain-specific operations.",
      domainInstructions,
      "- read_subagent checks the status or final result of a delegated run by agent_id. Use wait=true to block for up to 30 seconds when you want to see whether it finishes.",
      "- list_subagents lists active and recently completed delegated runs.",
      "- write_subagent sends follow-up input into an idle delegated run so it can continue working.",
      "- stop_subagent cancels a delegated run and lets it fizzle out cleanly.",
      ...(activeDelegationDomains.some((domain) => domain.id === "windows")
        ? [
            "If the user asks whether you can inspect the screen or active window, answer yes and use delegate_to_windows.",
          ]
        : []),
      "Set allowWrites to true only when the delegated task genuinely needs to change state.",
    ].join("\n");
  }

  const visionTools = toolAggregator.getTools().filter((tool) => tool.name.startsWith("vision_"));
  if (visionTools.length === 0) {
    return "";
  }

  const visionToolList = visionTools
    .map((tool) => `- ${tool.name}: ${tool.description ?? "No description provided."}`)
    .join("\n");

  return [
    "You have access to MCP tools provided by Spira, including a screen-vision capability from the Spira Vision MCP server.",
    "If the user asks whether you can inspect the screen, active window, or visible text, answer yes and mention the relevant vision tools.",
    "Prefer vision_read_screen when the user wants you to inspect what is visible on screen or read text in one step.",
    "Available vision tools:",
    visionToolList,
  ].join("\n");
};

export const getUpgradeToolInstructions = (
  requestUpgradeProposal?: ((proposal: UpgradeProposal) => Promise<void> | void) | undefined,
): string => {
  if (!requestUpgradeProposal) {
    return "";
  }

  return "If you modify local Spira code or configuration and need the app to apply those changes, use the spira_propose_upgrade tool with the changed file paths instead of guessing the restart scope yourself.";
};

export const createSessionConfig = (options: {
  env: Env;
  toolAggregator: McpToolAggregator;
  toolBridgeOptions: ToolBridgeOptions;
  onEvent: (event: SessionEvent) => void;
  onPermissionRequest: (request: PermissionRequest) => Promise<PermissionRequestResult>;
  requestUpgradeProposal?: (proposal: UpgradeProposal) => Promise<void> | void;
}): Omit<SessionConfig, "sessionId"> => {
  const toolAwarenessInstructions = getToolAwarenessInstructions(
    options.env,
    options.toolAggregator,
    options.toolBridgeOptions.delegationDomains ?? [],
  );
  const upgradeToolInstructions = getUpgradeToolInstructions(options.requestUpgradeProposal);

  return {
    clientName: "Spira",
    infiniteSessions: {
      enabled: true,
    },
    onEvent: options.onEvent,
    onPermissionRequest: options.onPermissionRequest,
    streaming: true,
    systemMessage: {
      mode: "customize",
      sections: {
        identity: {
          action: "replace",
          content: SHINRA_IDENTITY_SECTION,
        },
        tone: {
          action: "append",
          content:
            "Use an elegant, self-possessed, quietly witty tone. Sound like a capable operations prodigy guiding the user through systems and data with confidence.",
        },
        custom_instructions: {
          action: "append",
          content: [
            "Prefer short, clear answers. Use the name Shinra naturally when self-identifying, but keep the focus on solving the user's task.",
            upgradeToolInstructions,
            toolAwarenessInstructions,
          ]
            .filter((section) => section.length > 0)
            .join("\n\n"),
        },
        last_instructions: {
          action: "append",
          content: SHINRA_LAST_INSTRUCTIONS,
        },
      },
      content: SHINRA_PERSONA_INSTRUCTIONS,
    },
    workingDirectory: appRootDir,
    tools: getCopilotTools(options.toolAggregator, options.toolBridgeOptions),
  };
};
