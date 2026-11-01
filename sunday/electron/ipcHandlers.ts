import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { IPC, MAX_PANEL_MESSAGE_LENGTH, validateAnchor, validatePetCommand, validateWindowName, type AppInfo, type AppWindowName } from "../src/shared/ipc";
import { isAnimationState } from "../src/shared/states";
import type { DesktopManager } from "./desktopManager";
import type { IntegrationHub } from "./integration";
import type { SettingsStore } from "./settingsStore";
import { isTrustedSender } from "./windowManager";
import { setVoiceMute, getVoiceMute } from "./pythonBridge";

/**
 * Every IPC channel, with sender checks and payload validation. Privileged
 * operations (moving windows, persisting settings, quitting) live only here.
 */

export interface IpcContext {
  store: SettingsStore;
  desktop: DesktopManager;
  hub: IntegrationHub;
  openWindow(name: AppWindowName): void;
  hidePet(): void;
  quit(): void;
  studioWindows(): BrowserWindow[];
}

type AnyEvent = IpcMainEvent | IpcMainInvokeEvent;

function trusted(e: AnyEvent): boolean {
  const ok = isTrustedSender(e.senderFrame?.url);
  if (!ok) console.warn("[sunday] rejected IPC from untrusted frame", e.senderFrame?.url);
  return ok;
}

export function registerIpc(ctx: IpcContext): void {
  const fromPet = (e: AnyEvent) => trusted(e) && !!ctx.desktop.pet && e.sender.id === ctx.desktop.pet.webContents.id;

  // settings -----------------------------------------------------------------------
  ipcMain.handle(IPC.settingsGet, (e) => (trusted(e) ? ctx.store.get() : null));
  ipcMain.handle(IPC.settingsUpdate, (e, patch: unknown) => {
    if (!trusted(e)) return ctx.store.get();
    return ctx.store.update(patch);
  });

  ipcMain.handle(IPC.appInfo, (e): AppInfo | null => {
    if (!trusted(e)) return null;
    return {
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
      startWithWindowsSupported: app.isPackaged && (process.platform === "win32" || process.platform === "darwin"),
      integrationConnected: ctx.hub.isConnected(),
    };
  });

  // pet window ---------------------------------------------------------------------
  ipcMain.handle(IPC.petGetEnvironment, (e) => (fromPet(e) ? ctx.desktop.environment() : null));
  ipcMain.on(IPC.petMove, (e, anchor: unknown) => {
    if (!fromPet(e)) return;
    const a = validateAnchor(anchor);
    if (a) ctx.desktop.moveTo(a);
  });
  ipcMain.on(IPC.petSetInteractive, (e, on: unknown) => {
    if (fromPet(e) && typeof on === "boolean") ctx.desktop.setInteractive(on);
  });
  ipcMain.on(IPC.petSetExtraHeight, (e, px: unknown) => {
    if (fromPet(e) && typeof px === "number" && Number.isFinite(px)) ctx.desktop.setExtraHeight(px);
  });
  ipcMain.on(IPC.petDragStart, (e) => {
    if (fromPet(e)) ctx.desktop.startDrag();
  });
  ipcMain.on(IPC.petDragEnd, (e) => {
    if (fromPet(e)) ctx.desktop.endDrag();
  });
  ipcMain.on(IPC.petStateReport, (e, state: unknown) => {
    if (!fromPet(e) || !isAnimationState(state)) return;
    for (const w of ctx.studioWindows()) w.webContents.send(IPC.petStateChanged, state);
  });

  // app ------------------------------------------------------------------------------
  ipcMain.on(IPC.openWindow, (e, name: unknown) => {
    const n = validateWindowName(name);
    if (trusted(e) && n) ctx.openWindow(n);
  });
  ipcMain.on(IPC.hidePet, (e) => {
    if (trusted(e)) ctx.hidePet();
  });
  ipcMain.on(IPC.quit, (e) => {
    if (trusted(e)) ctx.quit();
  });
  ipcMain.on(IPC.windowMinimize, (e) => {
    if (!trusted(e)) return;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w !== ctx.desktop.pet) w.minimize();
  });
  ipcMain.on(IPC.windowClose, (e) => {
    if (!trusted(e)) return;
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w !== ctx.desktop.pet) w.close();
  });

  // development playground: studio → pet ----------------------------------------------
  ipcMain.on(IPC.sendPetCommand, (e, cmd: unknown) => {
    if (!trusted(e) || fromPet(e)) return;
    const valid = validatePetCommand(cmd);
    if (valid) ctx.desktop.pet?.webContents.send(IPC.petCommand, valid);
  });

  // interaction panel ------------------------------------------------------------------
  ipcMain.handle(IPC.panelHistory, (e) => (trusted(e) ? ctx.hub.panel.history() : []));
  ipcMain.handle(IPC.panelUserMessage, (e, text: unknown) => {
    if (!trusted(e) || typeof text !== "string") return { delivered: false };
    return ctx.hub.receiveUserMessage(text.slice(0, MAX_PANEL_MESSAGE_LENGTH));
  });

  // voice commands mute / unmute --------------------------------------------------------
  ipcMain.handle(IPC.voiceMute, async (e, muted: unknown) => {
    if (!trusted(e)) return { success: false, muted: false };
    const res = await setVoiceMute(typeof muted === "boolean" ? muted : undefined);
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.voiceMuteChanged, res.muted);
      }
    }
    return res;
  });

  ipcMain.handle(IPC.voiceGetMute, async (e) => {
    if (!trusted(e)) return false;
    return await getVoiceMute();
  });
}
