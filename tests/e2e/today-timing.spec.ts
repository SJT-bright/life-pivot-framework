import { performance } from "node:perf_hooks";

import { expect, test } from "@playwright/test";

const inputs = [
  "记录今天读完一章",
  "午后散步二十分钟",
  "学会使用稳定游标",
  "整理三条项目想法",
  "晚上回顾今日积累",
];

test("records the reproducible five-second interaction samples", async ({ page }) => {
  await page.goto("/today");
  const composer = page.getByLabel("今天发生了什么？");

  async function capture(text: string) {
    await composer.fill("");
    await composer.focus();
    const started = performance.now();
    await composer.pressSequentially(text, { delay: 25 });
    await composer.press("Enter");
    await expect(page.getByLabel("刚刚保存").getByText(text, { exact: true })).toBeVisible();
    return (performance.now() - started) / 1_000;
  }

  await capture("不计时练习记录");
  await page.reload();
  await expect(page.getByLabel("已加载时间线").getByText("不计时练习记录", { exact: true })).toBeVisible();

  const results: Array<{ input: string; seconds: number; saved: boolean; recovered: boolean }> = [];
  for (const input of inputs) {
    const seconds = await capture(input);
    await page.reload();
    const recovered = await page.getByLabel("已加载时间线").getByText(input, { exact: true }).isVisible();
    results.push({ input, seconds, saved: true, recovered });
  }

  const sorted = results.map((result) => result.seconds).sort((a, b) => a - b);
  const median = sorted[2] ?? Number.POSITIVE_INFINITY;
  console.log(`TODAY_CAPTURE_TIMING ${JSON.stringify({ results, median })}`);
  expect(results.every((result) => result.saved && result.recovered)).toBe(true);
  expect(median).toBeLessThanOrEqual(5);
});
