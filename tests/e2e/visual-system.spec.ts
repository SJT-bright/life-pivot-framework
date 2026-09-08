import { expect, test, type Locator, type Page } from "@playwright/test";

type SurfaceCase = {
  path: string;
  surface: string;
  asset: string;
};

const surfaces: SurfaceCase[] = [
  { path: "/today", surface: "today", asset: "today.png" },
  { path: "/goals", surface: "goals", asset: "goals.png" },
  { path: "/knowledge", surface: "knowledge", asset: "knowledge.png" },
  { path: "/reading", surface: "reading", asset: "reading.png" },
  { path: "/exercise", surface: "exercise", asset: "exercise.png" },
  { path: "/sleep", surface: "sleep", asset: "sleep.png" },
  { path: "/skincare", surface: "skincare", asset: "skincare.png" },
  { path: "/health", surface: "health", asset: "health.png" },
  { path: "/daily-review", surface: "daily-review", asset: "daily-review.png" },
  { path: "/review-map", surface: "review-map", asset: "review-map.png" },
  { path: "/review", surface: "weekly-review", asset: "weekly-review.png" },
  { path: "/settings/data", surface: "settings", asset: "settings.png" },
];

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const interactiveSelector = [
  "main input:not([type='hidden']):not([disabled])",
  "main textarea:not([disabled])",
  "main select:not([disabled])",
  "main button:not([disabled])",
  "main a[href]",
].join(", ");

async function expectNoHorizontalOverflow(page: Page) {
  const geometry = await page.evaluate(() => ({
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));

  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.bodyClientWidth + 1);
}

async function firstUsableControl(page: Page): Promise<Locator> {
  const controls = page.locator(interactiveSelector);
  const count = await controls.count();
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    if (await control.isVisible()) return control;
  }
  throw new Error("Expected at least one visible interactive control inside main");
}

async function expectUnclippedFocusIndicator(page: Page) {
  const control = await firstUsableControl(page);
  const restingBoxShadow = await control.evaluate((element) => getComputedStyle(element).boxShadow);
  // Establish keyboard modality, then focus and centre the exact control under test.
  // This avoids a sticky header changing the scroll position between two tab stops.
  await page.keyboard.press("Tab");
  await control.focus();
  await control.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center" });
  });
  await expect(control).toBeFocused();

  const focus = await control.evaluate((element, baselineShadow) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;
    const hasOutline = style.outlineStyle !== "none" && outlineWidth >= 2;
    const hasInsetFocusShadow = style.boxShadow !== baselineShadow && /\binset\b/.test(style.boxShadow);
    // An inset ring is fully painted inside the control. Otherwise account for
    // the full outward outline when checking every clipping boundary.
    const reach = hasInsetFocusShadow ? 0 : outlineWidth + Math.max(0, outlineOffset);
    const ring = {
      top: rect.top - reach,
      right: rect.right + reach,
      bottom: rect.bottom + reach,
      left: rect.left - reach,
    };

    const clippingAncestors: Array<{ tag: string; clipsRing: boolean }> = [];
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      const clipsX = /(hidden|clip)/.test(ancestorStyle.overflowX);
      const clipsY = /(hidden|clip)/.test(ancestorStyle.overflowY);
      if (clipsX || clipsY) {
        const ancestorRect = ancestor.getBoundingClientRect();
        clippingAncestors.push({
          tag: ancestor.tagName.toLowerCase(),
          clipsRing:
            (clipsX && (ring.left < ancestorRect.left - 1 || ring.right > ancestorRect.right + 1)) ||
            (clipsY && (ring.top < ancestorRect.top - 1 || ring.bottom > ancestorRect.bottom + 1)),
        });
      }
      ancestor = ancestor.parentElement;
    }

    return {
      matchesFocusVisible: element.matches(":focus-visible"),
      hasOutline,
      hasInsetFocusShadow,
      outlineStyle: style.outlineStyle,
      outlineWidth,
      ring,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      clippingAncestors,
    };
  }, restingBoxShadow);

  expect(focus.matchesFocusVisible).toBe(true);
  expect(focus.hasOutline || focus.hasInsetFocusShadow).toBe(true);
  if (!focus.hasInsetFocusShadow) {
    expect(focus.outlineStyle).not.toBe("none");
    expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  }
  expect(focus.ring.left).toBeGreaterThanOrEqual(-1);
  expect(focus.ring.top).toBeGreaterThanOrEqual(-1);
  expect(focus.ring.right).toBeLessThanOrEqual(focus.viewport.width + 1);
  expect(focus.ring.bottom).toBeLessThanOrEqual(focus.viewport.height + 1);
  expect(focus.clippingAncestors.filter((ancestor) => ancestor.clipsRing)).toEqual([]);
}

