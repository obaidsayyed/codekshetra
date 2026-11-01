import { useEffect, useRef, useState } from "react";
import { useSettings } from "../hooks/useSettings";
import { getBridge } from "../services/bridge";
import type { AppInfo } from "../shared/ipc";
import { playSound, setSoundEnabled, setSoundVolume, wireUiSounds } from "../services/sound";
import { isNightActive, SETTING_RANGES, type NightMode, type VoiceMode } from "../shared/settings";
import { setVoiceSettings, testVoice } from "../services/voice";
import { CustomizationPanel } from "./CustomizationPanel";
import { IconClose, IconMinus } from "./Icons";

/** Compact settings window for the desktop pet. */
export function PetSettings() {
  const bridge = getBridge();
  const [s, update] = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [tab, setTab] = useState<"pet" | "look">("pet");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => (rootRef.current ? wireUiSounds(rootRef.current) : undefined), []);
  useEffect(() => {
    setSoundEnabled(s.soundEffects && !s.quietMode);
    setSoundVolume(s.soundVolume);
    setVoiceSettings(s.voice, s.soundEffects && !s.quietMode, s.soundVolume);
  }, [s.soundEffects, s.quietMode, s.soundVolume, s.voice]);

  useEffect(() => {
    document.documentElement.classList.add("view-settings");
    document.title = "SUNDAY Settings";
    void bridge?.getAppInfo().then(setInfo);
    return () => document.documentElement.classList.remove("view-settings");
  }, [bridge]);

  const night = isNightActive(s.nightMode);

  const toggle = (label: string, key: "roaming" | "alwaysOnTop" | "quietMode" | "soundEffects" | "visible" | "startWithWindows", hint?: string, disabled?: boolean) => (
    <label className={`switch row ${disabled ? "is-disabled" : ""}`}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={s[key]} disabled={disabled} onChange={(e) => update({ [key]: e.target.checked })} />
    </label>
  );

  const range = (label: string, key: "movementSpeed" | "animationSpeed" | "characterScale") => {
    const r = SETTING_RANGES[key];
    const v = s[key];
    return (
      <label className="slider">
        <span className="slider-head">
          <span>{label}</span>
          <output>{v.toFixed(2)}×</output>
        </span>
        <input type="range" min={r.min} max={r.max} step={0.05} value={v} onChange={(e) => update({ [key]: parseFloat(e.target.value) })} style={{ ["--progress" as string]: `${((v - r.min) / (r.max - r.min)) * 100}%` }} />
      </label>
    );
  };

  return (
    <div className={`panel-shell ${night ? "is-night" : ""}`} ref={rootRef}>
      <div className="settings-panel">
        <header className="chat-header drag-region">
          <div className="chat-title">
            <h1>Settings</h1>
            <span className="conn">SUNDAY {info ? `v${info.version}` : ""}</span>
          </div>
          <div className="chat-controls no-drag">
            <button type="button" onClick={() => bridge?.minimizeWindow()} aria-label="Minimize">
              <IconMinus />
            </button>
            <button type="button" onClick={() => bridge?.closeWindow()} aria-label="Close">
              <IconClose />
            </button>
          </div>
        </header>
        <div className="segmented no-drag">
          <button type="button" className={tab === "pet" ? "is-active" : ""} onClick={() => setTab("pet")}>
            Behaviour
          </button>
          <button type="button" className={tab === "look" ? "is-active" : ""} onClick={() => setTab("look")}>
            Appearance
          </button>
        </div>
        <div className="settings-body">
          {tab === "pet" ? (
            <>
              <section className="panel-section">
                <h2 className="section-title">Moving around</h2>
                {toggle("Roam around the desktop", "roaming")}
                {range("Movement speed", "movementSpeed")}
                {range("Animation speed", "animationSpeed")}
                {range("Character size", "characterScale")}
              </section>
              <section className="panel-section">
                <h2 className="section-title">Sounds</h2>
                {toggle("Sound effects", "soundEffects", "Footsteps, boings, babble and little jingles")}
                <label className={`slider ${!s.soundEffects ? "is-disabled" : ""}`}>
                  <span className="slider-head">
                    <span>Volume</span>
                    <output>{Math.round(s.soundVolume * 100)}%</output>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={s.soundVolume}
                    disabled={!s.soundEffects}
                    onChange={(e) => update({ soundVolume: parseFloat(e.target.value) })}
                    onPointerUp={() => playSound("greet")}
                    style={{ ["--progress" as string]: `${s.soundVolume * 100}%` }}
                  />
                </label>
                <span className="field-label">Voice</span>
                <div className="segmented small">
                  {(
                    [
                      ["speak", "Talking voice"],
                      ["babble", "Cute babble"],
                      ["off", "Silent"],
                    ] as [VoiceMode, string][]
                  ).map(([m, label]) => (
                    <button key={m} type="button" className={s.voice.mode === m ? "is-active" : ""} onClick={() => update({ voice: { ...s.voice, mode: m } })}>
                      {label}
                    </button>
                  ))}
                </div>
                <label className="switch row">
                  <span>
                    Spoken reactions
                    <small>&ldquo;Wheee!&rdquo;, &ldquo;Yay!&rdquo;, &ldquo;Uh-oh!&rdquo;</small>
                  </span>
                  <input type="checkbox" checked={s.voice.reactions} onChange={(e) => update({ voice: { ...s.voice, reactions: e.target.checked } })} />
                </label>
                <button type="button" className="tbtn sunny" data-sound="off" disabled={!s.soundEffects || s.voice.mode === "off"} onClick={() => testVoice()}>
                  Test Sunday&rsquo;s voice
                </button>
                <p className="section-note">Pick a different voice, pitch and speed in Animation Studio → Sound.</p>
              </section>
              <section className="panel-section">
                <h2 className="section-title">Behaviour</h2>
                {toggle("Always on top", "alwaysOnTop")}
                {toggle("Quiet mode", "quietMode", "No chatter, no sounds, calmer roaming")}
                {toggle("Show SUNDAY", "visible")}
                {toggle("Start with Windows", "startWithWindows", info && !info.startWithWindowsSupported ? "Available in the installed app" : undefined, !!info && !info.startWithWindowsSupported)}
              </section>
              <section className="panel-section">
                <h2 className="section-title">Night mode</h2>
                <div className="segmented small">
                  {(["off", "auto", "on"] as NightMode[]).map((m) => (
                    <button key={m} type="button" className={s.nightMode === m ? "is-active" : ""} onClick={() => update({ nightMode: m })}>
                      {m === "off" ? "Off" : m === "on" ? "On" : "Auto (21:30–06:30)"}
                    </button>
                  ))}
                </div>
                <p className="section-note">Night mode dims the lighting, calms Sunday down and lets him go to sleep. Click him to wake him up.</p>
              </section>
            </>
          ) : (
            <CustomizationPanel appearance={s.appearance} onChange={(appearance) => update({ appearance })} />
          )}
        </div>
      </div>
    </div>
  );
}
