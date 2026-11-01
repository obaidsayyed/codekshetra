import { describe, expect, it } from "vitest";
import { speakableText } from "../../src/services/voice";
import { DEFAULT_SETTINGS, patchSettings, sanitizeSettings, sanitizeVoice } from "../../src/shared/settings";

describe("voice", () => {
  it("defaults to a cute talking voice with reactions", () => {
    expect(DEFAULT_SETTINGS.voice.mode).toBe("speak");
    expect(DEFAULT_SETTINGS.voice.pitch).toBeGreaterThan(1.4);
    expect(DEFAULT_SETTINGS.voice.reactions).toBe(true);
  });

  it("sanitises voice settings", () => {
    const v = sanitizeVoice({ mode: "shout", pitch: 9, rate: -1, voiceName: 42, reactions: "yes" });
    expect(v.mode).toBe("speak");
    expect(v.pitch).toBe(2);
    expect(v.rate).toBe(0.6);
    expect(v.voiceName).toBe("");
    expect(v.reactions).toBe(true);
  });

  it("partial voice patches keep the other voice fields", () => {
    const s = patchSettings(DEFAULT_SETTINGS, { voice: { mode: "babble" } });
    expect(s.voice.mode).toBe("babble");
    expect(s.voice.pitch).toBe(DEFAULT_SETTINGS.voice.pitch);
    expect(sanitizeSettings({}).voice).toEqual(DEFAULT_SETTINGS.voice);
  });

  it("strips emoji and markdown before speaking", () => {
    expect(speakableText("Hey! I'm Sunday. 👋")).toBe("Hey! I'm Sunday.");
    expect(speakableText("Task completed! ✅ **done**")).toBe("Task completed! done");
    expect(speakableText("🌙")).toBe("");
  });
});
