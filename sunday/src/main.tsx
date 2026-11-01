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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App view={view} />
  </StrictMode>,
);
