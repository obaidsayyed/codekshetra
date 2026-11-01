import { BrowserWindow, screen } from "electron";
import { clampAnchor, displayUnderAnchor, rectBottom } from "../src/movement/BoundaryManager";
import { IPC, type Anchor, type DragUpdate, type PetEnvironment } from "../src/shared/ipc";
import { getDisplays, getPrimaryDisplay } from "./displayManager";
import { createWindow } from "./windowManager";

/**
 * Owns the transparent pet window and its real desktop position.
 *
 * The renderer decides *where* Sunday wants to be (an anchor between his
 * feet); this class validates that against the current displays' work areas
 * and moves the actual window. While the user drags, the main process polls
 * the cursor itself so fast drags never lose the window.
 */

export const PET_BASE = { width: 300, height: 340 } as const;
const DRAG_INTERVAL_MS = 16;

export class DesktopManager {
  pet: BrowserWindow | null = null;
  private anchor: Anchor;
  private scale = 1;
  private extraHeight = 0;
  private dragTimer: NodeJS.Timeout | null = null;
  private grabOffset = { x: 0, y: 0 };
  private velocity = { x: 0, y: 0 };
  private lastDrag = { x: 0, y: 0, t: 0 };
  private interactive = false;

  constructor(initialScale: number) {
    this.scale = initialScale;
    const p = getPrimaryDisplay();
    this.anchor = { x: Math.round(p.workArea.x + p.workArea.width * 0.78), y: rectBottom(p.workArea) };
  }

  createPet(alwaysOnTop: boolean, visible: boolean): BrowserWindow {
    const size = this.windowSize();
    const b = this.boundsFor(this.anchor, size);
    const win = createWindow("pet", {
      ...b,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: true,
      alwaysOnTop,
      backgroundColor: "#00000000",
      title: "SUNDAY",
      webPreferences: { backgroundThrottling: false },
    });
    if (alwaysOnTop) win.setAlwaysOnTop(true, "floating");
    win.setIgnoreMouseEvents(true, { forward: true });
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.once("ready-to-show", () => {
      if (visible) win.showInactive();
    });
    win.on("show", () => win.webContents.send(IPC.petVisibility, true));
    win.on("hide", () => win.webContents.send(IPC.petVisibility, false));
    win.on("closed", () => {
      this.stopDrag();
      this.pet = null;
    });
    this.pet = win;
    return win;
  }

  windowSize(): { width: number; height: number } {
    return {
      width: Math.max(280, Math.round(PET_BASE.width * this.scale)),
      height: Math.round(PET_BASE.height * this.scale) + this.extraHeight,
    };
  }

  private boundsFor(anchor: Anchor, size = this.windowSize()): Electron.Rectangle {
    return {
      x: Math.round(anchor.x - size.width / 2),
      y: Math.round(anchor.y - size.height),
      width: size.width,
      height: size.height,
    };
  }

  private apply(): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    // setBounds (not setPosition) keeps the size stable across monitors with different DPI
    this.pet.setBounds(this.boundsFor(this.anchor));
  }

  environment(): PetEnvironment {
    return { displays: getDisplays(), anchor: { ...this.anchor }, windowSize: this.windowSize() };
  }

  sendEnvironment(): void {
    if (this.pet && !this.pet.isDestroyed()) this.pet.webContents.send(IPC.petEnvironment, this.environment());
  }

  /** Renderer-requested move. Clamped to real work areas so the taskbar is never covered. */
  moveTo(anchor: Anchor): void {
    if (this.dragTimer) return;
    this.anchor = clampAnchor(getDisplays(), anchor, this.scale);
    this.apply();
  }

  /** Re-seat the pet after display changes (monitor unplugged, resolution changed…). */
  revalidate(): void {
    const displays = getDisplays();
    const d = displayUnderAnchor(displays, this.anchor);
    if (!d) return;
    this.anchor = clampAnchor(displays, this.anchor, this.scale);
    if (this.anchor.y > rectBottom(d.workArea)) this.anchor.y = rectBottom(d.workArea);
    this.apply();
    this.sendEnvironment();
  }

  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.anchor = clampAnchor(getDisplays(), this.anchor, this.scale);
    this.apply();
    this.sendEnvironment();
  }

  setExtraHeight(px: number): void {
    const v = Math.max(0, Math.min(360, Math.round(px)));
    if (v === this.extraHeight) return;
    this.extraHeight = v;
    this.apply();
  }

  setInteractive(on: boolean): void {
    if (!this.pet || this.pet.isDestroyed() || on === this.interactive) return;
    this.interactive = on;
    this.pet.setIgnoreMouseEvents(!on, { forward: true });
  }

  setAlwaysOnTop(on: boolean): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    this.pet.setAlwaysOnTop(on, "floating");
  }

  // --- dragging -------------------------------------------------------------------
  startDrag(): void {
    if (!this.pet || this.dragTimer) return;
    const c = screen.getCursorScreenPoint();
    this.grabOffset = { x: c.x - this.anchor.x, y: c.y - this.anchor.y };
    this.velocity = { x: 0, y: 0 };
    this.lastDrag = { x: c.x, y: c.y, t: Date.now() };
    this.dragTimer = setInterval(() => this.dragTick(), DRAG_INTERVAL_MS);
  }

  private dragTick(): void {
    if (!this.pet || this.pet.isDestroyed()) return this.stopDrag();
    const c = screen.getCursorScreenPoint();
    const now = Date.now();
    const dt = Math.max(1, now - this.lastDrag.t) / 1000;
    const vx = (c.x - this.lastDrag.x) / dt;
    const vy = (c.y - this.lastDrag.y) / dt;
    this.velocity.x += (vx - this.velocity.x) * 0.25;
    this.velocity.y += (vy - this.velocity.y) * 0.25;
    this.lastDrag = { x: c.x, y: c.y, t: now };
    this.anchor = clampAnchor(getDisplays(), { x: c.x - this.grabOffset.x, y: c.y - this.grabOffset.y }, this.scale);
    this.apply();
    const update: DragUpdate = { anchor: { ...this.anchor }, vx: this.velocity.x, vy: this.velocity.y };
    this.pet.webContents.send(IPC.petDragMove, update);
  }

  endDrag(): void {
    if (!this.dragTimer) return;
    this.dragTick();
    this.stopDrag();
    this.pet?.webContents.send(IPC.petDragEnded, { ...this.anchor });
  }

  stopDrag(): void {
    if (this.dragTimer) clearInterval(this.dragTimer);
    this.dragTimer = null;
  }

  show(): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    if (this.pet.isMinimized()) this.pet.restore();
    this.pet.show();
    this.pet.setAlwaysOnTop(true, "floating");
    this.pet.moveTop();
    this.pet.webContents.send(IPC.petCommand, { type: "wake" });
    this.pet.webContents.send(IPC.petVisibility, true);
  }

  hide(): void {
    if (!this.pet || this.pet.isDestroyed()) return;
    this.stopDrag();
    this.pet.hide();
  }

  get bounds(): Electron.Rectangle {
    return this.boundsFor(this.anchor);
  }
}
