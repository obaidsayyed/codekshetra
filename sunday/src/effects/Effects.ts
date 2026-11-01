import * as THREE from "three";
import { VOXEL } from "../character/CharacterConfig";
import type { FxKind } from "../animation/AnimationClips";

/**
 * Pooled sprite particles in a pixel-art style: Z's, sparkles, confetti, the
 * question mark, the green check, thought bubbles, sound waves, speed lines,
 * dust and typing glyphs. The pool is capped so effects can never pile up.
 */

const MAX_PARTICLES = 72;

interface Particle {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  kind: FxKind;
  age: number;
  life: number;
  vel: THREE.Vector3;
  gravity: number;
  size0: number;
  size1: number;
  spin: number;
  baseOpacity: number;
  pop: boolean;
  bob: number;
  origin: THREE.Vector3;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const textureCache = new Map<string, THREE.Texture>();

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, pixel = true): THREE.Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (pixel) {
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
  }
  textureCache.set(key, tex);
  return tex;
}

/** Draws a bitmap with a 1px dark outline, for crisp pixel glyphs. */
function bitmap(key: string, rows: string[], colors: Record<string, string>, outline = "rgba(5,12,24,0.85)"): THREE.Texture {
  const h = rows.length + 2;
  const w = Math.max(...rows.map((r) => r.length)) + 2;
  return canvasTexture(key, w, h, (ctx) => {
    const put = (dx: number, dy: number, color: string | null) => {
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === ".") return;
          ctx.fillStyle = color ?? colors[ch] ?? "#fff";
          ctx.fillRect(x + 1 + dx, y + 1 + dy, 1, 1);
        }),
      );
    };
    if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(dx, dy, outline);
    put(0, 0, null);
  });
}

const GLYPHS = {
  z: () =>
    bitmap("z", ["#######", "#######", "....##.", "...##..", "..##...", ".##....", "#######", "#######"], { "#": "#7fd8ff" }),
  question: () =>
    bitmap(
      "question",
      [".#####.", "##hhh##", "##...##", ".....##", "....##.", "...##..", "...##..", ".......", "...##..", "...##.."],
      { "#": "#ff4d5e", h: "#ff98a3" },
    ),
  exclaim: () => bitmap("exclaim", ["##", "##", "##", "##", "##", "..", "##"], { "#": "#ffd54a" }),
  sparkle: () => bitmap("sparkle", ["...#...", "...#...", "..#w#..", "##www##", "..#w#..", "...#...", "...#..."], { "#": "#ffe066", w: "#ffffff" }, ""),
  star: () =>
    bitmap(
      "star",
      ["....#....", "....#....", "...###...", "#########", ".#######.", "..#####..", ".###.###.", ".##...##."],
      { "#": "#ffd23f" },
    ),
  check: () =>
    canvasTexture("check", 18, 18, (ctx) => {
      ctx.fillStyle = "#0d3b1b";
      ctx.fillRect(1, 2, 16, 15);
      ctx.fillRect(2, 1, 14, 17);
      ctx.fillStyle = "#2fbf55";
      ctx.fillRect(2, 2, 14, 14);
      ctx.fillStyle = "#47d96e";
      ctx.fillRect(2, 2, 14, 3);
      ctx.fillStyle = "#ffffff";
      const pts = [
        [4, 9], [5, 10], [6, 11], [7, 12], [8, 11], [9, 10], [10, 9], [11, 8], [12, 7], [13, 6],
      ];
      for (const [x, y] of pts) ctx.fillRect(x, y, 2, 2);
    }),
  thought: () =>
    canvasTexture("thought", 34, 24, (ctx) => {
      const blob = (x: number, y: number, r: number) => {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      ctx.fillStyle = "#7fe9ff";
      for (const [x, y, r] of [[10, 13, 8], [17, 9, 9], [25, 13, 8], [17, 16, 7]]) blob(x, y, r + 1);
      ctx.fillStyle = "#f3fbff";
      for (const [x, y, r] of [[10, 13, 8], [17, 9, 9], [25, 13, 8], [17, 16, 7]]) blob(x, y, r);
      ctx.fillStyle = "#1a3b5c";
      for (const x of [11, 17, 23]) ctx.fillRect(x, 12, 3, 3);
    }),
  dot: () =>
    canvasTexture("dot", 8, 8, (ctx) => {
      ctx.fillStyle = "#7fe9ff";
      ctx.fillRect(1, 2, 6, 4);
      ctx.fillRect(2, 1, 4, 6);
      ctx.fillStyle = "#f3fbff";
      ctx.fillRect(2, 2, 4, 4);
    }),
  wave: () =>
    canvasTexture("wave", 14, 16, (ctx) => {
      ctx.strokeStyle = "#39e4ff";
      ctx.lineWidth = 1.6;
      for (const r of [4, 8, 12]) {
        ctx.beginPath();
        ctx.arc(1, 8, r, -0.9, 0.9);
        ctx.stroke();
      }
    }),
  speed: () =>
    canvasTexture(
      "speed",
      32,
      4,
      (ctx) => {
        const g = ctx.createLinearGradient(0, 0, 32, 0);
        g.addColorStop(0, "rgba(120,230,255,0)");
        g.addColorStop(1, "rgba(200,248,255,1)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 1, 32, 2);
      },
      false,
    ),
  dust: () =>
    canvasTexture("dust", 8, 8, (ctx) => {
      ctx.fillStyle = "rgba(210,220,235,0.9)";
      ctx.fillRect(2, 1, 4, 6);
      ctx.fillRect(1, 2, 6, 4);
    }),
  square: () =>
    canvasTexture("square", 2, 2, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 2, 2);
    }),
  typing: (variant: number) =>
    canvasTexture(`typing${variant}`, 24, 12, (ctx) => {
      ctx.font = "bold 10px monospace";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      const labels = ["</>", "01", "{ }", "fn"];
      const colors = ["#5fe3ff", "#3ddc84", "#ffcf5c", "#b79cff"];
      ctx.fillStyle = colors[variant % colors.length];
      ctx.fillText(labels[variant % labels.length], 12, 6.5);
    }),
};

