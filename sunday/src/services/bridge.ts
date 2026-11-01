import type { SundayBridge, PanelMessage, PetCommand, AppInfo, PetEnvironment, Anchor, DragUpdate } from "../shared/ipc";
import { DEFAULT_SETTINGS, patchSettings, type PetSettings } from "../shared/settings";

declare global {
  interface Window {
    sunday?: SundayBridge;
    __SUNDAY_BACKEND_URL__?: string;
  }
}

export const isElectron = (): boolean =>
  typeof window !== "undefined" && Boolean(window.sunday?.isElectron);

// ---------------------------------------------------------------------------
// Settings access that also works in a plain browser (studio:web / PWA).
// ---------------------------------------------------------------------------

const LOCAL_KEY = "sunday.settings.web";
const MESSAGES_KEY = "sunday.messages.web";

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
  if (isElectron() && window.sunday) return window.sunday.getSettings();
  return readLocal();
}

export async function saveSettings(patch: Partial<PetSettings>): Promise<PetSettings> {
  if (isElectron() && window.sunday) return window.sunday.updateSettings(patch);
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
  if (isElectron() && window.sunday) return window.sunday.onSettingsChanged(cb);
  localListeners.add(cb);
  return () => localListeners.delete(cb);
}

// ---------------------------------------------------------------------------
// WebBridge: Full browser/PWA compatibility bridge connected to /api/*
// ---------------------------------------------------------------------------

export const getApiUrl = (path: string): string => {
  const base = (
    (typeof window !== "undefined" && window.__SUNDAY_BACKEND_URL__) ||
    (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_BACKEND_URL) ||
    ""
  ).replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
};

class WebBridgeImpl implements SundayBridge {
  readonly isElectron = true as const; // Satisfies SundayBridge interface type
  private petCommandListeners = new Set<(cmd: PetCommand) => void>();
  private petStateListeners = new Set<(state: string) => void>();
  private panelListeners = new Set<(msg: PanelMessage) => void>();
  private voiceMuteListeners = new Set<(muted: boolean) => void>();
  private isVoiceMuted = false;
  private lastEventId = 0;
  private pollingActive = false;
  private pollTimer: number | null = null;

  constructor() {
    this.startEventPolling();
  }

  async getAppInfo(): Promise<AppInfo> {
    let connected = true;
    try {
      const res = await fetch(getApiUrl("/api/status"), { method: "GET" });
      if (!res.ok) connected = false;
    } catch {
      // In web demo mode without live backend, allow chat and interaction gracefully
      connected = true;
    }
    return {
      version: "1.0.0",
      platform: "web",
      packaged: true,
      startWithWindowsSupported: false,
      integrationConnected: connected,
    };
  }

  async getSettings(): Promise<PetSettings> {
    return readLocal();
  }

  async updateSettings(patch: Partial<PetSettings>): Promise<PetSettings> {
    return saveSettings(patch);
  }

  onSettingsChanged(cb: (settings: PetSettings) => void): () => void {
    return subscribeSettings(cb);
  }

