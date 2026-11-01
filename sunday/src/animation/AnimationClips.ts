import type { SundayAnimationState } from "../shared/states";
import { STATE_CONFIG } from "./AnimationStateMachine";
import { clamp01, easeInOut, easeOutCubic, envelope, lerp, Pose, smooth, TAU, window01, wobble } from "./Pose";

/**
 * Procedural animation clips — one per state. Each clip is a pure function of
 * clip time that writes joint rotations, offsets, prop amounts and facial
 * expression into a Pose. Effects (Z's, confetti, sound waves…) are emitted on
 * time-crossing events so they stay in sync with the motion.
 *
 * Conventions (character faces +Z):
 *   arm "fwd"  > 0 raises the arm forward      arm "out" > 0 raises it sideways
 *   arm "bend" > 0 bends the elbow forward     leg "fwd" > 0 swings the leg forward
 *   leg "bend" > 0 bends the knee backward     spineRX / headRX > 0 lean / look down
 *   offsets (rootX/Y/Z, hipsY) are in voxels   stageYaw > 0 turns toward screen-right
 */

export interface ClipContext {
  /** Facing: -1 = toward screen-left, 1 = toward screen-right. */
  dir: number;
  dragVX: number;
  dragVY: number;
  falling: boolean;
  /** Movement speed multiplier (affects stride cadence a little). */
  speed: number;
  /** How many times a looping clip has repeated; used to vary idle behaviour. */
  cycle?: number;
}

export type FxKind =
  | "z"
  | "sparkle"
  | "confetti"
  | "question"
  | "check"
  | "thought"
  | "thoughtDot"
  | "soundwave"
  | "speedline"
  | "dust"
  | "typing"
  | "exclaim"
  | "star";

export type FxAnchor = "head" | "headTop" | "handL" | "handR" | "feet" | "laptop" | "earL" | "earR" | "root";

export interface FxRequest {
  kind: FxKind;
  at?: FxAnchor;
  /** Extra offset in voxels, in the character's (un-rotated) frame. */
  offset?: [number, number, number];
  count?: number;
  /** Lifetime override in seconds. */
  life?: number;
}

export type Emit = (req: FxRequest) => void;

/** Sound cue names (see services/sound.ts). Clips name them; the host decides how to play them. */
export type SoundCue =
  | "step" | "stepRun" | "jump" | "boing" | "land" | "sit" | "think" | "type" | "listen" | "ping"
  | "babble" | "snore" | "zzz" | "celebrate" | "confetti" | "uhoh" | "pickup" | "wiggle" | "fall"
  | "yawn" | "wake" | "success" | "sparkle" | "greet";

export type Sfx = (cue: SoundCue) => void;

const noSfx: Sfx = () => undefined;

