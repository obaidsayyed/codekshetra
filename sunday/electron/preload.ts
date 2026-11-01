import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type AppWindowName, type SundayBridge } from "../src/shared/ipc";

/**
 * The only API the renderer can reach. No Node, no filesystem, no shell: just
 * a fixed set of typed calls. The main process validates every payload again.
 */

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: SundayBridge = {
  isElectron: true,
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  onSettingsChanged: (cb) => on(IPC.settingsChanged, cb),
  pet: {
    getEnvironment: () => ipcRenderer.invoke(IPC.petGetEnvironment),
    onEnvironment: (cb) => on(IPC.petEnvironment, cb),
    moveTo: (anchor) => ipcRenderer.send(IPC.petMove, anchor),
    setInteractive: (interactive) => ipcRenderer.send(IPC.petSetInteractive, interactive),
    setExtraHeight: (px) => ipcRenderer.send(IPC.petSetExtraHeight, px),
    startDrag: () => ipcRenderer.send(IPC.petDragStart),
    endDrag: () => ipcRenderer.send(IPC.petDragEnd),
    onDragMove: (cb) => on(IPC.petDragMove, cb),
    onDragEnded: (cb) => on(IPC.petDragEnded, cb),
    onVisibility: (cb) => on(IPC.petVisibility, cb),
    onCommand: (cb) => on(IPC.petCommand, cb),
    reportState: (state) => ipcRenderer.send(IPC.petStateReport, state),
  },
  onPetStateChanged: (cb) => on(IPC.petStateChanged, cb),
  openWindow: (name: AppWindowName) => ipcRenderer.send(IPC.openWindow, name),
  hidePet: () => ipcRenderer.send(IPC.hidePet),
  quit: () => ipcRenderer.send(IPC.quit),
  minimizeWindow: () => ipcRenderer.send(IPC.windowMinimize),
  closeWindow: () => ipcRenderer.send(IPC.windowClose),
  sendPetCommand: (cmd) => ipcRenderer.send(IPC.sendPetCommand, cmd),
  panel: {
    getHistory: () => ipcRenderer.invoke(IPC.panelHistory),
    onMessage: (cb) => on(IPC.panelMessage, cb),
    sendUserMessage: (text) => ipcRenderer.invoke(IPC.panelUserMessage, text),
  },
  voice: {
    setMute: (muted?: boolean) => ipcRenderer.invoke(IPC.voiceMute, muted),
    getMute: () => ipcRenderer.invoke(IPC.voiceGetMute),
    onMuteChanged: (cb) => on(IPC.voiceMuteChanged, cb),
  },
};

contextBridge.exposeInMainWorld("sunday", bridge);
