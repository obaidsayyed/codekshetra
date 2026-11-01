import type { Anchor, DisplayInfo } from "../shared/ipc";
import { clampAnchor, floorAt, MAX_FLOOR_STEP, reachableRange } from "./BoundaryManager";

/**
 * Moves the pet's anchor across the desktop: walking/running toward a target
 * x, falling under gravity after a drop, and stepping between monitors with
 * compatible floors. Pure logic — the renderer feeds it time and sends the
 * resulting anchor to the main process, which positions the real window.
 */

export type Gait = "walk" | "run";
export type MoveMode = "idle" | "walk" | "run" | "fall" | "drag";
export type MoveEvent = "arrived" | "landed" | "blocked";

export const WALK_SPEED = 78; // DIP / s at scale 1, speed 1
export const RUN_SPEED = 230;
export const GRAVITY = 2600;

export class MovementController {
  anchor: Anchor = { x: 0, y: 0 };
  mode: MoveMode = "idle";
  facing: -1 | 1 = 1;
  targetX: number | null = null;
  speedMultiplier = 1;
  scale = 1;
  private vy = 0;
  private displays: DisplayInfo[] = [];

  setDisplays(displays: DisplayInfo[]): void {
    this.displays = displays;
    if (this.mode !== "drag" && this.mode !== "fall" && displays.length) {
      const floor = floorAt(displays, this.anchor.x, this.anchor.y);
      if (floor !== null && Math.abs(floor - this.anchor.y) > 1) {
        // display layout changed: re-seat on the nearest floor
        this.anchor = clampAnchor(displays, { x: this.anchor.x, y: floor }, this.scale);
      }
    }
  }

  setAnchor(a: Anchor): void {
    this.anchor = { ...a };
  }

  get isMoving(): boolean {
    return this.mode === "walk" || this.mode === "run";
  }

  get range(): { minX: number; maxX: number } {
    return reachableRange(this.displays, this.anchor, this.scale);
  }

  /** Starts walking/running to x (clamped to the reachable range). Returns the clamped target. */
  moveTo(x: number, gait: Gait): number {
    const r = this.range;
    const tx = Math.min(r.maxX, Math.max(r.minX, x));
    this.targetX = tx;
    if (Math.abs(tx - this.anchor.x) < 2) {
      this.targetX = null;
      this.mode = "idle";
      return tx;
    }
    this.facing = tx > this.anchor.x ? 1 : -1;
    this.mode = gait;
    return tx;
  }

  stop(): void {
    if (this.isMoving) {
      this.mode = "idle";
      this.targetX = null;
    }
  }

  startDrag(): void {
    this.mode = "drag";
    this.targetX = null;
    this.vy = 0;
  }

  /** Ends a drag at the anchor reported by the main process. Returns true if Sunday must fall. */
  endDrag(anchor: Anchor): boolean {
    this.anchor = clampAnchor(this.displays, anchor, this.scale);
    const floor = floorAt(this.displays, this.anchor.x, this.anchor.y);
    if (floor !== null && floor - this.anchor.y > 2) {
      this.mode = "fall";
      this.vy = 0;
      return true;
    }
    if (floor !== null) this.anchor.y = floor;
    this.mode = "idle";
    return false;
  }

  update(dt: number): MoveEvent[] {
    const events: MoveEvent[] = [];
    if (this.mode === "fall") {
      this.vy += GRAVITY * dt;
      this.anchor.y += this.vy * dt;
      const floor = floorAt(this.displays, this.anchor.x, this.anchor.y - this.vy * dt);
      if (floor !== null && this.anchor.y >= floor) {
        this.anchor.y = floor;
        this.vy = 0;
        this.mode = "idle";
        events.push("landed");
      }
      return events;
    }
    if (!this.isMoving || this.targetX === null) return events;

    const speed = (this.mode === "run" ? RUN_SPEED : WALK_SPEED) * this.speedMultiplier * this.scale;
    const dx = this.targetX - this.anchor.x;
    const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
    const nextX = this.anchor.x + step;

    // floor at the next position (stepping across monitors)
    const floor = floorAt(this.displays, nextX, this.anchor.y);
    if (floor === null) {
      this.mode = "idle";
      this.targetX = null;
      events.push("blocked");
      return events;
    }
    if (floor < this.anchor.y - MAX_FLOOR_STEP) {
      // a wall: the next display's floor is much higher
      this.mode = "idle";
      this.targetX = null;
      events.push("blocked");
      return events;
    }
    this.anchor.x = nextX;
    if (floor > this.anchor.y + 1) {
      // stepping down onto a lower monitor: drop
      this.mode = "fall";
      this.vy = 0;
      this.targetX = null;
      return events;
    }
    this.anchor.y = floor;
    if (Math.abs(this.targetX - this.anchor.x) < 0.5) {
      this.anchor.x = this.targetX;
      this.targetX = null;
      this.mode = "idle";
      events.push("arrived");
    }
    return events;
  }
}
