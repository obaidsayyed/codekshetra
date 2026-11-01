import { lazy, Suspense } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";

const SundayPet = lazy(() => import("./components/SundayPet").then((m) => ({ default: m.SundayPet })));
const AnimationStudio = lazy(() => import("./components/AnimationStudio").then((m) => ({ default: m.AnimationStudio })));
const InteractionPanel = lazy(() => import("./components/InteractionPanel").then((m) => ({ default: m.InteractionPanel })));
const PetSettings = lazy(() => import("./components/PetSettings").then((m) => ({ default: m.PetSettings })));

export type View = "pet" | "studio" | "panel" | "settings";

export function currentView(): View {
  const hash = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  const path = window.location.pathname.replace(/^\//, "").toLowerCase().split("/")[0];

  // Route /talk, /chat, /panel to the Sunday conversation / voice companion
  if (path === "talk" || path === "chat" || path === "panel" || hash === "panel") return "panel";
  if (path === "pet" || hash === "pet") return "pet";
  if (path === "settings" || hash === "settings") return "settings";
  if (path === "studio" || hash === "studio") return "studio";

  // Default app is the Animation Studio of Sunday as requested
  return "studio";
}

/** Renders requested view with custom error boundary and seamless PWA routing. */
export function App({ view }: { view: View }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        {view === "pet" && <SundayPet />}
        {view === "studio" && <AnimationStudio />}
        {view === "panel" && <InteractionPanel />}
        {view === "settings" && <PetSettings />}
      </Suspense>
    </ErrorBoundary>
  );
}