async function expectHorizontalFocusIndicatorInsideScrollport(
  page: Page,
  control: Locator,
  scrollportSelector: string,
  maskSafeInset = 0,
) {
  const restingBoxShadow = await control.evaluate((element) => getComputedStyle(element).boxShadow);

  await page.keyboard.press("Tab");
  await control.focus();
  await control.evaluate((element) => {
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  // Some tab/button materials transition their shadow. Read the settled state
  // so an inset focus ring is distinguishable from the resting material shadow.
  await page.waitForTimeout(220);
  await expect(control).toBeFocused();

  const focus = await control.evaluate((element, input) => {
    const scrollport = element.closest(input.scrollportSelector);
    if (!(scrollport instanceof HTMLElement)) {
      throw new Error(`Missing focus scrollport: ${input.scrollportSelector}`);
    }

    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const scrollportRect = scrollport.getBoundingClientRect();
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const outlineOffset = Number.parseFloat(style.outlineOffset) || 0;
    const hasOutline = style.outlineStyle !== "none" && outlineWidth >= 2;
    const hasInsetFocusShadow = style.boxShadow !== input.restingBoxShadow && /\binset\b/.test(style.boxShadow);
    const reach = hasInsetFocusShadow ? 0 : outlineWidth + Math.max(0, outlineOffset);
    const scrollportLeft = scrollportRect.left + scrollport.clientLeft + input.maskSafeInset;
    const scrollportRight = scrollportRect.left + scrollport.clientLeft
      + scrollport.clientWidth - input.maskSafeInset;

    return {
      matchesFocusVisible: element.matches(":focus-visible"),
      hasOutline,
      hasInsetFocusShadow,
      indicatorLeft: rect.left - reach,
      indicatorRight: rect.right + reach,
      scrollportLeft,
      scrollportRight,
      scrollWidth: scrollport.scrollWidth,
      clientWidth: scrollport.clientWidth,
      overflowX: getComputedStyle(scrollport).overflowX,
    };
  }, { maskSafeInset, restingBoxShadow, scrollportSelector });

  expect(focus.matchesFocusVisible).toBe(true);
  // The implementation may use a conventional external outline or an inset
  // box-shadow fallback. Geometry is evaluated using the actual paint reach.
  expect(focus.hasOutline || focus.hasInsetFocusShadow).toBe(true);
  expect(focus.scrollWidth).toBeGreaterThan(focus.clientWidth);
  expect(["auto", "scroll"]).toContain(focus.overflowX);
  expect(focus.indicatorLeft).toBeGreaterThanOrEqual(focus.scrollportLeft - 1);
  expect(focus.indicatorRight).toBeLessThanOrEqual(focus.scrollportRight + 1);
}

for (const viewport of viewports) {
  test.describe(`${viewport.name} visual surfaces`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const surface of surfaces) {
      test(`${surface.path} owns its art, semantics, responsive width, and focus treatment`, async ({ page }) => {
        await page.goto(surface.path);
        await page.waitForLoadState("networkidle");

        const shell = page.locator(".app-shell").first();
        await expect(shell).toHaveAttribute("data-surface", surface.surface);

        const art = shell.locator(".surface-art");
        await expect(art).toHaveCount(1);
        await expect.poll(async () => art.evaluate((element) => getComputedStyle(element).backgroundImage))
          .toContain(`/assets/page-backgrounds/apple-glass-v1/${surface.asset}`);

        const artBounds = await art.boundingBox();
        expect(artBounds).not.toBeNull();
        expect(artBounds!.width).toBeGreaterThanOrEqual(viewport.width - 1);
        expect(artBounds!.height).toBeGreaterThanOrEqual(viewport.height - 1);

        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
        await expectUnclippedFocusIndicator(page);
      });
    }
  });
}

test("390px primary navigation preserves complete focus indicators at both scroll edges", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/today");
  await page.waitForLoadState("networkidle");

  const navigation = page.getByRole("navigation", { name: "主要导航" });
  const links = navigation.getByRole("link");
  expect(await links.count()).toBeGreaterThan(2);

  // The mask fades the outer 18px of the rail. Keep the entire focused
  // treatment inside the fully opaque part, not merely inside overflow-x.
  await expectHorizontalFocusIndicatorInsideScrollport(page, links.first(), ".primary-nav", 18);
  await expectHorizontalFocusIndicatorInsideScrollport(page, links.last(), ".primary-nav", 18);
});

test("390px primary navigation reveals the current route and settings current state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/review");
  await page.waitForLoadState("networkidle");

  const navigation = page.getByRole("navigation", { name: "主要导航" });
  const current = navigation.getByRole("link", { name: "周回顾" });
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect.poll(async () => {
    const navBox = await navigation.boundingBox();
    const currentBox = await current.boundingBox();
    if (!navBox || !currentBox) return false;
    return currentBox.x >= navBox.x + 18
      && currentBox.x + currentBox.width <= navBox.x + navBox.width - 18;
  }).toBe(true);

  await page.goto("/settings/data");
  await expect(page.getByRole("link", { name: "数据与设置" }))
    .toHaveAttribute("aria-current", "page");
});

