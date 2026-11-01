import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import type { AppWindowName } from "../src/shared/ipc";

/**
 * Creates every window with the same hardened web preferences and loads the
 * single renderer bundle with a view hash (#pet, #studio, #panel, #settings).
 */

export type ViewName = "pet" | AppWindowName;

const DEV_URL = process.env.VITE_DEV_SERVER_URL;

export function appUrlPrefix(): string {
  if (DEV_URL) return DEV_URL.replace(/\/$/, "");
  return "file://";
}

export function rendererIndex(): string {
  return path.join(app.getAppPath(), "dist", "index.html");
}

export function preloadPath(): string {
  return path.join(__dirname, "preload.cjs");
}

/** Icons ship inside the renderer build (Vite copies public/ into dist/). */
export function iconPath(name = "sunday.png"): string {
  return path.join(app.getAppPath(), app.isPackaged ? "dist" : "public", "icons", name);
}

export function createWindow(view: ViewName, options: Electron.BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    icon: iconPath(),
    ...options,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Sunday's sounds may play without a prior click (e.g. footsteps while roaming)
      autoplayPolicy: "no-user-gesture-required",
      devTools: !app.isPackaged,
      ...options.webPreferences,
    },
  });

  // Never navigate away from the app or open new windows from content.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const ok = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith("file://");
    if (!ok) e.preventDefault();
  });

  if (DEV_URL) {
    void win.loadURL(`${DEV_URL}#${view}`);
  } else {
    void win.loadFile(rendererIndex(), { hash: view });
  }
  return win;
}

/** True when the IPC sender is one of our own pages. */
export function isTrustedSender(frameUrl: string | undefined): boolean {
  if (!frameUrl) return false;
  if (DEV_URL) return frameUrl.startsWith(DEV_URL);
  if (!frameUrl.startsWith("file://")) return false;
  try {
    const p = decodeURIComponent(new URL(frameUrl).pathname).replace(/^\/([A-Za-z]:)/, "$1");
    return path.normalize(p) === path.normalize(rendererIndex());
  } catch {
    return false;
  }
}
