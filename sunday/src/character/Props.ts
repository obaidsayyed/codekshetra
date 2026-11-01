import * as THREE from "three";
import { VOXEL } from "./CharacterConfig";
import { hashNoise, VoxelGrid } from "./VoxelGrid";

/**
 * Voxel props Sunday uses in some states: a laptop on a small desk and a gaming
 * chair (working), a bed with a blanket (sleeping). Each prop has an "amount"
 * channel driven by the animation pose, so props pop in and out smoothly
 * instead of appearing instantly.
 */

export type PropName = "chair" | "desk" | "laptop" | "bed" | "blanket";

export interface PropSet {
  root: THREE.Group;
  items: Record<PropName, THREE.Group>;
  laptopLid: THREE.Group;
  setAmount(name: PropName, amount: number): void;
  /** Animates the laptop screen; `activity` 0–1 controls how fast code scrolls. */
  update(time: number, activity: number): void;
  dispose(): void;
}

const shared = {
  material: null as THREE.MeshStandardMaterial | null,
  glow: null as THREE.MeshBasicMaterial | null,
  geos: new Map<string, { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null }>(),
};

function mats() {
  if (!shared.material) shared.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
  if (!shared.glow) shared.glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  return { solid: shared.material, glow: shared.glow };
}

function geo(name: string, build: () => VoxelGrid, offset: [number, number, number]) {
  let g = shared.geos.get(name);
  if (!g) {
    g = build().build(offset, VOXEL);
    shared.geos.set(name, g);
  }
  return g;
}

function meshes(name: string, build: () => VoxelGrid, offset: [number, number, number]): THREE.Object3D[] {
  const g = geo(name, build, offset);
  const { solid, glow } = mats();
  const out: THREE.Object3D[] = [];
  if (g.solid) {
    const m = new THREE.Mesh(g.solid, solid);
    m.castShadow = true;
    m.receiveShadow = true;
    out.push(m);
  }
  if (g.glow) out.push(new THREE.Mesh(g.glow, glow));
  return out;
}

const n = (x: number, y: number, z: number, s: number, pal: number[]) => pal[Math.floor(hashNoise(x, y, z, s) * pal.length)];

function chairGrid(): VoxelGrid {
  const g = new VoxelGrid();
  const black = [0x15171b, 0x1b1e23, 0x22262c];
  const accent = [0x1f9a45, 0x25b050];
  // seat: x -5..4, y 2..3, z -5..3
  g.box(-5, 2, -5, 10, 2, 9, (x, y, z) => n(x, y, z, 1, black));
  // backrest with accent stripes
  g.box(-5, 4, -7, 10, 14, 2, (x, y, z) => ((x === -3 || x === 2) && y > 6 && y < 16 ? n(x, y, z, 2, accent) : n(x, y, z, 3, black)));
  g.box(-4, 18, -7, 8, 1, 2, (x, y, z) => n(x, y, z, 4, black));
  // stem + star base
  g.box(-1, 0, -2, 2, 2, 2, 0x2b2f36);
  g.box(-5, 0, -2, 10, 1, 1, 0x30343b);
  g.box(-1, 0, -6, 1, 1, 9, 0x30343b);
  return g;
}

function deskGrid(): VoxelGrid {
  const g = new VoxelGrid();
  const wood = [0x3b2a1e, 0x45311f, 0x4f3824];
  g.box(-9, 10, 5, 18, 1, 9, (x, y, z) => n(x, y, z, 5, wood));
  for (const [x, z] of [
    [-9, 5],
    [8, 5],
    [-9, 13],
    [8, 13],
  ])
    g.box(x, 0, z, 1, 10, 1, 0x2a1e15);
  return g;
}

function laptopBaseGrid(): VoxelGrid {
  const g = new VoxelGrid();
  g.box(-5, 0, 0, 10, 1, 7, (x, _y, z) => {
    if (z >= 1 && z <= 4 && x >= -4 && x <= 3 && (x + z) % 2 === 0) return 0x3a3f47; // keys
    if (z === 5 && x >= -1 && x <= 0) return 0x6b727c; // trackpad
    return n(x, 0, z, 6, [0x8c949e, 0x9aa3ad, 0xa7afb8]);
  });
  return g;
}

function laptopLidGrid(): VoxelGrid {
  const g = new VoxelGrid();
  // lid stands along y from the hinge; screen faces -z (toward Sunday)
  g.box(-5, 0, 0, 10, 7, 1, (x, y, z) => n(x, y, z, 7, [0x8c949e, 0x9aa3ad]));
  return g;
}

function bedGrid(): VoxelGrid {
  const g = new VoxelGrid();
  const wood = [0x7a4d24, 0x8a5a2b, 0x996633];
  const red = [0xa81e1e, 0xbb2424, 0xcc2c2c, 0xd83535];
  const white = [0xe2e7ec, 0xeff2f5];
  // frame
  g.box(-22, 1, -9, 44, 2, 18, (x, y, z) => n(x, y, z, 8, wood));
  for (const [x, z] of [
    [-22, -9],
    [21, -9],
    [-22, 8],
    [21, 8],
  ])
    g.box(x, 0, z, 1, 1, 1, wood[0]);
  // mattress (red, white sheet band at the foot)
  g.box(-21, 3, -8, 42, 4, 16, (x, y, z) => (x >= 15 && x <= 17 ? n(x, y, z, 9, white) : n(x, y, z, 10, red)));
  // pillow
  g.box(-21, 7, -7, 7, 3, 12, (x, y, z) => n(x, y, z, 11, red));
  return g;
}

