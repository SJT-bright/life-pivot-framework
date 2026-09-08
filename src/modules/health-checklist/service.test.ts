import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import {
  HealthChecklistConflictError,
  createHealthChecklistService,
  materializeHealthChecklistDay,
} from "./service";

const databases: Database.Database[] = [];
const itemA = {
  itemKey: "vitamin-daily-001",
  groupKey: "vitamins",
  groupLabel: "全天维生素",
  name: "维生素",
  targetText: "按自己的计划",
  note: "",
  ordinal: 0,
} as const;
const itemB = {
  itemKey: "breakfast-item-001",
  groupKey: "breakfast",
  groupLabel: "早餐",
  name: "早餐元素",
  targetText: "",
  note: "",
  ordinal: 1,
} as const;

function setup(now = new Date("2026-08-12T02:00:00.000Z")) {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let sequence = 0;
  const options = {
    now: () => now,
    createId: (prefix: string) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
    writeBarrier: { runWrite: async <T>(action: () => T | Promise<T>) => action() },
  };
  return { sqlite, options, service: createHealthChecklistService(sqlite, options) };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("health checklist materialization and service", () => {
  it("creates one empty default template and a stable empty day without invented facts", async () => {
    const { sqlite, options } = setup();

    const first = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);
    const replay = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);

    expect(first).toMatchObject({
      businessDate: "2026-08-12",
      templateId: "health-default",
      templateRevision: 1,
      revision: 1,
      items: [],
    });
    expect(replay).toEqual(first);
    expect(sqlite.prepare("select count(*) from health_checklist_templates").pluck().get()).toBe(1);
    expect(sqlite.prepare("select count(*) from health_checklist_versions").pluck().get()).toBe(1);
    expect(sqlite.prepare("select count(*) from health_checklist_days").pluck().get()).toBe(1);
  });

  it("creates immutable future versions and preserves completion by stable itemKey", async () => {
    const { sqlite, options, service } = setup();
    const empty = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);
    const withA = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-and-future",
      name: "我的健康清单",
      changeNote: "先加入一项",
      items: [itemA],
      expectedTemplateRevision: 1,
      expectedDayRevision: empty.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-replace-key-0001");
    const completed = await service.execute({
      type: "set-health-checklist-items",
      businessDate: "2026-08-12",
      itemKeys: [itemA.itemKey],
      completed: true,
      expectedDayRevision: withA.revision,
    }, "health-complete-key-0001");

    const merged = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-and-future",
      name: "我的健康清单",
      changeNote: "加入早餐",
      items: [itemA, itemB],
      expectedTemplateRevision: 2,
      expectedDayRevision: completed.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-replace-key-0002");

    expect(merged.templateRevision).toBe(3);
    expect(merged.items).toEqual([
      expect.objectContaining({ itemKey: itemA.itemKey, completed: true }),
      expect.objectContaining({ itemKey: itemB.itemKey, completed: false, completedAt: null }),
    ]);
    expect(sqlite.prepare("select count(*) from health_checklist_versions").pluck().get()).toBe(3);
  });

  it("updates an already materialized future snapshot when today-and-future changes", async () => {
    const { sqlite, options, service } = setup();
    const today = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);
    await materializeHealthChecklistDay(sqlite, "2026-08-13", options);

    await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-and-future",
      name: "我的健康清单",
      changeNote: "今天起生效",
      items: [itemA],
      expectedTemplateRevision: 1,
      expectedDayRevision: today.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-future-version-key-0001");

    const future = await materializeHealthChecklistDay(sqlite, "2026-08-13", options);
    expect(future.templateRevision).toBe(2);
    expect(future.items).toEqual([
      expect.objectContaining({ itemKey: itemA.itemKey, completed: false }),
    ]);
  });

  it("keeps today-only edits out of template versions and confirms completed removals", async () => {
    const { sqlite, options, service } = setup();
    const empty = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);
    const day = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-only",
      name: "仅今天",
      changeNote: "",
      items: [itemA],
      expectedTemplateRevision: 1,
      expectedDayRevision: empty.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-today-key-0001");
    const completed = await service.execute({
      type: "set-health-checklist-items",
      businessDate: "2026-08-12",
      itemKeys: [itemA.itemKey],
      completed: true,
      expectedDayRevision: day.revision,
    }, "health-today-key-0002");

    await expect(service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-only",
      name: "仅今天",
      changeNote: "",
      items: [],
      expectedTemplateRevision: 1,
      expectedDayRevision: completed.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-today-key-0003")).rejects.toBeInstanceOf(HealthChecklistConflictError);

    const removed = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-only",
      name: "仅今天",
      changeNote: "",
      items: [],
      expectedTemplateRevision: 1,
      expectedDayRevision: completed.revision,
      confirmedRemovedCompletedItemKeys: [itemA.itemKey],
    }, "health-today-key-0004");

    expect(removed.items).toEqual([]);
    expect(sqlite.prepare("select count(*) from health_checklist_versions").pluck().get()).toBe(1);
    expect(sqlite.prepare("select event_type from audit_events").pluck().all()).toEqual([
      "health-checklist.completed-item-removed",
    ]);
  });

  it("changes only explicitly selected items and rejects future bulk completion", async () => {
    const { options, service, sqlite } = setup();
    const empty = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);
    const day = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-only",
      name: "今天",
      changeNote: "",
      items: [itemA, itemB],
      expectedTemplateRevision: 1,
      expectedDayRevision: empty.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-selected-key-0001");
    const selected = await service.execute({
      type: "set-health-checklist-items",
      businessDate: "2026-08-12",
      itemKeys: [itemB.itemKey],
      completed: true,
      expectedDayRevision: day.revision,
    }, "health-selected-key-0002");
    expect(selected.items.map((item) => [item.itemKey, item.completed])).toEqual([
      [itemA.itemKey, false],
      [itemB.itemKey, true],
    ]);

    const future = await materializeHealthChecklistDay(sqlite, "2026-08-13", options);
    await expect(service.execute({
      type: "set-health-checklist-items",
      businessDate: "2026-08-13",
      itemKeys: [itemA.itemKey],
      completed: true,
      expectedDayRevision: future.revision,
    }, "health-future-key-0001")).rejects.toBeInstanceOf(HealthChecklistConflictError);
  });

  it("revision-fences concurrent edits and rolls back the losing idempotency key", async () => {
    const { options, service, sqlite } = setup();
    const day = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);
    await service.execute({
      type: "save-health-checklist-note",
      businessDate: "2026-08-12",
      note: "先写入",
      expectedDayRevision: day.revision,
    }, "health-note-key-0001");
    await expect(service.execute({
      type: "save-health-checklist-note",
      businessDate: "2026-08-12",
      note: "过期写入",
      expectedDayRevision: day.revision,
    }, "health-note-key-0002")).rejects.toBeInstanceOf(HealthChecklistConflictError);
    expect(sqlite.prepare("select count(*) from idempotency_keys where key = ?").pluck().get("health-note-key-0002")).toBe(0);
  });

  it("keeps day-only tasks on the edited date while future days follow the template", async () => {
    const { sqlite, options, service } = setup();
    const itemC = {
      itemKey: "stretch-daily-0001",
      groupKey: "custom",
      groupLabel: "清单",
      name: "拉伸",
      targetText: "",
      note: "",
      ordinal: 2,
    } as const;
    const empty = await materializeHealthChecklistDay(sqlite, "2026-08-12", options);

    const withA = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-and-future",
      name: "我的健康清单",
      changeNote: "常驻维生素",
      items: [itemA],
      templateItemKeys: [itemA.itemKey],
      expectedTemplateRevision: 1,
      expectedDayRevision: empty.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-routine-key-0001");

    const withB = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-only",
      name: "我的健康清单",
      changeNote: "今日早餐",
      items: [itemA, itemB],
      expectedTemplateRevision: 2,
      expectedDayRevision: withA.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-today-key-0001");
    expect(withB.items.map((item) => item.itemKey)).toEqual([itemA.itemKey, itemB.itemKey]);

    // 再加一个常驻任务：当天的今日任务保留，模板里只有常驻项
    const withC = await service.execute({
      type: "replace-health-checklist",
      templateId: "health-default",
      businessDate: "2026-08-12",
      scope: "today-and-future",
      name: "我的健康清单",
      changeNote: "新增常驻拉伸",
      items: [itemA, itemB, itemC],
      templateItemKeys: [itemA.itemKey, itemC.itemKey],
      expectedTemplateRevision: 2,
      expectedDayRevision: withB.revision,
      confirmedRemovedCompletedItemKeys: [],
    }, "health-routine-key-0002");
    expect(withC.items.map((item) => item.itemKey)).toEqual([
      itemA.itemKey, itemB.itemKey, itemC.itemKey,
    ]);
    expect(withC.persistentItemKeys).toEqual([itemA.itemKey, itemC.itemKey]);

    const tomorrow = await materializeHealthChecklistDay(sqlite, "2026-08-13", options);
    expect(tomorrow.items.map((item) => item.itemKey)).toEqual([itemA.itemKey, itemC.itemKey]);
    expect(tomorrow.persistentItemKeys).toEqual([itemA.itemKey, itemC.itemKey]);
  });
});
