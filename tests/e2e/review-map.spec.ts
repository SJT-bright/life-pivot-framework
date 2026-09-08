import { expect, test } from "@playwright/test";

test("review map visualizes streaks, heatmap, graph and gallery", async ({ page }) => {
  test.setTimeout(60_000);
  const marker = `E2E-${Date.now()}`;
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  // 通过正式 API 写入三天的复盘内容（含重复主题词，供星图提取）
  const notes: Array<{ date: string; completed: string }> = [
    { date: "2026-08-20", completed: `${marker} 完成复盘地图的星图设计，坚持运动半小时` },
    { date: "2026-08-21", completed: `${marker} 继续打磨复盘地图的热力日历，坚持早睡` },
    { date: "2026-08-22", completed: `${marker} 星图节点可以拖拽了，坚持写字` },
  ];
  for (const [index, item] of notes.entries()) {
    const response = await page.request.post("/api/v1/personal-notes", {
      data: {
        type: "save-personal-daily-note",
        noteId: `personal-note-e2e-review-map-${index}`,
        businessDate: item.date,
        content: JSON.stringify({
          schemaVersion: "daily-review-template-v1",
          completed: item.completed,
          effective: "可视化让坚持看得见",
          tomorrow: "继续保持节奏",
        }),
        expectedRevision: 0,
      },
      headers: { "idempotency-key": `e2e-review-map-${index}` },
    });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto("/review-map");

  // 成就统计
  await expect(page.getByRole("heading", { name: "复盘地图", level: 1 })).toBeVisible();
  await expect(page.getByText("累计复盘").locator("..")).toContainText("3 天");

  // 热力日历：写入的三天有颜色格子，悬停有提示
  const reviewedCell = page.locator('a.review-heatmap-cell[title^="2026-08-21"]');
  await expect(reviewedCell).toHaveAttribute("title", /字/);
  await expect(reviewedCell).toContainText("8/21");
  await expect(page.locator(".review-heatmap-weekdays")).toHaveText("周一周二周三周四周五周六周日");

  // 星图：等力导向布局铺开后出现日期节点与关键词标签
  await expect(page.locator(".review-graph-day-circle").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".review-graph-keyword-label").first()).toBeVisible();

  // 近期复盘卡片墙包含写入的内容摘要
  await expect(page.locator(".review-gallery-card").filter({ hasText: marker }).first())
    .toBeVisible();

  // 卡片与热力格都能跳到对应日期的复盘
  await page.locator('a.review-heatmap-cell[title^="2026-08-22"]').click();
  await expect(page).toHaveURL(/\/daily-review\?date=2026-08-22$/);

  expect(consoleErrors).toEqual([]);
});
