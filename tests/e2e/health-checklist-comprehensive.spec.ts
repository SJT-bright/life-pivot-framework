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

test("health checklist supports its complete interactive workflow", async ({ page }) => {
  test.setTimeout(90_000);
  const testDate = shanghaiBusinessDate(new Date());
  const futureDate = shanghaiBusinessDate(new Date(Date.now() + 86_400_000));
  const marker = `E2E-${Date.now()}`;
  const firstName = `${marker}-喝水`;
  const renamedFirst = `${marker}-喝水-已编辑`;
  const secondName = `${marker}-早餐`;
  const thirdName = `${marker}-拉伸`;
  const dayNote = `${marker}-当天备注`;
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on("console", (message) => {
    const location = message.location().url;
    if (message.type() === "error" && !location.endsWith("/favicon.ico")) {
      consoleErrors.push(`${message.text()} @ ${location}`);
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/health-checklist") && response.status() >= 400) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`/health?date=${testDate}`);
  await expect(page.getByText(/今天还没有任务/)).toBeVisible();

  // 新任务默认进入每日常驻模板，之后每天自动出现
  await page.getByLabel("任务名称").fill(firstName);
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(page.getByTitle("常驻任务，每天自动出现")).toHaveCount(1);

  // 关掉常驻开关后添加的任务只属于今天
  await page.getByLabel("设为常驻，每天都出现").uncheck();
  await page.getByLabel("任务名称").fill(secondName);
  await page.getByLabel("任务名称").press("Enter");
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(page.getByTitle("常驻任务，每天自动出现")).toHaveCount(1);

  const items = page.locator(".health-item-list > li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(secondName);
  await expect(items.nth(1)).toContainText(firstName);

  // 勾选即完成，名称就是目标本身，没有隐藏的目标与备注区
  await page.getByRole("checkbox", { name: `完成 ${firstName}` }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(page.getByRole("checkbox", { name: `完成 ${firstName}` })).toBeChecked();
  await expect(page.getByText(/已完成/)).toHaveText("已完成 1 / 2");

  // 点击名称即可就地改名（常驻任务的改名同样作用于之后每天）
  await page.getByRole("button", { name: firstName, exact: true }).click();
  const renameBox = page.getByLabel(`重命名 ${firstName}`);
  await renameBox.fill(renamedFirst);
  await renameBox.press("Enter");
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(page.getByRole("checkbox", { name: `完成 ${renamedFirst}` })).toBeChecked();

  // 删除今日任务一步完成
  await page.getByRole("checkbox", { name: `完成 ${secondName}` }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await page.getByRole("button", { name: `删除 ${secondName}` }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(items).toHaveCount(1);
  await expect(page.getByText(secondName, { exact: true })).toHaveCount(0);

  // 新增的任务排在最上面（重新打开常驻开关）
  await page.getByLabel("设为常驻，每天都出现").check();
  await page.getByLabel("任务名称").fill(thirdName);
  await page.getByRole("button", { name: "添加" }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(items.nth(0)).toContainText(thirdName);
  await expect(page.getByTitle("常驻任务，每天自动出现")).toHaveCount(2);

  await page.locator(".health-checklist-note > summary").click();
  await page.getByLabel("当天备注").fill(dayNote);
  await page.getByRole("button", { name: "保存当天备注" }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await page.reload();
  await page.locator(".health-checklist-note > summary").click();
  await expect(page.getByLabel("当天备注")).toHaveValue(dayNote);

  const firstApiRead = await page.request.get(`/api/v1/health-checklist?date=${testDate}`);
  expect(firstApiRead.ok()).toBeTruthy();
  const firstPayload = await firstApiRead.json();
  expect(firstPayload.day.note).toBe(dayNote);
  expect(firstPayload.day.items.map((item: { name: string }) => item.name)).toEqual([
    thirdName,
    renamedFirst,
  ]);
  expect(firstPayload.day.persistentItemKeys).toHaveLength(2);

  // 常驻任务删除需要二次确认（会影响之后每天），确认后从模板移除
  await page.getByRole("button", { name: `删除 ${renamedFirst}` }).click();
  await expect(page.getByRole("button", { name: `确认删除常驻任务 ${renamedFirst}` })).toBeVisible();
  await page.getByRole("button", { name: `确认删除常驻任务 ${renamedFirst}` }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(items).toHaveCount(1);
  await expect(page.getByText(renamedFirst, { exact: true })).toHaveCount(0);

  // 常驻修改作用于今天及以后：未来日期看到同样的清单
  await page.getByLabel("清单日期").fill(futureDate);
  await page.getByRole("button", { name: "切换日期" }).click();
  await expect(page).toHaveURL(new RegExp(`date=${futureDate}$`));
  await expect(page.getByRole("checkbox", { name: `完成 ${renamedFirst}` })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: `完成 ${thirdName}` })).toBeVisible();

  await page.getByRole("checkbox", { name: `完成 ${thirdName}` }).click();
  await expect(page.getByRole("status")).toHaveText("健康清单已保存。");
  await expect(page.getByRole("checkbox", { name: `完成 ${thirdName}` })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: `完成 ${thirdName}` })).toBeChecked();

  const futureApiRead = await page.request.get(`/api/v1/health-checklist?date=${futureDate}`);
  expect(futureApiRead.ok()).toBeTruthy();
  const futurePayload = await futureApiRead.json();
  expect(futurePayload.day.items.map((item: { name: string }) => item.name)).toEqual([
    thirdName,
  ]);
  expect(futurePayload.day.persistentItemKeys).toHaveLength(1);
  expect(failedResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
