import * as THREE from "three";
import { HIP_HEIGHT, VOXEL } from "../character/CharacterConfig";
import type { SundayCharacter } from "../character/SundayModel";
import type { Effects } from "../effects/Effects";
import type { SundayAnimationState } from "../shared/states";
import { CLIPS, type ClipContext, type FxAnchor, type FxRequest, type SoundCue } from "./AnimationClips";
import { AnimationStateMachine, type RequestOptions, type RequestResult, STATE_CONFIG } from "./AnimationStateMachine";
import { CH, Pose, smooth } from "./Pose";
import { TransitionManager } from "./TransitionManager";

/**
 * Runs Sunday's animation: state machine → clip sampling → crossfade →
 * overlays (blinking, look-at-user) → rig. Movement (where the window is on
 * the desktop) is deliberately not handled here; see movement/.
 */

export type LoopMode = "natural" | "loop" | "once";

export interface EngineTimeline {
  state: SundayAnimationState;
  time: number;
  duration: number;
  loop: boolean;
  blending: boolean;
  paused: boolean;
}

const EYES_THAT_BLINK = new Set(["open", "wide", "focused", "confused", "sleepy"]);

export class AnimationEngine {
  readonly machine = new AnimationStateMachine();
  readonly ctx: ClipContext & { cycle: number } = { dir: 1, dragVX: 0, dragVY: 0, falling: false, speed: 1, cycle: 0 };
  timeScale = 1;
  paused = false;
  /** Receives sound cues from clips (footsteps, boings, babble…). Null = silent. */
  onSound: ((cue: SoundCue) => void) | null = null;

  private readonly transition = new TransitionManager();
  private readonly target = new Pose();
  readonly out = new Pose();
  private clock = 0;
  private lastClipTime = 0;
  private loopMode: LoopMode = "natural";
  private onceFinished = false;

  // blinking
  private blinkTimer = 2 + Math.random() * 2;
  private blinkPhase = -1;
  private doubleBlink = false;
  // look-at-user overlay
  private attention = 0;
  private attentionWave = false;
  private readonly tmpV = new THREE.Vector3();
  private stateListeners: ((s: SundayAnimationState, from: SundayAnimationState) => void)[] = [];

  constructor(
    readonly character: SundayCharacter,
    readonly effects: Effects | null = null,
  ) {
    this.machine.onEnter((e) => {
      this.transition.begin(this.out, e.blendIn);
      this.lastClipTime = e.startAt;
      this.onceFinished = false;
      const enter = CLIPS[e.state].enterSound;
      if (enter && e.state !== e.from && e.startAt === 0) this.onSound?.(enter);
      if (e.state !== e.from || e.startAt === 0) for (const l of this.stateListeners) l(e.state, e.from);
    });
    this.sampleTarget();
    this.out.copyFrom(this.target);
    this.applyToRig(this.out);
  }

  get state(): SundayAnimationState {
    return this.machine.current;
  }

