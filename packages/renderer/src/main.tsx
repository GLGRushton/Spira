import { createRoot } from "react-dom/client";
import "./global.css";
import { AppShell } from "./components/AppShell.js";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(<AppShell />);
