import { _electron as electron, expect, test, type ElectronApplication, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../..", import.meta.url));
// e.g. ELECTRON_EXTRA_ARGS="--no-sandbox" on Linux CI running as root
const extraArgs = process.env.ELECTRON_EXTRA_ARGS?.split(" ").filter(Boolean) ?? [];

let app: ElectronApplication;
let pet: Page;

const petBounds = () =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("#pet"))!.getBounds());

test.beforeAll(async () => {
  app = await electron.launch({ executablePath: require("electron"), args: [...extraArgs, root] });
  pet = await app.firstWindow();
  await pet.waitForFunction(() => !!(window as any).__sunday, null, { timeout: 30_000 });
  await pet.evaluate(() => (window as any).sunday.updateSettings({ roaming: false }));
});

test.afterAll(async () => {
  await pet.evaluate(() => (window as any).sunday.updateSettings({ roaming: true, characterScale: 1 }));
  await app.close();
});

test("pet window is a transparent, frameless, always-on-top overlay on the taskbar line", async () => {
  const info = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("#pet"))!;
    const b = w.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    return { onTop: w.isAlwaysOnTop(), bottom: b.y + b.height, waBottom: wa.y + wa.height };
  });
  expect(info.onTop).toBe(true);
  expect(info.bottom).toBe(info.waBottom);
  const alpha = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().endsWith("#pet"))!;
    const img = await w.webContents.capturePage();
    const { width } = img.getSize();
    return img.toBitmap()[(2 * width + 2) * 4 + 3];
  });
  expect(alpha).toBe(0);
});

test("renderer has no Node access", async () => {
  expect(await pet.evaluate(() => typeof (window as any).require + typeof (window as any).process)).toBe("undefinedundefined");
});

test("walking moves the real window", async () => {
  const before = await petBounds();
  await pet.evaluate(() => (window as any).__sunday.controller.setState("walking"));
  await pet.waitForTimeout(1500);
  const after = await petBounds();
  expect(after.x).not.toBe(before.x);
  expect(after.y).toBe(before.y);
  await pet.evaluate(() => (window as any).__sunday.controller.setState("idle"));
});

test("malformed IPC is ignored", async () => {
  await pet.waitForTimeout(500);
  const before = await petBounds();
  await pet.evaluate(() => (window as any).sunday.pet.moveTo({ x: "evil", y: 0 }));
  await pet.evaluate(() => (window as any).sunday.pet.moveTo({ x: 1e12, y: 0 }));
  await pet.waitForTimeout(300);
  expect(await petBounds()).toEqual(before);
});

test("character size setting resizes the window and keeps the feet planted", async () => {
  const before = await petBounds();
  await pet.evaluate(() => (window as any).sunday.updateSettings({ characterScale: 1.4 }));
  await pet.waitForTimeout(600);
  const after = await petBounds();
  expect(after.height).toBeGreaterThan(before.height);
  expect(after.y + after.height).toBe(before.y + before.height);
});

test("controller drives every state", async () => {
  for (const s of ["thinking", "working", "listening", "talking", "celebrating", "sitting", "idle"]) {
    await pet.evaluate((st) => (window as any).__sunday.controller.setState(st), s);
    await pet.waitForTimeout(300);
    expect(await pet.evaluate(() => (window as any).__sunday.engine.state)).toBe(s);
  }
});

test("right-click opens the menu and double-click opens the panel", async () => {
  await pet.mouse.click(150, 240, { button: "right" });
  await expect(pet.locator(".menu-item")).toHaveCount(7);
  await pet.keyboard.press("Escape");
  await pet.mouse.dblclick(150, 240);
  await expect.poll(() => app.windows().some((w) => w.url().endsWith("#panel")), { timeout: 10_000 }).toBe(true);
});

test("panel never fakes a reply", async () => {
  const panel = app.windows().find((w) => w.url().endsWith("#panel"))!;
  await panel.fill("[aria-label=Message]", "hello");
  await panel.click("button[aria-label=Send]");
  await expect(panel.locator(".msg-status")).toContainText("not sent");
  await expect(panel.locator(".msg-sunday")).toHaveCount(0);
});