export interface Clip {
  sample(t: number, p: Pose, ctx: ClipContext): void;
  fx?(t: number, prev: number, ctx: ClipContext, emit: Emit, sfx?: Sfx): void;
  /** Sound played once when the state is entered (not on loops). */
  enterSound?: SoundCue;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Side = "L" | "R";

function arm(p: Pose, side: Side, fwd: number, out: number, bend: number, twist = 0): void {
  if (side === "L") {
    p.set("shoulderLRX", -fwd).set("shoulderLRZ", -out).set("shoulderLRY", twist).set("elbowLRX", -bend);
  } else {
    p.set("shoulderRRX", -fwd).set("shoulderRRZ", out).set("shoulderRRY", -twist).set("elbowRRX", -bend);
  }
}

function leg(p: Pose, side: Side, fwd: number, out: number, bend: number): void {
  if (side === "L") p.set("hipLRX", -fwd).set("hipLRZ", -out).set("kneeLRX", bend);
  else p.set("hipRRX", -fwd).set("hipRRZ", out).set("kneeRRX", bend);
}

/** True when `at` (seconds, inside a loop of `period`) was crossed between prev and t. */
function crossed(prev: number, t: number, at: number, period = Infinity): boolean {
  if (period === Infinity) {
    // one-shot clips: a wrap means the clip restarted (studio loop mode)
    return t < prev ? at > prev || at <= t : prev < at && t >= at;
  }
  const count = (from: number, to: number) => Math.floor((to - at) / period) - Math.floor((from - at) / period);
  if (t < prev) {
    // the clip looped back to 0: events left in prev's cycle, plus events in [0, t]
    const phase = ((at % period) + period) % period;
    return phase > prev % period || count(-1e-6, t) > 0;
  }
  return count(prev, t) > 0;
}

function standing(p: Pose): void {
  arm(p, "L", 0.04, 0.07, 0.12);
  arm(p, "R", 0.04, 0.07, 0.12);
  leg(p, "L", 0, 0.02, 0);
  leg(p, "R", 0, 0.02, 0);
}

/** Natural breathing layered on top of most standing poses. */
function breathe(p: Pose, t: number, rate = 3.6, depth = 1): void {
  const b = Math.sin((TAU * t) / rate);
  p.add("spineRX", -0.022 * b * depth);
  p.add("hipsY", 0.12 * b * depth);
  p.add("headRX", 0.015 * b * depth);
  p.add("shoulderLRZ", -0.025 * b * depth);
  p.add("shoulderRRZ", 0.025 * b * depth);
}

/** Lying on the side in bed, facing the viewer. */
function lying(p: Pose, t: number, depth = 1): void {
  p.set("rootRZ", Math.PI / 2);
  p.set("rootX", 19);
  p.set("rootY", 14.2);
  p.set("stageYaw", 0);
  const b = Math.sin((TAU * t) / 4);
  leg(p, "L", 0.45, 0, 0.75);
  leg(p, "R", 0.3, 0, 0.55);
  arm(p, "L", 1.9, 0.15, 1.2); // under the pillow
  arm(p, "R", 0.55, -0.1, 0.9); // resting on the blanket
  p.set("headRZ", -0.7); // head tilted up on the pillow so the face reads
  p.set("headRX", -0.05);
  p.add("spineRX", 0.03 * b * depth);
  p.set("breath", b * depth);
  p.set("propBed", 1);
  p.set("propBlanket", 1);
  p.set("glow", 0.35);
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

const idle: Clip = {
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.2 * (ctx.dir || 1));
    breathe(p, t);
    // weight shift and tiny sway
    const s = wobble(t * 0.45, 1);
    p.add("hipsRZ", 0.03 * s);
    p.add("rootX", 0.35 * s);
    p.add("spineRZ", -0.025 * s);
    p.add("hipLRZ", 0.03 * s);
    p.add("hipRRZ", -0.03 * s);
    // occasional glances left / right, and a look up; mirrored on alternate cycles
    const flip = (ctx.cycle ?? 0) % 2 === 1 ? -1 : 1;
    const look = flip * (-envelope(t, 2.6, 3.0, 4.2, 4.6) + envelope(t, 7.0, 7.4, 8.4, 8.8));
    const up = (ctx.cycle ?? 0) % 3 === 2 ? 0 : envelope(t, 10.0, 10.4, 11.0, 11.4);
    p.add("headRY", 0.5 * look);
    p.add("headRX", -0.16 * up);
    p.add("spineRY", 0.08 * look);
    // posture adjustment: a little stretch / shrug
    const adjust = envelope(t, 5.4, 5.8, 6.1, 6.6);
    p.add("shoulderLRZ", -0.18 * adjust);
    p.add("shoulderRRZ", 0.18 * adjust);
    p.add("spineRX", -0.05 * adjust);
    p.add("hipsY", 0.25 * adjust);
    p.face.eyes = "open";
    p.face.lookX = look;
    p.face.lookY = -up;
    p.face.mouth = "smile";
    p.face.brows = up > 0.5 ? "raised" : "neutral";
  },
};

