import * as THREE from "three";

/**
 * A small sparse voxel grid with per-voxel colour, turned into a single merged
 * BufferGeometry with hidden-face culling and per-vertex ambient occlusion.
 *
 * Every visible block of Sunday — hair, hoodie, shoes, headphones, props — is
 * authored as voxels with this class, which is what gives the character its
 * "detailed pixel shading" while keeping the draw-call count small.
 */

export interface Voxel {
  color: number;
  glow: boolean;
}

const FACES = [
  // dir, corners (unit cube), uv-axis helpers for AO
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as const;

const AO_LEVELS = [1, 0.86, 0.76, 0.66];

export class VoxelGrid {
  private cells = new Map<string, Voxel>();

  static key(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  get size(): number {
    return this.cells.size;
  }

  set(x: number, y: number, z: number, color: number, glow = false): this {
    this.cells.set(VoxelGrid.key(x, y, z), { color, glow });
    return this;
  }

  get(x: number, y: number, z: number): Voxel | undefined {
    return this.cells.get(VoxelGrid.key(x, y, z));
  }

  has(x: number, y: number, z: number): boolean {
    return this.cells.has(VoxelGrid.key(x, y, z));
  }

  remove(x: number, y: number, z: number): this {
    this.cells.delete(VoxelGrid.key(x, y, z));
    return this;
  }

  /** Fills an axis-aligned box. `color` may be a function of the voxel coordinate. */
  box(
    x0: number,
    y0: number,
    z0: number,
    w: number,
    h: number,
    d: number,
    color: number | ((x: number, y: number, z: number) => number | null),
    glow = false,
  ): this {
    for (let x = x0; x < x0 + w; x++)
      for (let y = y0; y < y0 + h; y++)
        for (let z = z0; z < z0 + d; z++) {
          const c = typeof color === "function" ? color(x, y, z) : color;
          if (c !== null) this.set(x, y, z, c, glow);
        }
    return this;
  }

  forEach(fn: (x: number, y: number, z: number, v: Voxel) => void): void {
    for (const [k, v] of this.cells) {
      const [x, y, z] = k.split(",").map(Number);
      fn(x, y, z, v);
    }
  }

  /**
   * Builds geometry. `offset` is added to every voxel coordinate (in voxel
   * units) before scaling by `cell`, so callers can place the pivot anywhere.
   */
  build(offset: [number, number, number], cell: number): { solid: THREE.BufferGeometry | null; glow: THREE.BufferGeometry | null } {
    const solid = new GeoAccumulator();
    const glow = new GeoAccumulator();
    const tmp = new THREE.Color();

    const occ = (x: number, y: number, z: number) => (this.has(x, y, z) ? 1 : 0);

    this.forEach((x, y, z, v) => {
      tmp.setHex(v.color);
      const target = v.glow ? glow : solid;
      for (const f of FACES) {
        const [nx, ny, nz] = f.n;
        if (this.has(x + nx, y + ny, z + nz)) continue;
        // ambient occlusion per corner, computed from the layer outside the face
        const ao: number[] = [];
        for (const c of f.c) {
          // corner direction inside the face plane: -1 or +1 on the two tangent axes
          const cx = c[0] * 2 - 1;
          const cy = c[1] * 2 - 1;
          const cz = c[2] * 2 - 1;
          const ox = x + nx;
          const oy = y + ny;
          const oz = z + nz;
          let s1: number, s2: number, cr: number;
          if (nx !== 0) {
            s1 = occ(ox, oy + cy, oz);
            s2 = occ(ox, oy, oz + cz);
            cr = occ(ox, oy + cy, oz + cz);
          } else if (ny !== 0) {
            s1 = occ(ox + cx, oy, oz);
            s2 = occ(ox, oy, oz + cz);
            cr = occ(ox + cx, oy, oz + cz);
          } else {
            s1 = occ(ox + cx, oy, oz);
            s2 = occ(ox, oy + cy, oz);
            cr = occ(ox + cx, oy + cy, oz);
          }
          const level = s1 && s2 ? 3 : s1 + s2 + cr;
          ao.push(v.glow ? 1 : AO_LEVELS[level]);
        }
        target.addQuad(
          f.c.map((c) => [(x + c[0] + offset[0]) * cell, (y + c[1] + offset[1]) * cell, (z + c[2] + offset[2]) * cell]) as number[][],
          [nx, ny, nz],
          tmp,
          ao,
        );
      }
    });

    return { solid: solid.toGeometry(), glow: glow.toGeometry() };
  }
}

class GeoAccumulator {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  addQuad(corners: number[][], n: number[], color: THREE.Color, ao: number[]): void {
    const base = this.positions.length / 3;
    for (let i = 0; i < 4; i++) {
      this.positions.push(corners[i][0], corners[i][1], corners[i][2]);
      this.normals.push(n[0], n[1], n[2]);
      this.colors.push(color.r * ao[i], color.g * ao[i], color.b * ao[i]);
    }
    // flip the diagonal when AO is anisotropic to avoid interpolation artefacts
    if (ao[0] + ao[2] > ao[1] + ao[3]) {
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    } else {
      this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    }
  }

  toGeometry(): THREE.BufferGeometry | null {
    if (this.positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Deterministic PRNG so the generated textures are identical on every launch. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash noise in [0,1) for a voxel coordinate. */
export function hashNoise(x: number, y: number, z: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Picks a shade from a palette using voxel noise, weighted toward the middle entries. */
export function pick(palette: readonly number[], x: number, y: number, z: number, seed = 0): number {
  const n = hashNoise(x, y, z, seed);
  const idx = Math.min(palette.length - 1, Math.floor(n * palette.length));
  return palette[idx];
}
