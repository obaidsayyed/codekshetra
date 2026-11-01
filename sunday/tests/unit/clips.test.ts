import { describe, expect, it } from "vitest";
import { CLIPS, crossed, sampleClip, type ClipContext, type FxRequest } from "../../src/animation/AnimationClips";
import { STATE_CONFIG } from "../../src/animation/AnimationStateMachine";
import { CH, Pose } from "../../src/animation/Pose";
import { TransitionManager } from "../../src/animation/TransitionManager";
import { ANIMATION_STATES } from "../../src/shared/states";

const ctx: ClipContext = { dir: 1, dragVX: 0, dragVY: 0, falling: false, speed: 1 };

function range(state: (typeof ANIMATION_STATES)[number], ch: keyof typeof CH, samples = 60) {
  const p = new Pose();
  let min = Infinity;
  let max = -Infinity;
  const d = STATE_CONFIG[state].duration;
  for (let i = 0; i <= samples; i++) {
    sampleClip(state, (i / samples) * d, p, ctx);
    const v = p.c[CH[ch]];
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max, span: max - min };
}

describe("animation clips", () => {
  it("exist for all 15 states", () => {
    expect(ANIMATION_STATES).toHaveLength(15);
    for (const s of ANIMATION_STATES) expect(CLIPS[s]).toBeDefined();
  });

  it("always produce finite poses", () => {
    const p = new Pose();
    for (const s of ANIMATION_STATES) {
      const d = STATE_CONFIG[s].duration;
      for (let i = 0; i <= 40; i++) {
        sampleClip(s, (i / 40) * d, p, ctx);
        expect(p.isFinite(), `${s} @ ${i}`).toBe(true);
      }
    }
  });

  it("walking alternates legs and arms (not just bobbing)", () => {
    expect(range("walking", "hipLRX").span).toBeGreaterThan(0.8);
    expect(range("walking", "shoulderLRX").span).toBeGreaterThan(0.6);
    const p = new Pose();
    sampleClip("walking", STATE_CONFIG.walking.duration / 4, p, ctx);
    // legs are opposite
    expect(Math.sign(p.c[CH.hipLRX])).toBe(-Math.sign(p.c[CH.hipRRX]));
    // arms swing opposite to the legs on the same side
    expect(Math.sign(p.c[CH.shoulderLRX])).toBe(-Math.sign(p.c[CH.hipLRX]));
  });

  it("running is faster, bigger and leans forward", () => {
    expect(STATE_CONFIG.running.duration).toBeLessThan(STATE_CONFIG.walking.duration * 0.7);
    expect(range("running", "hipLRX").span).toBeGreaterThan(range("walking", "hipLRX").span * 1.4);
    const p = new Pose();
    sampleClip("running", 0.1, p, ctx);
    expect(p.c[CH.spineRX]).toBeGreaterThan(0.2);
  });

  it("jumping crouches, flies and lands", () => {
    const p = new Pose();
    sampleClip("jumping", 0.22, p, ctx);
    expect(p.c[CH.hipsY]).toBeLessThan(-2); // crouch
    expect(p.c[CH.rootY]).toBe(0);
    sampleClip("jumping", 0.58, p, ctx);
    expect(p.c[CH.rootY]).toBeGreaterThan(12); // mid-air
    sampleClip("jumping", 0.9, p, ctx);
    expect(p.c[CH.rootY]).toBe(0);
    expect(p.c[CH.hipsY]).toBeLessThan(-1.5); // landing absorb
  });

  it("working shows the laptop and types", () => {
    const p = new Pose();
    sampleClip("working", 1, p, ctx);
    expect(p.c[CH.propLaptop]).toBe(1);
    expect(p.c[CH.propChair]).toBe(1);
    expect(range("working", "elbowLRX", 240).span).toBeGreaterThan(0.05);
  });

  it("sleeping lies in bed, eyes closed, breathing", () => {
    const p = new Pose();
    sampleClip("sleeping", 1, p, ctx);
    expect(p.c[CH.propBed]).toBe(1);
    expect(p.face.eyes).toBe("closed");
    expect(Math.abs(p.c[CH.rootRZ])).toBeGreaterThan(1.4);
    expect(range("sleeping", "breath").span).toBeGreaterThan(1.5);
  });

  it("celebrating raises arms with a happy face", () => {
    const p = new Pose();
    sampleClip("celebrating", 0.4, p, ctx);
    expect(-p.c[CH.shoulderLRZ]).toBeGreaterThan(2);
    expect(p.c[CH.shoulderRRZ]).toBeGreaterThan(2);
    expect(p.face.eyes).toBe("happy");
  });

  it("error shows a confused face and tilts the head", () => {
    const p = new Pose();
    sampleClip("error", 1, p, ctx);
    expect(p.face.eyes).toBe("confused");
    expect(Math.abs(p.c[CH.headRZ])).toBeGreaterThan(0.2);
  });

  it("emits the expected effects", () => {
    const fx = (state: (typeof ANIMATION_STATES)[number], until: number) => {
      const got: FxRequest[] = [];
      let prev = 0;
      for (let t = 1 / 30; t <= until; t += 1 / 30) {
        CLIPS[state].fx?.(t, prev, ctx, (r) => got.push(r));
        prev = t;
      }
      return got.map((g) => g.kind);
    };
    expect(fx("sleeping", 4)).toContain("z");
    expect(fx("celebrating", 1.6)).toContain("confetti");
    expect(fx("error", 1)).toContain("question");
    expect(fx("completed", 1.2)).toContain("check");
    expect(fx("thinking", 1)).toContain("thought");
    expect(fx("listening", 1)).toContain("soundwave");
    expect(fx("running", 0.6)).toContain("speedline");
    expect(fx("working", 3.2)).toContain("typing");
  });

  it("cues cute sounds in sync with the motion", () => {
    const cues = (state: (typeof ANIMATION_STATES)[number], until: number) => {
      const got: string[] = [];
      let prev = 0;
      for (let t = 1 / 60; t <= until; t += 1 / 60) {
        CLIPS[state].fx?.(t, prev, ctx, () => undefined, (c) => got.push(c));
        prev = t;
      }
      return got;
    };
    expect(cues("walking", STATE_CONFIG.walking.duration).filter((c) => c === "step")).toHaveLength(2);
    expect(cues("jumping", 1.3)).toEqual(["jump", "land"]);
    expect(cues("working", 3.2)).toContain("type");
    expect(cues("talking", 2)).toContain("babble");
    expect(cues("sleeping", 4)).toContain("snore");
    expect(cues("completed", 1)).toContain("success");
    expect(CLIPS.celebrating.enterSound).toBe("celebrate");
    expect(CLIPS.error.enterSound).toBe("uhoh");
    expect(CLIPS.dragging.enterSound).toBe("pickup");
  });

  it("detects time crossings including loop wrap", () => {
    expect(crossed(0.1, 0.3, 0.2)).toBe(true);
    expect(crossed(0.3, 0.5, 0.2)).toBe(false);
    expect(crossed(1.9, 2.1, 0.05, 2)).toBe(true);
    expect(crossed(1.9, 0.1, 0.05, 2)).toBe(true);
    // sub-cycle periods across a loop wrap (celebration hops) must not recurse
    expect(crossed(1.55, 0.05, 0.01, 0.8)).toBe(true);
    expect(crossed(1.5, 1.55, 0.01, 0.8)).toBe(false);
    expect(crossed(0.75, 0.85, 0.01, 0.8)).toBe(true);
  });
});

describe("TransitionManager", () => {
  it("crossfades smoothly without snapping", () => {
    const a = new Pose();
    const b = new Pose();
    b.c[CH.headRY] = 1;
    const out = new Pose();
    const tm = new TransitionManager();
    tm.begin(a, 0.5);
    let last = 0;
    for (let i = 0; i < 32; i++) {
      tm.apply(b, 1 / 60, out);
      const v = out.c[CH.headRY];
      expect(v).toBeGreaterThanOrEqual(last - 1e-6);
      expect(v - last).toBeLessThan(0.12);
      last = v;
    }
    expect(last).toBeCloseTo(1, 3);
    expect(tm.blending).toBe(false);
  });
});
