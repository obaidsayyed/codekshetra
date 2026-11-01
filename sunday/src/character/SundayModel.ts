import * as THREE from "three";
import { appearanceKey, type CharacterAppearance, DEFAULT_APPEARANCE } from "../shared/appearance";
import { DIM, FACE_TEXELS, FRINGE, JOINTS, VOXEL } from "./CharacterConfig";
import { FaceState, NEUTRAL_FACE, faceKey, renderFaceCanvas } from "./FaceRenderer";
import { SKINS, SkinPalette, resolveGlow } from "./skins";
import { hashNoise, pick, VoxelGrid } from "./VoxelGrid";
import { buildProps, PropSet } from "./Props";

/**
 * Builds Sunday: an original voxel character assembled from articulated parts.
 *
 *   object (placement in the scene)
 *    └─ stage (facing yaw; props live here so they turn with Sunday)
 *        ├─ props (laptop, desk, chair, bed, blanket)
 *        └─ rigRoot (whole-body offset / roll, e.g. lying down)
 *            └─ hips
 *                ├─ spine ─┬─ neck (head, hair, headphones, face)
 *                │         ├─ shoulderL ─ elbowL
 *                │         └─ shoulderR ─ elbowR
 *                ├─ hipL ─ kneeL (shin + shoe)
 *                └─ hipR ─ kneeR (shin + shoe)
 */

export interface Joints {
  rigRoot: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  neck: THREE.Group;
  shoulderL: THREE.Group;
  elbowL: THREE.Group;
  shoulderR: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  kneeL: THREE.Group;
  hipR: THREE.Group;
  kneeR: THREE.Group;
}

interface PartGeometry {
  solid: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
}

const geometryCache = new Map<string, PartGeometry>();