function blanketGrid(): VoxelGrid {
  const g = new VoxelGrid();
  const red = [0xb22222, 0xc42a2a, 0xd23434];
  const white = [0xe6eaee, 0xf3f5f7];
  g.box(-3, 7, -8, 25, 12, 15, (x, y, z) => {
    if (x <= -1) return n(x, y, z, 12, white); // folded sheet edge
    if (y === 18 && hashNoise(x, y, z, 13) > 0.7) return red[2];
    return n(x, y, z, 14, red);
  });
  // soft lumps over the knees and feet
  g.box(10, 19, -6, 5, 1, 10, (x, y, z) => n(x, y, z, 15, red));
  g.box(17, 19, -5, 4, 1, 8, (x, y, z) => n(x, y, z, 16, red));
  return g;
}

export function buildProps(): PropSet {
  const root = new THREE.Group();
  root.name = "props";
  const make = (name: PropName) => {
    const g = new THREE.Group();
    g.name = name;
    g.visible = false;
    root.add(g);
    return g;
  };
  const items: Record<PropName, THREE.Group> = {
    chair: make("chair"),
    desk: make("desk"),
    laptop: make("laptop"),
    bed: make("bed"),
    blanket: make("blanket"),
  };
  items.chair.add(...meshes("chair", chairGrid, [0, 0, 0]));
  items.desk.add(...meshes("desk", deskGrid, [0, 0, 0]));
  items.bed.add(...meshes("bed", bedGrid, [0, 0, 0]));
  items.blanket.add(...meshes("blanket", blanketGrid, [0, 0, 0]));

  // laptop: base + hinged lid with an animated screen
  items.laptop.position.set(0, 11 * VOXEL, 6 * VOXEL);
  items.laptop.add(...meshes("laptopBase", laptopBaseGrid, [0, 0, 0]));
  const lid = new THREE.Group();
  lid.position.set(0, 1 * VOXEL, 7 * VOXEL);
  lid.add(...meshes("laptopLid", laptopLidGrid, [0, 0, 0]));
  const screenCanvas = document.createElement("canvas");
  screenCanvas.width = 40;
  screenCanvas.height = 26;
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  screenTex.magFilter = THREE.NearestFilter;
  screenTex.minFilter = THREE.NearestFilter;
  screenTex.generateMipmaps = false;
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(9 * VOXEL, 6 * VOXEL), screenMat);
  screen.position.set(0, 3.6 * VOXEL, -0.02 * VOXEL);
  screen.rotation.y = Math.PI;
  lid.add(screen);
  // the glowing logo on the back of the lid
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.4 * VOXEL, 1.4 * VOXEL), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, toneMapped: false }));
  logo.position.set(0, 3.5 * VOXEL, 1.02 * VOXEL);
  lid.add(logo);
  items.laptop.add(lid);

  let lastDraw = -1;
  let scroll = 0;
  const drawScreen = (time: number, activity: number) => {
    const ctx = screenCanvas.getContext("2d");
    if (!ctx) return;
    scroll += activity;
    ctx.fillStyle = "#06121f";
    ctx.fillRect(0, 0, 40, 26);
    ctx.fillStyle = "#0b2a44";
    ctx.fillRect(0, 0, 40, 3);
    ctx.fillStyle = "#2ee6ff";
    ctx.fillRect(1, 1, 2, 1);
    const colors = ["#5fe3ff", "#3ddc84", "#e7f2ff", "#ffcf5c", "#9a8cff"];
    const start = Math.floor(scroll);
    for (let row = 0; row < 7; row++) {
      const line = start + row;
      const indent = (Math.floor(hashNoise(line, 1, 2, 3) * 4) % 3) * 3;
      const len = 6 + Math.floor(hashNoise(line, 4, 5, 6) * 22);
      ctx.fillStyle = colors[Math.floor(hashNoise(line, 7, 8, 9) * colors.length)];
      ctx.fillRect(2 + indent, 5 + row * 3, Math.min(len, 36 - indent), 1);
      if (len > 14) {
        ctx.fillStyle = colors[(line + 2) % colors.length];
        ctx.fillRect(2 + indent + len - 6, 5 + row * 3, 4, 1);
      }
    }
    // blinking cursor
    if (Math.floor(time * 2) % 2 === 0) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(4, 5 + 6 * 3, 2, 1);
    }
    screenTex.needsUpdate = true;
  };
  drawScreen(0, 0);

  const amounts: Record<PropName, number> = { chair: 0, desk: 0, laptop: 0, bed: 0, blanket: 0 };

  return {
    root,
    items,
    laptopLid: lid,
    setAmount(name, amount) {
      const a = Math.max(0, Math.min(1, amount));
      if (a === amounts[name]) return;
      amounts[name] = a;
      const item = items[name];
      item.visible = a > 0.02;
      // ease-out-back pop-in
      const s = a >= 1 ? 1 : 1 + 2.2 * Math.pow(a - 1, 3) + 1.2 * Math.pow(a - 1, 2);
      if (name === "laptop") {
        item.scale.setScalar(Math.max(0.001, Math.min(1.06, s)));
        lid.rotation.x = -Math.PI / 2 + (Math.PI / 2 + 0.22) * Math.min(1, a * 1.2);
      } else {
        item.scale.setScalar(Math.max(0.001, s));
      }
    },
    update(time, activity) {
      if (!items.laptop.visible) return;
      if (time - lastDraw < 0.12) return;
      lastDraw = time;
      drawScreen(time, activity);
    },
    dispose() {
      screenTex.dispose();
      screenMat.dispose();
      screen.geometry.dispose();
    },
  };
}
