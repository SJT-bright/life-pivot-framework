import { expect, test, type Page } from "@playwright/test";

function shanghaiBusinessDate(offsetDays = 0): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(
    Number(value.year),
    Number(value.month) - 1,
    Number(value.day) + offsetDays,
  ));
  return date.toISOString().slice(0, 10);
}

async function selectSleepDate(page: Page, recordDate: string): Promise<void> {
  const dateInput = page.locator('input[type="date"][aria-label="日期"]');
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/v1/daily-sleep"
      && url.searchParams.get("date") === recordDate;
  });
  await dateInput.fill(recordDate);
  expect((await responsePromise).ok()).toBeTruthy();
  await expect(dateInput).toHaveValue(recordDate);
}

async function saveSleepRecord(
  page: Page,
  input: {
    readonly recordDate: string;
    readonly asleepTime: string;
    readonly wakeTime: string;
    readonly deepSleepMinutes: string;
    readonly lightSleepMinutes: string;
    readonly remSleepMinutes: string;
    readonly morningFeeling: number;
  },
): Promise<void> {
  await selectSleepDate(page, input.recordDate);
  await page.getByLabel("入睡时间").fill(input.asleepTime);
  await page.getByLabel("起床时间").fill(input.wakeTime);
  await page.getByLabel("深睡（分钟）").fill(input.deepSleepMinutes);
  await page.getByLabel("浅睡（分钟）").fill(input.lightSleepMinutes);
  await page.getByLabel("REM（分钟）").fill(input.remSleepMinutes);
  const feeling = page.getByRole("slider", { name: "醒后感受" });
  await feeling.focus();
  await feeling.press("Home");
  for (let value = 1; value < input.morningFeeling; value += 1) {
    await feeling.press("ArrowRight");
  }
  await expect(feeling).toHaveValue(String(input.morningFeeling));
  await expect(feeling).toHaveAttribute(
    "aria-valuetext",
    `${input.morningFeeling} 分，满分 5 分`,
  );

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/daily-sleep"
  ));
  await page.getByRole("button", { name: "保存睡眠记录" }).click();
  expect((await responsePromise).ok()).toBeTruthy();
  await expect(page.locator(".sleep-form-status")).toHaveText("已保存");
}

/**
 * This spec intentionally shares one browser context and one test so that the
 * three pages exercise the same per-process E2E database. scripts/run-playwright.mjs
 * supplies a disposable LIFE_OS_DATA_ROOT and removes it when Playwright exits.
 */
