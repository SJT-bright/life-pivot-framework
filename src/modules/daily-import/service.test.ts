import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import {
  type FeishuDailyImport,
  type FeishuDailyImportItem,
  parseFeishuDailyImport,
} from "./feishu-daily-import-contract";
import {
  FeishuDailyImportConflictError,
  createFeishuDailyImportService,
  renderFeishuImportItemText,
} from "./service";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let sequence = 0;
  const service = createFeishuDailyImportService(sqlite, {
    now: () => new Date("2026-08-30T14:30:00.000Z"),
    createId: () => `generated-${String(++sequence).padStart(4, "0")}`,
    writeBarrier: { runWrite: async (operation) => operation() },
  });
  return { sqlite, service };
}

function batch(overrides: Partial<Record<"batchId" | "chatId", string>> = {}): FeishuDailyImport {
  return parseFeishuDailyImport({
    schema: "life-pivot.daily-import",
    version: 1,
    batchId: overrides.batchId ?? "batch-20260830-001",
    timezone: "Asia/Shanghai",
    businessDate: "2026-08-30",
    source: {
      platform: "feishu",
      chatId: overrides.chatId ?? "oc_daily_log",
      summaryMessageId: "om_summary_001",
      generatedAt: "2026-08-30T22:00:00+08:00",
    },
    items: [
      {
        kind: "meal",
        sourceMessageId: "om_breakfast",
        sourceItemId: "meal-1",
        occurredAt: "2026-08-30T08:15:00+08:00",
        timePrecision: "exact",
        mealType: "breakfast",
        foods: [{ name: "鸡蛋", quantity: "2 个" }, { name: "牛奶" }],
        amountFen: 680,
      },
      {
        kind: "expense",
        sourceMessageId: "om_lunch",
        sourceItemId: "expense-1",
        occurredAt: "2026-08-30T12:30:00+08:00",
        timePrecision: "exact",
        amountFen: 2350,
        currency: "CNY",
        category: "food",
        merchant: "午餐店",
      },
      {
        kind: "activity",
        sourceMessageId: "om_gym",
        sourceItemId: "activity-1",
        occurredAt: "2026-08-30T19:00:00+08:00",
        timePrecision: "estimated",
        title: "健身",
        status: "done",
        durationMinutes: 45,
      },
    ],
  });
}

function itemOfKind<K extends FeishuDailyImportItem["kind"]>(
  value: FeishuDailyImport,
  kind: K,
): Extract<FeishuDailyImportItem, { kind: K }> {
  return value.items.find(
    (item): item is Extract<FeishuDailyImportItem, { kind: K }> => item.kind === kind,
  )!;
}

describe("Feishu daily import service", () => {
  it("previews normalized captures without writing any row", () => {
    const { sqlite, service } = setup();

    const receipt = service.preview(batch());

    expect(receipt).toMatchObject({
      preview: true,
      businessDate: "2026-08-30",
      totalCount: 3,
      importedCount: 0,
      skippedCount: 0,
    });
    expect(receipt.items.map((item) => item.status)).toEqual(["ready", "ready", "ready"]);
    expect(receipt.items[0]).toMatchObject({
      occurredAt: "2026-08-30T00:15:00.000Z",
      text: "【饮食 · 早餐】鸡蛋 2 个、牛奶 · ¥6.80",
    });
    expect(sqlite.prepare("select count(*) from capture_items").pluck().get()).toBe(0);
    expect(sqlite.prepare("select count(*) from audit_events").pluck().get()).toBe(0);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(0);
  });

  it("atomically imports all categories into the Today capture timeline", async () => {
    const { sqlite, service } = setup();

    const receipt = await service.importBatch(batch(), "feishu-import-key-0001");

    expect(receipt).toMatchObject({
      preview: false,
      totalCount: 3,
      importedCount: 3,
      skippedCount: 0,
    });
    expect(receipt.items.map((item) => item.status)).toEqual(["imported", "imported", "imported"]);
    expect(sqlite.prepare(`select business_date, occurred_at, content
      from capture_items order by occurred_at`).all()).toEqual([
      {
        business_date: "2026-08-30",
        occurred_at: "2026-08-30T00:15:00.000Z",
        content: "【饮食 · 早餐】鸡蛋 2 个、牛奶 · ¥6.80",
      },
      {
        business_date: "2026-08-30",
        occurred_at: "2026-08-30T04:30:00.000Z",
        content: "【消费 · 餐饮】午餐店 ¥23.50",
      },
      {
        business_date: "2026-08-30",
        occurred_at: "2026-08-30T11:00:00.000Z",
        content: "【今日事项 · 已完成】健身 · 45 分钟",
      },
    ]);
    expect(sqlite.prepare("select count(*) from audit_events where event_type = 'imported'").pluck().get())
      .toBe(3);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(4);
  });

  it("replays one batch key and skips overlapping source items in a later batch", async () => {
    const { sqlite, service } = setup();
    const first = await service.importBatch(batch(), "feishu-import-key-0002");
    const replay = await service.importBatch(batch(), "feishu-import-key-0002");
    expect(replay).toEqual(first);

    const overlap = batch({ batchId: "batch-20260830-002" });
    overlap.source.summaryMessageId = "om_summary_002";
    const overlapMeal = itemOfKind(overlap, "meal");
    const overlapActivity = itemOfKind(overlap, "activity");
    overlap.items = [
      overlapMeal,
      {
        ...overlapActivity,
        sourceMessageId: "om_walk",
        sourceItemId: "activity-2",
        title: "散步",
      },
    ];
    const second = await service.importBatch(overlap, "feishu-import-key-0003");

    expect(second).toMatchObject({ importedCount: 1, skippedCount: 1 });
    expect(second.items.map((item) => item.status)).toEqual(["skipped", "imported"]);
    expect(sqlite.prepare("select count(*) from capture_items").pluck().get()).toBe(4);
  });

  it("rejects a changed fact with the same source identity and rolls back the whole batch", async () => {
    const { sqlite, service } = setup();
    await service.importBatch(batch(), "feishu-import-key-0004");

    const changed = batch({ batchId: "batch-20260830-003" });
    const changedActivity = itemOfKind(changed, "activity");
    const changedExpense = itemOfKind(changed, "expense");
    changed.items = [
      {
        ...changedActivity,
        sourceMessageId: "om_new_first",
        sourceItemId: "activity-new",
        title: "这条应该回滚",
      },
      { ...changedExpense, amountFen: 2500 },
    ];

    await expect(service.importBatch(changed, "feishu-import-key-0005"))
      .rejects.toBeInstanceOf(FeishuDailyImportConflictError);
    expect(sqlite.prepare("select count(*) from capture_items").pluck().get()).toBe(3);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(4);
  });

  it("scopes otherwise identical Feishu message ids by chat", async () => {
    const { sqlite, service } = setup();
    const first = batch({ chatId: "oc_chat_a" });
    const second = batch({ batchId: "batch-20260830-chat-b", chatId: "oc_chat_b" });

    await service.importBatch(first, "feishu-import-key-chat-a");
    const receipt = await service.importBatch(second, "feishu-import-key-chat-b");

    expect(receipt.importedCount).toBe(3);
    expect(sqlite.prepare("select count(*) from capture_items").pluck().get()).toBe(6);
  });

  it("renders optional descriptions without inventing missing facts", () => {
    const activity = itemOfKind(batch(), "activity");
    expect(renderFeishuImportItemText({ ...activity, status: "planned", note: "带资料" }))
      .toBe("【今日事项 · 待办】健身 · 45 分钟｜带资料");
  });
});
