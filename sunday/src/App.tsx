import { lazy, Suspense, useEffect, useState } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PwaInstallBanner } from "./components/PwaInstallBanner";

const SundayPet = lazy(() => import("./components/SundayPet").then((m) => ({ default: m.SundayPet })));
const AnimationStudio = lazy(() => import("./components/AnimationStudio").then((m) => ({ default: m.AnimationStudio })));
const InteractionPanel = lazy(() => import("./components/InteractionPanel").then((m) => ({ default: m.InteractionPanel })));
const PetSettings = lazy(() => import("./components/PetSettings").then((m) => ({ default: m.PetSettings })));

export type View = "pet" | "studio" | "panel" | "settings";

export function currentView(): View {
  if (typeof window === "undefined") return "studio";
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

/** Renders requested view with custom error boundary, PWA banner, and seamless routing. */
export function App({ view: initialView }: { view?: View }) {
  const [activeView, setActiveView] = useState<View>(initialView || currentView());

  useEffect(() => {
    const handleRouteChange = () => {
      const v = currentView();
      setActiveView(v);
      document.documentElement.dataset.view = v;
    };

    window.addEventListener("hashchange", handleRouteChange);
    window.addEventListener("popstate", handleRouteChange);

    return () => {
      window.removeEventListener("hashchange", handleRouteChange);
      window.removeEventListener("popstate", handleRouteChange);
    };
  }, []);

  return (
    <ErrorBoundary>
      <PwaInstallBanner />
      <Suspense fallback={null}>
        {activeView === "pet" && <SundayPet />}
        {activeView === "studio" && <AnimationStudio />}
        {activeView === "panel" && <InteractionPanel />}
        {activeView === "settings" && <PetSettings />}
      </Suspense>
    </ErrorBoundary>
  );
}
