import { useEffect, useMemo, useState } from "react";
import type { AnimationEngine } from "../animation/AnimationEngine";
import { createRemotePetController } from "../integration/DevelopmentAdapter";
import type { SundayController } from "../integration/SundayController";
import { getBridge } from "../services/bridge";
import type { PetSettings } from "../shared/settings";
import { CONTROLLABLE_STATES, STATE_LABELS, type SundayState } from "../shared/states";

interface Props {
  hasBridge: boolean;
  previewEngine: () => AnimationEngine | null;
  onPreviewSpeech: (text: string | null) => void;
  settings: PetSettings;
}

type Target = "pet" | "preview";

/**
 * Local development playground: call every SundayController method by hand,
 * either on the live desktop pet (over IPC) or on the studio preview. This is
 * a manual tool — it never generates agent traffic or responses on its own.
 */
export function ControllerPlayground({ hasBridge, previewEngine, onPreviewSpeech, settings }: Props) {
  const [target, setTarget] = useState<Target>(hasBridge ? "pet" : "preview");
  const [speech, setSpeech] = useState("Working on it…");
  const [petState, setPetState] = useState<string>("—");
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    return bridge.onPetStateChanged((s) => setPetState(s));
  }, []);

  const remote = useMemo(() => createRemotePetController(), []);
  const preview: SundayController = useMemo(
    () => ({
      setState: (s: SundayState) => previewEngine()?.request(s),
      setSpeech: (t: string) => onPreviewSpeech(t),
      clearSpeech: () => onPreviewSpeech(null),
      setRoaming: () => undefined,
      setMovementSpeed: () => undefined,
      setCharacterScale: () => undefined,
    }),
    [previewEngine, onPreviewSpeech],
  );
  const controller = target === "pet" ? remote : preview;

  const call = (label: string, fn: () => void) => {
    fn();
    setLog((l) => [`controller.${label}`, ...l].slice(0, 6));
  };

  return (
    <section className="panel-section playground">
      <div className="segmented" role="radiogroup" aria-label="Target">
        <button type="button" role="radio" aria-checked={target === "pet"} className={target === "pet" ? "is-active" : ""} disabled={!hasBridge} onClick={() => setTarget("pet")}>
          Desktop pet
        </button>
        <button type="button" role="radio" aria-checked={target === "preview"} className={target === "preview" ? "is-active" : ""} onClick={() => setTarget("preview")}>
          Studio preview
        </button>
      </div>
      {!hasBridge && <p className="section-note">Running in a browser: the desktop pet is only reachable from the Electron app.</p>}
      {target === "pet" && hasBridge && (
        <p className="live-state">
          Live pet state <b>{petState}</b>
        </p>
      )}

      <div className="field">
        <span className="field-label">setState()</span>
        <div className="state-buttons">
          {CONTROLLABLE_STATES.map((s) => (
            <button key={s} type="button" className="state-btn" onClick={() => call(`setState("${s}")`, () => controller.setState(s))} data-state={s}>
              {STATE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">setSpeech()</span>
        <div className="speech-row">
          <input value={speech} onChange={(e) => setSpeech(e.target.value)} maxLength={600} placeholder="Text for the speech bubble" />
          <button type="button" className="tbtn primary" onClick={() => call(`setSpeech(${JSON.stringify(speech)})`, () => controller.setSpeech(speech))} disabled={!speech.trim()}>
            Show
          </button>
          <button type="button" className="tbtn" onClick={() => call("clearSpeech()", () => controller.clearSpeech())}>
            Clear
          </button>
        </div>
      </div>

      {target === "pet" && hasBridge && (
        <div className="field pet-controls">
          <label className="switch row">
            <span>setRoaming()</span>
            <input type="checkbox" checked={settings.roaming} onChange={(e) => call(`setRoaming(${e.target.checked})`, () => controller.setRoaming(e.target.checked))} />
          </label>
          <label className="slider">
            <span className="slider-head">
              <span>setMovementSpeed()</span>
              <output>{settings.movementSpeed.toFixed(2)}×</output>
            </span>
            <input type="range" min={0.5} max={2} step={0.05} value={settings.movementSpeed} onChange={(e) => controller.setMovementSpeed(parseFloat(e.target.value))} style={{ ["--progress" as string]: `${((settings.movementSpeed - 0.5) / 1.5) * 100}%` }} />
          </label>
          <label className="slider">
            <span className="slider-head">
              <span>setCharacterScale()</span>
              <output>{settings.characterScale.toFixed(2)}×</output>
            </span>
            <input type="range" min={0.6} max={1.8} step={0.05} value={settings.characterScale} onChange={(e) => controller.setCharacterScale(parseFloat(e.target.value))} style={{ ["--progress" as string]: `${((settings.characterScale - 0.6) / 1.2) * 100}%` }} />
          </label>
        </div>
      )}

      <div className="call-log" aria-live="polite">
        {log.length === 0 ? <span className="muted">Calls appear here.</span> : log.map((l, i) => <code key={i}>{l}</code>)}
      </div>
    </section>
  );
}
