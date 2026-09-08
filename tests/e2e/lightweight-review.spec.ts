import { expect, test, type Page } from "@playwright/test";

const widths = [320, 375, 768, 1024] as const;
const longUnbrokenText = "A".repeat(1024);
const externalBaseURL = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1"
  ? process.env.PLAYWRIGHT_BASE_URL
  : undefined;
if (externalBaseURL) {
  const target = new URL(externalBaseURL);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (!["http:", "https:"].includes(target.protocol) || !loopbackHosts.has(target.hostname)) {
    throw new Error("PLAYWRIGHT_BASE_URL must use HTTP(S) on a loopback host.");
  }
}
const route = (path: string) => externalBaseURL ? new URL(path, externalBaseURL).href : path;

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
}

for (const width of widths) {
  test(`weekly review stays reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route("/review?start=2026-08-10"));
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 1, name: "查看这一周留下的事实" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "我的周总结" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "我的周总结" })).toBeVisible();
    await expect(page.getByRole("button", { name: "保存周总结" })).toBeVisible();

    const previous = page.getByRole("link", { name: "上一周" });
    const next = page.getByRole("link", { name: "下一周" });
    await previous.focus();
    await expect(previous).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
    const summary = page.getByRole("textbox", { name: "我的周总结" });
    // Earlier E2E scenarios can leave recent-edit pin buttons in this shared,
    // disposable database. Walk the real tab order instead of assuming the
    // summary is always the very next focusable control after the period links.
    for (let index = 0; index < 30; index += 1) {
      await page.keyboard.press("Tab");
      if (await summary.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(summary).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "保存周总结" })).toBeFocused();

    await page.locator(".weekly-review-grid section").first().evaluate((section, text) => {
      const list = document.createElement("ul");
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
      section.append(list);
    }, longUnbrokenText);
    await expectNoHorizontalOverflow(page);
  });

  // The legacy archive route was retired; keep the scenario documented until a replacement exists.
  test.skip(`legacy archive stays readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(route("/settings/archive"));
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 1, name: "旧专业数据（只读）" })).toBeVisible();
    for (const heading of ["睡眠", "运动", "护肤"]) {
      await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
    }
    const back = page.getByRole("link", { name: "返回数据与设置" });
    await back.scrollIntoViewIfNeeded();
    await back.focus();
    await expect(back).toBeFocused();

    await page.locator(".legacy-archive-section").first().evaluate((section, text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      section.append(paragraph);
    }, longUnbrokenText);
    await expectNoHorizontalOverflow(page);
  });
}
