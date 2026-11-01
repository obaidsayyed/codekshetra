import { FaceState, NEUTRAL_FACE } from "../character/FaceRenderer";

/**
 * A pose is a flat set of numeric channels (joint rotations in radians,
 * offsets in voxels, prop amounts 0–1) plus a face state. Flat channels make
 * crossfading between any two poses trivial and allocation-free.
 */
export const CHANNELS = [
  "stageYaw",
  "rootX",
  "rootY",
  "rootZ",
  "rootRX",
  "rootRY",
  "rootRZ",
  "squash",
  "hipsY",
  "hipsRX",
  "hipsRY",
  "hipsRZ",
  "spineRX",
  "spineRY",
  "spineRZ",
  "headRX",
  "headRY",
  "headRZ",
  "shoulderLRX",
  "shoulderLRY",
  "shoulderLRZ",
  "elbowLRX",
  "shoulderRRX",
  "shoulderRRY",
  "shoulderRRZ",
  "elbowRRX",
  "hipLRX",
  "hipLRY",
  "hipLRZ",
  "kneeLRX",
  "hipRRX",
  "hipRRY",
  "hipRRZ",
  "kneeRRX",
  "propChair",
  "propDesk",
  "propLaptop",
  "propBed",
  "propBlanket",
  "breath",
  "glow",
  "screenActivity",
] as const;

export type Channel = (typeof CHANNELS)[number];

export const CH = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as Record<Channel, number>;

export class Pose {
  readonly c = new Float32Array(CHANNELS.length);
  face: FaceState = { ...NEUTRAL_FACE };

  constructor() {
    this.reset();
  }

  reset(): this {
    this.c.fill(0);
    this.c[CH.squash] = 1;
    this.c[CH.glow] = 1;
    this.face = { ...NEUTRAL_FACE };
    return this;
  }

  get(ch: Channel): number {
    return this.c[CH[ch]];
  }

  set(ch: Channel, v: number): this {
    this.c[CH[ch]] = v;
    return this;
  }

  add(ch: Channel, v: number): this {
    this.c[CH[ch]] += v;
    return this;
  }

  copyFrom(other: Pose): this {
    this.c.set(other.c);
    this.face = { ...other.face };
    return this;
  }

  /** Writes lerp(a, b, t) into this pose. Face switches halfway, gaze/blink blend. */
  blend(a: Pose, b: Pose, t: number): this {
    const n = this.c.length;
    for (let i = 0; i < n; i++) this.c[i] = a.c[i] + (b.c[i] - a.c[i]) * t;
    const base = t < 0.5 ? a.face : b.face;
    this.face = {
      ...base,
      blink: a.face.blink + (b.face.blink - a.face.blink) * t,
      lookX: a.face.lookX + (b.face.lookX - a.face.lookX) * t,
      lookY: a.face.lookY + (b.face.lookY - a.face.lookY) * t,
      mouthOpen: a.face.mouthOpen + (b.face.mouthOpen - a.face.mouthOpen) * t,
      blush: a.face.blush + (b.face.blush - a.face.blush) * t,
    };
    return this;
  }

  isFinite(): boolean {
    for (let i = 0; i < this.c.length; i++) if (!Number.isFinite(this.c[i])) return false;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Small math helpers used by clips
// ---------------------------------------------------------------------------

export const TAU = Math.PI * 2;
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
/** 0→1 over [a,b] with smoothstep. */
export const window01 = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
/** Rises over [a,b], holds, falls over [c,d]. */
export const envelope = (t: number, a: number, b: number, c: number, d: number) => window01(t, a, b) * (1 - window01(t, c, d));

/** Cheap smooth pseudo-noise in [-1,1] from layered sines. */
export function wobble(t: number, seed = 0): number {
  return (
    Math.sin(t * 1.13 + seed * 1.7) * 0.5 +
    Math.sin(t * 2.31 + seed * 3.1) * 0.3 +
    Math.sin(t * 0.47 + seed * 5.3) * 0.2
  );
}
