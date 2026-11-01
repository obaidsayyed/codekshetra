import type { SundayAnimationState } from "../shared/states";

/**
 * Centralised state machine. It decides *which* animation is playing and how
 * we get there; it knows nothing about poses or rendering, so it is fully unit
 * testable.
 *
 * Rules
 * - Looping states play until something else is requested.
 * - One-shot states play for `duration` seconds and then continue to `next`
 *   (or to whatever was queued while they played).
 * - Non-interruptible one-shots (jumping, waking) queue lower-priority requests.
 * - Invalid direct transitions are routed through a valid intermediate state
 *   (e.g. sleeping → working goes sleeping → waking → working) instead of
 *   snapping.
 * - Dragging may interrupt anything; releasing returns to the previous state.
 */

export type Posture = "stand" | "sit" | "lie" | "air";

export interface StateConfig {
  loop: boolean;
  priority: number;
  /** Seconds: total length for one-shots, cycle length for loops. */
  duration: number;
  /** Where a finished one-shot goes. */
  next: SundayAnimationState;
  /** Crossfade time into this state, in seconds. */
  blendIn: number;
  interruptible: boolean;
  posture: Posture;
}

export const STATE_CONFIG: Record<SundayAnimationState, StateConfig> = {
  idle: { loop: true, priority: 0, duration: 12, next: "idle", blendIn: 0.35, interruptible: true, posture: "stand" },
  walking: { loop: true, priority: 10, duration: 0.9, next: "idle", blendIn: 0.25, interruptible: true, posture: "stand" },
  running: { loop: true, priority: 12, duration: 0.52, next: "idle", blendIn: 0.2, interruptible: true, posture: "stand" },
  jumping: { loop: false, priority: 25, duration: 1.3, next: "idle", blendIn: 0.12, interruptible: false, posture: "air" },
  sitting: { loop: true, priority: 15, duration: 8, next: "idle", blendIn: 0.55, interruptible: true, posture: "sit" },
  thinking: { loop: true, priority: 35, duration: 4, next: "idle", blendIn: 0.4, interruptible: true, posture: "stand" },
  working: { loop: true, priority: 30, duration: 3.2, next: "idle", blendIn: 0.6, interruptible: true, posture: "sit" },
  listening: { loop: true, priority: 40, duration: 2.4, next: "idle", blendIn: 0.35, interruptible: true, posture: "stand" },
  talking: { loop: true, priority: 40, duration: 2, next: "idle", blendIn: 0.3, interruptible: true, posture: "stand" },
  sleeping: { loop: true, priority: 5, duration: 4, next: "idle", blendIn: 0.9, interruptible: true, posture: "lie" },
  celebrating: { loop: true, priority: 50, duration: 1.6, next: "idle", blendIn: 0.25, interruptible: true, posture: "stand" },
  error: { loop: false, priority: 60, duration: 3.2, next: "idle", blendIn: 0.2, interruptible: true, posture: "stand" },
  dragging: { loop: true, priority: 100, duration: 1.2, next: "idle", blendIn: 0.15, interruptible: false, posture: "air" },
  waking: { loop: false, priority: 70, duration: 3, next: "idle", blendIn: 0.25, interruptible: false, posture: "lie" },
  completed: { loop: false, priority: 55, duration: 2.3, next: "idle", blendIn: 0.15, interruptible: true, posture: "stand" },
};

export interface RequestOptions {
  /** Studio / debug: play immediately regardless of priority and routing. */
  force?: boolean;
  /** Start time inside the clip (e.g. start a jump at its landing phase). */
  startAt?: number;
  /** One-shots: where to go when finished, overriding `next`. */
  then?: SundayAnimationState;
}

export interface RequestResult {
  accepted: boolean;
  /** States that will be entered, in order. */
  path: SundayAnimationState[];
  queued: boolean;
  reason?: string;
}

export interface StateEnterEvent {
  state: SundayAnimationState;
  from: SundayAnimationState;
  startAt: number;
  blendIn: number;
}

interface PendingStep {
  state: SundayAnimationState;
  startAt: number;
  then?: SundayAnimationState;
  /** Minimum dwell for intermediate route states. */
  dwell?: number;
}

/** Direct transitions that are *not* allowed (target ← sources). */
function directlyAllowed(from: SundayAnimationState, to: SundayAnimationState): boolean {
  if (from === to) return true;
  if (to === "dragging") return true;
  if (from === "dragging") return true; // release handling decides where we go
  if (to === "waking") return from === "sleeping";
  if (from === "sleeping") return false; // only waking (handled above) or dragging
  if (to === "sleeping") return from === "idle" || from === "sitting" || from === "working" || from === "waking" || from === "thinking" || from === "listening" || from === "talking";
  return true;
}

export function canTransition(from: SundayAnimationState, to: SundayAnimationState): boolean {
  return directlyAllowed(from, to);
}

/** Finds the shortest valid route from → to (at most two hops). */
export function resolvePath(from: SundayAnimationState, to: SundayAnimationState): SundayAnimationState[] | null {
  if (directlyAllowed(from, to)) return [to];
  const hubs: SundayAnimationState[] = ["waking", "idle"];
  for (const hub of hubs) if (directlyAllowed(from, hub) && directlyAllowed(hub, to)) return [hub, to];
  for (const a of hubs)
    for (const b of hubs) if (a !== b && directlyAllowed(from, a) && directlyAllowed(a, b) && directlyAllowed(b, to)) return [a, b, to];
  return null;
}

