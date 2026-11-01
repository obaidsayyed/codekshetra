import { STATE_CONFIG } from "../animation/AnimationStateMachine";
import type { ExtendedSundayController } from "../integration/SundayController";
import { applyAgentEvent } from "../integration/SundayAgentEvent";
import { dispatchPetCommand } from "../integration/DevelopmentAdapter";
import { displayUnderAnchor, rectRight } from "../movement/BoundaryManager";
import { MovementController } from "../movement/MovementController";
import { RoamingBehavior } from "../movement/RoamingBehavior";
import { PET_BASE_SIZE, PET_GROUND_PX, SundayScene } from "../scene/SundayScene";
import type { Anchor, DisplayInfo, PetEnvironment, SundayBridge } from "../shared/ipc";
import { isNightActive, SETTING_RANGES, type PetSettings } from "../shared/settings";
import type { SundayAnimationState, SundayState } from "../shared/states";
import { playSound, setSoundEnabled, setSoundVolume } from "./sound";
import { react, say, setVoiceSettings, type Reaction } from "./voice";

/**
 * Everything that makes the desktop pet tick, outside React:
 *   frame loop (adaptive fps, paused when hidden) → movement → brain → engine
 *   pointer input (hit-testing, click / double-click / drag / context menu)
 *   the local SundayController used by integrations and the dev playground.
 * React only renders the overlays (bubble, menu, moon) from the callbacks.
 */

export interface BubbleModel {
  id: number;
  text: string;
  pinned: boolean;
}

export interface PetRuntimeCallbacks {
  onBubble(b: BubbleModel | null): void;
  onMenu(pos: { x: number; y: number } | null): void;
  onNight(active: boolean): void;
  onState?(s: SundayAnimationState): void;
}

const GREETINGS = ["Hey! I'm Sunday. 👋", "Hi there! 👋", "Need anything?", "Hehe, that tickles!", "I'm here!"];

export class PetRuntime {
  readonly scene: SundayScene;
  readonly movement = new MovementController();
  readonly brain = new RoamingBehavior();
  readonly controller: ExtendedSundayController;

