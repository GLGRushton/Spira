import { type Env, SUBAGENT_DOMAINS, type SubagentDomain } from "@spira/shared";
import type { McpToolAggregator } from "../mcp/tool-aggregator.js";
import type {
  ProviderCapabilities,
  ProviderId,
  ProviderPermissionRequest,
  ProviderPermissionResult,
  ProviderSessionConfig,
  ProviderSessionEvent,
  ProviderSystemMessageSection,
} from "../provider/types.js";
import { getProviderToolManifest } from "../runtime/capability-registry.js";
import { appRootDir } from "../util/app-paths.js";
import type { ToolBridgeOptions } from "../runtime/tool-bridge.js";

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

const BACKGROUND_AGENT_MODEL_WARNING = [
  "Background agent tooling may accept a requested model ID, but the host runtime can still fall back to its default model.",
  "Do not claim a specific background-agent model actually ran unless a returned tool result explicitly confirms it.",
  "Until then, describe the model as requested or unconfirmed rather than as executed fact.",
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
      "- When exact model selection matters for delegated work, prefer the matching delegate_to_* tool over built-in task/background agents.",
      "- Use read_subagent or list_subagents to inspect delegated runtime metadata, including the observed model, instead of relying on read_agent.",
      ...(activeDelegationDomains.some((domain) => domain.id === "windows")
        ? [
            "If the user asks whether you can inspect the screen or active window, answer yes and use delegate_to_windows.",
          ]
        : []),
      ...(activeDelegationDomains.some((domain) => domain.id === "code-review")
        ? [
            "When exact model selection matters for repository review or analysis, prefer delegate_to_code_review over built-in task/background agents.",
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
  toolBridgeOptions: Pick<ToolBridgeOptions, "requestUpgradeProposal">,
): string => {
  if (!toolBridgeOptions.requestUpgradeProposal) {
    return "";
  }

  return "If you modify local Spira code or configuration and need the app to apply those changes, use the spira_propose_upgrade tool with the changed file paths instead of guessing the restart scope yourself.";
};

export const createSessionConfig = (options: {
  env: Env;
  toolAggregator: McpToolAggregator;
  toolBridgeOptions: ToolBridgeOptions;
  onEvent: (event: ProviderSessionEvent) => void;
  onPermissionRequest: (request: ProviderPermissionRequest) => Promise<ProviderPermissionResult>;
  model?: string | null;
  additionalInstructions?: string | null;
  workingDirectory?: string | null;
  streaming?: boolean;
  providerId?: ProviderId;
  providerCapabilities?: ProviderCapabilities;
  runtimeRecoverySection?: ProviderSystemMessageSection | null;
}): Omit<ProviderSessionConfig, "sessionId"> => {
  const toolAwarenessInstructions = getToolAwarenessInstructions(
    options.env,
    options.toolAggregator,
    options.toolBridgeOptions.delegationDomains ?? [],
  );
  const upgradeToolInstructions = getUpgradeToolInstructions(options.toolBridgeOptions);

  return {
    clientName: "Spira",
    ...(options.model?.trim() ? { model: options.model.trim() } : {}),
    infiniteSessions: {
      enabled: true,
    },
    onEvent: options.onEvent,
    onPermissionRequest: options.onPermissionRequest,
    streaming: options.streaming ?? true,
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
            BACKGROUND_AGENT_MODEL_WARNING,
            upgradeToolInstructions,
            toolAwarenessInstructions,
            options.additionalInstructions?.trim() ?? "",
          ]
            .filter((section) => section.length > 0)
            .join("\n\n"),
        },
        ...(options.runtimeRecoverySection ? { runtime_recovery: options.runtimeRecoverySection } : {}),
        last_instructions: {
          action: "append",
          content: SHINRA_LAST_INSTRUCTIONS,
        },
      },
      content: SHINRA_PERSONA_INSTRUCTIONS,
    },
    workingDirectory: options.workingDirectory?.trim() || appRootDir,
    tools: getProviderToolManifest({
      aggregator: options.toolAggregator,
      options: options.toolBridgeOptions,
      providerId: options.providerId,
      capabilities: options.providerCapabilities,
    }).tools,
  };
};
