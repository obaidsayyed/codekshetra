import type { EyeStyle } from "../shared/appearance";
import { FACE_TEXELS } from "./CharacterConfig";

/**
 * Sunday's face is a 24 × 24 pixel-art decal drawn on a canvas. It is redrawn
 * only when the (quantised) expression changes, which keeps blinking, talking
 * and look-at cheap.
 */

export type EyeShape = "open" | "happy" | "closed" | "sleepy" | "wide" | "focused" | "confused";
export type BrowShape = "neutral" | "raised" | "furrowed" | "worried" | "confused" | "relaxed";
export type MouthShape = "smile" | "grin" | "talk" | "o" | "flat" | "wavy" | "frown" | "sleep" | "yawn";

export interface FaceState {
  eyes: EyeShape;
  /** 0 = fully open, 1 = closed. Applies to every eye shape except happy/closed. */
  blink: number;
  lookX: number;
  lookY: number;
  brows: BrowShape;
  mouth: MouthShape;
  /** 0–1, used by "talk" and "yawn". */
  mouthOpen: number;
  blush: number;
  sweat: boolean;
}

export const NEUTRAL_FACE: FaceState = {
  eyes: "open",
  blink: 0,
  lookX: 0,
  lookY: 0,
  brows: "neutral",
  mouth: "smile",
  mouthOpen: 0,
  blush: 0,
  sweat: false,
};

const C = {
  white: "#f4f7fb",
  whiteShade: "#cdd6e2",
  irisTop: "#2f86ea",
  irisBottom: "#1b55b8",
  irisSparkle: "#28d6ff",
  pupil: "#0d1b3a",
  lash: "#2a1a10",
  brow: "#3b2414",
  mouthDark: "#5c1515",
  mouthRed: "#b8322a",
  tongue: "#ef7d86",
  teeth: "#fbfbf6",
  blush: "rgba(255,120,130,0.55)",
  sweat: "#8fdcff",
  sweatHi: "#e8fbff",
  line: "#3a2212",
};

export function faceKey(f: FaceState, style: EyeStyle): string {
  const blinkQ = Math.round(Math.min(1, Math.max(0, f.blink)) * 4);
  const lx = Math.round(Math.max(-1, Math.min(1, f.lookX)));
  const ly = Math.round(Math.max(-1, Math.min(1, f.lookY)));
  const mo = Math.round(Math.min(1, Math.max(0, f.mouthOpen)) * 3);
  return `${style}|${f.eyes}|${blinkQ}|${lx}|${ly}|${f.brows}|${f.mouth}|${mo}|${f.blush > 0.5 ? 1 : 0}|${f.sweat ? 1 : 0}`;
}

/** Eye geometry in texels. Left = viewer's left. */
const EYE_L = { x: 4, y: 11 };
const EYE_R = { x: 15, y: 11 };
const EYE_W = 5;
const EYE_H = 5;