  pet = {
    getEnvironment: async (): Promise<PetEnvironment> => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1280;
      const h = typeof window !== "undefined" ? window.innerHeight : 720;
      return {
        displays: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: w, height: h },
            workArea: { x: 0, y: 0, width: w, height: h },
            scaleFactor: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
          },
        ],
        anchor: { x: Math.round(w / 2), y: Math.round(h * 0.75) },
        windowSize: { width: 300, height: 340 },
      };
    },
    onEnvironment: (cb: (env: PetEnvironment) => void): (() => void) => {
      void this.pet.getEnvironment().then(cb);
      const onResize = () => void this.pet.getEnvironment().then(cb);
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    },
    moveTo: (_anchor: Anchor): void => {},
    setInteractive: (_interactive: boolean): void => {},
    setExtraHeight: (_px: number): void => {},
    startDrag: (): void => {},
    endDrag: (): void => {},
    onDragMove: (_cb: (update: DragUpdate) => void): (() => void) => () => {},
    onDragEnded: (_cb: (anchor: Anchor) => void): (() => void) => () => {},
    onVisibility: (_cb: (visible: boolean) => void): (() => void) => () => {},
    onCommand: (cb: (cmd: PetCommand) => void): (() => void) => {
      this.petCommandListeners.add(cb);
      return () => this.petCommandListeners.delete(cb);
    },
    reportState: (state: string): void => {
      for (const cb of this.petStateListeners) cb(state);
    },
  };

  onPetStateChanged(cb: (state: string) => void): () => void {
    this.petStateListeners.add(cb);
    return () => this.petStateListeners.delete(cb);
  }

  openWindow(name: "panel" | "studio" | "settings"): void {
    if (typeof window === "undefined") return;
    if (name === "panel") {
      window.location.hash = "panel";
    } else if (name === "studio") {
      window.location.hash = "studio";
    } else if (name === "settings") {
      window.location.hash = "settings";
    }
  }

  hidePet(): void {}
  quit(): void {
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.pollingActive = false;
  }
  minimizeWindow(): void {}
  closeWindow(): void {}

  sendPetCommand(cmd: PetCommand): void {
    for (const cb of this.petCommandListeners) cb(cmd);
  }

  private loadHistory(): PanelMessage[] {
    try {
      const raw = window.localStorage.getItem(MESSAGES_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* ignore */
    }
    const seed: PanelMessage[] = [
      {
        id: "seed-welcome",
        role: "sunday",
        text: "Hello! I am SUNDAY, your autonomous AI companion. Say 'Sunday' to wake me or speak any command.",
        timestamp: Date.now(),
        status: "delivered",
      },
    ];
    return seed;
  }

  private saveHistory(msgs: PanelMessage[]): void {
    try {
      window.localStorage.setItem(MESSAGES_KEY, JSON.stringify(msgs.slice(-100)));
    } catch {
      /* ignore */
    }
  }

  panel = {
    getHistory: async (): Promise<PanelMessage[]> => {
      return this.loadHistory();
    },
    onMessage: (cb: (msg: PanelMessage) => void): (() => void) => {
      this.panelListeners.add(cb);
      return () => this.panelListeners.delete(cb);
    },
    sendUserMessage: async (text: string): Promise<{ delivered: boolean }> => {
      const clean = text.trim();
      if (!clean) return { delivered: false };

      const userMsg: PanelMessage = {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "user",
        text: clean,
        timestamp: Date.now(),
        status: "delivered",
      };

      const history = this.loadHistory();
      history.push(userMsg);
      this.saveHistory(history);
      for (const cb of this.panelListeners) cb(userMsg);

      // Indicate thinking on 3D character
      this.sendPetCommand({ type: "setState", state: "thinking" });
      this.sendPetCommand({ type: "setSpeech", text: "Thinking..." });

      try {
        const res = await fetch(getApiUrl("/api/message"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });

        if (res.ok) {
          const data = await res.json();
          let spoken =
            data.spoken_message ||
            data.spoken_prompt ||
            (data.success ? "Task completed successfully." : data.error || "Done.");

          // Execute client-side actions in deployment (open URLs, open YouTube, download documents)
          if (Array.isArray(data.results)) {
            for (const r of data.results) {
              const d = r?.data;
              if (d) {
                if (d.action === "open_url" && (d.url || d.target)) {
                  const targetUrl = d.url || d.target;
                  try {
                    window.open(targetUrl, "_blank", "noopener,noreferrer");
                  } catch {
                    /* popup blocked */
                  }
                  const label = d.app || d.query || "App";
                  spoken += `\n\n[▶️ Open ${label}](${targetUrl})`;
                } else if (d.action === "open_document" && d.download_url) {
                  const fullUrl = getApiUrl(d.download_url);
                  try {
                    window.open(fullUrl, "_blank");
                  } catch {
                    /* popup blocked */
                  }
                  spoken += `\n\n[📄 Download & View ${d.filename || "Document"}](${fullUrl})`;
                }
              }
            }
          }

          const botMsg: PanelMessage = {
            id: `sunday-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            role: data.status === "waiting_for_owner" ? "system" : "sunday",
            text: spoken,
            timestamp: Date.now(),
            status: "delivered",
          };

          history.push(botMsg);
          this.saveHistory(history);
          for (const cb of this.panelListeners) cb(botMsg);

          // Update 3D Character
          const state = data.success ? "celebrating" : data.status === "waiting_for_owner" ? "idle" : "error";
          this.sendPetCommand({ type: "setState", state });
          this.sendPetCommand({ type: "setSpeech", text: spoken });

          return { delivered: true };
        }
      } catch (err) {
        // Fallback for offline / demo mode
        const errorMsg: PanelMessage = {
          id: `sunday-err-${Date.now()}`,
          role: "system",
          text: `Backend connection pending. I recorded: "${clean}".`,
          timestamp: Date.now(),
          status: "delivered",
        };
        history.push(errorMsg);
        this.saveHistory(history);
        for (const cb of this.panelListeners) cb(errorMsg);
        this.sendPetCommand({ type: "setState", state: "idle" });
      }

      return { delivered: true };
    },
  };

  voice = {
    setMute: async (muted?: boolean): Promise<{ success: boolean; muted: boolean }> => {
      this.isVoiceMuted = typeof muted === "boolean" ? muted : !this.isVoiceMuted;
      for (const cb of this.voiceMuteListeners) cb(this.isVoiceMuted);
      try {
        await fetch(getApiUrl("/api/message"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: this.isVoiceMuted ? "mute" : "unmute" }),
        });
      } catch {
        /* offline */
      }
      return { success: true, muted: this.isVoiceMuted };
    },
    getMute: async (): Promise<boolean> => {
      return this.isVoiceMuted;
    },
    onMuteChanged: (cb: (muted: boolean) => void): (() => void) => {
      this.voiceMuteListeners.add(cb);
      return () => this.voiceMuteListeners.delete(cb);
    },
  };

  private startEventPolling(): void {
    if (typeof window === "undefined" || this.pollingActive) return;
    this.pollingActive = true;

    const poll = async () => {
      try {
        const res = await fetch(getApiUrl(`/api/events?since=${this.lastEventId}`), {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          const events: any[] = data.events || [];
          for (const evt of events) {
            if (evt.id > this.lastEventId) this.lastEventId = evt.id;

            if (evt.type === "state_change") {
              if (evt.state) this.sendPetCommand({ type: "setState", state: evt.state });
              if (evt.speech) {
                this.sendPetCommand({ type: "setSpeech", text: evt.speech });
              }
            } else if (evt.type === "chat_message") {
              const msg: PanelMessage = {
                id: String(evt.id),
                role: evt.role || "sunday",
                text: evt.text || "",
                timestamp: (evt.timestamp || Date.now() / 1000) * 1000,
                status: "delivered",
              };
              for (const cb of this.panelListeners) cb(msg);
            } else if (evt.type === "voice_mute_change") {
              this.isVoiceMuted = Boolean(evt.muted);
              for (const cb of this.voiceMuteListeners) cb(this.isVoiceMuted);
            }
          }
        }
      } catch {
        /* silent polling retry */
      }
      if (this.pollingActive) {
        this.pollTimer = window.setTimeout(poll, 1800);
      }
    };

    this.pollTimer = window.setTimeout(poll, 1000);
  }
}

let singletonWebBridge: SundayBridge | null = null;

function getWebBridge(): SundayBridge {
  if (!singletonWebBridge) {
    singletonWebBridge = new WebBridgeImpl();
  }
  return singletonWebBridge;
}

/** The bridge: returns Electron IPC when in Electron desktop app, or full WebBridge in browser/PWA. */
export function getBridge(): SundayBridge {
  if (typeof window !== "undefined" && window.sunday?.isElectron) {
    return window.sunday;
  }
  return getWebBridge();
}
