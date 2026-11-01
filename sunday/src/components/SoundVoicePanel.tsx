import { useEffect, useState } from "react";
import { playSound, type SoundName } from "../services/sound";
import { listVoices, react, testVoice, type Reaction, type VoiceInfo } from "../services/voice";
import type { PetSettings, VoiceMode, VoiceSettings } from "../shared/settings";

/** What the Sound & Voice workspace edits before it is applied to the pet. */
export interface SoundDraft {
  soundEffects: boolean;
  soundVolume: number;
  voice: VoiceSettings;
}

interface Props {
  draft: SoundDraft;
  onChange: (d: SoundDraft) => void;
  saved: PetSettings;
  onApply: () => void;
  canApply: boolean;
}

const BOARD: { label: string; sound: SoundName }[] = [
  { label: "Footsteps", sound: "step" },
  { label: "Jump", sound: "jump" },
  { label: "Land", sound: "land" },
  { label: "Sit", sound: "sit" },
  { label: "Hmm", sound: "think" },
  { label: "Typing", sound: "type" },
  { label: "Ding-dong", sound: "listen" },
  { label: "Snore", sound: "snore" },
  { label: "Ta-da", sound: "celebrate" },
  { label: "Confetti", sound: "confetti" },
  { label: "Uh-oh", sound: "uhoh" },
  { label: "Whee", sound: "pickup" },
  { label: "Fall", sound: "fall" },
  { label: "Yawn", sound: "yawn" },
  { label: "Jingle", sound: "success" },
  { label: "Boop", sound: "boop" },
];

const REACTION_CHIPS: { label: string; r: Reaction }[] = [
  { label: "Picked up", r: "pickup" },
  { label: "Celebrate", r: "celebrate" },
  { label: "Error", r: "error" },
  { label: "Done", r: "completed" },
  { label: "Wake up", r: "wake" },
  { label: "Poke", r: "poke" },
];

const sameDraft = (d: SoundDraft, s: PetSettings) =>
  d.soundEffects === s.soundEffects && d.soundVolume === s.soundVolume && JSON.stringify(d.voice) === JSON.stringify(s.voice);

export function SoundVoicePanel({ draft, onChange, saved, onApply, canApply }: Props) {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [line, setLine] = useState("Hi! I'm Sunday. Want to see me dance?");
  const v = draft.voice;
  const setVoice = (patch: Partial<VoiceSettings>) => onChange({ ...draft, voice: { ...v, ...patch } });
  const applied = sameDraft(draft, saved);

  useEffect(() => {
    void listVoices().then((list) => setVoices(list.filter((x) => /^en/i.test(x.lang)).concat(list.filter((x) => !/^en/i.test(x.lang)))));
  }, []);

  const range = (label: string, value: number, min: number, max: number, step: number, fmt: (n: number) => string, set: (n: number) => void, disabled = false) => (
    <label className={`slider ${disabled ? "is-disabled" : ""}`}>
      <span className="slider-head">
        <span>{label}</span>
        <output>{fmt(value)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => set(parseFloat(e.target.value))}
        style={{ ["--progress" as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
    </label>
  );

  return (
    <section className="panel-section sound-panel">
      <label className="switch row">
        <span>
          Sound effects
          <small>Footsteps, boings, jingles and UI sounds</small>
        </span>
        <input type="checkbox" checked={draft.soundEffects} onChange={(e) => onChange({ ...draft, soundEffects: e.target.checked })} />
      </label>
      {range("Volume", draft.soundVolume, 0, 1, 0.05, (n) => `${Math.round(n * 100)}%`, (n) => onChange({ ...draft, soundVolume: n }), !draft.soundEffects)}

      <div className="field">
        <span className="field-label">Sound board</span>
        <div className="sound-board">
          {BOARD.map((b) => (
            <button key={b.sound} type="button" className="board-btn" data-sound="off" onClick={() => playSound(b.sound)} disabled={!draft.soundEffects}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Sunday&rsquo;s voice</span>
        <div className="segmented" role="radiogroup" aria-label="Voice">
          {(
            [
              ["speak", "Talking voice"],
              ["babble", "Cute babble"],
              ["off", "Silent"],
            ] as [VoiceMode, string][]
          ).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={v.mode === m} className={v.mode === m ? "is-active" : ""} onClick={() => setVoice({ mode: m })}>
              {label}
            </button>
          ))}
        </div>
        {v.mode === "speak" && (
          <>
            <label className="select">
              <span className="field-label">System voice</span>
              <select value={v.voiceName} onChange={(e) => setVoice({ voiceName: e.target.value })}>
                <option value="">Automatic (friendliest English voice)</option>
                {voices.map((x) => (
                  <option key={x.name} value={x.name}>
                    {x.name} · {x.lang}
                  </option>
                ))}
              </select>
            </label>
            {voices.length === 0 && <p className="section-note">No system voices found — Sunday will babble instead. Windows voices live in Settings → Time &amp; language → Speech.</p>}
            {range("Pitch (cuteness)", v.pitch, 0.5, 2, 0.05, (n) => n.toFixed(2), (n) => setVoice({ pitch: n }))}
            {range("Speed", v.rate, 0.6, 1.6, 0.05, (n) => `${n.toFixed(2)}×`, (n) => setVoice({ rate: n }))}
          </>
        )}
        <label className="switch row">
          <span>
            Spoken reactions
            <small>&ldquo;Wheee!&rdquo; when picked up, &ldquo;Yay!&rdquo; when celebrating…</small>
          </span>
          <input type="checkbox" checked={v.reactions} onChange={(e) => setVoice({ reactions: e.target.checked })} />
        </label>
      </div>

      <div className="field">
        <span className="field-label">Try it</span>
        <div className="speech-row">
          <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={300} aria-label="Line to say" />
          <button type="button" className="tbtn sunny" data-sound="off" onClick={() => testVoice(line)} disabled={!draft.soundEffects || v.mode === "off"}>
            Say it
          </button>
        </div>
        <div className="chip-row">
          {REACTION_CHIPS.map((c) => (
            <button key={c.r} type="button" className="text-chip" data-sound="off" onClick={() => react(c.r, { force: true })} disabled={!draft.soundEffects || v.mode === "off"}>
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="apply-row">
        <button type="button" className="tbtn primary wide" disabled={applied || !canApply} onClick={onApply} data-testid="apply-sound">
          {applied ? "✓ Desktop pet uses these sounds" : "Apply to desktop pet"}
        </button>
      </div>
    </section>
  );
}
