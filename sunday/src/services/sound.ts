/**
 * Sunday's cute sound kit — every sound is synthesized live with Web Audio,
 * so there are no audio files to ship. Short, soft, high-pitched "toy" sounds:
 * sine / triangle blips, little pitch slides, filtered noise for fluffy thuds.
 *
 * Usage: setSoundEnabled(true); setSoundVolume(0.6); playSound("jump");
 * Frequent sounds (footsteps, typing, babble) are rate-limited so they never pile up.
 */

export type SoundName =
  // character
  | "boop"
  | "greet"
  | "step"
  | "stepRun"
  | "jump"
  | "boing"
  | "land"
  | "sit"
  | "think"
  | "type"
  | "listen"
  | "ping"
  | "babble"
  | "snore"
  | "zzz"
  | "celebrate"
  | "confetti"
  | "uhoh"
  | "pickup"
  | "wiggle"
  | "fall"
  | "yawn"
  | "wake"
  | "success"
  | "sparkle"
  | "bubble"
  // interface
  | "click"
  | "hover"
  | "menuOpen"
  | "menuClose"
  | "toggleOn"
  | "toggleOff"
  | "keypress"
  | "send"
  | "receive"
  | "panelOpen";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = false;
let volume = 0.8;
/** Overall loudness boost; a limiter after the master keeps peaks clean. */
const LOUDNESS = 2.4;
const lastPlayed = new Map<SoundName, number>();

/** Minimum gap between repeats of the same sound, in ms. */
const RATE_LIMIT: Partial<Record<SoundName, number>> = {
  step: 120,
  stepRun: 90,
  type: 45,
  babble: 70,
  keypress: 40,
  hover: 60,
  confetti: 120,
  sparkle: 150,
  wiggle: 260,
  ping: 200,
};

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on && ctx) void ctx.suspend().catch(() => undefined);
}

export function setSoundVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  if (master && ctx) master.gain.setTargetAtTime(volume * LOUDNESS, ctx.currentTime, 0.02);
}

export function isSoundEnabled(): boolean {
  return enabled;
}