export class AnimationStateMachine {
  current: SundayAnimationState = "idle";
  previous: SundayAnimationState = "idle";
  /** Seconds spent in the current state. */
  time = 0;
  /** If set, the current one-shot finishes into this state. */
  private thenOverride: SundayAnimationState | undefined;
  /** State to return to after dragging. */
  private resumeState: SundayAnimationState = "idle";
  private queue: PendingStep[] = [];
  private dwell = 0;
  private listeners: ((e: StateEnterEvent) => void)[] = [];
  /** When true, finished one-shots restart instead of moving on (studio loop). */
  loopOneShots = false;
  /** When true, finished one-shots freeze on their last frame (studio, loop off). */
  holdOneShots = false;

  constructor(initial: SundayAnimationState = "idle") {
    this.current = initial;
    this.previous = initial;
  }

  onEnter(fn: (e: StateEnterEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  get config(): StateConfig {
    return STATE_CONFIG[this.current];
  }

  get pending(): readonly SundayAnimationState[] {
    return this.queue.map((q) => q.state);
  }

  get isOneShotFinished(): boolean {
    const c = this.config;
    return !c.loop && this.time >= c.duration;
  }

  request(to: SundayAnimationState, options: RequestOptions = {}): RequestResult {
    const from = this.current;

    if (options.force) {
      this.queue = [];
      if (to !== "dragging") this.resumeState = "idle";
      this.enter(to, options.startAt ?? 0, options.then);
      return { accepted: true, path: [to], queued: false };
    }

    if (to === "dragging") {
      if (from !== "dragging") {
        // remember a looping state to come back to
        const cfg = STATE_CONFIG[from];
        this.resumeState = cfg.loop ? from : cfg.next;
        if (from === "sleeping" || from === "waking") this.resumeState = "idle";
      }
      this.queue = [];
      this.enter("dragging", 0);
      return { accepted: true, path: ["dragging"], queued: false };
    }

    if (from === "dragging") {
      // Requests while held become the state we resume with after release.
      this.resumeState = (to as SundayAnimationState) === "waking" ? "idle" : to;
      return { accepted: true, path: [], queued: true, reason: "dragging" };
    }

    if (from === to && STATE_CONFIG[to].loop) {
      this.queue = [];
      return { accepted: true, path: [], queued: false, reason: "already-active" };
    }

    const path = resolvePath(from, to);
    if (!path) return { accepted: false, path: [], queued: false, reason: "no-valid-route" };

    const steps: PendingStep[] = path.map((s, i) => ({
      state: s,
      startAt: i === path.length - 1 ? options.startAt ?? 0 : 0,
      then: i === path.length - 1 ? options.then : undefined,
      dwell: i < path.length - 1 && STATE_CONFIG[s].loop ? 0.35 : undefined,
    }));

    const cfg = STATE_CONFIG[from];
    const targetPriority = STATE_CONFIG[to].priority;
    const blocked = !cfg.interruptible && !this.isOneShotFinished && targetPriority <= cfg.priority;
    if (blocked) {
      this.queue = steps;
      return { accepted: true, path, queued: true, reason: "waiting-for-one-shot" };
    }

    this.queue = steps.slice(1);
    const first = steps[0];
    this.dwell = first.dwell ?? 0;
    this.enter(first.state, first.startAt, first.then);
    return { accepted: true, path, queued: false };
  }

  /** Ends dragging; returns to the remembered state (via a landing jump if `landing`). */
  release(options: { landing?: boolean } = {}): void {
    if (this.current !== "dragging") return;
    const resume = this.resumeState;
    if (options.landing) {
      this.enter("jumping", 0.84, resume);
    } else {
      this.enter(resume, 0);
    }
  }

  /** Advances time and resolves finished one-shots / queued route steps. */
  advance(dt: number): void {
    this.time += dt;
    if (this.dwell > 0) this.dwell = Math.max(0, this.dwell - dt);

    const cfg = this.config;
    if (!cfg.loop && this.time >= cfg.duration) {
      if (this.loopOneShots) {
        this.time = this.time % cfg.duration;
        return;
      }
      if (this.holdOneShots) {
        this.time = cfg.duration;
        return;
      }
      if (this.queue.length) return this.dequeue();
      const next = this.thenOverride ?? cfg.next;
      this.enter(next, 0);
      return;
    }
    if (cfg.loop && this.queue.length && this.dwell <= 0) this.dequeue();
  }

  private dequeue(): void {
    const step = this.queue.shift();
    if (!step) return;
    this.dwell = step.dwell ?? 0;
    this.enter(step.state, step.startAt, step.then);
  }

  private enter(state: SundayAnimationState, startAt: number, then?: SundayAnimationState): void {
    const from = this.current;
    this.previous = from;
    this.current = state;
    this.time = startAt;
    this.thenOverride = then;
    const blendIn = STATE_CONFIG[state].blendIn;
    for (const l of this.listeners) l({ state, from, startAt, blendIn });
  }

  /** Restarts the current state from the beginning. */
  restart(): void {
    this.time = 0;
    for (const l of this.listeners) l({ state: this.current, from: this.current, startAt: 0, blendIn: 0.15 });
  }

  seek(t: number): void {
    this.time = Math.max(0, t);
  }
}