const walking: Clip = {
  sample(t, p, ctx) {
    const T = STATE_CONFIG.walking.duration;
    const ph = (TAU * t) / T;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    leg(p, "L", 0.62 * s, 0.02, 0.12 + 0.75 * Math.pow(Math.max(0, c), 1.5));
    leg(p, "R", -0.62 * s, 0.02, 0.12 + 0.75 * Math.pow(Math.max(0, -c), 1.5));
    arm(p, "L", -0.5 * s, 0.09, 0.32 + 0.12 * Math.max(0, -s));
    arm(p, "R", 0.5 * s, 0.09, 0.32 + 0.12 * Math.max(0, s));
    p.set("hipsY", -0.5 + 0.65 * Math.abs(c));
    p.set("hipsRY", -0.1 * s);
    p.set("spineRX", 0.07);
    p.set("spineRY", 0.1 * s);
    p.set("spineRZ", 0.03 * c);
    p.set("headRX", -0.04);
    p.set("headRY", -0.07 * s);
    p.set("headRZ", -0.025 * c);
    p.set("stageYaw", 0.85 * (ctx.dir || 1));
    p.face.mouth = "smile";
    p.face.lookX = 0;
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    const T = STATE_CONFIG.walking.duration;
    if (crossed(prev, t, 0.05, T)) {
      emit({ kind: "dust", at: "feet", offset: [-2, 0, 0], count: 2 });
      sfx("step");
    }
    if (crossed(prev, t, T / 2 + 0.05, T)) {
      emit({ kind: "dust", at: "feet", offset: [2, 0, 0], count: 2 });
      sfx("step");
    }
  },
};

const running: Clip = {
  sample(t, p, ctx) {
    const T = STATE_CONFIG.running.duration;
    const ph = (TAU * t) / T;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    leg(p, "L", 1.0 * s, 0.03, 0.35 + 1.35 * Math.pow(Math.max(0, c), 1.2));
    leg(p, "R", -1.0 * s, 0.03, 0.35 + 1.35 * Math.pow(Math.max(0, -c), 1.2));
    arm(p, "L", -0.95 * s, 0.14, 1.3);
    arm(p, "R", 0.95 * s, 0.14, 1.3);
    p.set("hipsY", -0.9 + 1.3 * Math.abs(c));
    p.set("rootY", 1.1 * Math.max(0, Math.abs(c) - 0.35));
    p.set("hipsRY", -0.16 * s);
    p.set("spineRX", 0.34);
    p.set("spineRY", 0.16 * s);
    p.set("headRX", -0.24);
    p.set("headRY", -0.1 * s);
    p.set("stageYaw", 0.95 * (ctx.dir || 1));
    p.face.eyes = "focused";
    p.face.mouth = "grin";
    p.face.brows = "furrowed";
  },
  fx(t, prev, ctx, emit, sfx = noSfx) {
    const T = STATE_CONFIG.running.duration;
    for (const at of [0.0, 0.13, 0.26, 0.39]) {
      if (crossed(prev, t, at, T)) emit({ kind: "speedline", at: "root", offset: [-(ctx.dir || 1) * 9, 10 + ((at * 37) % 1) * 14, 0] });
    }
    if (crossed(prev, t, 0.02, T) || crossed(prev, t, T / 2 + 0.02, T)) {
      emit({ kind: "dust", at: "feet", count: 3 });
      sfx("stepRun");
    }
  },
};

const JUMP_TAKEOFF = 0.32;
const JUMP_LAND = 0.84;

