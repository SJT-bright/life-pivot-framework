import { expect, test } from "@playwright/test";

function shanghaiBusinessDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

test("imports a checked Feishu v1 summary and previews later source duplicates without writing twice", async ({ page }) => {
  const businessDate = shanghaiBusinessDate(new Date());
  const marker = `e2e${Date.now()}`;
  const firstBatch = {
    schema: "life-pivot.daily-import",
    version: 1,
    batchId: `batch-${marker}-001`,
    timezone: "Asia/Shanghai",
    businessDate,
    source: {
      platform: "feishu",
      chatId: `oc_${marker}`,
      summaryMessageId: `om_${marker}_summary_001`,
      generatedAt: `${businessDate}T22:00:00+08:00`,
    },
    items: [
      {
        kind: "meal",
        sourceMessageId: `om_${marker}_meal`,
        sourceItemId: "meal-1",
        occurredAt: `${businessDate}T07:45:00+08:00`,
        timePrecision: "exact",
        mealType: "breakfast",
        foods: [
          { name: "云吞", quantity: "1 碗" },
          { name: "豆浆" },
        ],
        amountFen: 1880,
        currency: "CNY",
        sourceText: "早上吃了一碗云吞和豆浆，共付款18.8元",
      },
      {
        kind: "expense",
        sourceMessageId: `om_${marker}_expense`,
        sourceItemId: "expense-1",
        occurredAt: `${businessDate}T13:20:00+08:00`,
        timePrecision: "exact",
        amountFen: 4260,
        currency: "CNY",
        category: "transport",
        merchant: "地铁",
        sourceText: "下午交通花费42.6元",
      },
      {
        kind: "activity",
        sourceMessageId: `om_${marker}_activity`,
        sourceItemId: "activity-1",
        occurredAt: `${businessDate}T18:30:00+08:00`,
        timePrecision: "estimated",
        title: "整理当天账目",
        status: "done",
        durationMinutes: 35,
        sourceText: "晚上整理了当天账目",
      },
    ],
  } as const;

  const mealTimelineText = "【饮食 · 早餐】云吞 1 碗、豆浆 · ¥18.80";
  const expenseTimelineText = "【消费 · 交通】地铁 ¥42.60";
  const activityTimelineText = "【今日事项 · 已完成】整理当天账目 · 35 分钟";

  await page.goto(`/today?date=${businessDate}`);
  await page.getByRole("button", { name: "导入飞书汇总" }).click();
  await expect(page.getByRole("dialog", { name: "导入飞书每日汇总" })).toBeVisible();

  await page.getByRole("textbox", { name: "飞书机器人汇总内容" })
    .fill(JSON.stringify(firstBatch, null, 2));
  await page.getByRole("button", { name: "解析并预览" }).click();

  await expect(page.getByRole("region", { name: "饮食记录" })).toBeVisible();
  await expect(page.getByRole("region", { name: "消费记录" })).toBeVisible();
  await expect(page.getByRole("region", { name: "事项记录" })).toBeVisible();
  const metrics = page.getByRole("list", { name: "导入统计" });
  await expect(metrics).toContainText("共 3 条");
  await expect(metrics).toContainText("已选 3 条");
  await expect(metrics).toContainText("今日消费 ¥61.40");
  await expect(metrics).toContainText("重复 0 条");

  const mealTime = page.getByLabel("饮食第 1 条时间");
  await expect(mealTime).toHaveValue(`${businessDate}T07:45`);
  await mealTime.fill(`${businessDate}T08:05`);
  await expect(page.getByText("时间已修改，请重新检查后再确认导入。"))
    .toBeVisible();

  const activitySelection = page.getByRole("checkbox", { name: "导入事项第 1 条" });
  await activitySelection.uncheck();
  await expect(metrics).toContainText("已选 2 条");
  await expect(page.getByRole("button", { name: "确认导入 2 条" })).toBeDisabled();

  await page.getByRole("button", { name: "重新检查" }).click();
  await expect(page.getByRole("button", { name: "确认导入 2 条" })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入 2 条" }).click();

  const success = page.getByRole("status").filter({ hasText: "飞书汇总已完成导入" });
  await expect(success).toContainText("已写入 2 条");
  await expect(success).toContainText("本次金额 ¥61.40");
  await expect(success).toContainText("今日时间线已刷新");

  await page.getByRole("button", { name: "关闭飞书汇总导入" }).click();
  const timeline = page.getByLabel("已加载时间线");
  await expect(timeline.getByText(mealTimelineText, { exact: true })).toHaveCount(1);
  await expect(timeline.getByText(expenseTimelineText, { exact: true })).toHaveCount(1);
  await expect(timeline.getByText(activityTimelineText, { exact: true })).toHaveCount(0);

  const secondBatch = {
    ...firstBatch,
    batchId: `batch-${marker}-002`,
    source: {
      ...firstBatch.source,
      summaryMessageId: `om_${marker}_summary_002`,
      generatedAt: `${businessDate}T22:30:00+08:00`,
    },
    items: [
      {
        ...firstBatch.items[0],
        occurredAt: `${businessDate}T08:05:00+08:00`,
        timePrecision: "exact",
      },
      firstBatch.items[1],
      firstBatch.items[2],
    ],
  } as const;

  await page.getByRole("button", { name: "导入飞书汇总" }).click();
  await page.getByRole("button", { name: "返回修改原文" }).click();
  await page.getByRole("textbox", { name: "飞书机器人汇总内容" })
    .fill(JSON.stringify(secondBatch, null, 2));
  await page.getByRole("button", { name: "解析并预览" }).click();

  await expect(metrics).toContainText("共 3 条");
  await expect(metrics).toContainText("已选 1 条");
  await expect(metrics).toContainText("今日消费 ¥0.00");
  await expect(metrics).toContainText("重复 2 条");
  await expect(page.getByText("已存在 · 将跳过")).toHaveCount(2);
  await expect(page.getByRole("checkbox", { name: "导入饮食第 1 条" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "导入消费第 1 条" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "导入事项第 1 条" })).toBeEnabled();

  // Preview performs no write: both imported source facts still occur exactly once,
  // while the fact cancelled in the first batch remains absent from the timeline.
  await expect(timeline.getByText(mealTimelineText, { exact: true })).toHaveCount(1);
  await expect(timeline.getByText(expenseTimelineText, { exact: true })).toHaveCount(1);
  await expect(timeline.getByText(activityTimelineText, { exact: true })).toHaveCount(0);
});
