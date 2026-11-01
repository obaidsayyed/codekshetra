import { useEffect, useRef } from "react";
import { drawFace, NEUTRAL_FACE } from "../character/FaceRenderer";
import { GLOW_COLORS, hexToCss, resolveGlow, SKINS } from "../character/skins";
import { ACCESSORIES, appearanceKey, EYE_STYLES, GLOW_IDS, SKIN_IDS, type Accessory, type CharacterAppearance, type EyeStyle } from "../shared/appearance";

interface Props {
  appearance: CharacterAppearance;
  onChange: (a: CharacterAppearance) => void;
  petAppearance?: CharacterAppearance;
  onApplyToPet?: () => void;
}

const ACCESSORY_LABELS: Record<Accessory, string> = { glasses: "Glasses", backpack: "Backpack", scarf: "Scarf" };
const EYE_LABELS: Record<EyeStyle, string> = { classic: "Classic", round: "Round", sparkle: "Sparkle", pixel: "Pixel" };

/** Skin / headphone / eyes / accessories editor. The rig never changes, so animations stay intact. */
export function CustomizationPanel({ appearance, onChange, petAppearance, onApplyToPet }: Props) {
  const set = (patch: Partial<CharacterAppearance>) => onChange({ ...appearance, ...patch });
  const toggleAccessory = (a: Accessory) =>
    set({ accessories: appearance.accessories.includes(a) ? appearance.accessories.filter((x) => x !== a) : [...appearance.accessories, a] });
  const dirty = petAppearance ? appearanceKey(petAppearance) !== appearanceKey(appearance) : false;

  return (
    <section className="panel-section customization">
      <div className="field">
        <span className="field-label">Skin</span>
        <div className="skin-grid">
          {SKIN_IDS.map((id) => (
            <button key={id} type="button" className={`skin-card ${appearance.skin === id ? "is-active" : ""}`} onClick={() => set({ skin: id })} aria-pressed={appearance.skin === id}>
              <SkinPortrait appearance={{ ...appearance, skin: id }} />
              <span>{SKINS[id].name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Headphone glow</span>
        <div className="chip-row">
          {GLOW_IDS.map((g) => {
            const color = g === "skin" ? SKINS[appearance.skin].glow : GLOW_COLORS[g].color;
            return (
              <button key={g} type="button" className={`glow-chip ${appearance.headphoneGlow === g ? "is-active" : ""}`} onClick={() => set({ headphoneGlow: g })} title={g === "skin" ? "Match skin" : GLOW_COLORS[g].name}>
                <i style={{ background: hexToCss(color), boxShadow: `0 0 10px ${hexToCss(color)}` }} />
                {g === "skin" ? "Match" : GLOW_COLORS[g].name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Eyes</span>
        <div className="chip-row">
          {EYE_STYLES.map((e) => (
            <button key={e} type="button" className={`text-chip ${appearance.eyes === e ? "is-active" : ""}`} onClick={() => set({ eyes: e })}>
              {EYE_LABELS[e]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Accessories</span>
        <div className="chip-row">
          {ACCESSORIES.map((a) => (
            <button key={a} type="button" className={`text-chip ${appearance.accessories.includes(a) ? "is-active" : ""}`} onClick={() => toggleAccessory(a)} aria-pressed={appearance.accessories.includes(a)}>
              {ACCESSORY_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      {onApplyToPet && (
        <div className="apply-row">
          <button type="button" className="tbtn primary wide" disabled={!dirty} onClick={onApplyToPet}>
            {dirty ? "Apply to desktop pet" : "Desktop pet uses this look"}
          </button>
          <button type="button" className="tbtn wide" onClick={() => onChange({ skin: "default", headphoneGlow: "skin", eyes: "classic", accessories: [] })}>
            Reset to default Sunday
          </button>
        </div>
      )}
    </section>
  );
}

/** A tiny 2D pixel portrait (head + shoulders) used for skin cards and the chat avatar. */
export function SkinPortrait({ appearance, size = 56 }: { appearance: CharacterAppearance; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    drawPortrait(c, appearance);
  }, [appearance]);
  return <canvas ref={ref} width={32} height={32} className="portrait" style={{ width: size, height: size }} aria-hidden />;
}

export function drawPortrait(c: HTMLCanvasElement, a: CharacterAppearance): void {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const p = SKINS[a.skin];
  const css = hexToCss;
  ctx.clearRect(0, 0, 32, 32);
  ctx.imageSmoothingEnabled = false;
  // shoulders / hoodie
  ctx.fillStyle = css(p.hoodie[2]);
  ctx.fillRect(4, 25, 24, 7);
  ctx.fillStyle = css(p.panel[1]);
  ctx.fillRect(12, 25, 8, 7);
  ctx.fillStyle = css(p.logo);
  ctx.fillRect(15, 27, 2, 3);
  // face (12×12 voxels drawn at 2 px → 24 px wide, scaled into 20 px)
  ctx.save();
  ctx.translate(6, 4);
  ctx.scale(20 / 24, 20 / 24);
  ctx.fillStyle = css(p.skin[2]);
  ctx.fillRect(0, 0, 24, 24);
  drawFace(ctx, { ...NEUTRAL_FACE, mouth: "grin" }, a.eyes);
  ctx.restore();
  // hair cap + fringe
  ctx.fillStyle = css(p.hair[2]);
  ctx.fillRect(5, 1, 22, 6);
  ctx.fillStyle = css(p.hair[3]);
  [2, 3, 4, 3, 2, 3, 4, 4, 3, 2, 3].forEach((len, i) => ctx.fillRect(5 + i * 2, 6, 2, len));
  ctx.fillStyle = css(p.hair[4]);
  ctx.fillRect(7, 1, 6, 2);
  ctx.fillRect(17, 2, 5, 2);
  // headphones
  ctx.fillStyle = "#111317";
  ctx.fillRect(4, 0, 24, 2);
  ctx.fillStyle = css(p.logo);
  ctx.fillRect(10, 0, 12, 1);
  ctx.fillStyle = "#111317";
  ctx.fillRect(1, 10, 5, 8);
  ctx.fillRect(26, 10, 5, 8);
  const g = css(resolveGlow(a));
  ctx.fillStyle = g;
  for (const x of [1, 27]) {
    ctx.fillRect(x + 1, 11, 2, 1);
    ctx.fillRect(x + 1, 16, 2, 1);
    ctx.fillRect(x, 12, 1, 4);
    ctx.fillRect(x + 3, 12, 1, 4);
  }
}