function audio(): AudioContext | null {
  if (!enabled || volume <= 0) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 6;
      comp.ratio.value = 12;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      master = ctx.createGain();
      master.gain.value = volume * LOUDNESS;
      master.connect(comp);
      comp.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

// ---------------------------------------------------------------------------
// building blocks
// ---------------------------------------------------------------------------

interface BlipOpts {
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  /** Slide to this frequency over the note. */
  to?: number;
  /** Vibrato depth in Hz. */
  vibrato?: number;
  delay?: number;
}

function blip(freq: number, dur: number, o: BlipOpts = {}): void {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + (o.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
  if (o.vibrato) {
    const lfo = a.createOscillator();
    const lg = a.createGain();
    lfo.frequency.value = 9;
    lg.gain.value = o.vibrato;
    lfo.connect(lg);
    lg.connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const vol = o.vol ?? 0.25;
  const attack = o.attack ?? 0.008;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let noiseBuffer: AudioBuffer | null = null;
function noise(dur: number, o: { freq?: number; q?: number; vol?: number; delay?: number; type?: BiquadFilterType; to?: number } = {}): void {
  const a = audio();
  if (!a || !master) return;
  if (!noiseBuffer || noiseBuffer.sampleRate !== a.sampleRate) {
    noiseBuffer = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + (o.delay ?? 0);
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const f = a.createBiquadFilter();
  f.type = o.type ?? "bandpass";
  f.frequency.setValueAtTime(o.freq ?? 1200, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  f.Q.value = o.q ?? 1.2;
  const g = a.createGain();
  const vol = o.vol ?? 0.2;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
// a cheerful pentatonic scale for babble and jingles (C major pentatonic, 5th octave)
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66];
let stepFlip = false;

// ---------------------------------------------------------------------------

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const now = performance.now();
  const gap = RATE_LIMIT[name];
  if (gap !== undefined) {
    const last = lastPlayed.get(name) ?? 0;
    if (now - last < gap) return;
  }
  lastPlayed.set(name, now);

  switch (name) {
    // --- Sunday ---------------------------------------------------------------
    case "boop": // poke
      blip(880, 0.09, { type: "sine", to: 1320, vol: 0.22 });
      return;
    case "greet": // "hi-ii!"
      blip(784, 0.1, { type: "triangle", vol: 0.2 });
      blip(1175, 0.16, { type: "triangle", vol: 0.2, delay: 0.09, vibrato: 12 });
      return;
    case "step": {
      stepFlip = !stepFlip; // soft alternating tip-tap
      noise(0.06, { freq: stepFlip ? 1700 : 1400, q: 3, vol: 0.2 });
      blip(stepFlip ? 330 : 294, 0.06, { type: "sine", vol: 0.12 });
      return;
    }
    case "stepRun":
      stepFlip = !stepFlip;
      noise(0.04, { freq: stepFlip ? 2200 : 1900, q: 4, vol: 0.18 });
      return;
    case "jump": // springy rising "bwip!"
      blip(300, 0.2, { type: "triangle", to: 900, vol: 0.2 });
      blip(600, 0.15, { type: "sine", to: 1500, vol: 0.08, delay: 0.03 });
      return;
    case "boing": // little hop
      blip(420, 0.16, { type: "triangle", to: 760, vol: 0.14, vibrato: 30 });
      return;
    case "land": // fluffy "puff" + tiny squeak
      noise(0.12, { freq: 500, q: 0.8, vol: 0.18, type: "lowpass", to: 180 });
      blip(220, 0.08, { type: "sine", to: 140, vol: 0.12 });
      return;
    case "sit": // soft cushion "fwump"
      noise(0.18, { freq: 700, q: 0.7, vol: 0.14, type: "lowpass", to: 150 });
      blip(330, 0.14, { type: "sine", to: 247, vol: 0.08, delay: 0.04 });
      return;
    case "think": // "hmm~" two wobbly notes
      blip(392, 0.22, { type: "sine", vol: 0.1, vibrato: 7 });
      blip(440, 0.3, { type: "sine", vol: 0.1, vibrato: 9, delay: 0.2 });
      return;
    case "type": // tiny plastic key click
      noise(0.03, { freq: rand(3200, 4800), q: 6, vol: 0.14 });
      return;
    case "listen": // attentive "ding-dong"
      blip(1319, 0.18, { type: "sine", vol: 0.12 });
      blip(988, 0.26, { type: "sine", vol: 0.1, delay: 0.12 });
      return;
    case "ping": // sound wave
      blip(1760, 0.12, { type: "sine", vol: 0.1, to: 1980 });
      return;
    case "babble": {
      // Animal-Crossing-style syllable
      const f = PENTA[Math.floor(Math.random() * PENTA.length)] * (Math.random() < 0.3 ? 0.5 : 1) * 0.75;
      blip(f, rand(0.05, 0.08), { type: "square", vol: 0.08, to: f * rand(0.9, 1.15) });
      return;
    }
    case "snore": // soft breath in… and out
      noise(0.9, { freq: 380, q: 1.5, vol: 0.12, type: "bandpass", to: 520 });
      noise(1.1, { freq: 520, q: 1.5, vol: 0.09, type: "bandpass", to: 300, delay: 1.1 });
      return;
    case "zzz": // twinkly "z"
      blip(1568, 0.12, { type: "sine", vol: 0.04 });
      blip(2093, 0.16, { type: "sine", vol: 0.03, delay: 0.08 });
      return;
    case "celebrate": // "ta-da-da-DAA!"
      [0, 2, 4, 5].forEach((n, i) => blip(PENTA[n], i === 3 ? 0.32 : 0.11, { type: "square", vol: 0.06, delay: i * 0.09 }));
      [0, 2, 4, 5].forEach((n, i) => blip(PENTA[n] * 2, i === 3 ? 0.3 : 0.1, { type: "sine", vol: 0.05, delay: i * 0.09 }));
      return;
    case "confetti": // popper
      noise(0.08, { freq: 2500, q: 0.9, vol: 0.12 });
      for (let i = 0; i < 4; i++) blip(rand(1800, 3200), 0.06, { type: "sine", vol: 0.03, delay: 0.05 + i * 0.04 });
      return;
    case "uhoh": // "uh-oh" descending
      blip(494, 0.16, { type: "triangle", vol: 0.16, vibrato: 6 });
      blip(370, 0.28, { type: "triangle", vol: 0.16, delay: 0.17, to: 330, vibrato: 6 });
      return;
    case "pickup": // "whee!" up-slide
      blip(500, 0.28, { type: "triangle", to: 1500, vol: 0.16, vibrato: 20 });
      return;
    case "wiggle": // dangling squeak
      blip(rand(900, 1200), 0.07, { type: "sine", to: rand(1200, 1500), vol: 0.05 });
      return;
    case "fall": // slide whistle down
      blip(1400, 0.5, { type: "sine", to: 350, vol: 0.12, vibrato: 14 });
      return;
    case "yawn": // "aaah~"
      blip(330, 0.7, { type: "triangle", to: 220, vol: 0.08, vibrato: 5, attack: 0.15 });
      return;
    case "wake": // morning chirp
      [2, 4, 6].forEach((n, i) => blip(PENTA[n], 0.12, { type: "triangle", vol: 0.12, delay: i * 0.1 }));
      return;
    case "success": // happy jingle
      [0, 2, 4].forEach((n, i) => blip(PENTA[n], 0.1, { type: "triangle", vol: 0.15, delay: i * 0.08 }));
      blip(PENTA[5], 0.35, { type: "triangle", vol: 0.15, delay: 0.24, vibrato: 8 });
      blip(PENTA[5] * 2, 0.3, { type: "sine", vol: 0.05, delay: 0.24 });
      return;
    case "sparkle":
      for (let i = 0; i < 3; i++) blip(rand(2400, 3600), 0.08, { type: "sine", vol: 0.035, delay: i * 0.05 });
      return;
    case "bubble": // speech bubble pop-in
      blip(660, 0.07, { type: "sine", to: 990, vol: 0.12 });
      return;

    // --- interface --------------------------------------------------------------
    case "click":
      blip(1046, 0.05, { type: "triangle", vol: 0.08 });
      return;
    case "hover":
      blip(1568, 0.03, { type: "sine", vol: 0.025 });
      return;
    case "menuOpen":
      blip(659, 0.06, { type: "triangle", vol: 0.08 });
      blip(988, 0.08, { type: "triangle", vol: 0.08, delay: 0.05 });
      return;
    case "menuClose":
      blip(988, 0.05, { type: "triangle", vol: 0.06 });
      blip(659, 0.07, { type: "triangle", vol: 0.06, delay: 0.04 });
      return;
    case "toggleOn":
      blip(784, 0.06, { type: "triangle", vol: 0.09 });
      blip(1175, 0.08, { type: "triangle", vol: 0.09, delay: 0.05 });
      return;
    case "toggleOff":
      blip(784, 0.06, { type: "triangle", vol: 0.08 });
      blip(523, 0.08, { type: "triangle", vol: 0.08, delay: 0.05 });
      return;
    case "keypress":
      noise(0.02, { freq: rand(2800, 4200), q: 5, vol: 0.035 });
      return;
    case "send": // whoosh up
      noise(0.22, { freq: 600, q: 1, vol: 0.08, to: 3500 });
      blip(880, 0.12, { type: "sine", to: 1760, vol: 0.06, delay: 0.06 });
      return;
    case "receive":
      blip(1175, 0.08, { type: "sine", vol: 0.1 });
      blip(1568, 0.12, { type: "sine", vol: 0.08, delay: 0.07 });
      return;
    case "panelOpen":
      [0, 2, 4].forEach((n, i) => blip(PENTA[n] * 1.5, 0.08, { type: "sine", vol: 0.07, delay: i * 0.05 }));
      return;
  }
}

/** Plays a short Animal-Crossing-style babble for a line of text. */
export function playBabble(text: string): void {
  if (!enabled) return;
  const syllables = Math.min(14, Math.max(2, Math.round(text.replace(/\s+/g, "").length / 3)));
  for (let i = 0; i < syllables; i++) {
    window.setTimeout(() => {
      lastPlayed.delete("babble");
      playSound("babble");
    }, i * 85);
  }
}

/** Plays a sound when interactive controls inside `root` are clicked or toggled (UI windows). */
export function wireUiSounds(root: HTMLElement): () => void {
  const onClick = (e: MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.("button, input[type=checkbox], select, [role=tab], [role=option]") as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") playSound(el.checked ? "toggleOn" : "toggleOff");
    else if (!el.dataset.sound) playSound("click");
  };
  const onOver = (e: MouseEvent) => {
    const el = (e.target as HTMLElement | null)?.closest?.("button:not(:disabled), [role=tab], .gallery-tile");
    const from = (e.relatedTarget as HTMLElement | null)?.closest?.("button, [role=tab], .gallery-tile");
    if (el && el !== from) playSound("hover");
  };
  root.addEventListener("click", onClick, true);
  root.addEventListener("mouseover", onOver);
  return () => {
    root.removeEventListener("click", onClick, true);
    root.removeEventListener("mouseover", onOver);
  };
}
