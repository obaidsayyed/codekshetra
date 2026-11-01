import { screen } from "electron";
import type { DisplayInfo } from "../src/shared/ipc";

/** Snapshot of all displays in DIP, using each display's *work area* (taskbar excluded). */
export function getDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
    workArea: { x: d.workArea.x, y: d.workArea.y, width: d.workArea.width, height: d.workArea.height },
    scaleFactor: d.scaleFactor,
  }));
}

export function getPrimaryDisplay(): DisplayInfo {
  const p = screen.getPrimaryDisplay();
  return {
    id: p.id,
    bounds: { ...p.bounds },
    workArea: { ...p.workArea },
    scaleFactor: p.scaleFactor,
  };
}

/** Calls `fn` whenever displays are added, removed, moved or resized. */
export function watchDisplays(fn: () => void): () => void {
  let t: NodeJS.Timeout | null = null;
  const debounced = () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, 150);
  };
  screen.on("display-added", debounced);
  screen.on("display-removed", debounced);
  screen.on("display-metrics-changed", debounced);
  return () => {
    screen.off("display-added", debounced);
    screen.off("display-removed", debounced);
    screen.off("display-metrics-changed", debounced);
    if (t) clearTimeout(t);
  };
}