const CONFETTI = ["#ff4d6d", "#ffd23f", "#3ddc84", "#38b6ff", "#b57dff", "#ff9f1c", "#ffffff"];

// ---------------------------------------------------------------------------

export class Effects {
  readonly root = new THREE.Group();
  private pool: Particle[] = [];
  private enabled = true;

  constructor() {
    this.root.name = "effects";
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const material = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: true });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 5;
      this.root.add(sprite);
      this.pool.push({
        sprite,
        material,
        kind: "sparkle",
        age: 0,
        life: 1,
        vel: new THREE.Vector3(),
        gravity: 0,
        size0: 1,
        size1: 1,
        spin: 0,
        baseOpacity: 1,
        pop: false,
        bob: 0,
        origin: new THREE.Vector3(),
        active: false,
      });
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.clear();
  }

  clear(): void {
    for (const p of this.pool) {
      p.active = false;
      p.sprite.visible = false;
    }
  }

  get activeCount(): number {
    return this.pool.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  }

  private alloc(): Particle | null {
    let oldest: Particle | null = null;
    for (const p of this.pool) {
      if (!p.active) return p;
      if (!oldest || p.age / p.life > oldest.age / oldest.life) oldest = p;
    }
    return oldest;
  }

  /** Spawns effect particles at `pos` (character-local world units). */
  spawn(kind: FxKind, pos: THREE.Vector3, opts: { count?: number; life?: number; dir?: number } = {}): void {
    if (!this.enabled) return;
    const count = opts.count ?? 1;
    const V = VOXEL;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    for (let i = 0; i < count; i++) {
      const p = this.alloc();
      if (!p) return;
      p.active = true;
      p.kind = kind;
      p.age = 0;
      p.spin = 0;
      p.gravity = 0;
      p.pop = false;
      p.bob = 0;
      p.baseOpacity = 1;
      p.material.color.set(0xffffff);
      p.material.rotation = 0;
      p.material.blending = THREE.NormalBlending;
      p.origin.copy(pos);
      p.sprite.position.copy(pos);
      p.vel.set(0, 0, 0);
      switch (kind) {
        case "z":
          p.material.map = GLYPHS.z();
          p.life = opts.life ?? 2.6;
          p.vel.set(rand(1.5, 3) * V, 5 * V, 0);
          p.size0 = 3.2 * V;
          p.size1 = 6 * V;
          p.bob = 1;
          break;
        case "sparkle":
          p.material.map = GLYPHS.sparkle();
          p.life = opts.life ?? rand(0.6, 1.0);
          p.sprite.position.add(new THREE.Vector3(rand(-11, 11) * V, rand(-4, 8) * V, rand(0, 4) * V));
          p.size0 = 2.5 * V;
          p.size1 = 4.5 * V;
          p.pop = true;
          break;
        case "star":
          p.material.map = GLYPHS.star();
          p.life = opts.life ?? 0.9;
          p.vel.set(rand(-4, 4) * V, rand(4, 9) * V, 0);
          p.size0 = 2.6 * V;
          p.size1 = 3.4 * V;
          p.pop = true;
          break;
        case "confetti":
          p.material.map = GLYPHS.square();
          p.material.color.set(CONFETTI[Math.floor(Math.random() * CONFETTI.length)]);
          p.life = opts.life ?? rand(1.4, 2.2);
          p.vel.set(rand(-16, 16) * V, rand(14, 26) * V, rand(-4, 4) * V);
          p.gravity = -34 * V;
          p.size0 = p.size1 = rand(0.9, 1.4) * V;
          p.spin = rand(-8, 8);
          break;
        case "question":
          p.material.map = GLYPHS.question();
          p.life = opts.life ?? 2.6;
          p.size0 = p.size1 = 6.5 * V;
          p.pop = true;
          p.bob = 0.6;
          break;
        case "exclaim":
          p.material.map = GLYPHS.exclaim();
          p.life = opts.life ?? 1.2;
          p.size0 = p.size1 = 5 * V;
          p.pop = true;
          break;
        case "check":
          p.material.map = GLYPHS.check();
          p.life = opts.life ?? 1.8;
          p.size0 = p.size1 = 7 * V;
          p.pop = true;
          p.vel.set(0, 1.2 * V, 0);
          break;
        case "thought":
          p.material.map = GLYPHS.thought();
          p.life = opts.life ?? 4;
          p.size0 = p.size1 = 13 * V;
          p.pop = true;
          p.bob = 0.5;
          p.baseOpacity = 0.95;
          break;
        case "thoughtDot":
          p.material.map = GLYPHS.dot();
          p.life = opts.life ?? 0.9;
          p.vel.set(4 * V, 7 * V, 0);
          p.size0 = 1.2 * V;
          p.size1 = 2.2 * V;
          break;
        case "soundwave":
          p.material.map = GLYPHS.wave();
          p.material.blending = THREE.AdditiveBlending;
          p.life = opts.life ?? 0.9;
          p.vel.set(-9 * V, 0, 0);
          p.size0 = 3 * V;
          p.size1 = 7 * V;
          p.material.rotation = Math.PI;
          break;
        case "speedline":
          p.material.map = GLYPHS.speed();
          p.material.blending = THREE.AdditiveBlending;
          p.life = opts.life ?? 0.32;
          p.vel.set(-(opts.dir ?? 1) * 40 * V, 0, 0);
          p.size0 = p.size1 = 1.4 * V;
          p.material.rotation = (opts.dir ?? 1) < 0 ? Math.PI : 0;
          p.baseOpacity = 0.8;
          break;
        case "dust":
          p.material.map = GLYPHS.dust();
          p.life = opts.life ?? rand(0.4, 0.6);
          p.sprite.position.add(new THREE.Vector3(rand(-4, 4) * V, 0.5 * V, rand(-2, 2) * V));
          p.vel.set(rand(-6, 6) * V, rand(1, 3) * V, 0);
          p.size0 = 1.2 * V;
          p.size1 = 3 * V;
          p.baseOpacity = 0.55;
          break;
        case "typing":
          p.material.map = GLYPHS.typing(Math.floor(Math.random() * 4));
          p.life = opts.life ?? 1.3;
          p.sprite.position.add(new THREE.Vector3(rand(-4, 4) * V, 0, 0));
          p.vel.set(rand(-1, 1) * V, 6 * V, 0);
          p.size0 = 3.5 * V;
          p.size1 = 4.5 * V;
          break;
      }
      p.material.needsUpdate = true;
      p.sprite.visible = true;
      this.applyScale(p, 0);
    }
  }

  private applyScale(p: Particle, t: number): void {
    let s = p.size0 + (p.size1 - p.size0) * t;
    if (p.pop) {
      const k = Math.min(1, p.age / 0.22);
      s *= k < 1 ? 1.15 * Math.sin((k * Math.PI) / 2) + 0.0 * k : 1;
    }
    const map = p.material.map;
    const aspect = map && map.image ? (map.image as HTMLCanvasElement).width / (map.image as HTMLCanvasElement).height : 1;
    p.sprite.scale.set(s * aspect, s, 1);
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = p.age / p.life;
      p.vel.y += p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      if (p.bob) p.sprite.position.y += Math.sin(p.age * 3.2) * 0.0035 * p.bob;
      if (p.kind === "z") p.sprite.position.x += Math.sin(p.age * 2.4) * 0.002;
      if (p.spin) p.material.rotation += p.spin * dt;
      this.applyScale(p, t);
      const fadeIn = Math.min(1, p.age / 0.12);
      const fadeOut = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      p.material.opacity = p.baseOpacity * fadeIn * fadeOut;
    }
  }

  dispose(): void {
    for (const p of this.pool) p.material.dispose();
  }
}
