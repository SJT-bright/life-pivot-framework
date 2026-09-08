import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __companionExpandedCalls?: boolean[];
    __companionMoveCalls?: Array<Record<string, number | string>>;
  }
}

test("companion expands once, stays stable under the pointer, and uses the compact geometry", async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 436 });
  await page.addInitScript(() => {
    Object.defineProperty(window, "__companionExpandedCalls", {
      configurable: true,
      value: [] as boolean[],
    });
    Object.defineProperty(window, "__companionMoveCalls", {
      configurable: true,
      value: [] as Array<Record<string, number | string>>,
    });
    Object.defineProperty(window, "lifePivotDesktop", {
      configurable: true,
      value: {
        available: true,
        moveCompanion(command: Record<string, number | string>) {
          window.__companionMoveCalls?.push(command);
        },
        openMainWindow() {},
        setCompanionExpanded(expanded: boolean) {
          window.__companionExpandedCalls?.push(expanded);
        },
      },
    });
  });

  await page.goto("/companion");
  const companion = page.getByLabel(/今日还有 \d+ 件事/);
  const tab = page.getByRole("button", { name: /展开今日提醒/ });
  const panel = page.locator(".reminder-companion-panel");
  const dragHandle = page.getByRole("button", { name: "上下拖动今日悬浮窗" });

  await expect(tab).toHaveAttribute("aria-expanded", "false");
  await expect(dragHandle).toBeVisible();
  const collapsedHandleBox = await dragHandle.boundingBox();
  expect(collapsedHandleBox).toMatchObject({ width: 44, height: 44 });
  const collapsedTabBox = await tab.boundingBox();
  expect(collapsedTabBox).toMatchObject({ width: 44, height: 112 });
  expect(collapsedHandleBox!.y).toBeGreaterThanOrEqual(
    collapsedTabBox!.y + collapsedTabBox!.height + 4,
  );
  await page.mouse.move(
    collapsedHandleBox!.x + collapsedHandleBox!.width / 2,
    collapsedHandleBox!.y + collapsedHandleBox!.height / 2,
  );
  await expect(tab).toHaveAttribute("aria-expanded", "true");
  const expandedHandleBox = await dragHandle.boundingBox();
  expect(expandedHandleBox!.y + expandedHandleBox!.height / 2)
    .toBe(collapsedHandleBox!.y + collapsedHandleBox!.height / 2);

  const countBox = await tab.locator("strong").boundingBox();
  expect(countBox).not.toBeNull();
  expect(expandedHandleBox!.y).toBeGreaterThan(countBox!.y + countBox!.height);

  const tabBox = await tab.boundingBox();
  const panelBox = await panel.boundingBox();
  expect(tabBox).toMatchObject({ width: 44, height: 112 });
  expect(panelBox).toMatchObject({ x: 10, y: 10, width: 246, height: 416 });
  expect(await page.evaluate(() => window.__companionExpandedCalls ?? [])).toEqual([true]);

  const dragBox = await dragHandle.boundingBox();
  expect(dragBox).not.toBeNull();
  await page.mouse.move(dragBox!.x + dragBox!.width / 2, dragBox!.y + dragBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(dragBox!.x + dragBox!.width / 2, dragBox!.y + 70, { steps: 5 });
  await page.mouse.up();
  const dragCalls = await page.evaluate(() => window.__companionMoveCalls ?? []);
  expect(dragCalls[0]).toMatchObject({ phase: "start" });
  expect(dragCalls.some((call) => call.phase === "move")).toBe(true);
  expect(dragCalls.at(-1)).toEqual({ phase: "end" });

  await dragHandle.focus();
  await dragHandle.press("ArrowDown");
  await expect.poll(async () => page.evaluate(() => window.__companionMoveCalls?.at(-1)))
    .toEqual({ phase: "nudge", deltaY: 24 });

  const moveCallCount = await page.evaluate(() => window.__companionMoveCalls?.length ?? 0);
  await page.getByPlaceholder("例如：五点开会").fill("五点开会");
  expect(await page.evaluate(() => window.__companionMoveCalls?.length ?? 0)).toBe(moveCallCount);

  for (const [x, y] of [[245, 28], [180, 110], [90, 210], [238, 390], [270, 218]]) {
    await page.mouse.move(x, y);
  }
  expect(await page.evaluate(() => window.__companionExpandedCalls ?? [])).toEqual([true]);

  await page.mouse.move(310, 218);
  await page.waitForTimeout(200);
  await page.mouse.move(270, 218);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__companionExpandedCalls ?? [])).toEqual([true]);

  await page.mouse.move(310, 218);
  await expect(tab).toHaveAttribute("aria-expanded", "false", { timeout: 1_000 });
  expect(await page.evaluate(() => window.__companionExpandedCalls ?? [])).toEqual([true, false]);
});

