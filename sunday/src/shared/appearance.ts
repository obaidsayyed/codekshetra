/**
 * Appearance description shared by the renderer (which builds the model) and
 * the main process (which persists it). Palettes live in character/skins.ts;
 * here we only keep identifiers so the main process stays free of renderer code.
 */
export const SKIN_IDS = ["default", "blue", "red", "white", "purple", "yellow", "black", "cyan"] as const;
export type SkinId = (typeof SKIN_IDS)[number];

export const GLOW_IDS = ["skin", "cyan", "green", "magenta", "amber", "white"] as const;
export type GlowId = (typeof GLOW_IDS)[number];

export const EYE_STYLES = ["classic", "round", "sparkle", "pixel"] as const;
export type EyeStyle = (typeof EYE_STYLES)[number];

export const ACCESSORIES = ["glasses", "backpack", "scarf"] as const;
export type Accessory = (typeof ACCESSORIES)[number];

export interface CharacterAppearance {
  skin: SkinId;
  /** "skin" means: use the glow colour that belongs to the skin palette. */
  headphoneGlow: GlowId;
  eyes: EyeStyle;
  accessories: Accessory[];
}

export const DEFAULT_APPEARANCE: CharacterAppearance = {
  skin: "default",
  headphoneGlow: "skin",
  eyes: "classic",
  accessories: [],
};

export function sanitizeAppearance(input: unknown): CharacterAppearance {
  const src = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const skin = (SKIN_IDS as readonly string[]).includes(src.skin as string) ? (src.skin as SkinId) : DEFAULT_APPEARANCE.skin;
  const headphoneGlow = (GLOW_IDS as readonly string[]).includes(src.headphoneGlow as string)
    ? (src.headphoneGlow as GlowId)
    : DEFAULT_APPEARANCE.headphoneGlow;
  const eyes = (EYE_STYLES as readonly string[]).includes(src.eyes as string) ? (src.eyes as EyeStyle) : DEFAULT_APPEARANCE.eyes;
  const accessories = Array.isArray(src.accessories)
    ? Array.from(new Set(src.accessories.filter((a): a is Accessory => (ACCESSORIES as readonly string[]).includes(a as string))))
    : [];
  return { skin, headphoneGlow, eyes, accessories };
}

export function appearanceKey(a: CharacterAppearance): string {
  return `${a.skin}|${a.headphoneGlow}|${a.eyes}|${[...a.accessories].sort().join(",")}`;
}
