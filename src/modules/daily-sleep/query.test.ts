import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { DailySleepValidationError } from "./contracts";
import { getDailySleepHistory, getDailySleepRecord } from "./query";
import { createDailySleepService } from "./service";

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
  for (const name of ["deep_sleep_minutes", "light_sleep_minutes", "rem_sleep_minutes", "morning_feeling"]) {
    if (!existing.has(name)) sqlite.exec(`alter table sleep_daily_records add column ${name} INTEGER`);
  }
  return sqlite;
}

describe("daily sleep queries", () => {
  it("returns a date record and newest-first bounded history without writes", async () => {
    const sqlite = setup();
    const service = createDailySleepService(sqlite, {
      now: () => new Date("2026-08-12T00:00:00.000Z"),
      writeBarrier: { runWrite: async <T>(action: () => T | Promise<T>) => action() },
    });
    for (const [index, recordDate] of ["2026-08-10", "2026-08-12", "2026-08-11"].entries()) {
      await service.execute({
        type: "save-daily-sleep",
        recordId: `sleep-record-000${index + 1}`,
        recordDate,
        asleepTime: "23:30",
        wakeTime: "07:00",
        confirmedDurationMinutes: null,
        deepSleepMinutes: 90,
        lightSleepMinutes: 270,
        remSleepMinutes: 90,
        morningFeeling: 4,
        qualityScore: 80 + index,
        qualityText: `记录 ${index + 1}`,
        note: "",
        expectedRevision: 0,
      }, `daily-query-key-000${index + 1}`);
    }
    const idempotencyCount = sqlite.prepare("select count(*) from idempotency_keys").pluck().get();

    expect(getDailySleepRecord(sqlite, { recordDate: "2026-08-11" })?.qualityText)
      .toBe("记录 3");
    const history = getDailySleepHistory(sqlite, { limit: 2 });
    expect(history.items.map((item) => item.recordDate))
      .toEqual(["2026-08-12", "2026-08-11"]);
    expect(history.items[0]).toMatchObject({
      deepSleepMinutes: 90,
      morningFeeling: 4,
      sleepVariabilityMinutes: 0,
    });
    expect(history.items[0]!.qualityScore).toBe(81);
    expect(sqlite.prepare("select count(*) from idempotency_keys").pluck().get()).toBe(idempotencyCount);
  });

  it("returns null for an empty valid date and rejects invalid inputs", () => {
    const sqlite = setup();
    expect(getDailySleepRecord(sqlite, { recordDate: "2026-08-12" })).toBeNull();
    expect(() => getDailySleepRecord(sqlite, { recordDate: "2026-02-30" }))
      .toThrow(DailySleepValidationError);
    expect(() => getDailySleepHistory(sqlite, { limit: 0 })).toThrow(DailySleepValidationError);
    expect(() => getDailySleepHistory(sqlite, { limit: 101 })).toThrow(DailySleepValidationError);
  });
});
