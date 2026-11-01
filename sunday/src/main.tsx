import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, currentView } from "./App";
import "./styles/base.css";
import "./styles/pet.css";
import "./styles/studio.css";
import "./styles/panel.css";

const view = currentView();
document.documentElement.dataset.view = view;
window.addEventListener("hashchange", () => window.location.reload());
window.addEventListener("popstate", () => window.location.reload());

// PWA Service Worker Registration (Zero browser notification prompts)
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const isElectron = Boolean((window as any).sunday?.isElectron);
  if (!isElectron) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App view={view} />
  </StrictMode>,
);
