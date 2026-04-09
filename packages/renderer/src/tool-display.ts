export const RECENT_COMPLETION_MS = 3_000;

const HIDDEN_TOOL_NAMES = new Set(["report_intent"]);
const OPERATING_TOOLS = new Set(["apply_patch", "powershell", "sql"]);
const RESEARCH_TOOLS = new Set(["list_agents", "read_agent", "task", "web_fetch", "web_search"]);
const INSPECT_PREFIXES = ["read_"];
const INSPECT_TOOLS = new Set(["glob", "rg", "view"]);

const formatSlug = (value: string): string =>
  value
    .split(/[-_]/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

export const shouldDisplayToolName = (toolName: string): boolean => !HIDDEN_TOOL_NAMES.has(toolName);

export const classifyToolName = (
  toolName: string,
): "inspect" | "operate" | "research" | "vision" | "system" | "unknown" => {
  if (!shouldDisplayToolName(toolName)) {
    return "unknown";
  }

  if (toolName.startsWith("vision_") || toolName.startsWith("ui_")) {
    return "vision";
  }

  if (toolName.startsWith("system_")) {
    return "system";
  }

  if (INSPECT_TOOLS.has(toolName) || INSPECT_PREFIXES.some((prefix) => toolName.startsWith(prefix))) {
    return "inspect";
  }

  if (OPERATING_TOOLS.has(toolName)) {
    return "operate";
  }

  if (RESEARCH_TOOLS.has(toolName)) {
    return "research";
  }

  return "unknown";
};

export const getToolTargetLabel = (roomId: string): string => {
  if (roomId === "settings") {
    return "Operations";
  }

  if (roomId === "bridge") {
    return "Bridge";
  }

  if (roomId.startsWith("mcp:")) {
    return `MCP · ${formatSlug(roomId.slice(4))}`;
  }

  if (roomId.startsWith("agent:")) {
    return "Agents";
  }

  return formatSlug(roomId);
};
