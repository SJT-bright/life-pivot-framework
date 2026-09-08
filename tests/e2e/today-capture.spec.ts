import { expect, test } from "@playwright/test";

test("twenty captures survive refresh and remain visible", async ({ page }) => {
  await page.goto("/today");
  const composer = page.getByLabel("今天发生了什么？");

  for (let index = 1; index <= 20; index += 1) {
    const text = `第 ${index} 条持久化记录`;
    await composer.fill(text);
    await page.getByRole("button", { name: "保存到待整理" }).click();
    await expect(page.getByLabel("刚刚保存").getByText(text, { exact: true })).toBeVisible();
  }

  await page.reload();
  for (let index = 1; index <= 20; index += 1) {
    await expect(
      page.getByLabel("已加载时间线").getByText(`第 ${index} 条持久化记录`, { exact: true }),
    ).toBeVisible();
  }
});

test("keyboard capture submits once and leaves the next draft editable", async ({ page }) => {
  await page.goto("/today");
  const composer = page.getByLabel("今天发生了什么？");
  await composer.fill("键盘提交一次");
  await composer.press("Enter");
  await composer.fill("提交后继续输入的新草稿");

  await expect(page.getByText("键盘提交一次", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("提交后继续输入的新草稿");
});
