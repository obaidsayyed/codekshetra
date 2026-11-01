import { Pose, smooth } from "./Pose";

/**
 * Crossfades from a snapshot of the last displayed pose to the new clip.
 * Because the snapshot is the *displayed* pose, interrupting a transition
 * halfway never snaps: the next blend simply starts from wherever we are.
 */
export class TransitionManager {
  private readonly from = new Pose();
  private elapsed = 0;
  private duration = 0;
  private active = false;

  get blending(): boolean {
    return this.active;
  }

  /** 0 → 1 progress of the current blend (1 when idle). */
  get progress(): number {
    return this.active ? Math.min(1, this.elapsed / this.duration) : 1;
  }

  begin(current: Pose, duration: number): void {
    this.from.copyFrom(current);
    this.elapsed = 0;
    this.duration = Math.max(0, duration);
    this.active = this.duration > 0;
  }

  cancel(): void {
    this.active = false;
  }

  apply(target: Pose, dt: number, out: Pose): void {
    if (!this.active) {
      out.copyFrom(target);
      return;
    }
    this.elapsed += dt;
    const w = smooth(this.elapsed / this.duration);
    out.blend(this.from, target, w);
    if (this.elapsed >= this.duration) this.active = false;
  }
}
