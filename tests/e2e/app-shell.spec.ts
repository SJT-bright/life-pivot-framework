import { expect, test } from "@playwright/test";

for (const width of [320, 375, 768, 1024]) {
  test(`shell has no horizontal overflow and usable targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");

    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);

    for (const locator of await page.locator(".app-header a, .primary-card").all()) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test("Home exposes Today immediately and keyboard focus reaches the composer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByLabel("今天发生了什么？")).toBeVisible();
  await page.getByRole("link", { name: "个人积累库" }).focus();
  let reachedComposer = false;
  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.press("Tab");
    reachedComposer = await page.evaluate(() => document.activeElement?.id === "today-entry");
    if (reachedComposer) break;
  }
  expect(reachedComposer).toBe(true);
});