test("authorless reading, adjacent sleep scoring, and same-day skincare insight work end to end", async ({ page }) => {
  test.setTimeout(120_000);
  const today = shanghaiBusinessDate();
  const previousDay = shanghaiBusinessDate(-1);
  const bookTitle = `E2E无作者-${Date.now()}`;
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
    const pathname = new URL(response.url()).pathname;
    if (
      ["/api/v1/reading", "/api/v1/daily-sleep", "/api/v1/manual-skincare"].includes(pathname)
      && response.status() >= 400
    ) {
      failedResponses.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto("/reading");
  await expect(page.getByRole("heading", { level: 1, name: "读书" })).toBeVisible();
  await expect(page.getByLabel("作者")).toHaveCount(0);
  await page.getByLabel("书名").fill(bookTitle);
  await page.getByLabel("状态").selectOption("reading");
  await page.getByLabel("总页数").fill("320");

  const readingSavePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/reading"
  ));
  await page.getByRole("button", { name: "添加书籍" }).click();
  expect((await readingSavePromise).ok()).toBeTruthy();
  await expect(page.getByRole("article", { name: `书籍：${bookTitle}` })).toBeVisible();

  const readingResponse = await page.request.get("/api/v1/reading");
  expect(readingResponse.ok()).toBeTruthy();
  const readingPayload = await readingResponse.json();
  expect(readingPayload.snapshot.books).toContainEqual(expect.objectContaining({
    author: "",
    status: "reading",
    title: bookTitle,
    totalPages: 320,
  }));

  await page.goto("/sleep");
  await expect(page.getByRole("heading", { level: 1, name: "睡眠记录" })).toBeVisible();
  await saveSleepRecord(page, {
    recordDate: previousDay,
    asleepTime: "23:55",
    wakeTime: "07:05",
    deepSleepMinutes: "90",
    lightSleepMinutes: "260",
    remSleepMinutes: "80",
    morningFeeling: 4,
  });
  await saveSleepRecord(page, {
    recordDate: today,
    asleepTime: "00:05",
    wakeTime: "07:20",
    deepSleepMinutes: "90",
    lightSleepMinutes: "260",
    remSleepMinutes: "85",
    morningFeeling: 5,
  });

  const sleepResponse = await page.request.get(`/api/v1/daily-sleep?date=${today}`);
  expect(sleepResponse.ok()).toBeTruthy();
  const sleepPayload = await sleepResponse.json();
  expect(sleepPayload.record).toMatchObject({
    asleepTime: "00:05",
    deepSleepMinutes: 90,
    finalDurationMinutes: 435,
    lightSleepMinutes: 260,
    morningFeeling: 5,
    qualityScore: 99,
    recordDate: today,
    remSleepMinutes: 85,
    sleepVariabilityMinutes: 13,
    wakeTime: "07:20",
    score: {
      averageVariabilityMinutes: 13,
      bedVariabilityMinutes: 10,
      usedPreviousNaturalDay: true,
      wakeVariabilityMinutes: 15,
    },
  });
  expect(sleepPayload.record.qualityText).toBe("未记录主观评价");
  expect(sleepPayload.record.score.disclaimer).toBe("个人趋势分，非医疗诊断");

  const summary = page.getByLabel("睡眠趋势摘要");
  await expect(summary).toContainText("睡眠质量分99");
  await expect(summary).toContainText("平均睡眠波动13 分钟");
  await expect(summary).toContainText("入睡波动10 分钟");
  await expect(summary).toContainText("起床波动15 分钟");
  await expect(page.getByRole("img", { name: /睡眠质量分历史折线图/ })).toBeVisible();
  await expect(page.getByRole("img", { name: new RegExp(`${previousDay}，睡眠质量分`) })).toBeVisible();
  await expect(page.getByRole("img", { name: `${today}，睡眠质量分 99，个人趋势分，非医疗诊断` })).toBeVisible();

  const historyResponse = await page.request.get("/api/v1/daily-sleep?view=history&limit=30");
  expect(historyResponse.ok()).toBeTruthy();
  const historyPayload = await historyResponse.json();
  expect(historyPayload.history.items.map((item: { recordDate: string }) => item.recordDate)).toEqual([
    today,
    previousDay,
  ]);

  await page.goto(`/skincare?date=${today}`);
  await expect(page.getByRole("heading", { level: 1, name: "护肤记录" })).toBeAttached();
  await expect(page.getByText("睡眠联动已开启：晚睡与作息波动只调整趋势权重，不会改写护肤或睡眠原始记录。")).toBeVisible();

  await page.getByRole("tab", { name: "护肤品库" }).click();
  await page.getByRole("button", { name: "新增护肤品" }).click();
  await page.getByLabel("名称").fill("E2E 本地照片精华");
  await page.getByLabel("品牌").fill("本机测试");
  await page.getByLabel("当前作用").fill("验证照片拖放与本地持久化");
  const photoBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const photoDropzone = page.getByRole("group", { name: "产品照片" });
  await photoDropzone.evaluate((element, bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "e2e-product.png", {
      type: "image/png",
    }));
    for (const eventName of ["dragenter", "dragover", "drop"]) {
      element.dispatchEvent(new DragEvent(eventName, {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }));
    }
  }, photoBytes);
  await expect(page.getByRole("img", { name: "E2E 本地照片精华照片预览" })).toBeVisible();

  const productSavePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/manual-skincare"
  ));
  await page.getByRole("button", { name: "保存护肤品" }).click();
  const productSaveResponse = await productSavePromise;
  expect(productSaveResponse.ok()).toBeTruthy();
  const productSavePayload = await productSaveResponse.json();
  const savedProduct = productSavePayload.result.snapshot.products.find(
    (candidate: { name: string }) => candidate.name === "E2E 本地照片精华",
  );
  expect(savedProduct.photoUrl).toMatch(/^\/api\/v1\/manual-skincare\/products\/.+\/photo\?revision=1$/);
  const storedPhotoResponse = await page.request.get(savedProduct.photoUrl);
  expect(storedPhotoResponse.ok()).toBeTruthy();
  expect(storedPhotoResponse.headers()["content-type"]).toBe("image/png");
  expect([...await storedPhotoResponse.body()]).toEqual(photoBytes);

  await page.getByRole("tab", { name: "历史记录" }).click();

  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  for (const heading of ["日期", "当日清单", "睡眠趋势", "作息波动", "睡眠扣权", "稳定度"]) {
    await expect(table.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
  }
  const linkedRow = table.locator("tbody tr").filter({ hasText: today });
  await expect(linkedRow).toHaveCount(1);
  await expect(linkedRow.locator("td").nth(5)).toHaveText("99分");
  await expect(linkedRow.locator("td").nth(6)).toHaveText("13分钟");
  await expect(linkedRow.locator("td").nth(7)).toHaveText("0");

  const skincareResponse = await page.request.get(`/api/v1/manual-skincare?date=${today}&historyLimit=20`);
  expect(skincareResponse.ok()).toBeTruthy();
  const skincarePayload = await skincareResponse.json();
  expect(skincarePayload.snapshot.history).toContainEqual(expect.objectContaining({
    businessDate: today,
    materialized: true,
  }));
  expect(skincarePayload.snapshot.insights).toContainEqual(expect.objectContaining({
    businessDate: today,
    sleepPenalty: 0,
    sleepQualityScore: 99,
    sleepVariabilityMinutes: 13,
  }));

  expect(failedResponses).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