  private settings: PetSettings;
  private displays: DisplayInfo[] = [];
  private raf = 0;
  private running = false;
  private visible = true;
  private last = performance.now();
  private accum = 0;
  private lastSent: Anchor = { x: NaN, y: NaN };
  private externalHold = false;
  private hovering = false;
  private hoverUntil = 0;
  private panelBusyUntil = 0;
  private menuOpen = false;
  private interactive = false;
  private lastHitCheck = 0;
  private pointerDown: { x: number; y: number; screenX: number; screenY: number } | null = null;
  private dragging = false;
  private clicks = 0;
  private bubble: BubbleModel | null = null;
  private bubbleTimer = 0;
  private bubbleId = 0;
  private bubbleEl: HTMLElement | null = null;
  private bubbleX = NaN;
  private bubbleY = NaN;
  private extraHeight = 0;
  private night = false;
  private disposers: (() => void)[] = [];
  private nightTimer = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly bridge: SundayBridge | null,
    settings: PetSettings,
    private readonly cb: PetRuntimeCallbacks,
  ) {
    this.settings = settings;
    this.scene = new SundayScene(canvas, { mode: "pet", appearance: settings.appearance, shadows: true, maxPixelRatio: 2 });
    this.controller = this.createController();
    this.applySettings(settings);
    this.scene.engine.onStateChange((s, from) => this.onStateChanged(s, from));
    this.scene.engine.onSound = (cue) => playSound(cue);
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.bridge) {
      const env = await this.bridge.pet.getEnvironment();
      this.applyEnvironment(env);
      this.disposers.push(
        this.bridge.pet.onEnvironment((e) => this.applyEnvironment(e)),
        this.bridge.pet.onDragMove((u) => {
          this.movement.setAnchor(u.anchor);
          this.scene.engine.ctx.dragVX = u.vx;
          this.scene.engine.ctx.dragVY = u.vy;
        }),
        this.bridge.pet.onDragEnded((a) => this.finishDrag(a)),
        this.bridge.pet.onVisibility((v) => this.setVisible(v)),
        this.bridge.pet.onCommand((cmd) =>
          dispatchPetCommand(this.controller, cmd, (c) => {
            applyAgentEvent(this.controller, c.event);
          }),
        ),
      );
    } else {
      // browser preview: pretend to stand on a 1920 × 1040 work area
      this.applyEnvironment({
        displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 }],
        anchor: { x: 1400, y: 1040 },
        windowSize: { ...PET_BASE_SIZE },
      });
    }
    this.bindInput();
    this.resize();
    this.running = true;
    this.last = performance.now();
    this.loop();
    this.nightTimer = window.setInterval(() => this.updateNight(), 30_000);
    this.updateNight();
    window.setTimeout(() => {
      if (!this.settings.quietMode) this.controller.setSpeech("Hey! I'm Sunday. 👋");
    }, 900);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.nightTimer);
    for (const d of this.disposers) d();
    this.scene.dispose();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v && this.running) {
      this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.loop();
    }
  }

  applySettings(s: PetSettings): void {
    const prev = this.settings;
    this.settings = s;
    this.scene.engine.timeScale = s.animationSpeed;
    this.movement.speedMultiplier = s.movementSpeed;
    this.scene.engine.ctx.speed = s.movementSpeed;
    if (prev.appearance !== s.appearance) this.scene.setAppearance(s.appearance);
    if (prev.characterScale !== s.characterScale || this.movement.scale !== s.characterScale) {
      this.movement.scale = s.characterScale;
      this.scene.setPetScale(s.characterScale);
      this.resize();
    }
    setSoundEnabled(s.soundEffects && !s.quietMode);
    setSoundVolume(s.soundVolume);
    setVoiceSettings(s.voice, s.soundEffects && !s.quietMode, s.soundVolume);
    if (!s.roaming && this.movement.isMoving) {
      this.movement.stop();
      this.scene.engine.request("idle");
    }
    this.updateNight();
  }

  private applyEnvironment(env: PetEnvironment): void {
    this.displays = env.displays;
    this.movement.setDisplays(env.displays);
    if (this.movement.mode !== "drag" && this.movement.mode !== "fall") this.movement.setAnchor(env.anchor);
    this.lastSent = { ...env.anchor };
    this.resize();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.scene.setSize(w, h);
  }

  private updateNight(): void {
    const n = isNightActive(this.settings.nightMode);
    if (n !== this.night) {
      this.night = n;
      this.cb.onNight(n);
      if (n && !this.settings.quietMode && this.scene.engine.state === "idle") this.controller.setSpeech("Good night! 🌙");
    }
    this.scene.setNight(n);
  }

  // ---------------------------------------------------------------------------
  // frame loop
  // ---------------------------------------------------------------------------

  private targetFps(): number {
    const st = this.scene.engine.state;
    if (this.dragging || this.movement.mode !== "idle") return 60;
    if (!STATE_CONFIG[st].loop || st === "celebrating" || st === "running") return 60;
    if (st === "sleeping") return 20;
    if (st === "idle" || st === "sitting" || st === "working" || st === "thinking") return 30;
    return 45;
  }

  private loop = (): void => {
    if (!this.running || !this.visible || document.hidden) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.accum += dt;
    const step = 1 / this.targetFps();
    if (this.accum + 0.002 < step) return;
    const frameDt = Math.min(0.1, this.accum);
    this.accum = 0;
    this.tick(frameDt);
  };

  private tick(dt: number): void {
    const engine = this.scene.engine;

    // movement → window position
    const events = this.movement.update(dt);
    if (this.movement.isMoving) engine.ctx.dir = this.movement.facing;
    for (const e of events) {
      if (e === "arrived" || e === "blocked") {
        if (engine.state === "walking" || engine.state === "running") engine.request("idle");
        this.brain.notifyArrived();
      } else if (e === "landed") {
        engine.ctx.falling = false;
        engine.machine.release({ landing: true });
      }
    }
    if (this.movement.mode === "fall" && !engine.ctx.falling) {
      playSound("fall");
      react("drop");
    }
    if (this.movement.mode === "fall") engine.ctx.falling = true;
    this.sendAnchor();

    // brain
    const now = performance.now();
    const userBusy = this.dragging || this.menuOpen || this.hovering || now < this.hoverUntil || now < this.panelBusyUntil;
    const actions = this.brain.update(dt, {
      state: engine.state,
      isMoving: this.movement.isMoving,
      anchorX: this.movement.anchor.x,
      range: this.movement.range,
      scale: this.settings.characterScale,
      roaming: this.settings.roaming,
      quiet: this.settings.quietMode,
      night: this.night,
      externalHold: this.externalHold,
      userBusy,
    });
    for (const a of actions) {
      if (a.type === "setState") engine.request(a.state);
      else if (a.type === "stop") this.movement.stop();
      else if (a.type === "say") this.showBubble(a.text, false);
      else if (a.type === "moveTo") this.startMove(a.x, a.gait);
    }

    // bubble lifetime
    if (this.bubble && !this.bubble.pinned) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) this.hideBubble();
    }

    this.scene.setGroundVisible(!this.dragging && this.movement.mode !== "fall" && this.movement.mode !== "drag");
    this.scene.frame(dt);
    this.positionBubble();
  }

  private sendAnchor(): void {
    const a = this.movement.anchor;
    const rx = Math.round(a.x);
    const ry = Math.round(a.y);
    if (rx === this.lastSent.x && ry === this.lastSent.y) return;
    if (this.movement.mode === "drag") return; // main process owns the window while dragging
    this.lastSent = { x: rx, y: ry };
    this.bridge?.pet.moveTo({ x: rx, y: ry });
  }

  private startMove(x: number, gait: "walk" | "run"): void {
    this.movement.moveTo(x, gait);
    if (!this.movement.isMoving) return;
    this.scene.engine.ctx.dir = this.movement.facing;
    this.scene.engine.request(gait === "run" ? "running" : "walking");
  }

  private onStateChanged(s: SundayAnimationState, from: SundayAnimationState): void {
    this.bridge?.pet.reportState(s);
    this.cb.onState?.(s);
    // sound effects come from the clips themselves (engine.onSound); spoken reactions here
    const reactions: Partial<Record<SundayAnimationState, Reaction>> = {
      celebrating: "celebrate",
      error: "error",
      completed: "completed",
      waking: "wake",
      sleeping: "sleep",
      dragging: "pickup",
    };
    const r = reactions[s];
    if (r && s !== from) window.setTimeout(() => react(r), s === "completed" ? 450 : 150);
    // leaving walking/running for anything else stops the window
    if (s !== "walking" && s !== "running" && this.movement.isMoving) this.movement.stop();
    if (s === "idle") this.externalHold = false;
  }

  // ---------------------------------------------------------------------------
  // speech bubble
  // ---------------------------------------------------------------------------

  setBubbleElement(el: HTMLElement | null): void {
    this.bubbleEl = el;
    this.bubbleX = NaN;
    this.bubbleY = NaN;
  }

  showBubble(text: string, pinned: boolean): void {
    const clean = text.trim().slice(0, 600);
    if (!clean) return;
    this.bubble = { id: ++this.bubbleId, text: clean, pinned };
    this.bubbleTimer = Math.min(12, Math.max(3, 2.2 + clean.length * 0.06));
    this.cb.onBubble(this.bubble);
    playSound("bubble");
    window.setTimeout(() => say(clean), 110);
  }

  hideBubble(): void {
    if (!this.bubble) return;
    this.bubble = null;
    this.cb.onBubble(null);
    this.setExtraHeight(0);
  }

  togglePinBubble(): void {
    if (!this.bubble) return;
    this.bubble = { ...this.bubble, pinned: !this.bubble.pinned };
    this.bubbleTimer = 4;
    this.cb.onBubble(this.bubble);
  }

  private setExtraHeight(px: number): void {
    const v = Math.max(0, Math.min(360, Math.round(px)));
    if (Math.abs(v - this.extraHeight) < 4 && v !== 0) return;
    if (v === this.extraHeight) return;
    this.extraHeight = v;
    this.bridge?.pet.setExtraHeight(v);
  }

  /** Places the bubble above Sunday's head, inside the visible part of the screen. */
  private positionBubble(): void {
    const el = this.bubbleEl;
    if (!el || !this.bubble) return;
    const canvasTop = this.canvas.offsetTop;
    const live = this.scene.headTopScreen();
    const standing = this.scene.standingHeadTopScreen();
    const headX = live.x;
    const headY = Math.min(live.y, standing.y) + canvasTop;
    const k = Number.isNaN(this.bubbleX) ? 1 : 0.25;
    this.bubbleX = Number.isNaN(this.bubbleX) ? headX : this.bubbleX + (headX - this.bubbleX) * k;
    this.bubbleY = Number.isNaN(this.bubbleY) ? headY : this.bubbleY + (headY - this.bubbleY) * k;

    const winW = window.innerWidth;
    // the part of the window that is actually on screen
    let visLeft = 0;
    let visRight = winW;
    const d = displayUnderAnchor(this.displays, this.movement.anchor);
    if (d) {
      const winX = this.movement.anchor.x - winW / 2;
      visLeft = Math.max(0, d.workArea.x - winX);
      visRight = Math.min(winW, rectRight(d.workArea) - winX);
    }
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    const margin = 8;
    const left = Math.min(Math.max(this.bubbleX - bw / 2, visLeft + margin), Math.max(visLeft + margin, visRight - margin - bw));
    const bottomGap = 14;
    const top = this.bubbleY - bottomGap - bh;
    if (top < 4) this.setExtraHeight(this.extraHeight + (4 - top));
    else if (this.extraHeight > 0 && top > 40) this.setExtraHeight(Math.max(0, this.extraHeight - (top - 20)));
    const pointer = Math.min(bw - 18, Math.max(18, this.bubbleX - left));
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(4, top))}px)`;
    el.style.setProperty("--pointer-x", `${Math.round(pointer)}px`);
  }

  // ---------------------------------------------------------------------------
  // input
  // ---------------------------------------------------------------------------

  setMenuOpen(open: boolean): void {
    if (this.menuOpen && !open) playSound("menuClose");
    this.menuOpen = open;
    this.updateInteractive(open || this.hovering || !!this.bubble?.pinned);
    if (!open) this.cb.onMenu(null);
  }

  private canvasPoint(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hit(e: MouseEvent): boolean {
    const p = this.canvasPoint(e);
    if (p.y < 0 || p.x < 0) return false;
    return this.scene.hitTest(p.x, p.y);
  }

  private updateInteractive(on: boolean): void {
    if (on === this.interactive) return;
    this.interactive = on;
    this.bridge?.pet.setInteractive(on);
    document.body.classList.toggle("pet-hover", on && !this.menuOpen);
  }

  private bindInput(): void {
    const onMove = (e: MouseEvent) => {
      if (this.dragging) return;
      if (this.pointerDown) {
        const dx = e.screenX - this.pointerDown.screenX;
        const dy = e.screenY - this.pointerDown.screenY;
        if (Math.hypot(dx, dy) > 5) this.beginDrag();
        return;
      }
      const now = performance.now();
      if (now - this.lastHitCheck < 30) return;
      this.lastHitCheck = now;
      const overUi = (e.target as HTMLElement | null)?.closest?.("[data-interactive]") != null;
      const over = overUi || this.hit(e);
      if (over !== this.hovering) {
        this.hovering = over;
        if (!over) this.hoverUntil = now + 2500;
        else this.brain.notifyInteraction();
      }
      this.updateInteractive(over || this.menuOpen);
    };
    const onLeave = () => {
      if (this.dragging || this.pointerDown) return;
      if (this.hovering) this.hoverUntil = performance.now() + 2500;
      this.hovering = false;
      this.updateInteractive(this.menuOpen);
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement | null)?.closest?.("[data-interactive]")) return;
      if (this.menuOpen) {
        this.setMenuOpen(false);
        return;
      }
      if (!this.hit(e)) return;
      this.pointerDown = { x: e.clientX, y: e.clientY, screenX: e.screenX, screenY: e.screenY };
    };
    const onUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (this.dragging) {
        this.endDrag();
        return;
      }
      if (this.pointerDown) {
        this.pointerDown = null;
        this.handleClick();
      }
    };
    const onDbl = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.("[data-interactive]")) return;
      if (!this.hit(e)) return;
      this.panelBusyUntil = performance.now() + 20_000;
      playSound("panelOpen");
      this.bridge?.openWindow("panel");
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      if (!this.hit(e) && !this.menuOpen) return;
      this.menuOpen = true;
      this.updateInteractive(true);
      this.cb.onMenu({ x: e.clientX, y: e.clientY });
      playSound("menuOpen");
      this.brain.notifyInteraction();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        this.setMenuOpen(false);
        if (this.bubble?.pinned) this.hideBubble();
      }
    };
    const onBlur = () => {
      if (this.menuOpen) this.setMenuOpen(false);
      if (this.dragging) this.endDrag();
    };
    const onResize = () => this.resize();
    const onVis = () => this.setVisible(!document.hidden);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("dblclick", onDbl);
    window.addEventListener("contextmenu", onContext);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVis);
    this.disposers.push(() => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("dblclick", onDbl);
      window.removeEventListener("contextmenu", onContext);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
    });
  }

  private handleClick(): void {
    const engine = this.scene.engine;
    this.brain.notifyInteraction();
    playSound("boop");
    if (engine.state === "sleeping") {
      this.controller.wake();
      return;
    }
    if (this.movement.isMoving) {
      this.movement.stop();
      engine.request("idle");
    }
    engine.attend();
    window.setTimeout(() => playSound("greet"), 120);
    this.clicks++;
    if (!this.settings.quietMode && (this.clicks === 1 || Math.random() < 0.35)) {
      this.showBubble(this.clicks === 1 ? GREETINGS[0] : GREETINGS[1 + Math.floor(Math.random() * (GREETINGS.length - 1))], false);
    } else {
      window.setTimeout(() => react("poke"), 200);
    }
  }

  private beginDrag(): void {
    this.pointerDown = null;
    this.dragging = true;
    this.movement.startDrag();
    this.scene.engine.ctx.falling = false;
    this.scene.engine.request("dragging");
    this.updateInteractive(true);
    this.bridge?.pet.startDrag();
  }

  private endDrag(): void {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.bridge) {
      this.bridge.pet.endDrag(); // the main process answers with onDragEnded
    } else {
      this.finishDrag(this.movement.anchor);
    }
  }

  private finishDrag(anchor: Anchor): void {
    this.dragging = false;
    this.scene.engine.ctx.dragVX = 0;
    this.scene.engine.ctx.dragVY = 0;
    const falling = this.movement.endDrag(anchor);
    this.lastSent = { x: NaN, y: NaN };
    if (falling) {
      this.scene.engine.ctx.falling = true;
    } else {
      this.scene.engine.machine.release({ landing: false });
    }
    this.hoverUntil = performance.now() + 3000;
    this.brain.notifyInteraction();
  }

  // ---------------------------------------------------------------------------
  // controller (public API for integrations)
  // ---------------------------------------------------------------------------

  private createController(): ExtendedSundayController {
    const engine = () => this.scene.engine;
    const persist = (patch: Partial<PetSettings>) => {
      if (this.bridge) void this.bridge.updateSettings(patch);
      else this.applySettings({ ...this.settings, ...patch });
    };
    return {
      setState: (state: SundayState) => {
        const e = engine();
        this.brain.reset();
        if (state === "walking" || state === "running") {
          const r = this.movement.range;
          const x = this.movement.anchor.x;
          const dir = r.maxX - x > x - r.minX ? 1 : -1;
          this.startMove(x + dir * (state === "running" ? 600 : 260) * this.settings.characterScale, state === "running" ? "run" : "walk");
          if (!this.movement.isMoving) e.request(state);
          this.externalHold = false;
          return;
        }
        if (this.movement.isMoving) this.movement.stop();
        this.externalHold = state !== "idle" && STATE_CONFIG[state].loop;
        e.request(state);
      },
      setSpeech: (text: string) => this.showBubble(text, false),
      setPinnedSpeech: (text: string) => this.showBubble(text, true),
      clearSpeech: () => this.hideBubble(),
      setRoaming: (enabled: boolean) => persist({ roaming: enabled }),
      setMovementSpeed: (speed: number) =>
        persist({ movementSpeed: Math.min(SETTING_RANGES.movementSpeed.max, Math.max(SETTING_RANGES.movementSpeed.min, speed)) }),
      setCharacterScale: (scale: number) =>
        persist({ characterScale: Math.min(SETTING_RANGES.characterScale.max, Math.max(SETTING_RANGES.characterScale.min, scale)) }),
      greet: () => {
        engine().attend();
        this.showBubble(GREETINGS[0], false);
      },
      wake: () => {
        if (engine().state === "sleeping") {
          this.brain.reset();
          engine().request("waking");
          if (!this.settings.quietMode) window.setTimeout(() => this.showBubble("Good morning! ☀️", false), 2600);
        }
      },
      getState: () => engine().state,
    };
  }
}

export const PET_LAYOUT = { ...PET_BASE_SIZE, groundPx: PET_GROUND_PX };