const jumping: Clip = {
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.25 * (ctx.dir || 1));
    // 1. preparation / crouch, 2. takeoff
    const crouch = window01(t, 0, 0.26) * (1 - window01(t, 0.26, 0.33));
    // 3–5. rising, mid-air, falling
    const u = (t - JUMP_TAKEOFF) / (JUMP_LAND - JUMP_TAKEOFF);
    const airborne = u > 0 && u < 1;
    const height = airborne ? 18 * 4 * u * (1 - u) : 0;
    const armsUp = envelope(t, 0.28, 0.4, 0.62, 0.8);
    const tuck = envelope(t, 0.44, 0.54, 0.66, 0.78);
    const stretch = envelope(t, 0.3, 0.34, 0.4, 0.5);
    // 6. landing, 7. recovery bounce
    const land = envelope(t, 0.82, 0.86, 0.95, 1.1);
    const bounce = envelope(t, 1.0, 1.06, 1.08, 1.2);

    const bendLegs = 1.6 * crouch + 1.5 * tuck + 1.35 * land;
    const fwdLegs = 0.85 * crouch + 0.9 * tuck + 0.65 * land;
    leg(p, "L", fwdLegs, 0.04, bendLegs);
    leg(p, "R", fwdLegs * 0.92, 0.04, bendLegs * 0.95);
    const armsBack = crouch;
    arm(p, "L", -0.75 * armsBack + 0.9 * armsUp + 0.3 * land, 0.1 + 2.1 * armsUp + 0.55 * land, 0.15 + 0.3 * crouch + 0.2 * armsUp);
    arm(p, "R", -0.75 * armsBack + 0.9 * armsUp + 0.3 * land, 0.1 + 2.1 * armsUp + 0.55 * land, 0.15 + 0.3 * crouch + 0.2 * armsUp);
    p.set("hipsY", -3.2 * crouch - 3.0 * land + 0.4 * stretch);
    p.set("spineRX", 0.36 * crouch + 0.12 * tuck + 0.3 * land - 0.08 * stretch);
    p.set("headRX", -0.2 * crouch - 0.1 * armsUp - 0.15 * land);
    p.set("rootY", height + 1.3 * bounce);
    p.set("squash", 1 - 0.07 * crouch + 0.08 * stretch - 0.08 * land);
    p.face.eyes = crouch > 0.5 ? "focused" : airborne && u > 0.25 && u < 0.75 ? "happy" : "open";
    p.face.mouth = airborne ? "grin" : land > 0.3 ? "o" : "smile";
    p.face.brows = crouch > 0.5 ? "furrowed" : "raised";
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    if (crossed(prev, t, JUMP_TAKEOFF)) {
      emit({ kind: "dust", at: "feet", count: 6 });
      sfx("jump");
    }
    if (crossed(prev, t, JUMP_LAND)) {
      emit({ kind: "dust", at: "feet", count: 8 });
      sfx("land");
    }
  },
};

const sitting: Clip = {
  enterSound: "sit",
  sample(t, p, ctx) {
    p.set("stageYaw", 0.55 * (ctx.dir || 1));
    p.set("hipsY", -8.6);
    p.set("rootZ", -2);
    // one leg stretched out, the other bent with the knee up
    leg(p, "L", 1.52, 0.12, 0.22 + 0.05 * Math.sin((TAU * t) / 2.2));
    leg(p, "R", 2.05, 0.06, 1.95);
    // the bent leg's foot taps gently every few seconds
    const tap = envelope(t % 8, 4.4, 4.55, 4.7, 4.85);
    p.add("kneeRRX", -0.12 * tap);
    // hand behind on the floor, the other resting on the raised knee
    arm(p, "L", -0.55, 0.32, 0.18);
    arm(p, "R", 0.95, 0.05, 0.55);
    p.set("spineRX", -0.16);
    breathe(p, t, 4.2, 1.1);
    const look = Math.sin((TAU * t) / 8);
    p.add("headRY", 0.35 * look);
    p.add("headRZ", 0.05 * Math.sin((TAU * t) / 5));
    p.add("spineRZ", 0.03 * Math.sin((TAU * t) / 6));
    p.face.eyes = "open";
    p.face.lookX = look;
    p.face.brows = "relaxed";
    p.face.mouth = "smile";
  },
};

const thinking: Clip = {
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.25 * (ctx.dir || 1));
    breathe(p, t, 4);
    // hand on chin, other arm supporting the elbow
    const tap = Math.max(0, Math.sin((TAU * t) / 1.0)) * envelope(t % 4, 0.6, 0.8, 2.0, 2.2);
    arm(p, "R", 1.05, -0.3, 2.35 + 0.08 * tap, 0.15);
    arm(p, "L", 0.65, -0.48, 1.55, 0.2);
    p.set("headRZ", 0.16 + 0.04 * Math.sin((TAU * t) / 4));
    p.set("headRX", -0.22);
    p.set("headRY", 0.12 * Math.sin((TAU * t) / 4));
    p.set("spineRZ", -0.03);
    p.set("hipsRZ", 0.04);
    p.face.eyes = "open";
    p.face.lookX = 1;
    p.face.lookY = -1;
    p.face.brows = "raised";
    p.face.mouth = Math.sin((TAU * t) / 4) > 0.6 ? "o" : "flat";
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    const T = STATE_CONFIG.thinking.duration;
    if (crossed(prev, t, 0.01, T)) {
      emit({ kind: "thought", at: "headTop", offset: [10, 9, 0], life: T });
      sfx("think");
    }
    for (const at of [0.4, 1.4, 2.4, 3.4]) if (crossed(prev, t, at, T)) emit({ kind: "thoughtDot", at: "headTop", offset: [4, 1, 0] });
  },
};

