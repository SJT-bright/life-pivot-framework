import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { getHealthChecklistDay } from "./query";
import { materializeHealthChecklistDay } from "./service";

describe("health checklist query", () => {
  it("reads a structured-cloneable day without writing", async () => {
    const sqlite = new Database(":memory:");
    migrateDatabase(sqlite);
    try {
      await materializeHealthChecklistDay(sqlite, "2026-08-12", {
        now: () => new Date("2026-08-12T02:00:00.000Z"),
        createId: (prefix) => `${prefix}-query-0001`,
        writeBarrier: { runWrite: async <T>(action: () => T | Promise<T>) => action() },
      });
      const before = sqlite.prepare("select total_changes()").pluck().get();
      const day = getHealthChecklistDay(sqlite, { businessDate: "2026-08-12" });
      expect(day).toMatchObject({ businessDate: "2026-08-12", items: [] });
      expect(structuredClone(day)).toEqual(day);
      expect(sqlite.prepare("select total_changes()").pluck().get()).toBe(before);
    } finally {
      sqlite.close();
    }
  });
});
