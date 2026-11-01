import type { SundayBridge } from "../shared/ipc";
import { DEFAULT_SETTINGS, patchSettings, type PetSettings } from "../shared/settings";

declare global {
  interface Window {
    sunday?: SundayBridge;
  }
}

/** The preload bridge when running inside Electron, otherwise null (browser dev mode). */
export function getBridge(): SundayBridge | null {
  return typeof window !== "undefined" && window.sunday?.isElectron ? window.sunday : null;
}

export const isElectron = (): boolean => getBridge() !== null;

// ---------------------------------------------------------------------------
// Settings access that also works in a plain browser (studio:web).
// ---------------------------------------------------------------------------

const LOCAL_KEY = "sunday.settings.web";
let localSettings: PetSettings | null = null;
const localListeners = new Set<(s: PetSettings) => void>();

function readLocal(): PetSettings {
  if (localSettings) return localSettings;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    localSettings = raw ? patchSettings(DEFAULT_SETTINGS, JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    localSettings = DEFAULT_SETTINGS;
  }
  return localSettings;
}

export async function loadSettings(): Promise<PetSettings> {
  const bridge = getBridge();
  if (bridge) return bridge.getSettings();
  return readLocal();
}

export async function saveSettings(patch: Partial<PetSettings>): Promise<PetSettings> {
  const bridge = getBridge();
  if (bridge) return bridge.updateSettings(patch);
  localSettings = patchSettings(readLocal(), patch);
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(localSettings));
  } catch {
    /* storage unavailable: keep in memory */
  }
  for (const l of localListeners) l(localSettings);
  return localSettings;
}

export function subscribeSettings(cb: (s: PetSettings) => void): () => void {
  const bridge = getBridge();
  if (bridge) return bridge.onSettingsChanged(cb);
  localListeners.add(cb);
  return () => localListeners.delete(cb);
}
