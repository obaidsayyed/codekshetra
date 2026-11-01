import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STATE_CONFIG, resolvePath } from "../animation/AnimationStateMachine";
import type { EngineTimeline } from "../animation/AnimationEngine";
import { useSettings } from "../hooks/useSettings";
import { getBridge } from "../services/bridge";
import { playSound, setSoundEnabled, setSoundVolume, wireUiSounds } from "../services/sound";
import { SundayScene } from "../scene/SundayScene";
import type { CharacterAppearance } from "../shared/appearance";
import { ANIMATION_STATES, isControllableState, STATE_LABELS, type SundayAnimationState } from "../shared/states";
import { react, setVoiceSettings, type Reaction } from "../services/voice";
import { SoundVoicePanel, type SoundDraft } from "./SoundVoicePanel";
import { createRemotePetController } from "../integration/DevelopmentAdapter";
import { AnimationGallery } from "./AnimationGallery";
import { CustomizationPanel, SkinPortrait } from "./CustomizationPanel";
import { ControllerPlayground } from "./ControllerPlayground";
import { IconLoop, IconPause, IconPlay, IconRestart, IconStepBack, IconStepFwd, IconStop, IconMoon, IconSound, IconMute } from "./Icons";
import { SpeechBubble } from "./SpeechBubble";

/**
 * SUNDAY ANIMATION STUDIO — preview every state on the real 3D character,
 * scrub the timeline, inspect transitions, customise the skin and drive the
 * live desktop pet by hand.
 */

export const BACKGROUNDS = [
  { id: "room", name: "Sunny room" },
  { id: "meadow", name: "Meadow" },
  { id: "sky", name: "Candy sky" },
  { id: "night", name: "Starry night" },
  { id: "transparent", name: "Transparent" },
] as const;
type BackgroundId = (typeof BACKGROUNDS)[number]["id"];

type Tab = "playback" | "transitions" | "character" | "sound" | "live";

const FPS = 30;

