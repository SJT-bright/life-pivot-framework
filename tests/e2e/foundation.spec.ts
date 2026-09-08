import { expect, test } from "@playwright/test";

test("today capture persists, reloads into the timeline, and is included in a verified backup", async ({ page }) => {
  const text = "端到端验证的第一条记录";
  await page.goto("/today");

  const entry = page.getByLabel("今天发生了什么？");
  await entry.fill(text);
  await page.getByRole("button", { name: "保存到待整理" }).click();
  await expect(page.getByLabel("刚刚保存").getByText(text, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("已加载时间线").getByText(text, { exact: true })).toBeVisible();
  await expect(entry).toHaveValue("");

  await page.getByRole("link", { name: "数据与设置", exact: true }).click();
  await page.getByRole("button", { name: "立即创建备份" }).click();
  await expect(page.getByText("备份已验证，可以用于恢复")).toBeVisible();
});

test("foreign origins cannot write local data", async ({ request }) => {
  const response = await request.post("/api/v1/today/sections", {
    headers: {
      origin: "https://evil.example",
      "idempotency-key": "hostile-request-0001",
    },
    data: {
      section: "entry",
      draftId: "hostile-draft-0001",
      businessDate: "2026-08-10",
      occurredAt: "2026-08-10T08:00:00.000Z",
      value: { text: "不应写入" },
    },
  });

  expect(response.status()).toBe(403);
});
