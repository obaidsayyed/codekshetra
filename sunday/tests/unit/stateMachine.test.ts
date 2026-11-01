import { describe, expect, it } from "vitest";
import { AnimationStateMachine, canTransition, resolvePath, STATE_CONFIG } from "../../src/animation/AnimationStateMachine";
import { ANIMATION_STATES } from "../../src/shared/states";

function advance(m: AnimationStateMachine, seconds: number, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) m.advance(step);
}

describe("AnimationStateMachine", () => {
  it("has a config for every state", () => {
    for (const s of ANIMATION_STATES) {
      const c = STATE_CONFIG[s];
      expect(c.duration).toBeGreaterThan(0);
      expect(c.blendIn).toBeGreaterThanOrEqual(0);
      expect(ANIMATION_STATES).toContain(c.next);
    }
  });

  it("allows the documented example transitions", () => {
    const pairs: [string, string][] = [
      ["idle", "walking"],
      ["walking", "idle"],
      ["walking", "running"],
      ["idle", "jumping"],
      ["jumping", "idle"],
      ["idle", "thinking"],
      ["thinking", "working"],
      ["working", "celebrating"],
      ["idle", "sleeping"],
      ["sleeping", "waking"],
      ["waking", "idle"],
    ];
    for (const [a, b] of pairs) expect(canTransition(a as never, b as never), `${a}→${b}`).toBe(true);
  });

  it("lets any state go to dragging", () => {
    for (const s of ANIMATION_STATES) expect(canTransition(s, "dragging")).toBe(true);
  });

  it("rejects invalid direct transitions and routes around them", () => {
    expect(canTransition("idle", "waking")).toBe(false);
    expect(canTransition("sleeping", "working")).toBe(false);
    expect(canTransition("running", "sleeping")).toBe(false);
    expect(resolvePath("sleeping", "working")).toEqual(["waking", "working"]);
    expect(resolvePath("running", "sleeping")).toEqual(["idle", "sleeping"]);
  });

  it("finishes one-shots into their next state", () => {
    const m = new AnimationStateMachine();
    m.request("completed");
    expect(m.current).toBe("completed");
    advance(m, STATE_CONFIG.completed.duration + 0.1);
    expect(m.current).toBe("idle");
  });

  it("queues lower-priority requests behind non-interruptible one-shots", () => {
    const m = new AnimationStateMachine();
    m.request("jumping");
    const r = m.request("walking");
    expect(r.queued).toBe(true);
    expect(m.current).toBe("jumping");
    advance(m, STATE_CONFIG.jumping.duration + 0.05);
    expect(m.current).toBe("walking");
  });

  it("lets higher priority interrupt interruptible states", () => {
    const m = new AnimationStateMachine();
    m.request("working");
    m.request("error");
    expect(m.current).toBe("error");
  });

  it("routes sleeping → waking → target over time", () => {
    const m = new AnimationStateMachine();
    m.request("sleeping");
    const r = m.request("working");
    expect(r.path).toEqual(["waking", "working"]);
    expect(m.current).toBe("waking");
    advance(m, STATE_CONFIG.waking.duration + 0.1);
    expect(m.current).toBe("working");
  });

  it("returns to the previous state after dragging", () => {
    const m = new AnimationStateMachine();
    m.request("thinking");
    m.request("dragging");
    expect(m.current).toBe("dragging");
    m.release();
    expect(m.current).toBe("thinking");
  });

  it("lands with a jump after a drop and then resumes", () => {
    const m = new AnimationStateMachine();
    m.request("sitting");
    m.request("dragging");
    m.release({ landing: true });
    expect(m.current).toBe("jumping");
    expect(m.time).toBeGreaterThan(0.5); // starts at the landing phase
    advance(m, 1);
    expect(m.current).toBe("sitting");
  });

  it("does not resume sleep after being picked up", () => {
    const m = new AnimationStateMachine();
    m.request("sleeping");
    m.request("dragging");
    m.release();
    expect(m.current).toBe("idle");
  });

  it("remembers requests made while dragging", () => {
    const m = new AnimationStateMachine();
    m.request("dragging");
    const r = m.request("working");
    expect(r.queued).toBe(true);
    m.release();
    expect(m.current).toBe("working");
  });

  it("force-plays anything for the studio", () => {
    const m = new AnimationStateMachine();
    m.request("waking", { force: true });
    expect(m.current).toBe("waking");
  });

  it("emits enter events with the blend time", () => {
    const m = new AnimationStateMachine();
    const seen: string[] = [];
    m.onEnter((e) => seen.push(`${e.from}>${e.state}:${e.blendIn}`));
    m.request("walking");
    expect(seen).toEqual([`idle>walking:${STATE_CONFIG.walking.blendIn}`]);
  });

  it("can loop or hold one-shots for preview", () => {
    const m = new AnimationStateMachine();
    m.loopOneShots = true;
    m.request("completed");
    advance(m, STATE_CONFIG.completed.duration * 2.5);
    expect(m.current).toBe("completed");
    const h = new AnimationStateMachine();
    h.holdOneShots = true;
    h.request("error");
    advance(h, STATE_CONFIG.error.duration + 1);
    expect(h.current).toBe("error");
    expect(h.time).toBeCloseTo(STATE_CONFIG.error.duration, 5);
  });
});
