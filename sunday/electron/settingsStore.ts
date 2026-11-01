import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, patchSettings, sanitizeSettings, type PetSettings } from "../src/shared/settings";

/**
 * Settings persisted as JSON in the user-data folder. Always validated on the
 * way in (from disk or IPC) and written atomically (temp file + rename).
 */
export class SettingsStore {
  private settings: PetSettings = DEFAULT_SETTINGS;
  private readonly file: string;
  private writeTimer: NodeJS.Timeout | null = null;
  private listeners: ((s: PetSettings, prev: PetSettings) => void)[] = [];

  constructor(fileName = "settings.json") {
    this.file = path.join(app.getPath("userData"), fileName);
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      this.settings = sanitizeSettings(JSON.parse(raw));
    } catch {
      this.settings = DEFAULT_SETTINGS;
    }
  }

  get(): PetSettings {
    return this.settings;
  }

  update(patch: unknown): PetSettings {
    const prev = this.settings;
    this.settings = patchSettings(prev, patch);
    this.scheduleWrite();
    for (const l of this.listeners) l(this.settings, prev);
    return this.settings;
  }

  onChange(fn: (s: PetSettings, prev: PetSettings) => void): void {
    this.listeners.push(fn);
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), "utf8");
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("[sunday] could not save settings:", err);
    }
  }
}
