# SUNDAY — a living desktop companion for Windows

SUNDAY is a small, original voxel character who lives on your Windows desktop. He walks and runs along the taskbar, sits down, thinks, types on a tiny laptop, listens, talks, celebrates, gets confused, sleeps in a little red bed at night, and reacts when you click, drag or right-click him.

Built with **Electron · React · TypeScript · Vite · Three.js (WebGL)**. No backend, no AI, no network access: the pet is a pure visual layer with a typed controller that your existing agent application can drive later.

---

## Quick start

Requirements: Windows 10/11, Node.js 20+ (22 LTS recommended).

```powershell
npm install
npm run dev            # desktop pet (Vite dev server + Electron)
npm run dev -- --studio   # also opens the Animation Studio
```

| Command | What it does |
|---|---|
| `npm run dev` | Development: hot-reloading renderer, Electron with the pet overlay |
| `npm run studio:web` | Animation Studio in your browser (no Electron needed) |
| `npm run build` | Type-check, `vite build` → `dist/`, bundle main + preload → `dist-electron/` |
| `npm start` | Run the built app with Electron |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Build, then Playwright: Studio in a browser + the real Electron app |
| `npm run dist:win` | Build a Windows **installer (NSIS)** and a **portable .exe** into `release/` |
| `npm run dist:dir` | Unpacked Windows build (`release/win-unpacked/SUNDAY.exe`) |

Once running, SUNDAY lives in the **system tray** (notification area). Closing other windows never quits him; use **Exit** in his right-click menu or **Quit SUNDAY** in the tray.

---

## Using SUNDAY