function cached(key: string, build: () => PartGeometry): PartGeometry {
  let g = geometryCache.get(key);
  if (!g) {
    g = build();
    geometryCache.set(key, g);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Part authoring
// ---------------------------------------------------------------------------

function shade(palette: readonly number[], x: number, y: number, z: number, seed: number, bias = 0): number {
  const n = hashNoise(x, y, z, seed);
  const i = Math.max(0, Math.min(palette.length - 1, Math.floor(n * (palette.length - 1) + 0.5 + bias)));
  return palette[i];
}

function buildHead(p: SkinPalette, glowColor: number, a: CharacterAppearance): VoxelGrid {
  const g = new VoxelGrid();
  const { w, h, d } = DIM.head; // 12 × 12 × 11 → x 0..11, y 0..11, z 0..10 (front z = 10)
  const front = d - 1;

  // skull: skin in front, hair on the back/sides/top
  g.box(0, 0, 0, w, h, d, (x, y, z) => {
    const isFront = z === front;
    const isBack = z === 0;
    const isSide = x === 0 || x === w - 1;
    if (y === h - 1) return shade(p.hair, x, y, z, 3, 0.6);
    if (isBack && y >= 1) return shade(p.hair, x, y, z, 3, 0.2);
    if (isSide && y >= 6 && z < front - 1) return shade(p.hair, x, y, z, 3);
    if (isFront && y >= 9) return shade(p.hair, x, y, z, 3, -0.8);
    // skin with a soft jaw shadow and cheek light
    if (y === 0) return p.skin[1];
    if (isFront && (x === 0 || x === w - 1)) return p.skin[1];
    return hashNoise(x, y, z, 11) > 0.82 ? p.skin[3] : p.skin[2];
  });

  // hair shell -------------------------------------------------------------
  // hair is shaded in chunky 2-voxel clumps with a little per-voxel variation
  const hairShade = (x: number, y: number, z: number, bias: number) => {
    const clump = hashNoise(Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2), 5);
    const fine = hashNoise(x, y, z, 6) - 0.5;
    const t = clump * 0.75 + fine * 0.35 + 0.1 + bias * 0.18;
    const i = Math.max(0, Math.min(p.hair.length - 1, Math.floor(t * p.hair.length)));
    return p.hair[i];
  };
  const hair = (x: number, y: number, z: number, bias = 0) => g.set(x, y, z, hairShade(x, y, z, bias));
  for (let x = -1; x <= w; x++)
    for (let z = -1; z <= d; z++) {
      hair(x, h, z, 0.8); // y = 12 full cap
      const edge = x === -1 || x === w || z === -1 || z === d;
      if (!edge && hashNoise(x, 13, z, 7) > 0.03) hair(x, h + 1, z, 1.2); // y = 13 volume
    }
  // messy tufts on top (kept clear of the headphone band at z = 4..5)
  const tufts: [number, number][] = [
    [1, 8], [2, 9], [3, 7], [6, 9], [7, 8], [9, 9], [10, 7], [4, 1], [8, 2], [5, 8], [2, 2], [10, 1], [7, 10], [3, 10],
  ];
  for (const [tx, tz] of tufts) hair(tx, h + 2, tz, 1.5);
  // back volume
  for (let x = -1; x <= w; x++)
    for (let y = 2; y < h; y++) hair(x, y, -1, 0);
  for (let x = 0; x < w; x++)
    for (let y = 5; y <= h; y++) if (hashNoise(x, y, -2, 9) > 0.12) hair(x, y, -2, -0.2);
  // side panels (behind the ear cups) + sideburns toward the front
  for (const sx of [-1, w])
    for (let z = -1; z <= d; z++)
      for (let y = 5; y < h; y++) {
        if (z >= front - 2 && y < 6) continue;
        hair(sx, y, z, 0);
      }
  for (const sx of [-1, w])
    for (let y = 3; y < 6; y++) hair(sx, y, front - 1, -0.3);
  // fringe: chunky strands hanging over the forehead, with a second layer for depth
  FRINGE.forEach((len, i) => {
    const x = i - 1;
    for (let k = 0; k < len; k++) hair(x, h - 1 - k, d, k === len - 1 ? -0.6 : 0.3);
    if (len >= 3 && x >= 0 && x < w) for (let k = 0; k < len - 2; k++) hair(x, h - 1 - k, d + 1, 0.6);
  });
  // overhang above the fringe and puffs around the headphone band
  for (let x = 0; x < w; x++) if (hashNoise(x, 12, d + 1, 21) > 0.25) hair(x, h, d + 1, 0.9);
  for (const sx of [-2, w + 1])
    for (let z = -1; z <= d; z++) {
      if (z >= 4 && z <= 5) continue;
      for (let y = 9; y <= h; y++) if (hashNoise(sx, y, z, 23) > (y === h ? 0.15 : 0.35)) hair(sx, y, z, 0.3);
    }
  // a couple of strands sweeping past the sides of the face
  hair(-1, 7, d, -0.2);
  hair(w, 7, d, -0.2);

  // headphones -------------------------------------------------------------
  const blacks = [0x0b0c0f, 0x111317, 0x181b20, 0x20242a];
  const cupY0 = 2;
  const cupZ0 = 2;
  for (const side of [-1, 1] as const) {
    const xs = side < 0 ? [-3, -2] : [w + 1, w + 2];
    const ringX = side < 0 ? -4 : w + 3;
    for (const x of xs)
      for (let y = cupY0; y < cupY0 + 6; y++)
        for (let z = cupZ0; z < cupZ0 + 6; z++) g.set(x, y, z, shade(blacks, x, y, z, 13));
    // glowing ring on the outer face: a rounded "O", 4 × 4 with a 2 × 2 hole
    for (let y = cupY0 + 1; y < cupY0 + 5; y++)
      for (let z = cupZ0 + 1; z < cupZ0 + 5; z++) {
        const border = y === cupY0 + 1 || y === cupY0 + 4 || z === cupZ0 + 1 || z === cupZ0 + 4;
        const corner = (y === cupY0 + 1 || y === cupY0 + 4) && (z === cupZ0 + 1 || z === cupZ0 + 4);
        if (border && !corner) g.set(ringX, y, z, glowColor, true);
      }
    // ring corners in dark plastic so the ring reads rounded
    for (const y of [cupY0 + 1, cupY0 + 4]) for (const z of [cupZ0 + 1, cupZ0 + 4]) g.set(ringX, y, z, blacks[2]);
    // band down the side
    const bx = side < 0 ? -2 : w + 1;
    for (let y = cupY0 + 6; y <= h + 2; y++) for (let z = 4; z <= 5; z++) g.set(bx, y, z, shade(blacks, bx, y, z, 17));
  }
  // band over the top with an accent stripe
  for (let x = -2; x <= w + 1; x++)
    for (let z = 4; z <= 5; z++) {
      g.set(x, h + 3, z, x >= 2 && x <= w - 3 ? p.logo : shade(blacks, x, h + 3, z, 19));
    }
  for (let z = 4; z <= 5; z++) {
    g.set(-1, h + 3, z, blacks[1]);
    g.set(w, h + 3, z, blacks[1]);
  }
  void a;
  return g;
}

function buildTorso(p: SkinPalette, a: CharacterAppearance): VoxelGrid {
  const g = new VoxelGrid();
  const { w, h, d } = DIM.torso; // x 0..7, y 0..9, z 0..4 (front z = 4)
  const front = d - 1;
  const S = [".###", "#...", ".##.", "...#", "###."]; // rows top → bottom
  g.box(0, 0, 0, w, h, d, (x, y, z) => {
    if (y === 0) return p.hoodieTrim;
    if (z === front) {
      if (y === h - 1 && (x === 3 || x === 4)) return p.skin[1]; // neckline
      if (x >= 1 && x <= 6 && y >= 1 && y <= h - 1) {
        const row = 6 - y; // y 6 → row 0
        if (x >= 2 && x <= 5 && row >= 0 && row < 5 && S[row][x - 2] === "#") return p.logo;
        return shade(p.panel, x, y, z, 23);
      }
    }
    // a darker seam along the sides
    if ((x === 0 || x === w - 1) && z === front) return p.hoodie[0];
    return shade(p.hoodie, x, y, z, 29);
  });
  // hood resting on the back
  for (let x = 1; x < w - 1; x++)
    for (let y = 5; y < h; y++) g.set(x, y, -1, y === h - 1 ? p.hoodieTrim : shade(p.hoodie, x, y, -1, 31, -0.8));
  for (let x = 2; x < w - 2; x++) for (let y = 6; y < h - 1; y++) g.set(x, y, -2, shade(p.hoodie, x, y, -2, 37, -1));

  if (a.accessories.includes("backpack")) {
    const pack = [0x2a2f38, 0x323844, 0x3b4250];
    for (let x = 1; x < w - 1; x++)
      for (let y = 1; y < 9; y++)
        for (let z = -4; z <= -3; z++) g.set(x, y, z, y === 5 ? p.logo : shade(pack, x, y, z, 41));
    for (let x = 2; x < w - 2; x++) for (let y = 2; y < 5; y++) g.set(x, y, -5, shade(pack, x, y, -5, 43, 0.5));
    for (const x of [1, w - 2]) for (let y = 4; y < h; y++) g.set(x, y, d, 0x1b1e24);
  }
  if (a.accessories.includes("scarf")) {
    const knit = [0xb3263a, 0xc9304a, 0xe04060];
    for (let x = -1; x <= w; x++)
      for (let z = -1; z <= d; z++)
        for (let y = h - 2; y <= h - 1; y++) {
          const shell = x === -1 || x === w || z === -1 || z === d;
          if (shell) g.set(x, y, z, (x + y + z) % 3 === 0 ? 0xf2f2f2 : shade(knit, x, y, z, 47));
        }
    for (let y = h - 7; y < h - 2; y++) for (let x = 1; x <= 2; x++) g.set(x, y, d, y === h - 7 ? 0xf2f2f2 : shade(knit, x, y, d, 53));
  }
  return g;
}

function buildUpperArm(p: SkinPalette): VoxelGrid {
  const g = new VoxelGrid();
  const { w, h, d } = DIM.upperArm;
  g.box(0, 0, 0, w, h, d, (x, y, z) => (y === 0 ? p.hoodieTrim : shade(p.hoodie, x, y, z, 59)));
  return g;
}

function buildForearm(p: SkinPalette): VoxelGrid {
  const g = new VoxelGrid();
  const { w, h, d } = DIM.forearm;
  g.box(0, 0, 0, w, h, d, (x, y, z) => {
    if (y === 2) return hashNoise(x, y, z, 61) > 0.7 ? 0x1d2026 : 0x111316; // wristband
    if (y === 0) return p.skin[1];
    return hashNoise(x, y, z, 67) > 0.75 ? p.skin[3] : p.skin[2];
  });
  return g;
}

function buildThigh(p: SkinPalette): VoxelGrid {
  const g = new VoxelGrid();
  const { w, h, d } = DIM.thigh;
  g.box(0, 0, 0, w, h, d, (x, y, z) => shade(p.pants, x, y, z, 71));
  return g;
}

function buildShin(p: SkinPalette): VoxelGrid {
  const g = new VoxelGrid();
  const { w, h, d } = DIM.shin;
  g.box(0, 0, 0, w, h, d, (x, y, z) => shade(p.pants, x, y, z, 73, y === 0 ? -0.6 : 0));
  return g;
}

function buildShoe(p: SkinPalette): VoxelGrid {
  const g = new VoxelGrid();
  const { w, h, d } = DIM.shoe; // x 0..3, y 0..2, z 0..5 (toe z = 5)
  g.box(0, 0, 0, w, h, d, (x, y, z) => {
    if (y === 0) return shade(p.shoeWhite, x, y, z, 79, z === d - 1 ? -0.5 : 0); // sole
    if (z === d - 1 && y === 1) return p.shoeWhite[2]; // toe cap
    if (z === 0) return p.shoeWhite[1]; // heel
    if (y === 1 && (x === 0 || x === w - 1) && (z === 2 || z === 3)) return p.shoeWhite[2]; // side stripe
    if (y === h - 1 && (x === 1 || x === 2) && z >= 3 && z <= 4) return 0x101114; // laces
    return shade(p.shoeUpper, x, y, z, 83);
  });
  return g;
}

function buildGlasses(): VoxelGrid {
  // half-voxel grid aligned with face texels (24 × 24)
  const g = new VoxelGrid();
  const frame = 0x14161b;
  const ring = (x0: number, row0: number) => {
    for (let x = x0; x < x0 + 7; x++)
      for (let row = row0; row < row0 + 7; row++) {
        const border = x === x0 || x === x0 + 6 || row === row0 || row === row0 + 6;
        if (border) g.set(x, FACE_TEXELS - 1 - row, 0, frame);
      }
  };
  ring(3, 10);
  ring(14, 10);
  for (let x = 10; x < 14; x++) g.set(x, FACE_TEXELS - 1 - 12, 0, frame);
  // temples going back along the sides
  for (let z = -12; z < 0; z++) {
    g.set(-1, FACE_TEXELS - 1 - 12, z, frame);
    g.set(FACE_TEXELS, FACE_TEXELS - 1 - 12, z, frame);
  }
  return g;
}

function partGeometry(name: string, a: CharacterAppearance, build: () => VoxelGrid, offset: [number, number, number], cell = VOXEL): PartGeometry {
  return cached(`${name}|${appearanceKey(a)}`, () => build().build(offset, cell));
}

// ---------------------------------------------------------------------------
// Character
// ---------------------------------------------------------------------------

export interface FaceDecal {
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  key: string;
}

export class SundayCharacter {
  readonly object = new THREE.Group();
  readonly stage = new THREE.Group();
  readonly joints: Joints;
  readonly props: PropSet;
  readonly halos: THREE.Sprite[] = [];
  readonly glowLight: THREE.PointLight | null;

  appearance: CharacterAppearance;
  private face: FaceDecal;
  private faceState: FaceState = { ...NEUTRAL_FACE };
  private readonly solidMaterial: THREE.MeshStandardMaterial;
  private readonly glowMaterial: THREE.MeshBasicMaterial;
  private readonly partMeshes: THREE.Mesh[] = [];
  private glowIntensity = 1;

  constructor(appearance: CharacterAppearance = DEFAULT_APPEARANCE, options: { castShadow?: boolean; glowLight?: boolean } = {}) {
    this.appearance = appearance;
    this.object.name = "Sunday";
    this.solidMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, flatShading: true });
    this.glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

    const group = (name: string, pos: readonly number[] = [0, 0, 0]) => {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(pos[0] * VOXEL, pos[1] * VOXEL, pos[2] * VOXEL);
      return g;
    };
    const rigRoot = group("rigRoot");
    const hips = group("hips", JOINTS.hips);
    const spine = group("spine");
    const neck = group("neck", JOINTS.neck);
    const shoulderL = group("shoulderL", JOINTS.shoulderL);
    const shoulderR = group("shoulderR", JOINTS.shoulderR);
    const elbowL = group("elbowL", JOINTS.elbow);
    const elbowR = group("elbowR", JOINTS.elbow);
    const hipL = group("hipL", JOINTS.hipL);
    const hipR = group("hipR", JOINTS.hipR);
    const kneeL = group("kneeL", JOINTS.knee);
    const kneeR = group("kneeR", JOINTS.knee);

    this.object.add(this.stage);
    this.stage.add(rigRoot);
    rigRoot.add(hips);
    hips.add(spine, hipL, hipR);
    spine.add(neck, shoulderL, shoulderR);
    shoulderL.add(elbowL);
    shoulderR.add(elbowR);
    hipL.add(kneeL);
    hipR.add(kneeR);
    this.joints = { rigRoot, hips, spine, neck, shoulderL, elbowL, shoulderR, elbowR, hipL, kneeL, hipR, kneeR };

    this.face = this.createFace();
    this.joints.neck.add(this.face.mesh);
    this.buildParts(options.castShadow ?? true);

    // soft additive halos behind the glowing ear-cup rings
    const haloTex = getHaloTexture();
    for (const side of [-1, 1]) {
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: resolveGlow(appearance), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.scale.setScalar(9 * VOXEL);
      halo.position.set(side * 9.6 * VOXEL, 4 * VOXEL, -0.5 * VOXEL);
      halo.renderOrder = 2;
      this.joints.neck.add(halo);
      this.halos.push(halo);
    }
    if (options.glowLight) {
      this.glowLight = new THREE.PointLight(resolveGlow(appearance), 0.6, 2.2, 2);
      this.glowLight.position.set(0, 5 * VOXEL, 3 * VOXEL);
      this.joints.neck.add(this.glowLight);
    } else {
      this.glowLight = null;
    }

    this.props = buildProps();
    this.stage.add(this.props.root);
    this.object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && options.castShadow !== false) {
        o.castShadow = true;
      }
    });
  }

  private createFace(): FaceDecal {
    const canvas = document.createElement("canvas");
    renderFaceCanvas(canvas, this.faceState, this.appearance.eyes);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.5,
      roughness: 0.7,
      emissive: 0xffffff,
      emissiveMap: texture,
      emissiveIntensity: 0.12,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const { w, h, d } = DIM.head;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * VOXEL, h * VOXEL), material);
    mesh.position.set(0, (h / 2) * VOXEL, (d / 2 + 0.01) * VOXEL);
    mesh.name = "face";
    return { mesh, canvas, texture, key: faceKey(this.faceState, this.appearance.eyes) };
  }

  /** Updates the face decal; only redraws when the quantised expression changes. */
  setFace(state: FaceState): void {
    this.faceState = state;
    const key = faceKey(state, this.appearance.eyes);
    if (key === this.face.key) return;
    this.face.key = key;
    renderFaceCanvas(this.face.canvas, state, this.appearance.eyes);
    this.face.texture.needsUpdate = true;
  }

  getFace(): FaceState {
    return this.faceState;
  }

  private buildParts(castShadow: boolean): void {
    for (const m of this.partMeshes) m.parent?.remove(m);
    this.partMeshes.length = 0;
    const a = this.appearance;
    const p = SKINS[a.skin];
    const glow = resolveGlow(a);
    const j = this.joints;

    const add = (parent: THREE.Object3D, geo: PartGeometry, name: string) => {
      if (geo.solid) {
        const m = new THREE.Mesh(geo.solid, this.solidMaterial);
        m.name = name;
        m.castShadow = castShadow;
        m.receiveShadow = false;
        parent.add(m);
        this.partMeshes.push(m);
      }
      if (geo.glow) {
        const m = new THREE.Mesh(geo.glow, this.glowMaterial);
        m.name = `${name}-glow`;
        parent.add(m);
        this.partMeshes.push(m);
      }
    };

    const H = DIM.head;
    add(j.neck, partGeometry("head", a, () => buildHead(p, glow, a), [-H.w / 2, 0, -H.d / 2]), "head");
    if (a.accessories.includes("glasses")) {
      const geo = partGeometry("glasses", a, buildGlasses, [-H.w, 0, (H.d / 2 + 0.35) * 2], VOXEL / 2);
      add(j.neck, geo, "glasses");
    }
    const T = DIM.torso;
    add(j.spine, partGeometry("torso", a, () => buildTorso(p, a), [-T.w / 2, 0, -T.d / 2]), "torso");
    const UA = DIM.upperArm;
    const FA = DIM.forearm;
    for (const [sh, el, side] of [
      [j.shoulderL, j.elbowL, "L"],
      [j.shoulderR, j.elbowR, "R"],
    ] as const) {
      add(sh, partGeometry("upperArm", a, () => buildUpperArm(p), [-UA.w / 2, -UA.h, -UA.d / 2]), `upperArm${side}`);
      add(el, partGeometry("forearm", a, () => buildForearm(p), [-FA.w / 2, -FA.h, -FA.d / 2]), `forearm${side}`);
    }
    const TH = DIM.thigh;
    const SH = DIM.shin;
    const SO = DIM.shoe;
    for (const [hp, kn, side] of [
      [j.hipL, j.kneeL, "L"],
      [j.hipR, j.kneeR, "R"],
    ] as const) {
      add(hp, partGeometry("thigh", a, () => buildThigh(p), [-TH.w / 2, -TH.h, -TH.d / 2]), `thigh${side}`);
      add(kn, partGeometry("shin", a, () => buildShin(p), [-SH.w / 2, -SH.h, -SH.d / 2]), `shin${side}`);
      add(kn, partGeometry("shoe", a, () => buildShoe(p), [-SO.w / 2, -SH.h - SO.h, -2.5]), `shoe${side}`);
    }
  }

  setAppearance(a: CharacterAppearance): void {
    const eyesChanged = a.eyes !== this.appearance.eyes;
    this.appearance = a;
    this.buildParts(true);
    const glow = resolveGlow(a);
    for (const h of this.halos) (h.material as THREE.SpriteMaterial).color.setHex(glow);
    this.glowLight?.color.setHex(glow);
    if (eyesChanged) {
      this.face.key = "";
      this.setFace(this.faceState);
    }
  }

  /** 0 – 2: brightness of the ear-cup glow (listening pulses it). */
  setGlowIntensity(v: number): void {
    if (Math.abs(v - this.glowIntensity) < 0.01) return;
    this.glowIntensity = v;
    for (const h of this.halos) (h.material as THREE.SpriteMaterial).opacity = 0.35 + 0.35 * v;
    if (this.glowLight) this.glowLight.intensity = 0.35 + 0.45 * v;
  }

  /** Meshes used for pointer hit-testing. */
  getHitMeshes(): THREE.Object3D[] {
    return [...this.partMeshes, this.face.mesh];
  }

  dispose(): void {
    this.solidMaterial.dispose();
    this.glowMaterial.dispose();
    this.face.texture.dispose();
    (this.face.mesh.material as THREE.Material).dispose();
    this.face.mesh.geometry.dispose();
    for (const h of this.halos) (h.material as THREE.Material).dispose();
    this.props.dispose();
  }
}

let haloTexture: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const grd = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,0.9)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

/** Builds a voxel avatar-friendly palette for 2D drawings (panel avatar, icons). */
export function paletteFor(a: CharacterAppearance): SkinPalette {
  return SKINS[a.skin];
}

export { pick };