const working: Clip = {
  sample(t, p, ctx) {
    p.set("stageYaw", -0.62 * (ctx.dir || 1));
    p.set("propChair", 1);
    p.set("propDesk", 1);
    p.set("propLaptop", 1);
    p.set("screenActivity", 1);
    p.set("hipsY", -5);
    leg(p, "L", 1.52, 0.05, 1.5);
    leg(p, "R", 1.52, 0.05, 1.5);
    // typing: alternating hands
    const k = TAU * t * 4.2;
    const burst = 0.55 + 0.45 * Math.max(0, Math.sin((TAU * t) / 3.2 + 0.5));
    arm(p, "L", 0.92 + 0.07 * Math.max(0, Math.sin(k)) * burst, 0.02, 0.8 - 0.1 * Math.max(0, Math.sin(k)) * burst, 0.1);
    arm(p, "R", 0.92 + 0.07 * Math.max(0, Math.sin(k + Math.PI)) * burst, 0.02, 0.8 - 0.1 * Math.max(0, Math.sin(k + Math.PI)) * burst, 0.1);
    p.set("spineRX", 0.12);
    p.set("headRX", 0.2 + 0.03 * Math.sin((TAU * t) / 1.6));
    p.set("headRY", 0.08 * Math.sin((TAU * t) / 3.2));
    breathe(p, t, 3.6, 0.6);
    p.face.eyes = "focused";
    p.face.lookY = 1;
    p.face.lookX = 0;
    p.face.brows = "furrowed";
    p.face.mouth = Math.sin((TAU * t) / 3.2) > 0.7 ? "smile" : "flat";
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    const T = STATE_CONFIG.working.duration;
    for (const at of [0.3, 1.2, 2.1, 2.8]) if (crossed(prev, t, at, T)) emit({ kind: "typing", at: "laptop" });
    // key clicks follow the alternating hands (4.2 strokes / s per hand), with pauses between bursts
    const burst = Math.sin((TAU * t) / T + 0.5) > -0.2;
    for (let k = 0; k < 28; k++) {
      const at = (k / 28) * T;
      if (burst && crossed(prev, t, at, T) && k % 3 !== 2) sfx("type");
    }
  },
};

const listening: Clip = {
  enterSound: "listen",
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.15 * (ctx.dir || 1));
    breathe(p, t, 3.2);
    const nod = Math.sin((TAU * t) / 1.2);
    // hand pressing the ear cup
    arm(p, "R", 0.5, 2.5, 1.05, -0.3);
    p.set("headRZ", 0.13 + 0.03 * nod);
    p.set("headRX", 0.06 + 0.06 * Math.max(0, nod));
    p.set("spineRZ", -0.04);
    p.set("glow", 1.55 + 0.45 * Math.sin((TAU * t) / 0.6));
    p.face.eyes = "wide";
    p.face.lookX = -1;
    p.face.lookY = 0;
    p.face.brows = "raised";
    p.face.mouth = "o";
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    const T = STATE_CONFIG.listening.duration;
    for (const at of [0.1, 0.7, 1.3, 1.9])
      if (crossed(prev, t, at, T)) {
        emit({ kind: "soundwave", at: "earL" });
        sfx("ping");
      }
  },
};

const talking: Clip = {
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.12 * (ctx.dir || 1));
    breathe(p, t, 3);
    // syllable-like mouth motion
    const syll = Math.max(0, Math.sin(t * 15) * 0.65 + Math.sin(t * 9.7 + 1.3) * 0.45);
    const pause = window01(Math.sin((TAU * t) / 2 + 0.4), -0.85, -0.6);
    p.face.mouth = "talk";
    p.face.mouthOpen = syll * pause;
    p.face.eyes = Math.sin((TAU * t) / 2) > 0.85 ? "happy" : "open";
    p.face.brows = Math.sin((TAU * t) / 2 + 1) > 0.5 ? "raised" : "neutral";
    p.set("headRX", -0.05 + 0.04 * Math.sin(t * 5.1));
    p.set("headRY", 0.12 * Math.sin((TAU * t) / 2));
    p.set("headRZ", 0.05 * Math.sin((TAU * t) / 2 + 0.7));
    // explaining gesture with one hand
    const g = 0.5 + 0.5 * Math.sin((TAU * t) / 2);
    arm(p, "R", 0.55 + 0.35 * g, 0.12 + 0.1 * g, 1.15 + 0.2 * g, 0.3);
    arm(p, "L", 0.08, 0.1, 0.2);
  },
  fx(t, prev, _ctx, _emit, sfx = noSfx) {
    // a babble blip on each syllable peak, silent in the pauses
    const T = STATE_CONFIG.talking.duration;
    for (let k = 0; k < 9; k++) {
      const at = 0.1 + k * 0.2;
      const pause = Math.sin((TAU * at) / 2 + 0.4) < -0.6;
      if (!pause && crossed(prev, t, at, T)) sfx("babble");
    }
  },
};

