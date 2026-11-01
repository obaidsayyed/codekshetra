import { Menu, nativeImage, Tray } from "electron";
import type { AppWindowName } from "../src/shared/ipc";
import type { NightMode, PetSettings } from "../src/shared/settings";
import { iconPath } from "./windowManager";

export interface TrayActions {
  getSettings(): PetSettings;
  update(patch: Partial<PetSettings>): void;
  togglePet(): void;
  openWindow(name: AppWindowName): void;
  quit(): void;
}

/** System tray icon with the main controls (Windows notification area). */
export function createTray(actions: TrayActions): { tray: Tray; refresh: () => void } {
  const icon = nativeImage.createFromPath(iconPath(process.platform === "win32" ? "sunday.ico" : "tray.png"));
  const tray = new Tray(icon.isEmpty() ? nativeImage.createFromPath(iconPath("tray.png")) : icon);
  tray.setToolTip("SUNDAY");

  const refresh = () => {
    const s = actions.getSettings();
    const night = (mode: NightMode, label: string): Electron.MenuItemConstructorOptions => ({
      label,
      type: "radio",
      checked: s.nightMode === mode,
      click: () => actions.update({ nightMode: mode }),
    });
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: s.visible ? "Hide SUNDAY" : "Show SUNDAY", click: () => actions.togglePet() },
        { type: "separator" },
        { label: "Open Chat Panel", click: () => actions.openWindow("panel") },
        { label: "Animation Studio", click: () => actions.openWindow("studio") },
        { label: "Settings…", click: () => actions.openWindow("settings") },
        { type: "separator" },
        { label: "Roam around", type: "checkbox", checked: s.roaming, click: (i) => actions.update({ roaming: i.checked }) },
        { label: "Always on top", type: "checkbox", checked: s.alwaysOnTop, click: (i) => actions.update({ alwaysOnTop: i.checked }) },
        { label: "Quiet mode", type: "checkbox", checked: s.quietMode, click: (i) => actions.update({ quietMode: i.checked }) },
        { label: "Night mode", submenu: [night("off", "Off"), night("auto", "Automatic"), night("on", "On")] },
        { type: "separator" },
        { label: "Quit SUNDAY", click: () => actions.quit() },
      ]),
    );
  };
  refresh();
  tray.on("click", () => actions.togglePet());
  return { tray, refresh };
}
