import { useEffect, useRef } from "react";
import * as THREE from "three";
import { AnimationEngine } from "../animation/AnimationEngine";
import { SundayCharacter } from "../character/SundayModel";
import { Effects } from "../effects/Effects";
import type { CharacterAppearance } from "../shared/appearance";
import { ANIMATION_STATES, STATE_LABELS, type SundayAnimationState } from "../shared/states";

interface Props {
  selected: SundayAnimationState;
  appearance: CharacterAppearance;
  onSelect: (s: SundayAnimationState) => void;
  paused?: boolean;
}

interface Tile {
  state: SundayAnimationState;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  character: SundayCharacter;
  engine: AnimationEngine;
  effects: Effects;
}

/**
 * The animation strip: every tile is the real 3D character playing its state.
 * All tiles share one WebGL renderer drawn with scissor viewports (one context
 * instead of fifteen), at 30 fps, and pause while scrolled out of view.
 */
export function AnimationGallery({ selected, appearance, onSelect, paused }: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tilesRef = useRef<Tile[]>([]);
  const tileEls = useRef<(HTMLButtonElement | null)[]>([]);
  const pausedRef = useRef(!!paused);
  pausedRef.current = !!paused;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setScissorTest(true);

    const tiles: Tile[] = ANIMATION_STATES.map((state) => {
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xbcd6ff, 0x1c2333, 1.2));
      const key = new THREE.DirectionalLight(0xfff1e2, 2.4);
      key.position.set(-2.6, 4.6, 4.2);
      const rim = new THREE.DirectionalLight(0x4fd8ff, 1.6);
      rim.position.set(3.2, 3.2, -3.6);
      scene.add(key, rim);
      const blob = new THREE.Mesh(
        new THREE.CircleGeometry(0.7, 24),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 0.003;
      scene.add(blob);
      const character = new SundayCharacter(appearance, { castShadow: false });
      const effects = new Effects();
      character.object.add(effects.root);
      scene.add(character.object);
      const engine = new AnimationEngine(character, effects);
      engine.setLoopMode("loop");
      engine.request(state, { force: true });
      // desynchronise the tiles a little
      engine.update(Math.random() * 0.5);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      const wide = state === "sleeping" || state === "waking" || state === "working";
      const tall = state === "jumping" || state === "celebrating" || state === "completed" || state === "thinking";
      camera.position.set(0, tall ? 1.9 : 1.55, wide ? 7.4 : tall ? 7.6 : 6.2);
      camera.lookAt(0, wide ? 0.95 : tall ? 1.45 : 1.05, 0);
      return { state, scene, camera, character, engine, effects };
    });
    tilesRef.current = tiles;

    let visible = true;
    const io = new IntersectionObserver((entries) => (visible = entries.some((e) => e.isIntersecting)));
    if (stripRef.current) io.observe(stripRef.current);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc < 1 / 30 || !visible || document.hidden) return;
      const step = acc;
      acc = 0;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
      }
      renderer.setScissor(0, 0, w, h);
      renderer.clear();
      tiles.forEach((tile, i) => {
        const el = tileEls.current[i];
        if (!el) return;
        if (!pausedRef.current) tile.engine.update(step);
        const r = el.getBoundingClientRect();
        const x = r.left - rect.left + 4;
        const y = r.top - rect.top + 4;
        const tw = r.width - 8;
        const th = r.height - 36;
        if (x + tw < 0 || x > w || tw <= 0 || th <= 0) return;
        const bottom = h - (y + th);
        renderer.setViewport(x, bottom, tw, th);
        renderer.setScissor(x, bottom, tw, th);
        tile.camera.aspect = tw / th;
        tile.camera.updateProjectionMatrix();
        renderer.render(tile.scene, tile.camera);
      });
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      for (const t of tiles) {
        t.effects.dispose();
        t.character.dispose();
      }
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    for (const t of tilesRef.current) t.character.setAppearance(appearance);
  }, [appearance]);

  return (
    <div className="gallery" ref={stripRef}>
      <canvas ref={canvasRef} className="gallery-canvas" aria-hidden />
      <div className="gallery-tiles" role="listbox" aria-label="Animation showcase">
        {ANIMATION_STATES.map((s, i) => (
          <button
            key={s}
            ref={(el) => {
              tileEls.current[i] = el;
            }}
            type="button"
            role="option"
            aria-selected={selected === s}
            className={`gallery-tile ${selected === s ? "is-selected" : ""}`}
            onClick={() => onSelect(s)}
            data-state={s}
          >
            <span className="tile-label">
              <span className="tile-index">{String(i + 1).padStart(2, "0")}</span>
              {STATE_LABELS[s]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
