import { DEFAULT_VOICE, type VoiceSettings } from "../shared/settings";
import { playBabble, playSound } from "./sound";

/**
 * Sunday's voice.
 *  - "speak":  reads speech bubbles aloud with a Windows text-to-speech voice,
 *              pitched up and sped up a little so he sounds small and cheerful.
 *              Falls back to babble when no system voice is available.
 *  - "babble": Animal-Crossing-style gibberish blips (no words).
 *  - "off":    silent.
 * Plus short spoken reactions to actions ("Wheee!", "Uh-oh!", "Yay!").
 * Uses only the operating system's built-in voices — nothing is downloaded or sent anywhere.
 */

export type Reaction = "pickup" | "drop" | "celebrate" | "error" | "completed" | "wake" | "sleep" | "poke" | "jump" | "think" | "listen";

const REACTIONS: Record<Reaction, string[]> = {
  pickup: ["Wheee!", "Whoa, hey!", "Up we go!", "Hehe, careful!"],
  drop: ["Whoaaa!", "Wheee!", "Incoming!"],
  celebrate: ["Yay!", "Woohoo!", "Yippee!", "Let's go!"],
  error: ["Uh-oh!", "Oopsie!", "Hmm, that's odd…"],
  completed: ["All done!", "Ta-da!", "Nailed it!"],
  wake: ["Good morning!", "Mmm… I'm awake!", "Rise and shine!"],
  sleep: ["Night night…", "Sleepy time…"],
  poke: ["Hi!", "Hehe!", "Hey there!", "That tickles!"],
  jump: ["Hup!", "Boing!"],
  think: ["Hmm…", "Let me think…"],
  listen: ["I'm listening!", "Go ahead!"],
};

let settings: VoiceSettings = DEFAULT_VOICE;
let enabled = true;
let volume = 0.8;
let lastReaction = 0;
let cachedVoices: SpeechSynthesisVoice[] = [];

const synth = (): SpeechSynthesis | null => (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null);

function refreshVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  cachedVoices = s.getVoices();
  return cachedVoices;
}

if (synth()) {
  refreshVoices();
  synth()!.addEventListener?.("voiceschanged", refreshVoices);
}

export function setVoiceSettings(v: VoiceSettings, soundOn: boolean, vol: number): void {
  settings = v;
  enabled = soundOn;
  volume = vol;
  if (!soundOn || v.mode !== "speak") synth()?.cancel();
}

export interface VoiceInfo {
  name: string;
  lang: string;
  local: boolean;
}

/** Lists the system voices (they may arrive a moment after start-up). */
export function listVoices(): Promise<VoiceInfo[]> {
  return new Promise((resolve) => {
    const toInfo = () => refreshVoices().map((v) => ({ name: v.name, lang: v.lang, local: v.localService }));
    const now = toInfo();
    if (now.length || !synth()) return resolve(now);
    const t = window.setTimeout(() => resolve(toInfo()), 1200);
    synth()!.addEventListener?.(
      "voiceschanged",
      () => {
        window.clearTimeout(t);
        resolve(toInfo());
      },
      { once: true },
    );
  });
}

/** Friendly default: a local English voice, preferring lighter ones that sound good pitched up. */
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = cachedVoices.length ? cachedVoices : refreshVoices();
  if (!voices.length) return null;
  if (settings.voiceName) {
    const exact = voices.find((v) => v.name === settings.voiceName);
    if (exact) return exact;
  }
  const local = voices.filter((v) => v.localService);
  const pool = local.length ? local : voices;
  const english = pool.filter((v) => /^en/i.test(v.lang));
  const prefs = [/aria/i, /jenny/i, /zira/i, /ana\b/i, /samantha/i, /female/i, /hazel/i, /susan/i];
  for (const re of prefs) {
    const hit = english.find((v) => re.test(v.name));
    if (hit) return hit;
  }
  return english[0] ?? pool[0];
}

/** Removes emoji and symbols that text-to-speech would read out literally. */
export function speakableText(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[*_~`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Says a line in Sunday's voice (or babbles it). Interrupts whatever he was saying. */
export function say(text: string): void {
  if (!enabled || settings.mode === "off") return;
  const clean = speakableText(text);
  if (!clean) return;
  const s = synth();
  const voice = settings.mode === "speak" && s ? pickVoice() : null;
  if (!voice || !s) {
    playBabble(clean);
    return;
  }
  s.cancel();
  const u = new SpeechSynthesisUtterance(clean.slice(0, 300));
  u.voice = voice;
  u.lang = voice.lang;
  u.pitch = settings.pitch;
  u.rate = settings.rate;
  u.volume = Math.min(1, volume * 1.25);
  s.speak(u);
}

/** A short spoken reaction to something that happened (rate-limited). */
export function react(r: Reaction, opts: { force?: boolean } = {}): void {
  if (!enabled || settings.mode === "off" || (!settings.reactions && !opts.force)) return;
  const now = performance.now();
  if (!opts.force && now - lastReaction < 3500) return;
  if (!opts.force && synth()?.speaking) return; // don't talk over a speech bubble
  lastReaction = now;
  const lines = REACTIONS[r];
  const line = lines[Math.floor(Math.random() * lines.length)];
  if (settings.mode === "babble") {
    playBabble(line);
    return;
  }
  say(line);
}

/** Preview helper for settings screens. */
export function testVoice(text = "Hi! I'm Sunday. Nice to meet you!"): void {
  playSound("greet");
  window.setTimeout(() => say(text), 250);
}

export function stopVoice(): void {
  synth()?.cancel();
}