test("companion uses one high-contrast smoked-glass system in dark mode", async ({ page }) => {
  await page.setViewportSize({ width: 300, height: 436 });
  await page.addInitScript(() => {
    window.localStorage.setItem("life-pivot-color-theme", "dark");
    Object.defineProperty(window, "lifePivotDesktop", {
      configurable: true,
      value: {
        available: true,
        moveCompanion() {},
        openMainWindow() {},
        setCompanionExpanded() {},
      },
    });
  });

  await page.goto("/companion");
  const dragHandle = page.getByRole("button", { name: "上下拖动今日悬浮窗" });
  await dragHandle.hover();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".reminder-companion-panel")).toHaveCSS("opacity", "1");

  const audit = await page.evaluate(() => {
    function channels(value: string): [number, number, number, number] {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
      return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
    }
    function composite(
      foreground: [number, number, number, number],
      background: [number, number, number, number],
    ): [number, number, number, number] {
      const alpha = foreground[3] + background[3] * (1 - foreground[3]);
      return [
        (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
        (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
        alpha,
      ];
    }
    function luminance(color: [number, number, number, number]): number {
      const linear = color.slice(0, 3).map((channel) => {
        const value = channel! / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
    }
    function contrast(
      foreground: [number, number, number, number],
      background: [number, number, number, number],
    ): number {
      const light = Math.max(luminance(foreground), luminance(background));
      const dark = Math.min(luminance(foreground), luminance(background));
      return (light + 0.05) / (dark + 0.05);
    }

    const handle = document.querySelector<HTMLButtonElement>("[aria-label='上下拖动今日悬浮窗']")!;
    const rail = handle.parentElement!;
    const tab = document.querySelector<HTMLButtonElement>(".reminder-companion-tab")!;
    const badge = tab.querySelector<HTMLElement>("strong")!;
    const panel = document.querySelector<HTMLElement>(".reminder-companion-panel")!;
    const heading = panel.querySelector<HTMLElement>("h1")!;
    const canvas: [number, number, number, number] = [9, 17, 14, 1];
    const railBackground = composite(channels(getComputedStyle(rail).backgroundColor), canvas);
    const panelBackground = composite(channels(getComputedStyle(panel).backgroundColor), canvas);
    const gripBackground = composite(
      channels(getComputedStyle(handle, "::before").backgroundColor),
      railBackground,
    );
    const badgeBackground = channels(getComputedStyle(badge).backgroundColor);

    return {
      badgeContrast: contrast(channels(getComputedStyle(badge).color), badgeBackground),
      gripContrast: contrast(channels(getComputedStyle(handle).color), gripBackground),
      headingContrast: contrast(channels(getComputedStyle(heading).color), panelBackground),
      panelBackground,
      railBackground,
      tabContrast: contrast(channels(getComputedStyle(tab).color), railBackground),
    };
  });

  expect(audit.railBackground.slice(0, 3).every((channel) => channel < 45)).toBe(true);
  expect(audit.panelBackground.slice(0, 3).every((channel) => channel < 45)).toBe(true);
  expect(audit.tabContrast).toBeGreaterThanOrEqual(7);
  expect(audit.headingContrast).toBeGreaterThanOrEqual(7);
  expect(audit.badgeContrast).toBeGreaterThanOrEqual(7);
  expect(audit.gripContrast).toBeGreaterThanOrEqual(4.5);
});