export function AnimationStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SundayScene | null>(null);
  const [settings, updateSettings, loaded] = useSettings();
  const [appearance, setAppearance] = useState<CharacterAppearance | null>(null);
  const [selected, setSelected] = useState<SundayAnimationState>("idle");
  const [timeline, setTimeline] = useState<EngineTimeline | null>(null);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [scale, setScale] = useState(1);
  const [orbit, setOrbit] = useState({ yaw: -0.35, pitch: 0.12, distance: 6.2 });
  const [background, setBackground] = useState<BackgroundId>("room");
  const [grid, setGrid] = useState(false);
  const [night, setNight] = useState(false);
  const [tab, setTab] = useState<Tab>("playback");
  const [playAll, setPlayAll] = useState<{ index: number } | null>(null);
  const [transition, setTransition] = useState<{ from: SundayAnimationState; to: SundayAnimationState }>({ from: "sleeping", to: "working" });
  const [routeInfo, setRouteInfo] = useState<string[] | null>(null);
  const [previewSpeech, setPreviewSpeech] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const playAllTimer = useRef<number | null>(null);

  // first appearance comes from saved settings
  useEffect(() => {
    if (loaded && !appearance) setAppearance(settings.appearance);
  }, [loaded, settings.appearance, appearance]);

  // preview sounds (on by default when the pet's sounds are on)
  const [sound, setSound] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  // the Sound & Voice tab edits a draft that is previewed here and applied to the pet on demand
  const [soundDraft, setSoundDraft] = useState<SoundDraft | null>(null);
  useEffect(() => {
    if (loaded && !soundDraft) setSoundDraft({ soundEffects: settings.soundEffects, soundVolume: settings.soundVolume, voice: settings.voice });
  }, [loaded, settings, soundDraft]);
  useEffect(() => {
    const d = soundDraft ?? { soundEffects: settings.soundEffects, soundVolume: settings.soundVolume, voice: settings.voice };
    setSoundEnabled(sound && d.soundEffects);
    setSoundVolume(d.soundVolume);
    setVoiceSettings(d.voice, sound && d.soundEffects, d.soundVolume);
  }, [sound, soundDraft, settings.soundEffects, settings.soundVolume, settings.voice]);
  const [petNote, setPetNote] = useState<string | null>(null);
  const playOnPet = () => {
    if (!isControllableState(selected)) {
      setPetNote(`${STATE_LABELS[selected]} only happens on the pet by itself`);
    } else {
      createRemotePetController().setState(selected);
      setPetNote(`Desktop pet → ${STATE_LABELS[selected]}`);
    }
    window.setTimeout(() => setPetNote(null), 2200);
  };
  useEffect(() => (rootRef.current ? wireUiSounds(rootRef.current) : undefined), []);

  useEffect(() => {
    document.documentElement.classList.add("view-studio");
    document.title = "SUNDAY Animation Studio";
    return () => document.documentElement.classList.remove("view-studio");
  }, []);

  // --- scene lifecycle ----------------------------------------------------------
  useEffect(() => {
    if (!canvasRef.current || !appearance || sceneRef.current) return;
    const scene = new SundayScene(canvasRef.current, { mode: "studio", appearance, shadows: true });
    sceneRef.current = scene;
    scene.engine.setLoopMode("loop");
    scene.engine.onSound = (cue) => playSound(cue);
    (window as unknown as { __studio?: unknown }).__studio = { scene, engine: scene.engine };

    const resize = () => {
      const el = viewportRef.current;
      if (el) scene.setSize(el.clientWidth, el.clientHeight);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (viewportRef.current) ro.observe(viewportRef.current);

    let raf = 0;
    let last = performance.now();
    let frames = 0;
    let fpsStart = performance.now();
    const loopFn = () => {
      raf = requestAnimationFrame(loopFn);
      if (document.hidden) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      scene.frame(dt);
      frames++;
      if (now - fpsStart >= 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsStart)));
        frames = 0;
        fpsStart = now;
      }
      const b = bubbleRef.current;
      if (b) {
        const p = scene.headTopScreen();
        b.style.transform = `translate(${Math.round(p.x - b.offsetWidth / 2)}px, ${Math.round(p.y - b.offsetHeight - 16)}px)`;
        b.style.setProperty("--pointer-x", `${Math.round(b.offsetWidth / 2)}px`);
      }
    };
    loopFn();
    const tl = window.setInterval(() => setTimeline(scene.engine.getTimeline()), 100);
    const voiceFor: Partial<Record<SundayAnimationState, Reaction>> = { celebrating: "celebrate", error: "error", completed: "completed", waking: "wake", dragging: "pickup" };
    const offState = scene.engine.onStateChange((s, from) => {
      setSelected(s);
      const r = voiceFor[s];
      if (r && s !== from) window.setTimeout(() => react(r), 200);
    });
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(tl);
      ro.disconnect();
      offState();
      scene.dispose();
      sceneRef.current = null;
    };
  }, [appearance === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (appearance) sceneRef.current?.setAppearance(appearance);
  }, [appearance]);
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.engine.timeScale = speed;
  }, [speed]);
  useEffect(() => {
    sceneRef.current?.setCharacterScale(scale);
  }, [scale]);
  useEffect(() => {
    sceneRef.current?.setOrbit(orbit);
  }, [orbit]);
  useEffect(() => {
    sceneRef.current?.showGrid(grid);
  }, [grid]);
  useEffect(() => {
    sceneRef.current?.setNight(night);
  }, [night]);
  useEffect(() => {
    sceneRef.current?.engine.setLoopMode(loop ? "loop" : "once");
  }, [loop]);

  // --- transport ---------------------------------------------------------------
  const engine = () => sceneRef.current?.engine;

  const select = useCallback((s: SundayAnimationState) => {
    const e = sceneRef.current?.engine;
    if (!e) return;
    stopPlayAll();
    e.paused = false;
    setPlaying(true);
    e.request(s, { force: true });
    setSelected(s);
    setRouteInfo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const play = () => {
    const e = engine();
    if (!e) return;
    e.paused = false;
    setPlaying(true);
  };
  const pause = () => {
    const e = engine();
    if (!e) return;
    e.paused = true;
    setPlaying(false);
  };
  const stop = () => {
    const e = engine();
    if (!e) return;
    stopPlayAll();
    e.request("idle", { force: true });
    e.seek(0);
    e.paused = true;
    setPlaying(false);
    sceneRef.current?.effects.clear();
  };
  const restart = () => {
    const e = engine();
    if (!e) return;
    e.paused = false;
    setPlaying(true);
    e.restart();
  };
  const step = (dir: number) => {
    const e = engine();
    if (!e) return;
    e.paused = true;
    setPlaying(false);
    const t = e.getTimeline();
    e.seek(Math.max(0, Math.min(t.duration, t.time + dir / FPS)));
    setTimeline(e.getTimeline());
  };
  const scrub = (t: number) => {
    const e = engine();
    if (!e) return;
    e.paused = true;
    setPlaying(false);
    e.seek(t);
    setTimeline(e.getTimeline());
  };

  // --- play all -------------------------------------------------------------------
  function stopPlayAll() {
    if (playAllTimer.current) window.clearTimeout(playAllTimer.current);
    playAllTimer.current = null;
    setPlayAll(null);
  }
  const startPlayAll = () => {
    const e = engine();
    if (!e) return;
    stopPlayAll();
    e.paused = false;
    setPlaying(true);
    const run = (i: number) => {
      if (i >= ANIMATION_STATES.length) {
        setPlayAll(null);
        e.request("idle", { force: true });
        return;
      }
      const s = ANIMATION_STATES[i];
      e.request(s, { force: true });
      setSelected(s);
      setPlayAll({ index: i });
      const cfg = STATE_CONFIG[s];
      const secs = cfg.loop ? Math.min(6, Math.max(3.2, cfg.duration * 2)) : cfg.duration + 0.4;
      playAllTimer.current = window.setTimeout(() => run(i + 1), (secs * 1000) / Math.max(0.25, speed));
    };
    run(0);
  };
  useEffect(() => () => stopPlayAll(), []);

  // --- transitions ---------------------------------------------------------------
  const previewTransition = () => {
    const e = engine();
    if (!e) return;
    stopPlayAll();
    e.paused = false;
    setPlaying(true);
    e.setLoopMode("natural");
    e.request(transition.from, { force: true });
    const cfg = STATE_CONFIG[transition.from];
    const wait = cfg.loop ? 1.6 : Math.max(0.4, cfg.duration * 0.5);
    setRouteInfo(null);
    window.setTimeout(() => {
      const r = e.request(transition.to);
      setRouteInfo([transition.from, ...r.path]);
      window.setTimeout(() => e.setLoopMode(loop ? "loop" : "once"), 6000);
    }, (wait * 1000) / Math.max(0.25, speed));
  };
  const plannedRoute = useMemo(() => resolvePath(transition.from, transition.to), [transition]);

  // --- camera drag / zoom ---------------------------------------------------------
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw: orbit.yaw, pitch: orbit.pitch };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setOrbit((o) => ({ ...o, yaw: d.yaw - (e.clientX - d.x) * 0.01, pitch: Math.max(-0.2, Math.min(1.2, d.pitch + (e.clientY - d.y) * 0.006)) }));
  };
  const onPointerUp = () => (drag.current = null);
  const onWheel = (e: React.WheelEvent) => setOrbit((o) => ({ ...o, distance: Math.max(2.5, Math.min(14, o.distance * (1 + Math.sign(e.deltaY) * 0.08))) }));

  const tl = timeline;
  const frame = tl ? Math.round(tl.time * FPS) : 0;
  const totalFrames = tl ? Math.round(tl.duration * FPS) : 0;
  const bridge = getBridge();

  return (
    <div className={`studio ${night ? "is-night" : ""}`} ref={rootRef}>
      <header className="studio-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            {appearance && <SkinPortrait appearance={appearance} size={30} />}
          </span>
          <h1>
            SUNDAY <span>ANIMATION STUDIO</span>
          </h1>
          <span className="brand-sub">developer tools</span>
        </div>
        <div className="header-status">
          <span className={`state-chip ${tl?.blending ? "is-blending" : ""}`}>
            <i aria-hidden />
            {STATE_LABELS[selected]}
            {tl?.blending && <em>blending</em>}
          </span>
          {playAll && (
            <span className="playall-chip">
              Play all · {playAll.index + 1}/{ANIMATION_STATES.length}
            </span>
          )}
          <button
            type="button"
            className={`icon-toggle ${sound && settings.soundEffects ? "is-on" : ""}`}
            onClick={() => setSound((v) => !v)}
            title={settings.soundEffects ? "Preview sounds" : "Sound effects are off in Settings"}
            aria-pressed={sound}
            data-testid="sound-toggle"
          >
            {sound && settings.soundEffects ? <IconSound /> : <IconMute />}
          </button>
          <button type="button" className={`icon-toggle ${night ? "is-on" : ""}`} onClick={() => setNight((n) => !n)} title="Night lighting preview" aria-pressed={night}>
            <IconMoon />
          </button>
          <span className="fps">{fps} fps</span>
        </div>
      </header>

      <div className="studio-body">
        <nav className="anim-list" aria-label="Animations">
          <h2>Animations</h2>
          <ol>
            {ANIMATION_STATES.map((s, i) => (
              <li key={s}>
                <button type="button" className={selected === s ? "is-active" : ""} onClick={() => select(s)} data-state={s}>
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <span className="name">{STATE_LABELS[s]}</span>
                  <span className="kind">{STATE_CONFIG[s].loop ? "loop" : "once"}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <main className="preview-col">
          <div
            className={`viewport bg-${background}`}
            ref={viewportRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            <canvas ref={canvasRef} className="viewport-canvas" />
            {previewSpeech && <SpeechBubble ref={bubbleRef} text={previewSpeech} floating className="viewport-bubble" />}
            <div className="viewport-hud">
              <span>{STATE_LABELS[selected]}</span>
              <span>
                {tl ? tl.time.toFixed(2) : "0.00"}s / {tl ? tl.duration.toFixed(2) : "0.00"}s
              </span>
            </div>
            <div className="viewport-hint">drag to orbit · scroll to zoom</div>
          </div>

          <div className="transport">
            <div className="transport-buttons">
              {playing ? (
                <button type="button" className="tbtn primary" onClick={pause} data-testid="pause">
                  <IconPause /> Pause
                </button>
              ) : (
                <button type="button" className="tbtn primary" onClick={play} data-testid="play">
                  <IconPlay /> Play
                </button>
              )}
              <button type="button" className="tbtn" onClick={stop} data-testid="stop">
                <IconStop /> Stop
              </button>
              <button type="button" className="tbtn" onClick={restart} data-testid="restart">
                <IconRestart /> Restart
              </button>
              <button type="button" className={`tbtn ${playAll ? "is-on" : ""}`} onClick={() => (playAll ? stopPlayAll() : startPlayAll())} data-testid="play-all">
                <IconLoop /> {playAll ? "Stop all" : "Play All"}
              </button>
              {bridge && (
                <button type="button" className="tbtn sunny" onClick={playOnPet} title="Play this animation on the desktop pet" data-testid="play-on-pet">
                  <IconPlay /> On desktop pet
                </button>
              )}
              {petNote && <span className="pet-note">{petNote}</span>}
              <span className="tsep" />
              <button type="button" className="tbtn icon" onClick={() => step(-1)} title="Previous frame" aria-label="Previous frame">
                <IconStepBack />
              </button>
              <button type="button" className="tbtn icon" onClick={() => step(1)} title="Next frame" aria-label="Next frame">
                <IconStepFwd />
              </button>
              <label className="switch">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} data-testid="loop" />
                <span>Loop</span>
              </label>
            </div>
            <div className="timeline">
              <input
                type="range"
                min={0}
                max={tl?.duration ?? 1}
                step={1 / FPS}
                value={tl?.time ?? 0}
                onChange={(e) => scrub(parseFloat(e.target.value))}
                aria-label="Timeline"
                style={{ ["--progress" as string]: `${tl ? (tl.time / tl.duration) * 100 : 0}%` }}
              />
              <span className="frame-readout">
                frame {frame} / {totalFrames}
              </span>
            </div>
          </div>
        </main>

        <aside className="inspector">
          <div className="tabs" role="tablist">
            {(
              [
                ["playback", "Playback"],
                ["transitions", "Transitions"],
                ["character", "Character"],
                ["sound", "Sound"],
                ["live", "Live"],
              ] as [Tab, string][]
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)} type="button">
                {label}
              </button>
            ))}
          </div>

          {tab === "playback" && (
            <section className="panel-section">
              <Slider label="Speed" value={speed} min={0.1} max={2} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setSpeed} testId="speed" />
              <Slider label="Scale" value={scale} min={0.5} max={1.6} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={setScale} testId="scale" />
              <Slider
                label="Camera rotation"
                value={((orbit.yaw * 180) / Math.PI + 540) % 360 - 180}
                min={-180}
                max={180}
                step={1}
                format={(v) => `${Math.round(v)}°`}
                onChange={(v) => setOrbit((o) => ({ ...o, yaw: (v * Math.PI) / 180 }))}
              />
              <Slider label="Camera zoom" value={orbit.distance} min={2.5} max={14} step={0.1} format={(v) => `${(6.2 / v).toFixed(2)}×`} onChange={(v) => setOrbit((o) => ({ ...o, distance: v }))} invert />
              <div className="field">
                <span className="field-label">Background</span>
                <div className="bg-swatches">
                  {BACKGROUNDS.map((b) => (
                    <button key={b.id} type="button" className={`bg-swatch bg-${b.id} ${background === b.id ? "is-active" : ""}`} onClick={() => setBackground(b.id)} title={b.name} aria-label={b.name} />
                  ))}
                </div>
              </div>
              <label className="switch row">
                <span>Show grid</span>
                <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
              </label>
              <label className="switch row">
                <span>Night lighting</span>
                <input type="checkbox" checked={night} onChange={(e) => setNight(e.target.checked)} />
              </label>
              <div className="state-meta">
                <div>
                  <span>Type</span>
                  <b>{STATE_CONFIG[selected].loop ? "Looping" : "One-shot"}</b>
                </div>
                <div>
                  <span>Priority</span>
                  <b>{STATE_CONFIG[selected].priority}</b>
                </div>
                <div>
                  <span>Blend in</span>
                  <b>{STATE_CONFIG[selected].blendIn.toFixed(2)}s</b>
                </div>
                <div>
                  <span>Then</span>
                  <b>{STATE_CONFIG[selected].loop ? "—" : STATE_LABELS[STATE_CONFIG[selected].next]}</b>
                </div>
              </div>
            </section>
          )}

          {tab === "transitions" && (
            <section className="panel-section">
              <p className="section-note">Plays the first state, then requests the second through the real state machine — including routing and crossfades.</p>
              <div className="transition-picker">
                <StateSelect label="From" value={transition.from} onChange={(from) => setTransition((t) => ({ ...t, from }))} />
                <span className="arrow" aria-hidden>
                  →
                </span>
                <StateSelect label="To" value={transition.to} onChange={(to) => setTransition((t) => ({ ...t, to }))} />
              </div>
              <div className="route">
                <span className="field-label">Planned route</span>
                <div className="route-chips">
                  {[transition.from, ...(plannedRoute ?? [])].map((s, i) => (
                    <span key={`${s}-${i}`} className="route-chip">
                      {STATE_LABELS[s]}
                    </span>
                  ))}
                </div>
                <span className="route-blend">blend into {STATE_LABELS[transition.to]}: {STATE_CONFIG[transition.to].blendIn.toFixed(2)}s</span>
              </div>
              <button type="button" className="tbtn primary wide" onClick={previewTransition} data-testid="preview-transition">
                <IconPlay /> Preview transition
              </button>
              <button type="button" className="tbtn wide" onClick={() => setSpeed(0.25)}>
                Slow motion (0.25×)
              </button>
              {routeInfo && (
                <div className="route-result">
                  Played: {routeInfo.map((s) => STATE_LABELS[s as SundayAnimationState]).join(" → ")}
                </div>
              )}
              <div className="presets">
                <span className="field-label">Common transitions</span>
                {(
                  [
                    ["idle", "walking"],
                    ["walking", "running"],
                    ["idle", "jumping"],
                    ["thinking", "working"],
                    ["working", "celebrating"],
                    ["idle", "sleeping"],
                    ["sleeping", "waking"],
                    ["working", "dragging"],
                  ] as [SundayAnimationState, SundayAnimationState][]
                ).map(([from, to]) => (
                  <button key={`${from}-${to}`} type="button" className="preset" onClick={() => setTransition({ from, to })}>
                    {STATE_LABELS[from]} → {STATE_LABELS[to]}
                  </button>
                ))}
              </div>
            </section>
          )}

          {tab === "character" && appearance && (
            <CustomizationPanel
              appearance={appearance}
              onChange={setAppearance}
              petAppearance={settings.appearance}
              onApplyToPet={() => updateSettings({ appearance })}
            />
          )}

          {tab === "sound" && soundDraft && (
            <SoundVoicePanel
              draft={soundDraft}
              onChange={setSoundDraft}
              saved={settings}
              canApply
              onApply={() => updateSettings({ soundEffects: soundDraft.soundEffects, soundVolume: soundDraft.soundVolume, voice: soundDraft.voice })}
            />
          )}

          {tab === "live" && (
            <ControllerPlayground
              hasBridge={!!bridge}
              previewEngine={() => sceneRef.current?.engine ?? null}
              onPreviewSpeech={setPreviewSpeech}
              settings={settings}
            />
          )}
        </aside>
      </div>

      {appearance && <AnimationGallery selected={selected} appearance={appearance} onSelect={select} />}
    </div>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  invert?: boolean;
  testId?: string;
}) {
  const { label, value, min, max, step, format, onChange, invert, testId } = props;
  const shown = invert ? max + min - value : value;
  return (
    <label className="slider">
      <span className="slider-head">
        <span>{label}</span>
        <output>{format(value)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        data-testid={testId}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(invert ? max + min - v : v);
        }}
        style={{ ["--progress" as string]: `${((shown - min) / (max - min)) * 100}%` }}
      />
    </label>
  );
}

function StateSelect({ label, value, onChange }: { label: string; value: SundayAnimationState; onChange: (s: SundayAnimationState) => void }) {
  return (
    <label className="select">
      <span className="field-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as SundayAnimationState)}>
        {ANIMATION_STATES.map((s) => (
          <option key={s} value={s}>
            {STATE_LABELS[s]}
          </option>
        ))}
      </select>
    </label>
  );
}