| Action | Result |
|---|---|
| Click | Sunday turns to you, smiles and waves (and wakes up if he's asleep) |
| Double-click | Opens the chat panel |
| Drag | Picks him up — he dangles and swings with your motion; release and he falls back to the taskbar, lands, and carries on |
| Right-click | Menu: Open Chat Panel · Animation Studio · Settings · Roam around · Night mode · Hide SUNDAY · Exit |
| Tray icon | Show/hide, windows, roaming, always-on-top, quiet mode, night mode, quit |

Transparent areas of his window are click-through: the window only captures the mouse while the pointer is actually over Sunday, his bubble or his menu.

### Sounds
Every motion and action has a cute, synthesized sound (no audio files): soft tip-tap footsteps, pitter-patter running, a springy *bwip!* jump and fluffy landing, a cushion *fwump* when sitting, a wobbly *hmm~* when thinking, tiny key clicks while working, a *ding-dong* and sonar pings when listening, Animal-Crossing-style babble when talking or when a speech bubble appears, gentle snores and twinkly Z's, a *ta-da* fanfare and confetti pops when celebrating, an *uh-oh* on errors, *whee!* when picked up, squeaks when swung around, a slide-whistle when dropped, a yawn and morning chirp when waking, and a happy jingle on task completion. The menus, buttons, toggles, chat typing and sending have soft UI sounds too. Fast repeating sounds are rate-limited so they never pile up.

### Voice
Sunday reads his speech bubbles aloud in a small, cheerful voice: one of Windows' built-in text-to-speech voices, pitched up (adjustable pitch and speed, emoji are skipped). He also reacts out loud — "Wheee!" when picked up, "Whoaaa!" when dropped, "Yay!" when celebrating, "Uh-oh!" on errors, "All done!", "Good morning!", "Night night…". Prefer no words? Switch the voice to **Cute babble** (Animal-Crossing-style gibberish) or **Silent**. If no system voice is installed he babbles automatically. Nothing is downloaded or sent anywhere.

Turn sounds off or change the volume in **Settings → Sounds**; **Quiet mode** mutes everything.

In the Studio's **Sound** tab you can play every sound on a sound board, pick a system voice, tune pitch and speed, type a line for Sunday to say, trigger reactions, and press **Apply to desktop pet** when you like it. The transport bar's **On desktop pet** button plays the currently selected animation on the real pet.

### Look
The interface uses a warm "sunny meadow" theme drawn from Sunday's own colours — cream paper, cocoa outlines, leaf green, sunflower yellow and coral — with chunky outlines and hard offset shadows like a cozy game UI. Night mode switches every window to a cocoa/plum variant.

### Settings
Roaming on/off · movement speed · animation speed · character size · always on top · quiet mode (no chatter, no sounds, calmer roaming) · sound effects (on by default) + volume · show/hide · **start with Windows (off by default, installed app only)** · night mode (off / automatic 21:30–06:30 / on) · appearance.

### Night mode
Softer, moonlit lighting, a small moon indicator, calmer behaviour; after a little while Sunday goes to bed. Click him to wake him up. Other windows dim slightly.

---

## The character

Sunday is built entirely in code from voxels (`src/character/`): no image textures, no downloaded models.

- **Hair** — ~400 voxels shaded in chunky clumps, a messy fringe with depth, tufts and side puffs around the headphone band.
- **Headphones** — black cups and band with a green accent stripe; the ear-cup rings are emissive "O" shapes with a soft halo and a small point light.
- **Face** — a 24 × 24 pixel-art decal redrawn only when the expression changes: 7 eye shapes, blinking, gaze, 6 brow shapes, 9 mouth shapes (talking is animated), blush, sweat drop. Four eye styles.
- **Hoodie** — green camo shading, black front panel with a green **S**, darker hem and cuffs, hood on the back. Black trousers, green-and-white sneakers with laces.
- **Rig** — `rigRoot → hips → spine → neck / shoulders → elbows`, `hips → hip joints → knees`; props (gaming chair, desk, laptop with a live screen, bed, blanket) sit on a `stage` that turns with him.
- **Shading** — per-vertex ambient occlusion on every voxel, flat lighting, key / rim (cyan) / fill lights, real shadows plus a soft contact shadow.

Skins (`src/character/skins.ts`): Default, Blue, Red, White, Purple, Yellow, Black, Cyan. Headphone glow colours, eye styles and accessories (glasses, backpack, scarf) are independent. Skins are palettes over a fixed layout, so they can never break the rig. **Adding a skin** = add an id to `SKIN_IDS` in `src/shared/appearance.ts` and a palette in `skins.ts`.

---

## Animation system

`src/animation/`

- **15 procedural clips** (`AnimationClips.ts`): idle, walking, running, jumping, sitting, thinking, working, listening, talking, sleeping, celebrating, error, dragging, waking, completed. Each is a pure function of time that writes joint rotations, offsets, prop amounts and a facial expression into a `Pose`. Effects are emitted on time events so they stay in sync: Z's, confetti, sparkles, the red `?`, the green check, thought bubble + dots, sound waves, speed lines, dust, typing glyphs.
- **State machine** (`AnimationStateMachine.ts`): priorities, looping vs one-shot, non-interruptible one-shots (jump, wake) that queue lower-priority requests, invalid transitions routed through a valid hub (e.g. `sleeping → working` plays `sleeping → waking → working`), `ANY → dragging`, `dragging → previous state` (via a landing jump after a drop).
- **Transitions** (`TransitionManager.ts`): crossfades from a snapshot of the *displayed* pose, so interrupting a blend never snaps.
- **Engine** (`AnimationEngine.ts`): state machine → clip → crossfade → overlays (natural random blinking with occasional double-blinks; "look at the user" on click) → rig.

Movement is separate from animation (`src/movement/`): `MovementController` moves an *anchor* (the point between Sunday's feet), `RoamingBehavior` decides what to do, `BoundaryManager` handles multi-monitor work areas.

### Desktop behaviour
- The pet window is transparent, frameless, skip-taskbar, always on top, and is moved with `setBounds` by the main process.
- Positions are validated against each display's **work area** — Sunday stands on top of the taskbar and never covers it.
- Multiple monitors: he walks between side-by-side monitors whose floors are within 48 px (dropping onto a lower floor); otherwise he turns back at the edge. You can drag him to any monitor.
- The roaming brain waits natural intervals, walks (sometimes runs) to nearby spots, sits, thinks, hops, and sleeps at night. It never moves while you hover over him, drag him, have the chat panel open, or while an integration holds a state.
- Rendering is adaptive (60 fps when moving, 30 when idle, 20 when sleeping) and stops completely while the window is hidden.

---

## Animation Studio

Right-click Sunday → **Animation Studio** (or `npm run studio:web` in a browser).

- Large live 3D preview with orbit (drag) and zoom (wheel)
- All 15 states, Play / Pause / Stop / Restart / **Play All**, Loop on/off, frame stepping, timeline scrubbing with time + frame readout
- Speed, character scale, camera rotation and zoom, backgrounds (sunny room, meadow, candy sky, starry night, transparent), grid, night lighting, preview sounds
- **Transitions** tab: pick any from → to, see the planned route, play it through the real state machine (with slow motion)
- **Character** tab: skins, headphone glow, eyes, accessories, "Apply to desktop pet"
- **Live** tab: the development playground — call every `SundayController` method by hand on the real desktop pet (over IPC) or on the preview; it never generates agent traffic on its own
- **Full Animation Showcase** strip: 15 live 3D tiles (one shared WebGL context, 30 fps, paused when hidden)

---

## Integrating your AI backend

SUNDAY contains **no** agent, model calls, HTTP, WebSockets or Ollama code. Your existing integration layer drives it.

### Main process (recommended)

```ts
// in electron/main.ts (or a module it imports), after app is ready:
import { getIntegrationHost } from "./integration";

const sunday = getIntegrationHost()!;

sunday.controller.setState("thinking");
sunday.controller.setSpeech("Working on it…");
sunday.dispatchAgentEvent({ type: "task_completed", payload: { message: "Done! ✅" } });

sunday.panel.pushMessage({ role: "sunday", text: "Here are your latest updates…" });
const off = sunday.panel.onUserMessage((text) => {
  // forward `text` to your agent; reply later with pushMessage(...)
});
```

As soon as something subscribes with `onUserMessage`, the chat panel switches from "AI not connected" to connected.

### Contract (`src/integration/`)

```ts
export type SundayState =
  | "idle" | "walking" | "running" | "jumping" | "sitting" | "thinking" | "working"
  | "listening" | "talking" | "sleeping" | "celebrating" | "error" | "completed";

export interface SundayController {
  setState(state: SundayState): void;
  setSpeech(text: string): void;
  clearSpeech(): void;
  setRoaming(enabled: boolean): void;
  setMovementSpeed(speed: number): void;     // 0.5 – 2
  setCharacterScale(scale: number): void;    // 0.6 – 1.8
}

export interface SundayAgentEvent {
  type: "status_changed" | "speech" | "task_completed" | "task_failed" | "user_attention";
  payload: Record<string, unknown>;
}
```

`applyAgentEvent(controller, event)` maps events onto the controller:

| Event | Payload | Effect |
|---|---|---|
| `status_changed` | `{ status, message? }` — a state name or alias (`busy`, `processing`, `recording`, `speaking`, `done`, `failed`, `ready`…) | `setState` (+ bubble) |
| `speech` | `{ text, animate? }` | talking + bubble |
| `task_completed` | `{ message? }` | completed + "Task completed! ✅" |
| `task_failed` | `{ message? }` | error + message |
| `user_attention` | `{ message? }` | hop + "Hey! Over here 👋" |

Everything crossing IPC is validated (`src/shared/ipc.ts`); unknown commands are dropped.

---

## Project structure

```
electron/      main.ts · preload.ts · desktopManager.ts (pet window, real positioning, drag)
               displayManager.ts · windowManager.ts · ipcHandlers.ts · settingsStore.ts
               tray.ts · integration.ts (host for your backend)
src/
  character/   VoxelGrid · SundayModel (rig) · FaceRenderer · Props · skins · CharacterConfig
  animation/   AnimationEngine · AnimationStateMachine · AnimationClips · TransitionManager · Pose
  effects/     Effects (pooled pixel sprites)
  scene/       SundayScene (renderer, camera, lights, picking)
  movement/    MovementController · RoamingBehavior · BoundaryManager
  integration/ SundayController · SundayAgentEvent (adapter) · DevelopmentAdapter
  services/    PetRuntime (pet frame loop + input) · bridge · sound
  components/  SundayPet · SpeechBubble · ContextMenu · InteractionPanel · PetSettings
               AnimationStudio · AnimationGallery · CustomizationPanel · ControllerPlayground
  shared/      states · settings · appearance · ipc (contract + validators)
public/icons/  app / tray icons (rendered from the 3D model)
tests/unit/    state machine, clips, movement & multi-monitor, roaming, adapter, IPC, settings
tests/e2e/     Studio in a browser; real Electron app
scripts/       build-electron.mjs · dev.mjs
```

## Security
Context isolation on, Node integration off, renderer sandbox on, a minimal typed preload bridge, strict CSP, every IPC payload validated and sender-checked, navigation and new windows blocked, all permission requests denied. No filesystem access, shell execution or credential access from the renderer. Settings are stored as JSON in `%APPDATA%\SUNDAY\settings.json`.

## Performance
One WebGL context for the pet with ~20 merged voxel meshes; adaptive frame rate (20–60 fps) and no rendering while hidden; particle pool capped at 72; face texture redrawn only on expression changes; React does not re-render per frame (bubble positioning writes styles directly). Pixel ratio capped at 2.

---

## Verification status

What was verified while building (on Linux, Electron 45.2.1 under a virtual display with software WebGL, and headless Chrome):

- TypeScript strict type-check of the whole project.
- 56 unit tests (sound cues per animation, state machine rules & routing, every clip produces finite poses, walking/running/jumping/sitting/sleeping/celebrating/error specifics, effect emission, crossfade smoothness, movement + falling + multi-monitor stepping, roaming brain incl. quiet/night/roaming-off/user-busy, adapter mapping, IPC validators, settings sanitising).
- 12 Playwright tests: Studio (all 15 states, transport, play-all, transition routing) and the **real Electron app**: transparent window (alpha 0 at the corners), always-on-top, bottom edge exactly on the work-area bottom, no Node in the renderer, walking moves the real window, malformed IPC ignored, scaling keeps the feet planted, controller drives every state, right-click menu, double-click opens the panel, the panel never fabricates replies.
- Additionally checked by hand in Electron: click → look/smile, Escape closes the menu, a **real cursor drag** moves the window and a mid-air drop falls back to the taskbar and lands, click wakes a sleeping Sunday, the Studio's Live Pet tab drives the running pet, the single-instance lock, settings persistence.

**Not yet verified on real Windows hardware** (the build environment was Linux):
- Windows-specific window behaviour: DWM transparency, `setIgnoreMouseEvents(..., { forward: true })` hover tracking, tray icon/menu, taskbar placement on displays with a side/top taskbar.
- Real multi-monitor setups, especially mixed DPI scaling (covered by unit tests only).
- Start with Windows (only active in the installed app).
- `npm install`, `vite build`, `vitest` and `electron-builder` themselves: the build sandbox had no npm registry access, so equivalent esbuild / node:test runs were used. The configs in this repo are the standard ones and should work as-is; please run `npm run build && npm test` once after installing.

If anything looks off on your machine, the Studio's **Live** tab plus DevTools in `npm run dev` is the fastest way to investigate.
