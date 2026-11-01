import type { SundayAnimationState } from "../shared/states";
import type { Gait } from "./MovementController";

/**
 * Sunday's autonomous "brain". Decides, at natural intervals, whether to walk
 * somewhere, sit down, think, hop, or (at night) fall asleep. It never acts
 * while the user is interacting, while dragged, or while an external
 * integration holds a state. Pure and deterministic given its random source.
 */

export interface BrainEnv {
  state: SundayAnimationState;
  isMoving: boolean;
  anchorX: number;
  range: { minX: number; maxX: number };
  scale: number;
  roaming: boolean;
  quiet: boolean;
  night: boolean;
  /** An integration set a non-idle state and nobody released it yet. */
  externalHold: boolean;
  /** The user is hovering, dragging or has a panel open. */
  userBusy: boolean;
}

export type BrainAction =
  | { type: "setState"; state: SundayAnimationState }
  | { type: "moveTo"; x: number; gait: Gait }
  | { type: "stop" }
  | { type: "say"; text: string };

type Plan = "rest" | "moving" | "activity" | "asleep";

const CHATTER = {
  walk: ["On my way!", "Just stretching my legs.", "Patrolling the taskbar 🫡"],
  run: ["Zoom!", "Race you!"],
  sit: ["Time for a little break.", "Nice view from down here."],
  think: ["Hmm…", "Thinking…"],
  sleep: ["Good night! 🌙"],
};

export class RoamingBehavior {
  private plan: Plan = "rest";
  private timer: number;
  private idleFor = 0;
  private sinceChatter = 30;

  constructor(private readonly random: () => number = Math.random) {
    this.timer = 3 + random() * 3;
  }

  get currentPlan(): Plan {
    return this.plan;
  }

  /** Called when the movement controller reports arrival. */
  notifyArrived(): void {
    if (this.plan === "moving") {
      this.plan = "rest";
      this.timer = this.restTime(false);
    }
  }

  /** The user interacted; postpone autonomous decisions. */
  notifyInteraction(): void {
    if (this.plan === "rest") this.timer = Math.max(this.timer, 6);
    this.idleFor = 0;
  }

  /** Something else (integration, click-to-wake) changed the state: start fresh. */
  reset(): void {
    this.plan = "rest";
    this.timer = 4 + this.random() * 4;
    this.idleFor = 0;
  }

  private restTime(quiet: boolean): number {
    return quiet ? 9 + this.random() * 12 : 4 + this.random() * 8;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length) % items.length];
  }

  private maybeSay(env: BrainEnv, key: keyof typeof CHATTER, out: BrainAction[]): void {
    if (env.quiet || this.sinceChatter < 45) return;
    if (this.random() < 0.22) {
      out.push({ type: "say", text: this.pick(CHATTER[key]) });
      this.sinceChatter = 0;
    }
  }

  update(dt: number, env: BrainEnv): BrainAction[] {
    const out: BrainAction[] = [];
    this.sinceChatter += dt;

    if (env.state === "dragging" || env.externalHold) {
      if (this.plan !== "rest") this.plan = "rest";
      this.timer = Math.max(this.timer, 3);
      return out;
    }
    if (env.userBusy) {
      if (env.isMoving) out.push({ type: "stop" }, { type: "setState", state: "idle" });
      if (this.plan === "moving") this.plan = "rest";
      this.timer = Math.max(this.timer, 4);
      this.idleFor = 0;
      return out;
    }

    if (this.plan === "asleep") {
      // stay asleep until night ends (clicks wake Sunday from the pet view)
      if (env.state !== "sleeping") {
        this.reset();
      } else if (!env.night) {
        out.push({ type: "setState", state: "waking" });
        this.reset();
      }
      return out;
    }

    if (this.plan === "moving") {
      if (!env.isMoving && env.state !== "walking" && env.state !== "running") this.plan = "rest";
      return out;
    }

    this.timer -= dt;
    if (env.state === "idle") this.idleFor += dt;
    else this.idleFor = 0;

    if (this.plan === "activity") {
      if (this.timer <= 0) {
        out.push({ type: "setState", state: "idle" });
        this.plan = "rest";
        this.timer = this.restTime(env.quiet);
      }
      return out;
    }

    // plan === "rest"
    if (this.timer > 0 || env.state !== "idle") return out;
    return this.decide(env, out);
  }

  private decide(env: BrainEnv, out: BrainAction[]): BrainAction[] {
    const r = this.random();
    if (env.night) {
      if (this.idleFor > 18 || r < 0.5) {
        out.push({ type: "setState", state: "sleeping" });
        this.maybeSay(env, "sleep", out);
        this.plan = "asleep";
        return out;
      }
      if (r < 0.8) return this.startActivity(env, "sitting", 20, 40, out);
      this.timer = this.restTime(true);
      return out;
    }

    const canMove = env.roaming && env.range.maxX - env.range.minX > 80 * env.scale;
    const wWalk = canMove ? (env.quiet ? 0.3 : 0.45) : 0;
    const wRun = canMove && !env.quiet ? 0.07 : 0;
    const wSit = 0.16;
    const wThink = 0.08;
    const wJump = env.quiet ? 0.02 : 0.06;
    const total = wWalk + wRun + wSit + wThink + wJump + 0.18;
    let x = r * total;

    if ((x -= wWalk) < 0) return this.startMove(env, "walk", out);
    if ((x -= wRun) < 0) return this.startMove(env, "run", out);
    if ((x -= wSit) < 0) return this.startActivity(env, "sitting", 12, 28, out);
    if ((x -= wThink) < 0) return this.startActivity(env, "thinking", 4, 7, out);
    if ((x -= wJump) < 0) {
      out.push({ type: "setState", state: "jumping" });
      this.timer = this.restTime(env.quiet);
      return out;
    }
    // just keep idling (the idle clip looks around on its own)
    this.timer = this.restTime(env.quiet);
    return out;
  }

  private startActivity(env: BrainEnv, state: SundayAnimationState, min: number, max: number, out: BrainAction[]): BrainAction[] {
    out.push({ type: "setState", state });
    if (state === "sitting") this.maybeSay(env, "sit", out);
    if (state === "thinking") this.maybeSay(env, "think", out);
    this.plan = "activity";
    this.timer = min + this.random() * (max - min);
    return out;
  }

  private startMove(env: BrainEnv, gait: Gait, out: BrainAction[]): BrainAction[] {
    const { minX, maxX } = env.range;
    const s = env.scale;
    const [dMin, dMax] = gait === "run" ? [380 * s, 900 * s] : [110 * s, 420 * s];
    const roomLeft = env.anchorX - minX;
    const roomRight = maxX - env.anchorX;
    // head toward the side with more room, but not always
    const preferRight = roomRight > roomLeft ? this.random() < 0.75 : this.random() < 0.25;
    const dir = preferRight ? 1 : -1;
    const room = dir > 0 ? roomRight : roomLeft;
    const dist = Math.min(room, dMin + this.random() * (dMax - dMin));
    if (dist < 60 * s) {
      this.timer = this.restTime(env.quiet);
      return out;
    }
    out.push({ type: "moveTo", x: env.anchorX + dir * dist, gait });
    this.maybeSay(env, gait === "run" ? "run" : "walk", out);
    this.plan = "moving";
    return out;
  }
}
