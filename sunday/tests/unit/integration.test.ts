import { describe, expect, it } from "vitest";
import { applyAgentEvent, resolveStatus } from "../../src/integration/SundayAgentEvent";
import type { SundayController } from "../../src/integration/SundayController";
import { validateAgentEvent, validateAnchor, validatePanelMessage, validatePetCommand, validateWindowName } from "../../src/shared/ipc";
import { DEFAULT_SETTINGS, isNightActive, patchSettings, sanitizeSettings } from "../../src/shared/settings";
import { sanitizeAppearance } from "../../src/shared/appearance";

function recorder() {
  const calls: string[] = [];
  const c: SundayController = {
    setState: (s) => calls.push(`state:${s}`),
    setSpeech: (t) => calls.push(`speech:${t}`),
    clearSpeech: () => calls.push("clear"),
    setRoaming: (e) => calls.push(`roam:${e}`),
    setMovementSpeed: (s) => calls.push(`speed:${s}`),
    setCharacterScale: (s) => calls.push(`scale:${s}`),
  };
  return { c, calls };
}

describe("agent event adapter", () => {
  it("maps status changes, including common aliases", () => {
    const { c, calls } = recorder();
    expect(applyAgentEvent(c, { type: "status_changed", payload: { status: "thinking" } })).toBe(true);
    expect(applyAgentEvent(c, { type: "status_changed", payload: { status: "Processing" } })).toBe(true);
    expect(applyAgentEvent(c, { type: "status_changed", payload: { status: "busy" } })).toBe(true);
    expect(calls).toEqual(["state:thinking", "state:thinking", "state:working"]);
    expect(resolveStatus("dragging")).toBeNull(); // not controllable from outside
  });

  it("ignores unknown statuses", () => {
    const { c, calls } = recorder();
    expect(applyAgentEvent(c, { type: "status_changed", payload: { status: "banana" } })).toBe(false);
    expect(calls).toEqual([]);
  });

  it("speech makes Sunday talk and shows the bubble", () => {
    const { c, calls } = recorder();
    applyAgentEvent(c, { type: "speech", payload: { text: "Hello!" } });
    expect(calls).toEqual(["state:talking", "speech:Hello!"]);
    const r2 = recorder();
    applyAgentEvent(r2.c, { type: "speech", payload: { text: "Quiet", animate: false } });
    expect(r2.calls).toEqual(["speech:Quiet"]);
  });

  it("task results map to completed / error", () => {
    const { c, calls } = recorder();
    applyAgentEvent(c, { type: "task_completed", payload: {} });
    applyAgentEvent(c, { type: "task_failed", payload: { message: "Disk full" } });
    expect(calls).toEqual(["state:completed", "speech:Task completed! ✅", "state:error", "speech:Disk full"]);
  });
});

describe("IPC validation", () => {
  it("accepts only well-formed commands", () => {
    expect(validatePetCommand({ type: "setState", state: "working" })).toEqual({ type: "setState", state: "working" });
    expect(validatePetCommand({ type: "setState", state: "dragging" })).toBeNull();
    expect(validatePetCommand({ type: "setState", state: "rm -rf" })).toBeNull();
    expect(validatePetCommand({ type: "exec", cmd: "calc.exe" })).toBeNull();
    expect(validatePetCommand({ type: "setRoaming", enabled: "yes" })).toBeNull();
    expect(validatePetCommand(null)).toBeNull();
    const long = validatePetCommand({ type: "setSpeech", text: "x".repeat(5000) });
    expect(long && long.type === "setSpeech" && long.text.length).toBe(600);
  });

  it("validates anchors, window names, events and panel messages", () => {
    expect(validateAnchor({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
    expect(validateAnchor({ x: "1", y: 2 })).toBeNull();
    expect(validateAnchor({ x: NaN, y: 2 })).toBeNull();
    expect(validateAnchor({ x: 1e9, y: 2 })).toBeNull();
    expect(validateWindowName("studio")).toBe("studio");
    expect(validateWindowName("devtools")).toBeNull();
    expect(validateAgentEvent({ type: "speech", payload: { text: "hi" } })).not.toBeNull();
    expect(validateAgentEvent({ type: "launch_missiles", payload: {} })).toBeNull();
    expect(validatePanelMessage({ id: "1", role: "admin", text: "x", timestamp: 1 })).toBeNull();
  });
});

describe("settings", () => {
  it("clamps and sanitises untrusted input", () => {
    const s = sanitizeSettings({ movementSpeed: 99, characterScale: -3, roaming: "yes", nightMode: "dusk", appearance: { skin: "neon", accessories: ["glasses", "jetpack", "glasses"] } });
    expect(s.movementSpeed).toBe(2);
    expect(s.characterScale).toBe(0.6);
    expect(s.roaming).toBe(DEFAULT_SETTINGS.roaming);
    expect(s.nightMode).toBe("off");
    expect(s.appearance.skin).toBe("default");
    expect(s.appearance.accessories).toEqual(["glasses"]);
  });

  it("turns sounds on once for settings saved before the sound update", () => {
    expect(sanitizeSettings({ soundEffects: false }).soundEffects).toBe(true);
    expect(sanitizeSettings({ soundEffects: false, soundVolume: 0.4 }).soundEffects).toBe(false);
    expect(sanitizeSettings({ soundVolume: 7 }).soundVolume).toBe(1);
  });

  it("starts with Windows disabled by default", () => {
    expect(DEFAULT_SETTINGS.startWithWindows).toBe(false);
  });

  it("patches partially", () => {
    const s = patchSettings(DEFAULT_SETTINGS, { quietMode: true });
    expect(s.quietMode).toBe(true);
    expect(s.roaming).toBe(DEFAULT_SETTINGS.roaming);
  });

  it("computes night mode", () => {
    expect(isNightActive("on")).toBe(true);
    expect(isNightActive("off")).toBe(false);
    expect(isNightActive("auto", new Date(2026, 0, 1, 23, 0))).toBe(true);
    expect(isNightActive("auto", new Date(2026, 0, 1, 12, 0))).toBe(false);
  });

  it("sanitises appearance on its own", () => {
    expect(sanitizeAppearance({ skin: "red", eyes: "sparkle" })).toMatchObject({ skin: "red", eyes: "sparkle", headphoneGlow: "skin" });
  });
});