export function drawFace(ctx: CanvasRenderingContext2D, f: FaceState, style: EyeStyle, ox = 0, oy = 0, px = 1): void {
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x * px, oy + y * px, w * px, h * px);
  };

  const lookX = Math.round(Math.max(-1, Math.min(1, f.lookX)));
  const lookY = Math.round(Math.max(-1, Math.min(1, f.lookY)));
  const blinkRows = Math.round(Math.min(1, Math.max(0, f.blink)) * EYE_H);

  // --- brows --------------------------------------------------------------
  const browY = 9;
  const drawBrow = (x: number, mirrored: boolean, shape: BrowShape) => {
    switch (shape) {
      case "raised":
        rect(x, browY - 1, 4, 1, C.brow);
        break;
      case "furrowed":
        // inner end low
        if (mirrored) {
          rect(x, browY, 2, 1, C.brow);
          rect(x + 2, browY - 1, 2, 1, C.brow);
        } else {
          rect(x, browY - 1, 2, 1, C.brow);
          rect(x + 2, browY, 2, 1, C.brow);
        }
        break;
      case "worried":
        // inner end high
        if (mirrored) {
          rect(x, browY - 1, 2, 1, C.brow);
          rect(x + 2, browY, 2, 1, C.brow);
        } else {
          rect(x, browY, 2, 1, C.brow);
          rect(x + 2, browY - 1, 2, 1, C.brow);
        }
        break;
      case "relaxed":
        rect(x, browY, 4, 1, C.brow);
        break;
      case "confused":
        if (mirrored) rect(x, browY - 2, 4, 1, C.brow);
        else rect(x, browY, 4, 1, C.brow);
        break;
      default:
        rect(x, browY, 4, 1, C.brow);
    }
  };
  drawBrow(EYE_L.x + 1, false, f.brows);
  drawBrow(EYE_R.x, true, f.brows);

  // --- eyes ---------------------------------------------------------------
  const drawOpenEye = (ex: number, ey: number, h: number, isRight: boolean, wide = false) => {
    const w = EYE_W;
    const top = ey + (EYE_H - h);
    if (style === "pixel") {
      const cx = ex + 1 + lookX + (isRight ? 0 : 1);
      rect(cx, ey + 1 + Math.max(0, lookY), 2, Math.min(3, h), C.pupil);
      rect(cx, ey + 1 + Math.max(0, lookY), 1, 1, "#5a6b8a");
      return;
    }
    if (style === "round") {
      rect(ex, top, w - 1 + (isRight ? 0 : 1), h, C.pupil);
      if (h >= 3) {
        rect(ex + 1 + (isRight ? 0 : 1) + Math.max(0, lookX), top + 1, 1, 1, C.white);
        rect(ex + 3 + (isRight ? -1 : 0), top + h - 2, 1, 1, "#7e8fb4");
      }
      return;
    }
    // classic + sparkle: white sclera with a blue iris placed toward the gaze
    rect(ex, top, w, h, C.white);
    rect(ex, top + h - 1, w, 1, C.whiteShade);
    const irisW = wide ? 2 : 3;
    // Iris rests on the inner side (toward the nose) like the reference art.
    let irisX = isRight ? ex : ex + w - irisW;
    irisX += lookX;
    irisX = Math.max(ex, Math.min(ex + w - irisW, irisX));
    const irisTop = Math.max(top, top + (lookY > 0 ? 1 : 0) + (wide ? 1 : 0));
    const irisH = Math.max(1, Math.min(h - (wide ? 1 : 0), 4));
    const topColor = style === "sparkle" ? C.irisSparkle : C.irisTop;
    rect(irisX, irisTop, irisW, irisH, C.irisBottom);
    rect(irisX, irisTop, irisW, Math.max(1, Math.floor(irisH / 2)), topColor);
    if (irisH >= 3) {
      rect(irisX + (isRight ? irisW - 2 : 1), irisTop + 1, 1, 2, C.pupil);
      rect(irisX + (isRight ? 0 : irisW - 1), irisTop, 1, 1, C.white);
      if (style === "sparkle") rect(irisX + (isRight ? 1 : 0), irisTop + irisH - 1, 1, 1, "#bff6ff");
    }
    // upper lash line
    rect(ex, top - 1, w, 1, C.lash);
  };

  const drawLid = (ex: number, ey: number, rows: number) => {
    if (rows <= 0) return;
    if (rows >= EYE_H) {
      rect(ex, ey + EYE_H - 2, EYE_W, 1, C.lash);
      rect(ex + (ex < 12 ? 0 : EYE_W - 1), ey + EYE_H - 1, 1, 1, C.lash);
      return;
    }
    // the lid is drawn by not drawing the eye's top rows: lash line moves down
    rect(ex, ey + rows - 1, EYE_W, 1, C.lash);
  };

  const eyePair = (draw: (ex: number, ey: number, isRight: boolean) => void) => {
    draw(EYE_L.x, EYE_L.y, false);
    draw(EYE_R.x, EYE_R.y, true);
  };

  switch (f.eyes) {
    case "happy":
      eyePair((ex, ey) => {
        // ^ ^ arcs
        rect(ex, ey + 3, 1, 1, C.lash);
        rect(ex + 1, ey + 2, 1, 1, C.lash);
        rect(ex + 2, ey + 1, 1, 1, C.lash);
        rect(ex + 3, ey + 2, 1, 1, C.lash);
        rect(ex + 4, ey + 3, 1, 1, C.lash);
      });
      break;
    case "closed":
      eyePair((ex, ey, isRight) => {
        // gentle downward curve, sleeping
        rect(ex, ey + 2, 1, 1, C.lash);
        rect(ex + 1, ey + 3, 3, 1, C.lash);
        rect(ex + 4, ey + 2, 1, 1, C.lash);
        rect(isRight ? ex + 4 : ex, ey + 3, 1, 1, C.lash);
      });
      break;
    case "sleepy":
      eyePair((ex, ey, isRight) => {
        drawOpenEye(ex, ey, 2, isRight);
        rect(ex, ey + 2, EYE_W, 1, C.lash);
      });
      break;
    case "focused":
      eyePair((ex, ey, isRight) => {
        if (blinkRows >= EYE_H) return drawLid(ex, ey, EYE_H);
        drawOpenEye(ex, ey, Math.max(1, 4 - blinkRows), isRight);
      });
      break;
    case "wide":
      eyePair((ex, ey, isRight) => {
        if (blinkRows >= EYE_H) return drawLid(ex, ey, EYE_H);
        drawOpenEye(ex, ey, EYE_H - blinkRows, isRight, true);
      });
      break;
    case "confused":
      // one eye open, the other squinted
      if (blinkRows >= EYE_H) {
        drawLid(EYE_L.x, EYE_L.y, EYE_H);
        drawLid(EYE_R.x, EYE_R.y, EYE_H);
      } else {
        drawOpenEye(EYE_L.x, EYE_L.y, EYE_H - blinkRows, false);
        rect(EYE_R.x, EYE_R.y + 2, EYE_W, 1, C.lash);
        rect(EYE_R.x + 1, EYE_R.y + 3, 3, 1, C.white);
        rect(EYE_R.x + 1, EYE_R.y + 3, 2, 1, C.irisBottom);
      }
      break;
    default:
      eyePair((ex, ey, isRight) => {
        if (blinkRows >= EYE_H) return drawLid(ex, ey, EYE_H);
        drawOpenEye(ex, ey, EYE_H - blinkRows, isRight);
      });
  }

  // --- cheeks -------------------------------------------------------------
  if (f.blush > 0.5) {
    rect(2, 17, 3, 1, C.blush);
    rect(19, 17, 3, 1, C.blush);
  }

  // --- mouth --------------------------------------------------------------
  const my = 19;
  const open = Math.min(1, Math.max(0, f.mouthOpen));
  switch (f.mouth) {
    case "grin":
      rect(9, my - 1, 6, 1, C.mouthDark);
      rect(9, my, 6, 1, C.mouthRed);
      rect(11, my, 2, 1, C.tongue);
      rect(10, my + 1, 4, 1, C.mouthDark);
      rect(10, my - 1, 4, 1, C.teeth);
      break;
    case "talk": {
      const h = 1 + Math.round(open * 2);
      const w = h >= 3 ? 4 : 5;
      const x = 12 - Math.ceil(w / 2);
      rect(x, my - 1, w, h, C.mouthDark);
      if (h >= 2) rect(x + 1, my - 1 + h - 1, w - 2, 1, C.tongue);
      break;
    }
    case "o":
      rect(11, my - 1, 2, 1, C.mouthDark);
      rect(10, my, 1, 1, C.mouthDark);
      rect(13, my, 1, 1, C.mouthDark);
      rect(11, my, 2, 1, C.mouthRed);
      rect(11, my + 1, 2, 1, C.mouthDark);
      break;
    case "yawn": {
      const h = 1 + Math.round(open * 3);
      rect(10, my - 1, 4, h, C.mouthDark);
      if (h > 2) rect(11, my + h - 3, 2, 1, C.tongue);
      break;
    }
    case "flat":
      rect(10, my, 4, 1, C.line);
      break;
    case "wavy":
      rect(9, my, 1, 1, C.line);
      rect(10, my - 1, 1, 1, C.line);
      rect(11, my, 1, 1, C.line);
      rect(12, my - 1, 1, 1, C.line);
      rect(13, my, 1, 1, C.line);
      rect(14, my - 1, 1, 1, C.line);
      break;
    case "frown":
      rect(10, my - 1, 4, 1, C.line);
      rect(9, my, 1, 1, C.line);
      rect(14, my, 1, 1, C.line);
      break;
    case "sleep":
      rect(11, my, 2, 1, C.line);
      break;
    default:
      // closed smile
      rect(9, my - 1, 1, 1, C.line);
      rect(10, my, 4, 1, C.line);
      rect(14, my - 1, 1, 1, C.line);
  }

  if (f.sweat) {
    rect(21, 7, 1, 1, C.sweatHi);
    rect(20, 8, 2, 2, C.sweat);
    rect(20, 8, 1, 1, C.sweatHi);
  }
}

/** Draws the face into a fresh transparent FACE_TEXELS² canvas. */
export function renderFaceCanvas(canvas: HTMLCanvasElement, f: FaceState, style: EyeStyle): void {
  canvas.width = FACE_TEXELS;
  canvas.height = FACE_TEXELS;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, FACE_TEXELS, FACE_TEXELS);
  drawFace(ctx, f, style);
}