const sleeping: Clip = {
  sample(t, p) {
    lying(p, t);
    p.face.eyes = "closed";
    p.face.blink = 0;
    p.face.brows = "relaxed";
    p.face.mouth = Math.sin((TAU * t) / 8) > 0.75 ? "o" : "sleep";
    p.face.blush = 0.6;
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    const T = STATE_CONFIG.sleeping.duration;
    for (const at of [0.2, 1.5, 2.8])
      if (crossed(prev, t, at, T)) {
        emit({ kind: "z", at: "headTop", offset: [2, 2, 2] });
        sfx("zzz");
      }
    if (crossed(prev, t, 0.05, T)) sfx("snore");
  },
};

const celebrating: Clip = {
  enterSound: "celebrate",
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.1 * (ctx.dir || 1));
    const T = STATE_CONFIG.celebrating.duration;
    const hopT = (t % (T / 2)) / (T / 2); // two hops per cycle
    const air = Math.sin(Math.PI * hopT);
    const squat = hopT < 0.12 ? 1 - hopT / 0.12 : hopT > 0.9 ? (hopT - 0.9) / 0.1 : 0;
    p.set("rootY", 7 * air);
    p.set("hipsY", -1.6 * squat);
    p.set("squash", 1 - 0.06 * squat + 0.04 * air);
    leg(p, "L", 0.4 * air + 0.5 * squat, 0.08, 0.8 * air + 0.9 * squat);
    leg(p, "R", 0.2 * air + 0.5 * squat, 0.08, 0.5 * air + 0.9 * squat);
    const wave = Math.sin((TAU * t) / (T / 2));
    arm(p, "L", 0.25, 2.55 + 0.25 * wave, 0.25);
    arm(p, "R", 0.25, 2.55 - 0.25 * wave, 0.25);
    p.set("spineRX", -0.12);
    p.set("headRX", -0.18);
    p.set("headRZ", 0.1 * wave);
    p.face.eyes = "happy";
    p.face.mouth = "grin";
    p.face.blush = 1;
    p.face.brows = "raised";
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    const T = STATE_CONFIG.celebrating.duration;
    if (crossed(prev, t, 0.35, T)) {
      emit({ kind: "confetti", at: "headTop", offset: [0, 6, 0], count: 14 });
      sfx("confetti");
    }
    for (const at of [0.1, 0.5, 0.9, 1.3]) if (crossed(prev, t, at, T)) emit({ kind: "sparkle", at: "head", count: 2 });
    // a springy boing at the start of each hop
    if (crossed(prev, t, 0.01, T / 2)) sfx("boing");
  },
};