  onStateChange(fn: (s: SundayAnimationState, from: SundayAnimationState) => void): () => void {
    this.stateListeners.push(fn);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== fn);
    };
  }

  request(state: SundayAnimationState, options?: RequestOptions): RequestResult {
    return this.machine.request(state, options);
  }

  setLoopMode(mode: LoopMode): void {
    this.loopMode = mode;
    this.machine.loopOneShots = mode === "loop";
    this.machine.holdOneShots = mode === "once";
    this.onceFinished = false;
  }

  restart(): void {
    this.onceFinished = false;
    this.machine.restart();
    this.lastClipTime = 0;
    this.effects?.clear();
  }

  /** Jumps to a time inside the current clip (studio timeline). */
  seek(t: number): void {
    this.machine.seek(t);
    this.lastClipTime = this.clipTime();
    this.transition.cancel();
    this.sampleTarget();
    this.out.copyFrom(this.target);
    this.applyOverlays(0);
    this.applyToRig(this.out);
  }

  /** Turn toward the user, smile, and (when idle) wave. */
  attend(): void {
    this.attention = 1.9;
    this.attentionWave = this.machine.current === "idle";
  }

  getTimeline(): EngineTimeline {
    const cfg = STATE_CONFIG[this.machine.current];
    return {
      state: this.machine.current,
      time: this.clipTime(),
      duration: cfg.duration,
      loop: cfg.loop,
      blending: this.transition.blending,
      paused: this.paused,
    };
  }

  private clipTime(): number {
    const cfg = STATE_CONFIG[this.machine.current];
    const t = this.machine.time;
    if (!cfg.loop) return Math.min(t, cfg.duration);
    if (this.loopMode === "once") return Math.min(t, cfg.duration);
    return t % cfg.duration;
  }

  private sampleTarget(): void {
    const cfg = STATE_CONFIG[this.machine.current];
    this.ctx.cycle = cfg.loop ? Math.floor(this.machine.time / cfg.duration) : 0;
    this.target.reset();
    CLIPS[this.machine.current].sample(this.clipTime(), this.target, this.ctx);
  }

  update(dt: number): void {
    const realDt = Math.min(dt, 0.1);
    if (this.paused) {
      this.effects?.update(0);
      return;
    }
    const sdt = realDt * this.timeScale;
    this.clock += sdt;

    const before = this.machine.current;
    if (!this.onceFinished) this.machine.advance(sdt);
    const cfg = STATE_CONFIG[this.machine.current];
    if (this.loopMode === "once" && cfg.loop && this.machine.time >= cfg.duration) this.onceFinished = true;

    this.sampleTarget();
    const t = this.clipTime();
    const clip = CLIPS[this.machine.current];
    if (clip.fx && this.effects && before === this.machine.current && !this.onceFinished) {
      clip.fx(t, this.lastClipTime, this.ctx, (req) => this.emit(req), (cue) => this.onSound?.(cue));
    }
    this.lastClipTime = t;

    this.transition.apply(this.target, sdt, this.out);
    this.applyOverlays(sdt);
    this.applyToRig(this.out);
    this.effects?.update(sdt);
    this.character.props.update(this.clock, this.out.c[CH.screenActivity]);
  }

  private applyOverlays(dt: number): void {
    const o = this.out;
    // --- blinking ---------------------------------------------------------
    this.blinkTimer -= dt;
    if (this.blinkPhase < 0 && this.blinkTimer <= 0) this.blinkPhase = 0;
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt;
      const d = 0.16;
      blink = this.blinkPhase < d ? Math.sin((this.blinkPhase / d) * Math.PI) : 0;
      if (this.blinkPhase >= d) {
        this.blinkPhase = -1;
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.blinkTimer = 2.2 + Math.random() * 3.6;
        } else if (Math.random() < 0.18) {
          this.doubleBlink = true; // a quick second blink now and then
          this.blinkTimer = 0.09;
        } else {
          this.blinkTimer = 2.2 + Math.random() * 3.6;
        }
      }
    }
    if (EYES_THAT_BLINK.has(o.face.eyes)) o.face.blink = Math.max(o.face.blink, blink);

    // --- attention (look toward the user) ---------------------------------
    if (this.attention > 0) {
      this.attention = Math.max(0, this.attention - dt);
      const total = 1.9;
      const age = total - this.attention;
      const w = smooth(age / 0.25) * smooth(this.attention / 0.45);
      const state = this.machine.current;
      const canTurn = state !== "sleeping" && state !== "waking" && state !== "dragging";
      if (canTurn && w > 0) {
        const yaw = o.c[CH.stageYaw];
        o.c[CH.headRY] += (-yaw * 0.75 - o.c[CH.headRY]) * w;
        o.c[CH.headRX] += (-0.08 - o.c[CH.headRX]) * w;
        o.c[CH.headRZ] += (0.06 - o.c[CH.headRZ]) * w;
        if (this.attentionWave && state === "idle") {
          const wave = Math.sin(age * 12) * 0.35;
          o.c[CH.shoulderRRZ] += (2.45 + wave - o.c[CH.shoulderRRZ]) * w;
          o.c[CH.shoulderRRX] += (-0.25 - o.c[CH.shoulderRRX]) * w;
          o.c[CH.elbowRRX] += (-0.55 - o.c[CH.elbowRRX]) * w;
        }
        if (w > 0.5) {
          o.face = { ...o.face, eyes: o.face.eyes === "focused" ? "open" : o.face.eyes, lookX: 0, lookY: 0, mouth: "grin", brows: "raised", blush: 1 };
        }
      }
    }
  }

  private applyToRig(p: Pose): void {
    const ch = this.character;
    const j = ch.joints;
    const c = p.c;
    ch.stage.rotation.y = c[CH.stageYaw];
    j.rigRoot.position.set(c[CH.rootX] * VOXEL, c[CH.rootY] * VOXEL, c[CH.rootZ] * VOXEL);
    j.rigRoot.rotation.set(c[CH.rootRX], c[CH.rootRY], c[CH.rootRZ]);
    const sq = Math.max(0.6, c[CH.squash]);
    const sxz = 1 / Math.sqrt(sq);
    j.rigRoot.scale.set(sxz, sq, sxz);
    j.hips.position.y = (HIP_HEIGHT + c[CH.hipsY]) * VOXEL;
    j.hips.rotation.set(c[CH.hipsRX], c[CH.hipsRY], c[CH.hipsRZ]);
    j.spine.rotation.set(c[CH.spineRX], c[CH.spineRY], c[CH.spineRZ]);
    j.neck.rotation.set(c[CH.headRX], c[CH.headRY], c[CH.headRZ]);
    j.shoulderL.rotation.set(c[CH.shoulderLRX], c[CH.shoulderLRY], c[CH.shoulderLRZ], "ZXY");
    j.shoulderR.rotation.set(c[CH.shoulderRRX], c[CH.shoulderRRY], c[CH.shoulderRRZ], "ZXY");
    j.elbowL.rotation.x = c[CH.elbowLRX];
    j.elbowR.rotation.x = c[CH.elbowRRX];
    j.hipL.rotation.set(c[CH.hipLRX], c[CH.hipLRY], c[CH.hipLRZ], "ZXY");
    j.hipR.rotation.set(c[CH.hipRRX], c[CH.hipRRY], c[CH.hipRRZ], "ZXY");
    j.kneeL.rotation.x = c[CH.kneeLRX];
    j.kneeR.rotation.x = c[CH.kneeRRX];

    const props = ch.props;
    props.setAmount("chair", c[CH.propChair]);
    props.setAmount("desk", c[CH.propDesk]);
    props.setAmount("laptop", c[CH.propLaptop]);
    props.setAmount("bed", c[CH.propBed]);
    props.setAmount("blanket", c[CH.propBlanket]);
    const blanket = props.items.blanket.children[0];
    if (blanket) blanket.scale.y = 1 + 0.025 * c[CH.breath];
    ch.setGlowIntensity(c[CH.glow]);
    ch.setFace(p.face);
  }

  /** Resolves an effect anchor to a position in the character's local frame. */
  anchorPosition(anchor: FxAnchor, target = new THREE.Vector3()): THREE.Vector3 {
    const j = this.character.joints;
    const V = VOXEL;
    const local = (obj: THREE.Object3D, x: number, y: number, z: number) => {
      target.set(x * V, y * V, z * V);
      obj.localToWorld(target);
      this.character.object.worldToLocal(target);
      return target;
    };
    switch (anchor) {
      case "head":
        return local(j.neck, 0, 6, 0);
      case "headTop":
        return local(j.neck, 0, 15, 0);
      case "earL":
        return local(j.neck, -11, 5, 0);
      case "earR":
        return local(j.neck, 11, 5, 0);
      case "handL":
        return local(j.elbowL, 0, -5, 0);
      case "handR":
        return local(j.elbowR, 0, -5, 0);
      case "laptop":
        return local(this.character.props.items.laptop, 0, 6, 3);
      case "feet":
        return target.set(this.character.stage.position.x, 0.02, 0);
      default:
        return target.set(0, 0, 0);
    }
  }

  private emit(req: FxRequest): void {
    if (!this.effects) return;
    const pos = this.anchorPosition(req.at ?? "root", this.tmpV);
    if (req.offset) pos.add(new THREE.Vector3(req.offset[0] * VOXEL, req.offset[1] * VOXEL, req.offset[2] * VOXEL));
    this.effects.spawn(req.kind, pos.clone(), { count: req.count, life: req.life, dir: this.ctx.dir || 1 });
  }

  /** Emits an effect directly (used by the desktop pet for clicks etc.). */
  emitEffect(req: FxRequest): void {
    this.emit(req);
  }
}
