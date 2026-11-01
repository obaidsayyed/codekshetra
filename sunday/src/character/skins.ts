import type { CharacterAppearance, GlowId, SkinId } from "../shared/appearance";

/**
 * A skin is a palette applied to Sunday's fixed voxel layout. Geometry, rig and
 * proportions never change between skins, so animations always stay valid.
 * To add a new original skin: add an id to SKIN_IDS (shared/appearance.ts) and
 * a palette entry here.
 */
export interface SkinPalette {
  id: SkinId;
  name: string;
  /** Hoodie body shades, darkest → lightest. */
  hoodie: readonly number[];
  /** Hem / cuff / trim colour. */
  hoodieTrim: number;
  /** Front panel ("black detailing") shades. */
  panel: readonly number[];
  /** Logo colour on the front panel. */
  logo: number;
  hair: readonly number[];
  skin: readonly number[];
  pants: readonly number[];
  shoeUpper: readonly number[];
  shoeWhite: readonly number[];
  /** Headphone ring + band stripe glow. */
  glow: number;
  /** Swatch colour for UI previews. */
  swatch: string;
}

const SKIN_TONES = [0xd99c74, 0xe7b088, 0xf0bf96, 0xf6cca4] as const;
const BROWN_HAIR = [0x4a2b17, 0x5b371f, 0x6c4427, 0x7e5230, 0x91603a, 0xa87348] as const;
const BLACK_PANTS = [0x101114, 0x16181c, 0x1c1f24, 0x23262c] as const;
const BLACK_PANEL = [0x0c0d0f, 0x111316, 0x16191c] as const;
const WHITE = [0xd7dde3, 0xe4e9ee, 0xf2f5f8] as const;

export const SKINS: Record<SkinId, SkinPalette> = {
  default: {
    id: "default",
    name: "Default",
    hoodie: [0x165f2b, 0x1b7333, 0x20863b, 0x279a45, 0x30ad50],
    hoodieTrim: 0x0f1a12,
    panel: BLACK_PANEL,
    logo: 0x39d353,
    hair: BROWN_HAIR,
    skin: SKIN_TONES,
    pants: BLACK_PANTS,
    shoeUpper: [0x1c8f3c, 0x22a646, 0x2bbb52],
    shoeWhite: WHITE,
    glow: 0x2ee6ff,
    swatch: "#25a046",
  },
  blue: {
    id: "blue",
    name: "Blue",
    hoodie: [0x123f86, 0x164c9f, 0x1b5bb8, 0x2169cc, 0x2a7ae0],
    hoodieTrim: 0x0b1424,
    panel: BLACK_PANEL,
    logo: 0x3ab0ff,
    hair: BROWN_HAIR,
    skin: SKIN_TONES,
    pants: BLACK_PANTS,
    shoeUpper: [0x1a5fc0, 0x2170d8, 0x2d83ec],
    shoeWhite: WHITE,
    glow: 0x38b6ff,
    swatch: "#2169cc",
  },
  red: {
    id: "red",
    name: "Red",
    hoodie: [0x7c1414, 0x941919, 0xab1f1f, 0xc02626, 0xd23131],
    hoodieTrim: 0x1d0b0b,
    panel: BLACK_PANEL,
    logo: 0xff5a3c,
    hair: BROWN_HAIR,
    skin: SKIN_TONES,
    pants: BLACK_PANTS,
    shoeUpper: [0xb01e1e, 0xc72727, 0xdc3434],
    shoeWhite: WHITE,
    glow: 0xff6b6b,
    swatch: "#c02626",
  },
  white: {
    id: "white",
    name: "White",
    hoodie: [0xb9c3d1, 0xc9d2de, 0xd8dfe8, 0xe5eaf1, 0xf1f4f8],
    hoodieTrim: 0x5f6b7d,
    panel: [0x2b3446, 0x323c50, 0x39445a],
    logo: 0x7cc8ff,
    hair: [0xb7bcc6, 0xc8cdd6, 0xd8dce3, 0xe6e9ee, 0xf2f4f7, 0xfbfcfd],
    skin: SKIN_TONES,
    pants: [0x2a3242, 0x313a4c, 0x384256, 0x404b60],
    shoeUpper: [0x5d8dd6, 0x6c9be2, 0x7eaaeb],
    shoeWhite: WHITE,
    glow: 0x9fd8ff,
    swatch: "#dfe5ee",
  },
  purple: {
    id: "purple",
    name: "Purple",
    hoodie: [0x41187c, 0x4f1e96, 0x5e25af, 0x6c2dc6, 0x7c38da],
    hoodieTrim: 0x140b22,
    panel: BLACK_PANEL,
    logo: 0xb47cff,
    hair: BROWN_HAIR,
    skin: SKIN_TONES,
    pants: BLACK_PANTS,
    shoeUpper: [0x6a2cc4, 0x7a38d8, 0x8c4ae9],
    shoeWhite: WHITE,
    glow: 0xb57dff,
    swatch: "#6c2dc6",
  },
  yellow: {
    id: "yellow",
    name: "Yellow",
    hoodie: [0x9a6a07, 0xb47d0a, 0xcc900e, 0xe1a316, 0xf0b726],
    hoodieTrim: 0x2a1d06,
    panel: BLACK_PANEL,
    logo: 0xffcb3a,
    hair: BROWN_HAIR,
    skin: SKIN_TONES,
    pants: BLACK_PANTS,
    shoeUpper: [0xcf930f, 0xe3a618, 0xf3ba2b],
    shoeWhite: WHITE,
    glow: 0xffc93c,
    swatch: "#e1a316",
  },
  black: {
    id: "black",
    name: "Black",
    hoodie: [0x101114, 0x15171b, 0x1b1e23, 0x22262c, 0x2a2e35],
    hoodieTrim: 0x060708,
    panel: [0x060708, 0x0a0b0d, 0x0e1012],
    logo: 0xe8edf2,
    hair: BROWN_HAIR,
    skin: SKIN_TONES,
    pants: BLACK_PANTS,
    shoeUpper: [0x1d2025, 0x262a30, 0x30353c],
    shoeWhite: WHITE,
    glow: 0xf2f6fa,
    swatch: "#1b1e23",
  },
  cyan: {
    id: "cyan",
    name: "Cyan",
    hoodie: [0x0b5f62, 0x0f7276, 0x13868a, 0x199a9e, 0x22adb1],
    hoodieTrim: 0x062022,
    panel: BLACK_PANEL,
    logo: 0x4ff3ff,
    hair: BROWN_HAIR,
    skin: SKIN_TONES,
    pants: BLACK_PANTS,
    shoeUpper: [0x128a8e, 0x199ea2, 0x23b2b6],
    shoeWhite: WHITE,
    glow: 0x4ff3ff,
    swatch: "#199a9e",
  },
};

export const GLOW_COLORS: Record<Exclude<GlowId, "skin">, { name: string; color: number }> = {
  cyan: { name: "Cyan", color: 0x2ee6ff },
  green: { name: "Green", color: 0x3dff7a },
  magenta: { name: "Magenta", color: 0xff4fd8 },
  amber: { name: "Amber", color: 0xffb02e },
  white: { name: "White", color: 0xf4f8ff },
};

export function resolveGlow(appearance: CharacterAppearance): number {
  if (appearance.headphoneGlow === "skin") return SKINS[appearance.skin].glow;
  return GLOW_COLORS[appearance.headphoneGlow].color;
}

export function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}