const error: Clip = {
  enterSound: "uhoh",
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.15 * (ctx.dir || 1));
    breathe(p, t, 3);
    // flinch, then shrug, then scratch the head
    const flinch = envelope(t, 0, 0.08, 0.18, 0.45);
    const shrug = envelope(t, 0.25, 0.5, 1.2, 1.5);
    const scratch = envelope(t, 1.35, 1.65, 2.75, 3.15);
    const scr = Math.sin(t * 22) * scratch;
    p.set("rootZ", -1.2 * flinch);
    p.set("spineRX", -0.16 * flinch + 0.04 * shrug);
    p.set("hipsY", -0.6 * flinch + 0.4 * shrug);
    arm(p, "L", 0.04 + 0.35 * shrug, 0.07 + 0.55 * shrug + 0.4 * scratch, 0.12 + 1.3 * shrug + 1.45 * scratch, 0.6 * shrug);
    arm(p, "R", lerp(0.04 + 0.35 * shrug, 2.7, scratch), lerp(0.07 + 0.55 * shrug, 0.25, scratch), lerp(0.12 + 1.3 * shrug, 1.25 + 0.15 * scr, scratch), 0.6 * shrug);
    p.set("headRZ", 0.3 * smooth(t / 0.4) * (1 - window01(t, 2.9, 3.2)));
    p.set("headRX", -0.06);
    p.set("headRY", -0.12 * shrug);
    p.face.eyes = "confused";
    p.face.brows = "confused";
    p.face.mouth = shrug > 0.5 ? "frown" : "wavy";
    p.face.sweat = t > 0.3 && t < 3.0;
    p.face.lookX = 1;
    p.face.lookY = -1;
  },
  fx(t, prev, _ctx, emit) {
    if (crossed(prev, t, 0.12)) emit({ kind: "question", at: "headTop", offset: [7, 6, 0], life: 2.8 });
  },
};

const dragging: Clip = {
  enterSound: "pickup",
  sample(t, p, ctx) {
    const vx = Math.max(-1, Math.min(1, ctx.dragVX / 1800));
    const fall = ctx.falling ? 1 : 0;
    const flail = Math.sin((TAU * t) / (ctx.falling ? 0.35 : 1.2));
    p.set("stageYaw", 0);
    p.set("rootY", 1.5);
    // legs dangle and trail behind the motion
    const swing = -0.55 * vx + 0.08 * Math.sin((TAU * t) / 1.2);
    leg(p, "L", 0.18 + 0.25 * flail * fall, 0.04, 0.25 + 0.35 * Math.max(0, flail) * (0.4 + fall));
    leg(p, "R", 0.12 - 0.25 * flail * fall, 0.04, 0.3 + 0.35 * Math.max(0, -flail) * (0.4 + fall));
    p.set("hipLRZ", swing);
    p.set("hipRRZ", swing);
    arm(p, "L", 0.2, 1.0 + 0.3 * flail + 1.2 * fall, 0.4);
    arm(p, "R", 0.2, 1.0 - 0.3 * flail + 1.2 * fall, 0.4);
    p.set("spineRZ", 0.25 * vx);
    p.set("headRZ", -0.18 * vx + 0.06 * flail);
    p.set("headRX", -0.1);
    p.face.eyes = "wide";
    p.face.mouth = "o";
    p.face.brows = "worried";
    p.face.sweat = Math.abs(vx) > 0.25 || ctx.falling;
  },
  fx(t, prev, ctx, _emit, sfx = noSfx) {
    const T = STATE_CONFIG.dragging.duration;
    // little squeaks while dangling and being swung around
    if (Math.abs(ctx.dragVX) > 500 && (crossed(prev, t, 0.2, T / 2))) sfx("wiggle");
  },
};

const scratchLie = new Pose();
const scratchStand = new Pose();

const waking: Clip = {
  sample(t, p) {
    // 0 – 0.7: eyes open in bed · 0.7 – 1.5: get up · 1.5 – 2.4: stretch + yawn · 2.4 – 3: settle
    const up = easeInOut(window01(t, 0.7, 1.5));
    lying(scratchLie.reset(), 0, 0);
    standing(scratchStand.reset());
    p.blend(scratchLie, scratchStand, up);
    // keep the bed visible until Sunday is out of it, then pop it away
    p.set("propBed", 1 - window01(t, 1.4, 1.9));
    p.set("propBlanket", 1 - window01(t, 0.8, 1.2));
    const stretch = envelope(t, 1.45, 1.75, 2.25, 2.55);
    arm(p, "L", lerp(p.get("shoulderLRX") * -1, 0.3, stretch), lerp(-p.get("shoulderLRZ"), 2.85, stretch), lerp(-p.get("elbowLRX"), 0.15, stretch));
    arm(p, "R", lerp(p.get("shoulderRRX") * -1, 0.3, stretch), lerp(p.get("shoulderRRZ"), 2.85, stretch), lerp(-p.get("elbowRRX"), 0.15, stretch));
    p.add("rootY", 0.8 * stretch);
    p.add("spineRX", -0.12 * stretch);
    p.add("headRX", -0.2 * stretch);
    p.add("headRZ", 0.1 * Math.sin(t * 3) * envelope(t, 2.3, 2.5, 2.8, 3));
    p.set("glow", lerp(0.35, 1, window01(t, 0.6, 1.4)));
    const blinkSeq = envelope(t, 0.15, 0.2, 0.25, 0.3) + envelope(t, 0.45, 0.5, 0.55, 0.6);
    p.face = {
      ...p.face,
      eyes: t < 0.15 ? "closed" : stretch > 0.4 ? "closed" : t < 1.5 ? "sleepy" : "open",
      blink: clamp01(blinkSeq),
      mouth: stretch > 0.2 ? "yawn" : t > 2.5 ? "smile" : "flat",
      mouthOpen: stretch,
      brows: stretch > 0.4 ? "raised" : "relaxed",
      lookX: 0,
      lookY: 0,
      blush: 0,
      sweat: false,
    };
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    if (crossed(prev, t, 0.2)) sfx("wake");
    if (crossed(prev, t, 1.5)) sfx("yawn");
    if (crossed(prev, t, 1.9)) {
      emit({ kind: "sparkle", at: "headTop", count: 3 });
      sfx("sparkle");
    }
  },
};

