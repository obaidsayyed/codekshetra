import { expect, test } from "@playwright/test";

const STUDIO = "http://localhost:5318/#studio";

test.describe("Animation Studio (browser)", () => {
  test("loads every animation without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(STUDIO);
    await expect(page.locator(".anim-list button")).toHaveCount(15);
    await expect(page.locator(".gallery-tile")).toHaveCount(15);
    for (const btn of await page.locator(".anim-list button").all()) {
      await btn.click();
      const state = await btn.getAttribute("data-state");
      await expect(page.locator(".state-chip")).toContainText(await btn.locator(".name").innerText());
      expect(await page.evaluate(() => (window as any).__studio.engine.state)).toBe(state);
    }
    expect(errors).toEqual([]);
  });

  test("transport: pause, play, restart, stop, speed and scale", async ({ page }) => {
    await page.goto(STUDIO);
    await page.click('.anim-list button[data-state="walking"]');
    await page.click('[data-testid="pause"]');
    const t1 = await page.evaluate(() => (window as any).__studio.engine.getTimeline().time);
    await page.waitForTimeout(400);
    const t2 = await page.evaluate(() => (window as any).__studio.engine.getTimeline().time);
    expect(t2).toBeCloseTo(t1, 5);
    await page.click('[data-testid="play"]');
    await expect.poll(() => page.evaluate(() => (window as any).__studio.engine.getTimeline().time), { timeout: 10_000 }).not.toBeCloseTo(t2, 3);
    await page.click('[data-testid="restart"]');
    expect(await page.evaluate(() => (window as any).__studio.engine.getTimeline().time)).toBeLessThan(0.3);
    await page.locator('[data-testid="speed"]').fill("2");
    expect(await page.evaluate(() => (window as any).__studio.engine.timeScale)).toBe(2);
    await page.locator('[data-testid="scale"]').fill("1.5");
    expect(await page.evaluate(() => (window as any).__studio.scene.character.object.scale.x)).toBe(1.5);
    await page.click('[data-testid="stop"]');
    expect(await page.evaluate(() => (window as any).__studio.engine.state)).toBe("idle");
  });

  test("play all walks through the states", async ({ page }) => {
    await page.goto(STUDIO);
    await page.click('[data-testid="play-all"]');
    await expect(page.locator(".playall-chip")).toContainText("1/15");
    await page.waitForTimeout(3800);
    await expect(page.locator(".playall-chip")).toContainText("2/15");
  });

  test("transition preview uses the state machine route", async ({ page }) => {
    await page.goto(STUDIO);
    await page.click('button[role="tab"]:has-text("Transitions")');
    await expect(page.locator(".route-chip")).toHaveText(["Sleeping", "Waking Up", "Working"]);
    await page.click('[data-testid="preview-transition"]');
    await expect(page.locator(".route-result")).toContainText("Waking Up", { timeout: 8000 });
  });
});
