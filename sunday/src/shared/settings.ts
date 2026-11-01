import { CharacterAppearance, DEFAULT_APPEARANCE, sanitizeAppearance } from "./appearance";

export type NightMode = "off" | "on" | "auto";

/** How Sunday "talks": a real text-to-speech voice, cute babble, or silence. */
export type VoiceMode = "speak" | "babble" | "off";

export interface VoiceSettings {
  mode: VoiceMode;
  /** Name of a system voice; "" = pick a friendly one automatically. */
  voiceName: string;
  /** 0.5 – 2 (higher = cuter). */
  pitch: number;
  /** 0.6 – 1.6 */
  rate: number;
  /** Short spoken reactions: "Wheee!", "Uh-oh!", "Yay!"… */
  reactions: boolean;
}

export const DEFAULT_VOICE: VoiceSettings = { mode: "speak", voiceName: "", pitch: 1.75, rate: 1.1, reactions: true };

export function sanitizeVoice(input: unknown, base: VoiceSettings = DEFAULT_VOICE): VoiceSettings {
  const v = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number, d: number) => (typeof x === "number" && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  return {
    mode: v.mode === "speak" || v.mode === "babble" || v.mode === "off" ? v.mode : base.mode,
    voiceName: typeof v.voiceName === "string" ? v.voiceName.slice(0, 200) : base.voiceName,
    pitch: num(v.pitch, 0.5, 2, base.pitch),
    rate: num(v.rate, 0.6, 1.6, base.rate),
    reactions: typeof v.reactions === "boolean" ? v.reactions : base.reactions,
  };
}

export interface PetSettings {
  roaming: boolean;
  /** Multiplier for walking/running speed (0.5 – 2). */
  movementSpeed: number;
  /** Multiplier for animation playback speed (0.5 – 2). */
  animationSpeed: number;
  /** Character / window scale (0.6 – 1.8). */
  characterScale: number;
  alwaysOnTop: boolean;
  /** Quiet mode: no spontaneous chatter, no sounds, calmer roaming. */
  quietMode: boolean;
  soundEffects: boolean;
  /** Master volume for sound effects (0 – 1). */
  soundVolume: number;
  voice: VoiceSettings;
  visible: boolean;
  startWithWindows: boolean;
  nightMode: NightMode;
  appearance: CharacterAppearance;
}

export const DEFAULT_SETTINGS: PetSettings = {
  roaming: true,
  movementSpeed: 1,
  animationSpeed: 1,
  characterScale: 1,
  alwaysOnTop: true,
  quietMode: false,
  soundEffects: true,
  soundVolume: 0.8,
  voice: DEFAULT_VOICE,
  visible: true,
  startWithWindows: false,
  nightMode: "off",
  appearance: DEFAULT_APPEARANCE,
};

export const SETTING_RANGES = {
  movementSpeed: { min: 0.5, max: 2 },
  animationSpeed: { min: 0.5, max: 2 },
  characterScale: { min: 0.6, max: 1.8 },
  soundVolume: { min: 0, max: 1 },
} as const;

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Validates an untrusted object (from disk or IPC) into complete settings. */
export function sanitizeSettings(input: unknown, base: PetSettings = DEFAULT_SETTINGS): PetSettings {
  const src = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const night = src.nightMode;
  return {
    roaming: bool(src.roaming, base.roaming),
    movementSpeed: clampNumber(src.movementSpeed, SETTING_RANGES.movementSpeed.min, SETTING_RANGES.movementSpeed.max, base.movementSpeed),
    animationSpeed: clampNumber(src.animationSpeed, SETTING_RANGES.animationSpeed.min, SETTING_RANGES.animationSpeed.max, base.animationSpeed),
    characterScale: clampNumber(src.characterScale, SETTING_RANGES.characterScale.min, SETTING_RANGES.characterScale.max, base.characterScale),
    alwaysOnTop: bool(src.alwaysOnTop, base.alwaysOnTop),
    quietMode: bool(src.quietMode, base.quietMode),
    // settings saved before sounds existed had them off: switch them on once
    soundEffects: src.soundVolume === undefined && src.soundEffects === false ? true : bool(src.soundEffects, base.soundEffects),
    soundVolume: clampNumber(src.soundVolume, 0, 1, base.soundVolume),
    voice: src.voice === undefined ? base.voice : sanitizeVoice(src.voice, base.voice),
    visible: bool(src.visible, base.visible),
    startWithWindows: bool(src.startWithWindows, base.startWithWindows),
    nightMode: night === "on" || night === "off" || night === "auto" ? night : base.nightMode,
    appearance: src.appearance === undefined ? base.appearance : sanitizeAppearance(src.appearance),
  };
}

/** Applies a partial, untrusted patch on top of existing settings. */
export function patchSettings(current: PetSettings, patch: unknown): PetSettings {
  if (typeof patch !== "object" || patch === null) return current;
  const merged = { ...current, ...(patch as Record<string, unknown>) };
  return sanitizeSettings(merged, current);
}

/** Night is "active" when forced on, or in auto mode between 21:30 and 06:30 local time. */
export function isNightActive(mode: NightMode, date: Date = new Date()): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= 21 * 60 + 30 || minutes < 6 * 60 + 30;
}
