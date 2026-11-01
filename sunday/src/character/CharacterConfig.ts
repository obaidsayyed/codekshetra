/**
 * Sunday's proportions, in voxels. One voxel = VOXEL world units.
 *
 *            ┌──── hair / headphones ────┐
 *            │  HEAD 12 × 12 × 11        │
 *            └───────────┬───────────────┘
 *        arm 4×10 ┌──── TORSO 8 × 10 × 5 ────┐ arm 4×10
 *                 └─────┬──────────┬────────┘
 *                  thigh 4×5     thigh 4×5
 *                  shin  4×3     shin  4×3
 *                  shoe  4×3×6   shoe  4×3×6
 */
export const VOXEL = 1 / 16;

export const DIM = {
  head: { w: 12, h: 12, d: 11 },
  torso: { w: 8, h: 10, d: 5 },
  upperArm: { w: 4, h: 5, d: 4 },
  forearm: { w: 4, h: 5, d: 4 },
  thigh: { w: 4, h: 5, d: 4 },
  shin: { w: 4, h: 3, d: 4 },
  shoe: { w: 4, h: 3, d: 7 },
} as const;

/** Height of the hip pivot above the ground (thigh + shin + shoe). */
export const HIP_HEIGHT = DIM.thigh.h + DIM.shin.h + DIM.shoe.h; // 11
/** Total standing height including hair and headphone band. */
export const STANDING_HEIGHT = HIP_HEIGHT + DIM.torso.h + DIM.head.h + 3; // ≈ 36

export const JOINTS = {
  hips: [0, HIP_HEIGHT, 0],
  neck: [0, DIM.torso.h, 0],
  shoulderL: [-(DIM.torso.w / 2 + DIM.upperArm.w / 2), DIM.torso.h - 0.5, 0],
  shoulderR: [DIM.torso.w / 2 + DIM.upperArm.w / 2, DIM.torso.h - 0.5, 0],
  elbow: [0, -DIM.upperArm.h, 0],
  hipL: [-DIM.thigh.w / 2, 0, 0],
  hipR: [DIM.thigh.w / 2, 0, 0],
  knee: [0, -DIM.thigh.h, 0],
} as const;

/**
 * Fringe: how many voxels each front hair column hangs down from the top of
 * the head (columns x = -1 … 12). Hand-tuned so the eyes stay visible.
 */
export const FRINGE = [2, 3, 4, 3, 2, 3, 4, 4, 3, 2, 3, 4, 3, 2] as const;

/** Face decal resolution: two texels per voxel on the 12 × 12 front of the head. */
export const FACE_TEXELS = 24;