const completed: Clip = {
  sample(t, p, ctx) {
    standing(p);
    p.set("stageYaw", 0.12 * (ctx.dir || 1));
    const crouch = envelope(t, 0, 0.14, 0.18, 0.24);
    const u = (t - 0.22) / 0.46;
    const air = u > 0 && u < 1 ? 4 * u * (1 - u) : 0;
    const land = envelope(t, 0.66, 0.72, 0.78, 0.9);
    const pump = envelope(t, 0.2, 0.32, 0.8, 1.0);
    const thumbs = envelope(t, 0.85, 1.05, 1.75, 2.15);
    p.set("rootY", 9 * air);
    p.set("hipsY", -2.2 * crouch - 1.8 * land);
    leg(p, "L", 0.6 * crouch + 0.5 * air + 0.5 * land, 0.04, 1.1 * crouch + 0.9 * air + 0.9 * land);
    leg(p, "R", 0.6 * crouch + 0.3 * air + 0.5 * land, 0.04, 1.1 * crouch + 0.6 * air + 0.9 * land);
    // fist pump, then a proud thumbs-up toward the user
    arm(p, "R", lerp(0.15 + 0.3 * pump, 1.25, thumbs), lerp(0.1 + 2.55 * pump, 0.15, thumbs), lerp(0.3, 1.45, thumbs), 0.2 * thumbs);
    arm(p, "L", 0.1 + 0.2 * air, 0.1 + 0.5 * air, 0.3 + 1.2 * thumbs, 0);
    p.set("squash", 1 - 0.06 * crouch + 0.06 * air - 0.07 * land);
    p.set("headRX", -0.12 * pump);
    p.set("headRZ", 0.08 * thumbs);
    p.face.eyes = air > 0.1 || thumbs > 0.5 ? "happy" : "open";
    p.face.mouth = "grin";
    p.face.blush = pump + thumbs > 0.5 ? 1 : 0;
    p.face.brows = "raised";
  },
  fx(t, prev, _ctx, emit, sfx = noSfx) {
    if (crossed(prev, t, 0.22)) sfx("boing");
    if (crossed(prev, t, 0.3)) {
      emit({ kind: "check", at: "headTop", offset: [0, 7, 0], life: 1.9 });
      sfx("success");
    }
    if (crossed(prev, t, 0.45)) emit({ kind: "sparkle", at: "head", count: 4 });
    if (crossed(prev, t, 1.0)) emit({ kind: "star", at: "handR", count: 3 });
  },
};

export const CLIPS: Record<SundayAnimationState, Clip> = {
  idle,
  walking,
  running,
  jumping,
  sitting,
  thinking,
  working,
  listening,
  talking,
  sleeping,
  celebrating,
  error,
  dragging,
  waking,
  completed,
};

/** Evaluates a clip into `out` (reset first). Exposed for tests and thumbnails. */
export function sampleClip(state: SundayAnimationState, t: number, out: Pose, ctx: ClipContext): Pose {
  out.reset();
  CLIPS[state].sample(t, out, ctx);
  return out;
}

export { crossed, easeOutCubic };
