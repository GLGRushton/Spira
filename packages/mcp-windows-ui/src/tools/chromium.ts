import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runPs } from "@spira/mcp-util/powershell";
import { errorResult, successResult } from "@spira/mcp-util/results";
import {
  attachChromiumSession,
  detachChromiumSession,
  evaluateChromiumJson,
  listChromiumSessions,
  listChromiumTargets,
} from "../util/chromium.js";
import {
  ChromiumActionSchema,
  ChromiumAttachSchema,
  ChromiumPortSchema,
  ChromiumQuerySchema,
  ChromiumSessionSchema,
  ChromiumSnapshotSchema,
  EmptySchema,
} from "../util/validation.js";

const chromiumString = (value: string): string => JSON.stringify(value);

export const registerChromiumTools = (server: McpServer): void => {
  server.registerTool(
    "ui_list_debuggable_processes",
    {
      description:
        "List Chromium or Electron processes that already expose a remote debugging port. This is the discovery step before attaching a Chromium session.",
      inputSchema: EmptySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      try {
        const { stdout } = await runPs(
          `
$processes = @(
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match '--remote-debugging-port=(\\d+)' } |
    ForEach-Object {
      $portMatch = [regex]::Match($_.CommandLine, '--remote-debugging-port=(\\d+)')
      [PSCustomObject]@{
        processName = $_.Name
        pid = $_.ProcessId
        port = [int]$portMatch.Groups[1].Value
        commandLine = $_.CommandLine
      }
    }
)
if ($processes.Count -eq 0) {
  "[]"
} else {
  @($processes) | ConvertTo-Json -Depth 4 -Compress
}
`,
          20_000,
        );

        const processes = JSON.parse(stdout) as
          | Array<{
              processName: string;
              pid: number;
              port: number;
              commandLine: string;
            }>
          | {
              processName: string;
              pid: number;
              port: number;
              commandLine: string;
            };
        const normalized = Array.isArray(processes) ? processes : processes ? [processes] : [];
        return successResult(
          { processes: normalized, sessions: listChromiumSessions() },
          `Found ${normalized.length} debuggable Chromium/Electron process${normalized.length === 1 ? "" : "es"}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to inspect Chromium debug processes.");
      }
    },
  );

  server.registerTool(
    "ui_list_chromium_targets",
    {
      description: "List Chromium or Electron debug targets on a specific remote debugging port.",
      inputSchema: ChromiumPortSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
    },
    async ({ host, port }) => {
      try {
        const targets = await listChromiumTargets(host, port);
        return successResult(
          { host, port, targets },
          `Found ${targets.length} Chromium target${targets.length === 1 ? "" : "s"} on ${host}:${port}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to list Chromium targets.");
      }
    },
  );

  server.registerTool(
    "ui_attach_chromium_target",
    {
      description:
        "Attach to a Chromium or Electron debug target. Follow-up Chromium tools require the returned sessionId.",
      inputSchema: ChromiumAttachSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ host, port, targetId, titleIncludes, urlIncludes }) => {
      try {
        const session = await attachChromiumSession({ host, port, targetId, titleIncludes, urlIncludes });
        return successResult(
          { ...session, sessions: listChromiumSessions() },
          `Attached Chromium session ${session.sessionId} to "${session.target.title}" on ${host}:${port}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to attach Chromium debug session.");
      }
    },
  );

  server.registerTool(
    "ui_detach_chromium_session",
    {
      description: "Close a previously attached Chromium or Electron debug session.",
      inputSchema: ChromiumSessionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ sessionId }) => {
      try {
        await detachChromiumSession(sessionId);
        return successResult(
          { sessionId, sessions: listChromiumSessions() },
          `Detached Chromium session ${sessionId}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to detach Chromium debug session.");
      }
    },
  );

  server.registerTool(
    "ui_chromium_snapshot",
    {
      description:
        "Read the current Chromium or Electron page snapshot for an attached session, including title, URL, text, and HTML excerpts.",
      inputSchema: ChromiumSnapshotSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ sessionId, maxTextLength, maxHtmlLength }) => {
      try {
        const snapshot = await evaluateChromiumJson<{
          title: string;
          url: string;
          readyState: string;
          viewport: { width: number; height: number };
          text: string;
          html: string;
        }>(
          sessionId,
          `(() => {
            const body = document.body;
            const text = body?.innerText ?? "";
            const html = body?.innerHTML ?? "";
            return {
              title: document.title,
              url: window.location.href,
              readyState: document.readyState,
              viewport: { width: window.innerWidth, height: window.innerHeight },
              text: text.slice(0, ${maxTextLength}),
              html: html.slice(0, ${maxHtmlLength})
            };
          })()`,
        );

        return successResult(snapshot, `Read Chromium snapshot for "${snapshot.title}".`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to read the Chromium snapshot.");
      }
    },
  );

  server.registerTool(
    "ui_chromium_query",
    {
      description:
        "Query a Chromium or Electron page with a CSS selector and return DOM summaries for the matched elements.",
      inputSchema: ChromiumQuerySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ sessionId, selector, limit }) => {
      try {
        const matches = await evaluateChromiumJson<
          Array<{
            index: number;
            tagName: string;
            id: string;
            classes: string[];
            text: string;
            value?: string;
            href?: string;
            bounds: { x: number; y: number; width: number; height: number };
          }>
        >(
          sessionId,
          `(() => Array.from(document.querySelectorAll(${chromiumString(selector)}))
            .slice(0, ${limit})
            .map((node, index) => {
              const rect = node.getBoundingClientRect();
              const value = "value" in node ? String(node.value ?? "") : undefined;
              const href = node instanceof HTMLAnchorElement ? node.href : undefined;
              return {
                index,
                tagName: node.tagName.toLowerCase(),
                id: node.id || "",
                classes: Array.from(node.classList ?? []),
                text: (node.innerText ?? node.textContent ?? "").trim().slice(0, 500),
                value,
                href,
                bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
              };
            }))()`,
        );

        return successResult(
          { selector, matches },
          `Found ${matches.length} Chromium node${matches.length === 1 ? "" : "s"} for selector ${selector}.`,
        );
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to query the Chromium page.");
      }
    },
  );

  server.registerTool(
    "ui_chromium_act",
    {
      description:
        "Act on a Chromium or Electron page element with a CSS selector. For typing, provide text; for click or focus, the selector alone is enough.",
      inputSchema: ChromiumActionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    async ({ sessionId, selector, action, text }) => {
      try {
        const result = await evaluateChromiumJson<{ ok: boolean; message: string; value?: string }>(
          sessionId,
          `(() => {
            const element = document.querySelector(${chromiumString(selector)});
            if (!element) {
              return { ok: false, message: "No element matched the selector." };
            }

            switch (${chromiumString(action)}) {
              case "focus":
                element.focus();
                return { ok: true, message: "Focused element." };
              case "click":
                element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
                if (typeof element.click === "function") {
                  element.click();
                }
                return { ok: true, message: "Clicked element." };
              case "type": {
                const nextValue = ${chromiumString(text ?? "")};
                if (!("value" in element)) {
                  return { ok: false, message: "Element does not expose a value property." };
                }

                element.focus();
                element.value = nextValue;
                element.dispatchEvent(new Event("input", { bubbles: true }));
                element.dispatchEvent(new Event("change", { bubbles: true }));
                return { ok: true, message: "Updated element value.", value: String(element.value ?? "") };
              }
              default:
                return { ok: false, message: "Unsupported Chromium action." };
            }
          })()`,
        );

        if (!result.ok) {
          return errorResult(result.message);
        }

        return successResult({ selector, action, ...result }, `${result.message} Selector: ${selector}.`);
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : "Failed to execute the Chromium page action.");
      }
    },
  );
};
