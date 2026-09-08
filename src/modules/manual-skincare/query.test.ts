import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import type { ManualSkincareCommand } from "./contracts";
import { getManualSkincareProductPhoto, getManualSkincareSnapshot } from "./query";
import {
  createManualSkincareService,
  materializeManualSkincareDay,
} from "./service";

const databases: Database.Database[] = [];
const pngPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let sequence = 0;
  const options = {
    now: () => new Date("2026-08-13T02:00:00.000Z"),
    createId: (prefix: string) => `${prefix}-${String(++sequence).padStart(6, "0")}`,
    writeBarrier: {
      runWrite: async <T>(action: () => T | Promise<T>) => await action(),
    },
  };
  return {
    sqlite,
    options,
    service: createManualSkincareService({ sqlite, ...options }),
  };
}

function totalChanges(sqlite: Database.Database): number {
  return sqlite.prepare("select total_changes()").pluck().get() as number;
}

async function save(
  context: ReturnType<typeof setup>,
  command: ManualSkincareCommand,
  key: string,
) {
  return context.service.execute(command, key);
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("manual skincare query", () => {
  it("returns bounded, ordered immutable day and recovery-cycle snapshots", async () => {
    const context = setup();
    await save(context, {
      type: "save-product",
      productId: "product-cleanser-001",
      name: "旧名称洁面",
      brand: "旧品牌",
      currentPurpose: "旧用途",
      status: "active",
      addedOn: "2026-08-01",
      note: "",
      photoDataUrl: pngPhoto,
      expectedProductRevision: 0,
    }, "manual-query-product-0001");
    await save(context, {
      type: "save-product",
      productId: "product-cream-0001",
      name: "面霜",
      brand: "品牌乙",
      currentPurpose: "修护",
      status: "active",
      addedOn: "2026-08-01",
      note: "",
      expectedProductRevision: 0,
    }, "manual-query-product-0002");
    const initial = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-12",
      context.options,
    );
    await save(context, {
      type: "replace-routine",
      businessDate: "2026-08-13",
      scope: "today-and-future",
      items: [
        { itemKey: "item-evening-cream", slot: "evening", productId: "product-cream-0001", ordinal: 0 },
        { itemKey: "item-morning-second", slot: "morning", productId: "product-cream-0001", ordinal: 1 },
        { itemKey: "item-morning-first", slot: "morning", productId: "product-cleanser-001", ordinal: 0 },
      ],
      changeNote: "稳定顺序",
      expectedRoutineRevision: 0,
      expectedDayRevision: 0,
      confirmedRemovedUsedItemKeys: [],
    }, "manual-query-routine-0001");
    let today = await materializeManualSkincareDay(
      context.sqlite,
      "2026-08-13",
      context.options,
    );
    for (const [section, note, key] of [
      ["morning", "早间记录", "manual-query-note-0001"],
      ["evening", "晚间记录", "manual-query-note-0002"],
      ["overall", "整体记录", "manual-query-note-0003"],
    ] as const) {
      const saved = await save(context, {
        type: "save-day-note",
        businessDate: "2026-08-13",
        section,
        note,
        expectedDayRevision: today.selectedDay!.revision,
      }, key);
      today = saved.snapshot;
    }
    await save(context, {
      type: "save-recovery-plan",
      planId: "recovery-plan-query",
      name: "查询展示计划",
      note: "",
      expectedPlanRevision: 0,
    }, "manual-query-plan-0001");
    await save(context, {
      type: "save-recovery-cycle",
      planId: "recovery-plan-query",
      cycleId: "recovery-cycle-query",
      ordinal: 0,
      name: "查询展示周期",
      goal: "只展示预计日期",
      expectedEndOn: "2026-08-14",
      note: "",
      items: [{ itemKey: "item-morning-first", slot: "morning", productId: "product-cleanser-001", ordinal: 0 }],
      expectedPlanRevision: 1,
      expectedCycleRevision: 0,
      expectedRoutineRevision: 1,
    }, "manual-query-cycle-0001");
    await save(context, {
      type: "save-product",
      productId: "product-cleanser-001",
      name: "当前新名称",
      brand: "当前新品牌",
      currentPurpose: "当前新用途",
      status: "paused",
      addedOn: "2026-08-01",
      note: "",
      expectedProductRevision: 1,
    }, "manual-query-product-0003");
    await materializeManualSkincareDay(context.sqlite, "2026-08-14", context.options);
    const sleepInsert = context.sqlite.prepare(`insert into sleep_daily_records
      (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
       confirmed_duration_minutes, quality_text, deep_sleep_minutes,
       light_sleep_minutes, rem_sleep_minutes, morning_feeling, note,
       revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, '', 1, ?, ?)`);
    sleepInsert.run(
      "sleep-link-2026-08-12",
      "2026-08-12",
      "23:40",
      "07:10",
      450,
      "旧版摘要",
      90,
      270,
      90,
      4,
      "2026-08-12T02:00:00.000Z",
      "2026-08-12T02:00:00.000Z",
    );
    sleepInsert.run(
      "sleep-link-2026-08-13",
      "2026-08-13",
      "01:40",
      "08:10",
      390,
      "旧版摘要",
      80,
      230,
      80,
      3,
      "2026-08-13T02:00:00.000Z",
      "2026-08-13T02:00:00.000Z",
    );

    const snapshot = getManualSkincareSnapshot(context.sqlite, {
      businessDate: "2026-08-13",
      historyLimit: 1,
    });
    expect(snapshot.selectedDay).toMatchObject({
      materialized: true,
      morningNote: "早间记录",
      eveningNote: "晚间记录",
      overallNote: "整体记录",
    });
    expect(snapshot.selectedDay?.morningItems.map((item) => item.itemKey))
      .toEqual(["item-morning-first", "item-morning-second"]);
    expect(snapshot.selectedDay?.eveningItems.map((item) => item.itemKey))
      .toEqual(["item-evening-cream"]);
    expect(snapshot.selectedDay?.morningItems[0]).toMatchObject({
      productName: "旧名称洁面",
      brand: "旧品牌",
      currentPurpose: "旧用途",
    });
    expect(snapshot.products.find((product) => product.productId === "product-cleanser-001"))
      .toMatchObject({
        name: "当前新名称",
        brand: "当前新品牌",
        currentPurpose: "当前新用途",
        photoUrl: "/api/v1/manual-skincare/products/product-cleanser-001/photo?revision=2",
      });
    expect(JSON.stringify(snapshot)).not.toContain("data:image/");
    expect(getManualSkincareProductPhoto(context.sqlite, "product-cleanser-001"))
      .toMatchObject({ mediaType: "image/png", revision: 2 });
    expect(snapshot.recoveryPlans[0]?.cycles[0]).toMatchObject({
      name: "查询展示周期",
      durationDays: 2,
      expectedEndOn: "2026-08-14",
      status: "draft",
      routineRevision: 2,
    });
    expect(snapshot.history).toHaveLength(1);
    expect(snapshot.insights?.find((insight) => insight.businessDate === "2026-08-13"))
      .toMatchObject({
        sleepVariabilityMinutes: 90,
        completionPercent: 0,
        stabilityScore: 0,
      });
    expect(snapshot.insights?.find((insight) => insight.businessDate === "2026-08-13")?.sleepQualityScore)
      .toBeGreaterThanOrEqual(60);
    expect(snapshot.insights?.find((insight) => insight.businessDate === "2026-08-13")?.sleepPenalty)
      .toBeGreaterThan(0);
    expect(initial.selectedDay?.materialized).toBe(true);
  });

  it("is a pure bounded read and expected dates never select routine authority", async () => {
    const context = setup();
    await save(context, {
      type: "save-product",
      productId: "product-authority-001",
      name: "权威测试产品",
      brand: "测试品牌",
      currentPurpose: "测试用途",
      status: "active",
      addedOn: "2026-08-01",
      note: "",
      expectedProductRevision: 0,
    }, "manual-query-authority-0001");
    const beforeRows = context.sqlite.prepare(`
      select sum(rows) from (
        select count(*) rows from manual_skincare_days
        union all select count(*) from manual_skincare_day_items
        union all select count(*) from manual_skincare_routine_activations
      )
    `).pluck().get();
    const beforeChanges = totalChanges(context.sqlite);
    const snapshot = getManualSkincareSnapshot(context.sqlite, {
      businessDate: "2026-08-15",
      historyLimit: 1,
    });
    expect(snapshot.selectedDay).toMatchObject({
      businessDate: "2026-08-15",
      materialized: false,
      revision: 0,
      morningItems: [],
      eveningItems: [],
    });
    expect(totalChanges(context.sqlite)).toBe(beforeChanges);
    expect(context.sqlite.prepare(`
      select sum(rows) from (
        select count(*) rows from manual_skincare_days
        union all select count(*) from manual_skincare_day_items
        union all select count(*) from manual_skincare_routine_activations
      )
    `).pluck().get()).toBe(beforeRows);
    expect(() => getManualSkincareSnapshot(context.sqlite, {
      businessDate: "2026-02-30",
    })).toThrow();
    expect(() => getManualSkincareSnapshot(context.sqlite, {
      businessDate: "2026-08-15",
      historyLimit: 101,
    })).toThrow();
  });
});
