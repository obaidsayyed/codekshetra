import { lazy, Suspense } from "react";

const SundayPet = lazy(() => import("./components/SundayPet").then((m) => ({ default: m.SundayPet })));
const AnimationStudio = lazy(() => import("./components/AnimationStudio").then((m) => ({ default: m.AnimationStudio })));
const InteractionPanel = lazy(() => import("./components/InteractionPanel").then((m) => ({ default: m.InteractionPanel })));
const PetSettings = lazy(() => import("./components/PetSettings").then((m) => ({ default: m.PetSettings })));

export type View = "pet" | "studio" | "panel" | "settings";

export function currentView(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h === "pet" || h === "panel" || h === "settings" || h === "studio") return h;
  return "studio";
}

/** Each Electron window loads the same bundle and picks its view from the URL hash. */
export function App({ view }: { view: View }) {
  return (
    <Suspense fallback={null}>
      {view === "pet" && <SundayPet />}
      {view === "studio" && <AnimationStudio />}
      {view === "panel" && <InteractionPanel />}
      {view === "settings" && <PetSettings />}
    </Suspense>
  );
}
