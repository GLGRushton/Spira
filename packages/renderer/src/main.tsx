import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { installSpiraUiControlRuntime } from "./automation/control-runtime.js";
import "./global.css";
import { AppShell } from "./components/AppShell.js";
import { RendererBootErrorBoundary } from "./components/RendererBootErrorBoundary.js";
import { createRendererFatalPayload } from "./renderer-fatal.js";

const root = document.getElementById("root");
let lastReportedFatalKey: string | null = null;

const reportRendererFatal = (
  error: unknown,
  phase: "bootstrap" | "runtime",
  options: { componentStack?: string; showBootFailure?: boolean } = {},
) => {
  const payload = createRendererFatalPayload(error, phase, options.componentStack);
  const dedupeKey = `${payload.phase}:${payload.title}:${payload.message}:${payload.details ?? ""}`;
  if (lastReportedFatalKey !== dedupeKey) {
    lastReportedFatalKey = dedupeKey;
    if (typeof window.electronAPI?.reportRendererFatal === "function") {
      window.electronAPI.reportRendererFatal(payload);
    }
  }

  if (options.showBootFailure ?? phase === "bootstrap") {
    window.__spiraRendererBoot?.showFailure(payload);
  }

  return payload;
};

window.addEventListener("error", (event) => {
  if (window.__spiraRendererBoot?.isReady()) {
    return;
  }
  reportRendererFatal(event.error ?? event.message, "bootstrap");
});

window.addEventListener("unhandledrejection", (event) => {
  if (window.__spiraRendererBoot?.isReady()) {
    return;
  }
  reportRendererFatal(event.reason, "bootstrap");
});

if (!root) {
  reportRendererFatal(new Error("Root element not found"), "bootstrap", { showBootFailure: true });
  throw new Error("Root element not found");
}

function RendererApp() {
  useEffect(() => {
    window.__spiraRendererBoot?.markReady();
  }, []);

  return <AppShell />;
}

try {
  installSpiraUiControlRuntime();
  createRoot(root).render(
    <RendererBootErrorBoundary
      onError={(error, errorInfo, fatal) => {
        reportRendererFatal(error, "runtime", {
          componentStack: errorInfo.componentStack ?? undefined,
          showBootFailure: false,
        });
        lastReportedFatalKey = `${fatal.phase}:${fatal.title}:${fatal.message}:${fatal.details ?? ""}`;
      }}
    >
      <RendererApp />
    </RendererBootErrorBoundary>,
  );
} catch (error) {
  reportRendererFatal(error, "bootstrap", { showBootFailure: true });
}
