import { app, BrowserWindow, Menu, screen, session } from "electron";
import { IPC, type AppWindowName, type PanelMessage, type PetCommand } from "../src/shared/ipc";
import type { PetSettings } from "../src/shared/settings";
import { DesktopManager } from "./desktopManager";
import { watchDisplays } from "./displayManager";
import { IntegrationHub, setIntegrationHost } from "./integration";
import { initPythonBackendBridge } from "./pythonBridge";
import { registerIpc } from "./ipcHandlers";
import { SettingsStore } from "./settingsStore";
import { createTray } from "./tray";
import { createWindow } from "./windowManager";

/**
 * SUNDAY — main process entry.
 * Single instance · transparent pet overlay · tray · studio / panel / settings windows.
 */

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId("app.sunday.companion");
// Transparent always-on-top overlays look best without Chromium's occlusion throttling.
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
Menu.setApplicationMenu(null);

let store: SettingsStore;
let desktop: DesktopManager;
let hub: IntegrationHub;
let quitting = false;
let refreshTray: () => void = () => undefined;
const windows: Partial<Record<AppWindowName, BrowserWindow>> = {};
let stopDisplays: () => void = () => undefined;

function allWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of allWindows()) w.webContents.send(channel, payload);
}

function sendToPet(cmd: PetCommand): void {
  desktop.pet?.webContents.send(IPC.petCommand, cmd);
}

/** Places a panel window beside the pet, on the side with more room. */
function besidePet(width: number, height: number): { x: number; y: number } {
  const pet = desktop.bounds;
  const display = screen.getDisplayMatching(pet);
  const wa = display.workArea;
  const roomRight = wa.x + wa.width - (pet.x + pet.width);
  const x = roomRight >= width ? pet.x + pet.width - 40 : Math.max(wa.x + 8, pet.x - width + 40);
  const y = Math.max(wa.y + 8, wa.y + wa.height - height - 12);
  return { x: Math.round(Math.min(x, wa.x + wa.width - width - 8)), y: Math.round(y) };
}

function openWindow(name: AppWindowName): void {
  const existing = windows[name];
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }
  let win: BrowserWindow;
  if (name === "studio") {
    win = createWindow("studio", {
      width: 1440,
      height: 900,
      minWidth: 1100,
      minHeight: 720,
      backgroundColor: "#04070d",
      title: "SUNDAY Animation Studio",
      autoHideMenuBar: true,
    });
  } else {
    const size = name === "panel" ? { width: 400, height: 560 } : { width: 420, height: 660 };
    win = createWindow(name, {
      ...size,
      ...besidePet(size.width, size.height),
      transparent: true,
      frame: false,
      resizable: name === "panel",
      minWidth: 340,
      minHeight: 420,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: "#00000000",
      hasShadow: false,
      title: name === "panel" ? "SUNDAY" : "SUNDAY Settings",
    });
  }
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    delete windows[name];
  });
  windows[name] = win;
}

function togglePet(): void {
  store.update({ visible: !store.get().visible });
}

function hidePet(): void {
  store.update({ visible: false });
}

function applySettingSideEffects(s: PetSettings, prev: PetSettings): void {
  if (s.alwaysOnTop !== prev.alwaysOnTop) desktop.setAlwaysOnTop(s.alwaysOnTop);
  if (s.characterScale !== prev.characterScale) desktop.setScale(s.characterScale);
  if (s.visible !== prev.visible) (s.visible ? desktop.show() : desktop.hide());
  if (s.startWithWindows !== prev.startWithWindows && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: s.startWithWindows });
  }
  broadcast(IPC.settingsChanged, s);
  refreshTray();
}

function quit(): void {
  quitting = true;
  app.quit();
}

app.on("second-instance", () => {
  // launching SUNDAY again just brings the pet back
  if (!store.get().visible) store.update({ visible: true });
  desktop.show();
  sendToPet({ type: "greet" });
});

app.whenReady().then(() => {
  // deny every permission request (camera, mic, notifications, …): none are needed
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  store = new SettingsStore();
  // Launching SUNDAY always shows him, even if he was hidden when the app last quit.
  if (!store.get().visible) store.update({ visible: true });
  const s = store.get();
  desktop = new DesktopManager(s.characterScale);
  hub = new IntegrationHub(sendToPet, (msg: PanelMessage) => broadcast(IPC.panelMessage, msg));
  setIntegrationHost(hub);
  initPythonBackendBridge(hub);

  registerIpc({
    store,
    desktop,
    hub,
    openWindow,
    hidePet,
    quit,
    studioWindows: () => (windows.studio && !windows.studio.isDestroyed() ? [windows.studio] : []),
  });
  store.onChange(applySettingSideEffects);

  desktop.createPet(s.alwaysOnTop, s.visible);
  if (app.isPackaged && (process.platform === "win32" || process.platform === "darwin")) {
    // keep the OS login item in sync with the stored choice (off by default)
    app.setLoginItemSettings({ openAtLogin: s.startWithWindows });
  }

  const tray = createTray({
    getSettings: () => store.get(),
    update: (patch) => store.update(patch),
    togglePet,
    openWindow,
    quit,
  });
  refreshTray = tray.refresh;

  stopDisplays = watchDisplays(() => desktop.revalidate());

  if (process.argv.includes("--studio")) {
    openWindow("studio");
  } else if (!process.argv.includes("--pet-only")) {
    openWindow("panel");
  }
});

// Tray app: closing windows never quits; only "Exit" / "Quit SUNDAY" does.
app.on("window-all-closed", () => {
  if (quitting) app.quit();
});

app.on("before-quit", () => {
  quitting = true;
  stopDisplays();
  desktop?.stopDrag();
  store?.flush();
});
