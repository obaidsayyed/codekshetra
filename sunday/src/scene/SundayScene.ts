import * as THREE from "three";
import { AnimationEngine } from "../animation/AnimationEngine";
import { STANDING_HEIGHT, VOXEL } from "../character/CharacterConfig";
import { SundayCharacter } from "../character/SundayModel";
import { Effects } from "../effects/Effects";
import type { CharacterAppearance } from "../shared/appearance";
import { DEFAULT_APPEARANCE } from "../shared/appearance";

/**
 * Renderer + camera + lighting around one Sunday. Used by the desktop pet
 * (transparent, compact, low power) and the Animation Studio (orbit camera).
 * The caller owns the frame loop and calls `frame(dt)`.
 */

export type SceneMode = "pet" | "studio";

export interface SceneOptions {
  mode: SceneMode;
  appearance?: CharacterAppearance;
  shadows?: boolean;
  maxPixelRatio?: number;
}

/** Pet framing: pixels per world unit at scale 1, and ground line from the bottom. */
export const PET_PX_PER_UNIT = 86;
export const PET_GROUND_PX = 12;
export const PET_BASE_SIZE = { width: 300, height: 340 } as const;

interface LightRig {
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
}

interface LightTargets {
  hemi: number;
  hemiSky: THREE.Color;
  key: number;
  keyColor: THREE.Color;
  rim: number;
  fill: number;
  fillColor: THREE.Color;
}

const DAY: LightTargets = {
  hemi: 1.15,
  hemiSky: new THREE.Color(0xbcd6ff),
  key: 2.5,
  keyColor: new THREE.Color(0xfff1e2),
  rim: 1.7,
  fill: 0.55,
  fillColor: new THREE.Color(0x8fb0ff),
};

const NIGHT: LightTargets = {
  hemi: 0.55,
  hemiSky: new THREE.Color(0x46629e),
  key: 1.15,
  keyColor: new THREE.Color(0xbcd0ff),
  rim: 1.35,
  fill: 0.42,
  fillColor: new THREE.Color(0xffb36b),
};

