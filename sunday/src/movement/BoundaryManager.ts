import type { Anchor, DisplayInfo, Rect } from "../shared/ipc";

/**
 * Multi-monitor geometry for the pet. Everything is expressed in Electron DIP
 * screen coordinates and in terms of the *anchor*: the point between Sunday's
 * feet, which sits on the bottom edge of a display's work area (i.e. on top of
 * the taskbar, never over it).
 */

export interface WalkBounds {
  /** Smallest / largest anchor x Sunday may walk to. */
  minX: number;
  maxX: number;
  /** Anchor y when standing on the floor of this display. */
  floor: number;
  displayId: number;
}

/** Horizontal room the character needs on each side of the anchor, in DIP at scale 1. */
export const CHARACTER_HALF_WIDTH = 64;
/** Displays whose floors differ by more than this are not walked between. */
export const MAX_FLOOR_STEP = 48;

export const rectRight = (r: Rect) => r.x + r.width;
export const rectBottom = (r: Rect) => r.y + r.height;

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < rectRight(r) && y >= r.y && y < rectBottom(r);
}

function distanceToRect(r: Rect, x: number, y: number): number {
  const dx = x < r.x ? r.x - x : x > rectRight(r) ? x - rectRight(r) : 0;
  const dy = y < r.y ? r.y - y : y > rectBottom(r) ? y - rectBottom(r) : 0;
  return Math.hypot(dx, dy);
}

/** The display whose bounds contain the point, or the nearest one. */
export function displayForPoint(displays: DisplayInfo[], x: number, y: number): DisplayInfo | null {
  if (displays.length === 0) return null;
  const hit = displays.find((d) => contains(d.bounds, x, y));
  if (hit) return hit;
  let best = displays[0];
  let bestD = Infinity;
  for (const d of displays) {
    const dist = distanceToRect(d.bounds, x, y);
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

/** Display that the anchor stands on: horizontally containing x, choosing the floor nearest to y. */
export function displayUnderAnchor(displays: DisplayInfo[], anchor: Anchor): DisplayInfo | null {
  const columns = displays.filter((d) => anchor.x >= d.workArea.x && anchor.x < rectRight(d.workArea));
  if (columns.length === 0) return displayForPoint(displays, anchor.x, anchor.y - 1);
  let best = columns[0];
  let bestD = Infinity;
  for (const d of columns) {
    const floor = rectBottom(d.workArea);
    // prefer the floor at or below the anchor (we fall onto it)
    const dist = floor >= anchor.y - 1 ? floor - anchor.y : (anchor.y - floor) * 4 + 10_000;
    if (dist < bestD) {
      bestD = dist;
      best = d;
    }
  }
  return best;
}

export function walkBounds(display: DisplayInfo, scale = 1): WalkBounds {
  const half = CHARACTER_HALF_WIDTH * scale;
  const wa = display.workArea;
  const minX = wa.x + half;
  const maxX = Math.max(minX, rectRight(wa) - half);
  return { minX, maxX, floor: rectBottom(wa), displayId: display.id };
}

/** A display sharing the left/right edge of `current` with a compatible floor height. */
export function findAdjacentDisplay(displays: DisplayInfo[], current: DisplayInfo, direction: -1 | 1): DisplayInfo | null {
  const edge = direction > 0 ? rectRight(current.workArea) : current.workArea.x;
  const curFloor = rectBottom(current.workArea);
  for (const d of displays) {
    if (d.id === current.id) continue;
    const touching = direction > 0 ? Math.abs(d.workArea.x - edge) <= 2 : Math.abs(rectRight(d.workArea) - edge) <= 2;
    if (!touching) continue;
    if (Math.abs(rectBottom(d.workArea) - curFloor) > MAX_FLOOR_STEP) continue;
    return d;
  }
  return null;
}

/**
 * The continuous walkable range around the anchor: the current display plus
 * any chain of side-by-side displays with compatible floors.
 */
export function reachableRange(displays: DisplayInfo[], anchor: Anchor, scale = 1): { minX: number; maxX: number } {
  const start = displayUnderAnchor(displays, anchor);
  if (!start) return { minX: anchor.x, maxX: anchor.x };
  const b = walkBounds(start, scale);
  let { minX, maxX } = b;
  for (const dir of [-1, 1] as const) {
    let cur: DisplayInfo | null = start;
    const seen = new Set<number>([start.id]);
    while (cur) {
      const next = findAdjacentDisplay(displays, cur, dir);
      if (!next || seen.has(next.id)) break;
      seen.add(next.id);
      const nb = walkBounds(next, scale);
      if (dir < 0) minX = Math.min(minX, nb.minX);
      else maxX = Math.max(maxX, nb.maxX);
      cur = next;
    }
  }
  return { minX, maxX };
}

/** Floor height (anchor y) at a given x near the anchor's current display. */
export function floorAt(displays: DisplayInfo[], x: number, currentY: number): number | null {
  const d = displayUnderAnchor(displays, { x, y: currentY });
  return d ? rectBottom(d.workArea) : null;
}

/** Keeps an anchor on some display: inside the work area horizontally, at or above its floor. */
export function clampAnchor(displays: DisplayInfo[], anchor: Anchor, scale = 1): Anchor {
  const d = displayForPoint(displays, anchor.x, anchor.y - 1);
  if (!d) return anchor;
  const b = walkBounds(d, scale);
  const minY = d.workArea.y + 160 * scale; // keep the head on screen
  return {
    x: Math.min(b.maxX, Math.max(b.minX, anchor.x)),
    y: Math.min(b.floor, Math.max(minY, anchor.y)),
  };
}
