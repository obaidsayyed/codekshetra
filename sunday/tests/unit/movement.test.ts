import { describe, expect, it } from "vitest";
import { clampAnchor, displayUnderAnchor, findAdjacentDisplay, reachableRange, walkBounds } from "../../src/movement/BoundaryManager";
import { MovementController } from "../../src/movement/MovementController";
import { RoamingBehavior, type BrainEnv } from "../../src/movement/RoamingBehavior";
import type { DisplayInfo } from "../../src/shared/ipc";

// Two side-by-side 1080p monitors with a taskbar on the first, plus a portrait monitor further right.
const A: DisplayInfo = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
const B: DisplayInfo = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1060 }, scaleFactor: 1.5 };
const C: DisplayInfo = { id: 3, bounds: { x: 3840, y: -400, width: 1080, height: 1920 }, workArea: { x: 3840, y: -400, width: 1080, height: 1880 }, scaleFactor: 1 };
const displays = [A, B, C];

describe("BoundaryManager", () => {
  it("uses the work area so the taskbar is never covered", () => {
    expect(walkBounds(A).floor).toBe(1040);
    expect(clampAnchor(displays, { x: 500, y: 1075 }).y).toBe(1040);
  });

  it("finds the display under the anchor", () => {
    expect(displayUnderAnchor(displays, { x: 100, y: 1040 })?.id).toBe(1);
    expect(displayUnderAnchor(displays, { x: 2500, y: 1060 })?.id).toBe(2);
  });

  it("connects adjacent monitors with similar floors only", () => {
    expect(findAdjacentDisplay(displays, A, 1)?.id).toBe(2);
    expect(findAdjacentDisplay(displays, B, -1)?.id).toBe(1);
    expect(findAdjacentDisplay(displays, B, 1)).toBeNull(); // C's floor is 420 px higher
    const r = reachableRange(displays, { x: 100, y: 1040 });
    expect(r.minX).toBeLessThan(200);
    expect(r.maxX).toBeGreaterThan(3600);
    expect(r.maxX).toBeLessThan(3840);
  });

  it("keeps the character on screen horizontally", () => {
    const a = clampAnchor(displays, { x: -500, y: 1040 });
    expect(a.x).toBeGreaterThanOrEqual(64);
  });
});

describe("MovementController", () => {
  const make = () => {
    const m = new MovementController();
    m.setDisplays(displays);
    m.setAnchor({ x: 1000, y: 1040 });
    return m;
  };

  it("walks to a target and reports arrival", () => {
    const m = make();
    m.moveTo(1200, "walk");
    expect(m.facing).toBe(1);
    let arrived = false;
    for (let i = 0; i < 600 && !arrived; i++) arrived = m.update(1 / 60).includes("arrived");
    expect(arrived).toBe(true);
    expect(m.anchor.x).toBeCloseTo(1200, 3);
    expect(m.anchor.y).toBe(1040);
  });

  it("runs faster than it walks", () => {
    const w = make();
    const r = make();
    w.moveTo(1800, "walk");
    r.moveTo(1800, "run");
    for (let i = 0; i < 60; i++) {
      w.update(1 / 60);
      r.update(1 / 60);
    }
    expect(r.anchor.x - 1000).toBeGreaterThan((w.anchor.x - 1000) * 2);
  });

  it("walks across to the next monitor and drops onto its lower floor", () => {
    const m = make();
    m.setAnchor({ x: 1880, y: 1040 });
    m.moveTo(2100, "walk");
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) landed = m.update(1 / 60).includes("landed");
    expect(landed).toBe(true);
    expect(m.anchor.y).toBe(1060);
  });

  it("falls after being dropped mid-air", () => {
    const m = make();
    m.startDrag();
    expect(m.endDrag({ x: 900, y: 600 })).toBe(true);
    let landed = false;
    for (let i = 0; i < 300 && !landed; i++) landed = m.update(1 / 60).includes("landed");
    expect(landed).toBe(true);
    expect(m.anchor.y).toBe(1040);
  });

  it("respects the movement speed multiplier", () => {
    const slow = make();
    const fast = make();
    slow.speedMultiplier = 0.5;
    fast.speedMultiplier = 2;
    slow.moveTo(1800, "walk");
    fast.moveTo(1800, "walk");
    for (let i = 0; i < 60; i++) {
      slow.update(1 / 60);
      fast.update(1 / 60);
    }
    expect(fast.anchor.x - 1000).toBeCloseTo((slow.anchor.x - 1000) * 4, 0);
  });
});

describe("RoamingBehavior", () => {
  const env = (patch: Partial<BrainEnv> = {}): BrainEnv => ({
    state: "idle",
    isMoving: false,
    anchorX: 1000,
    range: { minX: 64, maxX: 1856 },
    scale: 1,
    roaming: true,
    quiet: false,
    night: false,
    externalHold: false,
    userBusy: false,
    ...patch,
  });
  const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  it("waits a natural interval before acting", () => {
    const b = new RoamingBehavior(seeded(7));
    expect(b.update(1, env())).toEqual([]);
  });

  it("eventually walks somewhere within range", () => {
    const b = new RoamingBehavior(seeded(3));
    const moves: number[] = [];
    for (let i = 0; i < 600; i++) {
      for (const a of b.update(0.5, env())) if (a.type === "moveTo") moves.push(a.x);
      b.notifyArrived();
    }
    expect(moves.length).toBeGreaterThan(3);
    for (const x of moves) {
      expect(x).toBeGreaterThanOrEqual(64);
      expect(x).toBeLessThanOrEqual(1856);
    }
  });

  it("never moves when roaming is disabled", () => {
    const b = new RoamingBehavior(seeded(11));
    for (let i = 0; i < 400; i++) for (const a of b.update(0.5, env({ roaming: false }))) expect(a.type).not.toBe("moveTo");
  });

  it("stays still while the user interacts or an integration holds a state", () => {
    const b = new RoamingBehavior(seeded(5));
    for (let i = 0; i < 200; i++) expect(b.update(0.5, env({ userBusy: true })).filter((a) => a.type !== "stop" && a.type !== "setState")).toEqual([]);
    for (let i = 0; i < 200; i++) expect(b.update(0.5, env({ externalHold: true, state: "working" }))).toEqual([]);
  });

  it("stops walking when the user hovers", () => {
    const b = new RoamingBehavior(seeded(5));
    const out = b.update(0.1, env({ userBusy: true, isMoving: true, state: "walking" }));
    expect(out.map((a) => a.type)).toContain("stop");
  });

  it("falls asleep at night", () => {
    const b = new RoamingBehavior(seeded(9));
    let slept = false;
    for (let i = 0; i < 400 && !slept; i++) slept = b.update(0.5, env({ night: true })).some((a) => a.type === "setState" && a.state === "sleeping");
    expect(slept).toBe(true);
  });

  it("is quiet in quiet mode", () => {
    const b = new RoamingBehavior(seeded(13));
    for (let i = 0; i < 800; i++) {
      for (const a of b.update(0.5, env({ quiet: true }))) expect(a.type).not.toBe("say");
      b.notifyArrived();
    }
  });
});
