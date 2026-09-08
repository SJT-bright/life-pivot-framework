import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import {
  DailySleepConflictError,
  createDailySleepService,
} from "./service";
import { calculateSleepMinutes } from "./duration";

const databases: Database.Database[] = [];

afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close();
});

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  const existing = new Set((sqlite.prepare("pragma table_info(sleep_daily_records)").all() as Array<{ name: string }>)
    .map((column) => column.name));
  for (const [name, definition] of [
    ["deep_sleep_minutes", "INTEGER"],
    ["light_sleep_minutes", "INTEGER"],
    ["rem_sleep_minutes", "INTEGER"],
    ["morning_feeling", "INTEGER"],
  ] as const) {
    if (!existing.has(name)) sqlite.exec(`alter table sleep_daily_records add column ${name} ${definition}`);
  }
  const service = createDailySleepService(sqlite, {
    now: () => new Date("2026-08-12T01:02:03.000Z"),
    writeBarrier: { runWrite: async <T>(action: () => T | Promise<T>) => action() },
  });
  return { sqlite, service };
}

const createCommand = {
  type: "save-daily-sleep",
  recordId: "sleep-record-0001",
  recordDate: "2026-08-12",
  asleepTime: "23:30",
  wakeTime: "07:00",
  confirmedDurationMinutes: 0,
  deepSleepMinutes: 0,
  lightSleepMinutes: 0,
  remSleepMinutes: 0,
  morningFeeling: 4,
  qualityScore: 88,
  qualityText: "主观精神尚可",
  note: "第一次记录",
  expectedRevision: 0,
} as const;

describe("calculateSleepMinutes", () => {
  it.each([
    ["23:30", "07:00", 450],
    ["07:00", "07:00", 0],
    ["07:00", "06:59", 1439],
  ])("calculates %s to %s", (asleepTime, wakeTime, expected) => {
    expect(calculateSleepMinutes(asleepTime, wakeTime)).toBe(expected);
  });
});

describe("DailySleepService", () => {
  it("stores the manually entered score without overwriting the legacy text column", async () => {
    const { service } = setup();
    const { qualityText: _legacyQualityText, ...modernCommand } = createCommand;

    const created = await service.execute(modernCommand, "daily-sleep-modern-key-0001");

    expect(created.qualityText).toBe("未记录主观评价");
    expect(created.qualityScore).toBe(88);
  });

  it("creates, replays exact bytes, and preserves explicit zero duration", async () => {
    const { sqlite, service } = setup();
    const first = await service.execute(createCommand, "daily-sleep-key-0001");
    const replay = await service.execute(createCommand, "daily-sleep-key-0001");

    expect(first).toMatchObject({
      id: "sleep-record-0001",
      recordDate: "2026-08-12",
      asleepTime: "23:30",
      wakeTime: "07:00",
      calculatedDurationMinutes: 450,
      confirmedDurationMinutes: 0,
      finalDurationMinutes: 0,
      deepSleepMinutes: 0,
      lightSleepMinutes: 0,
      remSleepMinutes: 0,
      morningFeeling: 4,
      sleepVariabilityMinutes: null,
      note: "第一次记录",
      revision: 1,
      createdAt: "2026-08-12T01:02:03.000Z",
      updatedAt: "2026-08-12T01:02:03.000Z",
    });
    expect(first.qualityScore).toBe(88);
    expect(first.qualityText).toBe("主观精神尚可");
    expect(first.score.disclaimer).toContain("非医疗诊断");
    expect(replay).toEqual(first);
    expect(sqlite.prepare("select count(*) from sleep_daily_records").pluck().get()).toBe(1);
  });

  it("updates only at the current revision and keeps stable identity", async () => {
    const { sqlite, service } = setup();
    const created = await service.execute(createCommand, "daily-sleep-key-0002");
    const { qualityText: _legacyQualityText, ...modernCommand } = createCommand;
    const updated = await service.execute({
      ...modernCommand,
      wakeTime: "07:15",
      confirmedDurationMinutes: null,
      note: "已修正",
      qualityScore: 93,
      expectedRevision: 1,
    }, "daily-sleep-key-0003");

    expect(updated).toMatchObject({
      id: created.id,
      calculatedDurationMinutes: 465,
      finalDurationMinutes: 465,
      note: "已修正",
      qualityScore: 93,
      qualityText: "主观精神尚可",
      revision: 2,
      createdAt: created.createdAt,
    });
    await expect(service.execute({
      ...createCommand,
      qualityText: "过期写入",
      expectedRevision: 1,
    }, "daily-sleep-key-0004")).rejects.toBeInstanceOf(DailySleepConflictError);
    expect(sqlite.prepare("select quality_text from sleep_daily_records").pluck().get()).toBe("主观精神尚可");
    expect(sqlite.prepare("select manual_quality_score from sleep_daily_records").pluck().get()).toBe(93);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(2);
  });

  it("conflicts on reused keys with changed content and duplicate date ownership", async () => {
    const { service } = setup();
    await service.execute(createCommand, "daily-sleep-key-0005");
    await expect(service.execute({ ...createCommand, note: "不同内容" }, "daily-sleep-key-0005"))
      .rejects.toThrow();
    await expect(service.execute({
      ...createCommand,
      recordId: "sleep-record-0002",
    }, "daily-sleep-key-0006")).rejects.toBeInstanceOf(DailySleepConflictError);
  });

});
