/**
 * The IPC contract between the Electron main process and the renderer windows.
 * Every payload crossing the boundary is validated with the guards below —
 * in the main process for renderer→main traffic, in the renderer for main→renderer.
 */
import type { PetSettings } from "./settings";
import { isControllableState, type SundayState } from "./states";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: number;
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
}

/** The pet window is positioned by its "anchor": the point between Sunday's feet. */
export interface Anchor {
  x: number;
  y: number;
}

export interface PetEnvironment {
  displays: DisplayInfo[];
  anchor: Anchor;
  windowSize: { width: number; height: number };
}

export interface DragUpdate {
  anchor: Anchor;
  /** Cursor velocity in DIP per second, used for the dangling animation. */
  vx: number;
  vy: number;
}

export type AgentEventType = "status_changed" | "speech" | "task_completed" | "task_failed" | "user_attention";

export interface SundayAgentEvent {
  type: AgentEventType;
  payload: Record<string, unknown>;
}

export type PetCommand =
  | { type: "setState"; state: SundayState }
  | { type: "setSpeech"; text: string; pinned?: boolean }
  | { type: "clearSpeech" }
  | { type: "setRoaming"; enabled: boolean }
  | { type: "setMovementSpeed"; speed: number }
  | { type: "setCharacterScale"; scale: number }
  | { type: "agentEvent"; event: SundayAgentEvent }
  | { type: "wake" }
  | { type: "greet" };

export type PanelRole = "user" | "sunday" | "system";

export interface PanelMessage {
  id: string;
  role: PanelRole;
  text: string;
  timestamp: number;
  /** "not-delivered" marks user messages typed while no backend is attached. */
  status?: "delivered" | "not-delivered";
}

export type AppWindowName = "panel" | "studio" | "settings";

export const IPC = {
  // settings
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  settingsChanged: "settings:changed",
  // pet window
  petGetEnvironment: "pet:get-environment",
  petEnvironment: "pet:environment",
  petMove: "pet:move",
  petSetInteractive: "pet:set-interactive",
  petSetExtraHeight: "pet:set-extra-height",
  petDragStart: "pet:drag-start",
  petDragEnd: "pet:drag-end",
  petDragMove: "pet:drag-move",
  petDragEnded: "pet:drag-ended",
  petVisibility: "pet:visibility",
  petCommand: "pet:command",
  petStateReport: "pet:state-report",
  petStateChanged: "pet:state-changed",
  // app
  openWindow: "app:open-window",
  hidePet: "app:hide-pet",
  quit: "app:quit",
  windowMinimize: "window:minimize",
  windowClose: "window:close",
  sendPetCommand: "dev:send-pet-command",
  // panel
  panelMessage: "panel:message",
  panelUserMessage: "panel:user-message",
  panelHistory: "panel:history",
  appInfo: "app:info",
} as const;

export interface AppInfo {
  version: string;
  platform: string;
  packaged: boolean;
  startWithWindowsSupported: boolean;
  integrationConnected: boolean;
}

export interface SundayBridge {
  isElectron: true;
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<PetSettings>;
  updateSettings(patch: Partial<PetSettings>): Promise<PetSettings>;
  onSettingsChanged(cb: (settings: PetSettings) => void): () => void;
  pet: {
    getEnvironment(): Promise<PetEnvironment>;
    onEnvironment(cb: (env: PetEnvironment) => void): () => void;
    moveTo(anchor: Anchor): void;
    setInteractive(interactive: boolean): void;
    setExtraHeight(px: number): void;
    startDrag(): void;
    endDrag(): void;
    onDragMove(cb: (update: DragUpdate) => void): () => void;
    onDragEnded(cb: (anchor: Anchor) => void): () => void;
    onVisibility(cb: (visible: boolean) => void): () => void;
    onCommand(cb: (cmd: PetCommand) => void): () => void;
    reportState(state: string): void;
  };
  onPetStateChanged(cb: (state: string) => void): () => void;
  openWindow(name: AppWindowName): void;
  hidePet(): void;
  quit(): void;
  minimizeWindow(): void;
  closeWindow(): void;
  sendPetCommand(cmd: PetCommand): void;
  panel: {
    getHistory(): Promise<PanelMessage[]>;
    onMessage(cb: (msg: PanelMessage) => void): () => void;
    sendUserMessage(text: string): Promise<{ delivered: boolean }>;
  };
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const MAX_SPEECH_LENGTH = 600;
export const MAX_PANEL_MESSAGE_LENGTH = 4000;

export function validateAnchor(v: unknown): Anchor | null {
  if (!isObj(v) || !isFiniteNum(v.x) || !isFiniteNum(v.y)) return null;
  if (Math.abs(v.x) > 100_000 || Math.abs(v.y) > 100_000) return null;
  return { x: v.x, y: v.y };
}

export function validateAgentEvent(v: unknown): SundayAgentEvent | null {
  if (!isObj(v)) return null;
  const types: AgentEventType[] = ["status_changed", "speech", "task_completed", "task_failed", "user_attention"];
  if (!types.includes(v.type as AgentEventType)) return null;
  const payload = isObj(v.payload) ? v.payload : {};
  return { type: v.type as AgentEventType, payload };
}

export function validatePetCommand(v: unknown): PetCommand | null {
  if (!isObj(v) || typeof v.type !== "string") return null;
  switch (v.type) {
    case "setState":
      return isControllableState(v.state) ? { type: "setState", state: v.state } : null;
    case "setSpeech":
      if (typeof v.text !== "string") return null;
      return { type: "setSpeech", text: v.text.slice(0, MAX_SPEECH_LENGTH), pinned: v.pinned === true };
    case "clearSpeech":
      return { type: "clearSpeech" };
    case "setRoaming":
      return typeof v.enabled === "boolean" ? { type: "setRoaming", enabled: v.enabled } : null;
    case "setMovementSpeed":
      return isFiniteNum(v.speed) ? { type: "setMovementSpeed", speed: v.speed } : null;
    case "setCharacterScale":
      return isFiniteNum(v.scale) ? { type: "setCharacterScale", scale: v.scale } : null;
    case "agentEvent": {
      const event = validateAgentEvent(v.event);
      return event ? { type: "agentEvent", event } : null;
    }
    case "wake":
      return { type: "wake" };
    case "greet":
      return { type: "greet" };
    default:
      return null;
  }
}

export function validateWindowName(v: unknown): AppWindowName | null {
  return v === "panel" || v === "studio" || v === "settings" ? v : null;
}

export function validatePanelMessage(v: unknown): PanelMessage | null {
  if (!isObj(v)) return null;
  if (typeof v.id !== "string" || typeof v.text !== "string" || !isFiniteNum(v.timestamp)) return null;
  if (v.role !== "user" && v.role !== "sunday" && v.role !== "system") return null;
  const status = v.status === "delivered" || v.status === "not-delivered" ? v.status : undefined;
  return { id: v.id, role: v.role, text: v.text.slice(0, MAX_PANEL_MESSAGE_LENGTH), timestamp: v.timestamp, status };
}