export class SundayScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly character: SundayCharacter;
  readonly engine: AnimationEngine;
  readonly effects = new Effects();
  readonly mode: SceneMode;

  private readonly lights: LightRig;
  private readonly ground: THREE.Mesh;
  private readonly blob: THREE.Mesh;
  private grid: THREE.GridHelper | null = null;
  private night = false;
  private nightBlend = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private size = { width: 1, height: 1 };
  private orbit = { yaw: -0.35, pitch: 0.12, distance: 6.2 };
  private petScale = 1;

  constructor(canvas: HTMLCanvasElement, options: SceneOptions) {
    this.mode = options.mode;
    const isPet = options.mode === "pet";
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      powerPreference: isPet ? "low-power" : "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    const shadows = options.shadows ?? true;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.maxPixelRatio = options.maxPixelRatio ?? 2;

    this.camera = new THREE.PerspectiveCamera(isPet ? 20 : 32, 1, 0.1, 200);

    // --- lights -------------------------------------------------------------
    const hemi = new THREE.HemisphereLight(DAY.hemiSky, 0x1c2333, DAY.hemi);
    const key = new THREE.DirectionalLight(DAY.keyColor, DAY.key);
    key.position.set(-2.6, 4.6, 4.2);
    key.castShadow = shadows;
    key.shadow.mapSize.set(isPet ? 512 : 1024, isPet ? 512 : 1024);
    key.shadow.camera.left = -2.6;
    key.shadow.camera.right = 2.6;
    key.shadow.camera.top = 3.2;
    key.shadow.camera.bottom = -1;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 14;
    key.shadow.bias = -0.0015;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    const rim = new THREE.DirectionalLight(0x4fd8ff, DAY.rim);
    rim.position.set(3.2, 3.2, -3.6);
    const fill = new THREE.DirectionalLight(DAY.fillColor, DAY.fill);
    fill.position.set(3, 1.2, 3);
    this.scene.add(hemi, key, rim, fill);
    this.lights = { hemi, key, rim, fill };

    // --- ground: shadow catcher + soft contact blob -------------------------
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: isPet ? 0.28 : 0.38 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: isPet ? 0.42 : 0.5 }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.y = 0.004;
    this.blob.renderOrder = 1;
    this.scene.add(this.blob);

    // --- character ----------------------------------------------------------
    this.character = new SundayCharacter(options.appearance ?? DEFAULT_APPEARANCE, { castShadow: shadows, glowLight: true });
    this.scene.add(this.character.object);
    this.character.object.add(this.effects.root);
    this.engine = new AnimationEngine(this.character, this.effects);

    if (!isPet) this.applyOrbit();
  }

  private maxPixelRatio: number;

  setSize(width: number, height: number, devicePixelRatio = window.devicePixelRatio || 1): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) };
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.maxPixelRatio));
    this.renderer.setSize(this.size.width, this.size.height, false);
    this.camera.aspect = this.size.width / this.size.height;
    if (this.mode === "pet") this.framePet();
    this.camera.updateProjectionMatrix();
  }

  /** Pet: keep the ground line PET_GROUND_PX above the canvas bottom at a fixed pixel scale. */
  setPetScale(scale: number): void {
    this.petScale = scale;
    if (this.mode === "pet") {
      this.framePet();
      this.camera.updateProjectionMatrix();
    }
  }

  private framePet(): void {
    const pxPerUnit = PET_PX_PER_UNIT * this.petScale;
    const worldH = this.size.height / pxPerUnit;
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = worldH / 2 / Math.tan(fov / 2);
    const centerY = worldH / 2 - (PET_GROUND_PX * this.petScale) / pxPerUnit;
    const tilt = 0.09; // look slightly down onto Sunday
    this.camera.position.set(0, centerY + Math.sin(tilt) * distance, Math.cos(tilt) * distance);
    this.camera.lookAt(0, centerY, 0);
  }

  // --- studio camera ----------------------------------------------------------
  setOrbit(o: Partial<{ yaw: number; pitch: number; distance: number }>): void {
    this.orbit = {
      yaw: o.yaw ?? this.orbit.yaw,
      pitch: THREE.MathUtils.clamp(o.pitch ?? this.orbit.pitch, -0.2, 1.2),
      distance: THREE.MathUtils.clamp(o.distance ?? this.orbit.distance, 2.5, 14),
    };
    this.applyOrbit();
  }

  getOrbit(): { yaw: number; pitch: number; distance: number } {
    return { ...this.orbit };
  }

  private applyOrbit(): void {
    const { yaw, pitch, distance } = this.orbit;
    const target = new THREE.Vector3(0, 1.15 * this.character.object.scale.y, 0);
    this.camera.position.set(
      target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      target.y + Math.sin(pitch) * distance,
      target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(target);
  }

  setCharacterScale(s: number): void {
    this.character.object.scale.setScalar(s);
    this.blob.scale.setScalar(s);
    if (this.mode === "studio") this.applyOrbit();
  }

  showGrid(on: boolean): void {
    if (on && !this.grid) {
      this.grid = new THREE.GridHelper(8, 32, 0x2ee6ff, 0x1d3550);
      (this.grid.material as THREE.Material).transparent = true;
      (this.grid.material as THREE.Material).opacity = 0.35;
      this.grid.position.y = 0.002;
      this.scene.add(this.grid);
    } else if (!on && this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
      this.grid = null;
    }
  }

  /** Hides the contact shadow while Sunday is held up in the air (desktop pet). */
  setGroundVisible(on: boolean): void {
    this.ground.visible = on;
    this.blob.visible = on;
  }

  setNight(on: boolean): void {
    this.night = on;
  }

  setAppearance(a: CharacterAppearance): void {
    this.character.setAppearance(a);
    if (this.renderer.shadowMap.enabled) this.character.object.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = true) : null));
  }

  // --- frame -------------------------------------------------------------------
  frame(dt: number): void {
    this.engine.update(dt);
    this.updateLighting(dt);
    this.updateBlob();
    this.renderer.render(this.scene, this.camera);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateLighting(dt: number): void {
    const sleepy = this.engine.state === "sleeping" ? 0.6 : 0;
    const target = Math.max(this.night ? 1 : 0, sleepy);
    const k = 1 - Math.exp(-dt * 2.5);
    this.nightBlend += (target - this.nightBlend) * k;
    const n = this.nightBlend;
    const L = this.lights;
    L.hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * n;
    L.hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, n);
    L.key.intensity = DAY.key + (NIGHT.key - DAY.key) * n;
    L.key.color.copy(DAY.keyColor).lerp(NIGHT.keyColor, n);
    L.rim.intensity = DAY.rim + (NIGHT.rim - DAY.rim) * n;
    L.fill.intensity = DAY.fill + (NIGHT.fill - DAY.fill) * n;
    L.fill.color.copy(DAY.fillColor).lerp(NIGHT.fillColor, n);
  }

  private updateBlob(): void {
    const lift = this.character.joints.rigRoot.position.y;
    const lying = Math.abs(this.character.joints.rigRoot.rotation.z) > 0.6;
    const s = Math.max(0.35, 1 - lift * 0.35) * this.character.object.scale.x;
    this.blob.scale.set(lying ? s * 1.6 : s, s, 1);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = (this.mode === "pet" ? 0.42 : 0.5) * Math.max(0.3, 1 - lift * 0.4);
    this.blob.position.x = this.character.object.position.x;
  }

  // --- picking & projection ----------------------------------------------------
  /** Returns true when the canvas pixel (CSS px) is over Sunday or a visible prop. */
  hitTest(x: number, y: number): boolean {
    this.ndc.set((x / this.size.width) * 2 - 1, -(y / this.size.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    this.character.object.traverseVisible((o) => {
      if ((o as THREE.Mesh).isMesh && o !== this.ground) targets.push(o);
    });
    return this.raycaster.intersectObjects(targets, false).length > 0;
  }

  /** Projects a character-local point (voxels) to canvas CSS pixels. */
  project(local: THREE.Vector3): { x: number; y: number } {
    const v = local.clone();
    this.character.object.localToWorld(v);
    v.project(this.camera);
    return { x: ((v.x + 1) / 2) * this.size.width, y: ((1 - v.y) / 2) * this.size.height };
  }

  /** Screen position just above Sunday's head (for speech bubbles). */
  headTopScreen(): { x: number; y: number } {
    const p = this.engine.anchorPosition("headTop");
    return this.project(p);
  }

  /** Screen position of the standing head top, independent of the current pose. */
  standingHeadTopScreen(): { x: number; y: number } {
    return this.project(new THREE.Vector3(0, STANDING_HEIGHT * VOXEL, 0));
  }

  dispose(): void {
    this.effects.dispose();
    this.character.dispose();
    this.showGrid(false);
    this.ground.geometry.dispose();
    (this.ground.material as THREE.Material).dispose();
    this.blob.geometry.dispose();
    (this.blob.material as THREE.Material).dispose();
    this.renderer.dispose();
  }
}

let blobTex: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (blobTex) return blobTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.75)");
  g.addColorStop(0.55, "rgba(0,0,0,0.3)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  return blobTex;
}