test("application navigation remains sticky while content scrolls", async ({ page }) => {
  await page.goto("/today");
  await page.waitForLoadState("networkidle");
  await page.locator("main").evaluate((main) => {
    const spacer = document.createElement("div");
    spacer.style.height = "1800px";
    spacer.style.pointerEvents = "none";
    main.append(spacer);
  });
  await page.evaluate(() => window.scrollTo(0, 1100));

  const header = page.locator(".app-header");
  await expect.poll(async () => header.evaluate((element) => ({
    position: getComputedStyle(element).position,
    top: element.getBoundingClientRect().top,
  }))).toEqual({ position: "sticky", top: 12 });
});

test("390px exercise DomainSubnav keeps edge focus treatments inside its rail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/exercise");
  await page.waitForLoadState("networkidle");

  const navigation = page.getByRole("navigation", { name: "运动健身分区" });
  const links = navigation.getByRole("link");
  expect(await links.count()).toBeGreaterThan(2);

  await expectHorizontalFocusIndicatorInsideScrollport(
    page,
    links.first(),
    'nav[aria-label="运动健身分区"]',
  );
  await expectHorizontalFocusIndicatorInsideScrollport(
    page,
    links.last(),
    'nav[aria-label="运动健身分区"]',
  );
});

test("390px skincare tab rail keeps first and last keyboard focus treatments complete", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/skincare");
  await page.waitForLoadState("networkidle");

  const tablist = page.getByRole("tablist", { name: "手动护肤视图" });
  const tabs = tablist.getByRole("tab");
  await expect(tabs).toHaveCount(4);

  await expectHorizontalFocusIndicatorInsideScrollport(page, tabs.first(), ".manual-skincare-tabs");
  await expectHorizontalFocusIndicatorInsideScrollport(page, tabs.last(), ".manual-skincare-tabs");
});

test("review heatmap links keep 44px targets and complete edge focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/review-map");
  await page.waitForLoadState("networkidle");

  const heatmap = page.getByRole("region", { name: /周复盘热力图/ });
  const cells = heatmap.getByRole("link");
  expect(await cells.count()).toBeGreaterThan(7);
  const size = await cells.first().boundingBox();
  expect(size).not.toBeNull();
  expect(size!.width).toBeGreaterThanOrEqual(44);
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await expectHorizontalFocusIndicatorInsideScrollport(page, cells.first(), ".review-heatmap");
  await expectHorizontalFocusIndicatorInsideScrollport(page, cells.last(), ".review-heatmap");
});

test("reduced motion leaves the visual system effectively still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/today");
  await page.waitForLoadState("networkidle");

  const timing = await page.locator(".surface-art").evaluate((element) => {
    const toMilliseconds = (value: string) => {
      const parsed = Number.parseFloat(value);
      return value.trim().endsWith("ms") ? parsed : parsed * 1000;
    };
    const maximumTime = (value: string) => Math.max(
      ...value.split(",").map((part) => toMilliseconds(part)),
    );
    const style = getComputedStyle(element);
    const pageStyle = getComputedStyle(document.querySelector(".page-shell")!);
    return {
      artAnimationMs: maximumTime(style.animationDuration),
      artTransitionMs: maximumTime(style.transitionDuration),
      pageAnimationMs: maximumTime(pageStyle.animationDuration),
      pageTransitionMs: maximumTime(pageStyle.transitionDuration),
      scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    };
  });

  expect(timing.artAnimationMs).toBeLessThanOrEqual(20);
  expect(timing.artTransitionMs).toBeLessThanOrEqual(20);
  expect(timing.pageAnimationMs).toBeLessThanOrEqual(20);
  expect(timing.pageTransitionMs).toBeLessThanOrEqual(20);
  expect(timing.scrollBehavior).toBe("auto");

  // Make the scroll threshold deterministic even when the isolated database is
  // empty, then exercise the real fixed control without waiting for an animation.
  await page.locator("main").evaluate((main) => {
    const spacer = document.createElement("div");
    spacer.setAttribute("data-e2e-scroll-spacer", "true");
    spacer.style.height = "1600px";
    spacer.style.pointerEvents = "none";
    main.append(spacer);
  });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(480);

  const backToTop = page.getByRole("button", { name: "回到顶部" });
  await expect(backToTop).toHaveAttribute("data-visible", "true");
  expect(await backToTop.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return {
      position: getComputedStyle(button).position,
      insideViewport: rect.left >= 0 && rect.top >= 0
        && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight,
    };
  })).toEqual({ position: "fixed", insideViewport: true });
  const immediateScrollY = await backToTop.evaluate((button) => {
    (button as HTMLButtonElement).click();
    return window.scrollY;
  });
  expect(immediateScrollY).toBe(0);
});
