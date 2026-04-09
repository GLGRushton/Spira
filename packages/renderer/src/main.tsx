import { createRoot } from "react-dom/client";
import { installSpiraUiControlRuntime } from "./automation/control-runtime.js";
import "./global.css";
import { AppShell } from "./components/AppShell.js";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

installSpiraUiControlRuntime();
createRoot(root).render(<AppShell />);
