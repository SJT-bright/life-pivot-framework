import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { createWeeklyReviewService } from "./service";

const databases: Database.Database[] = [];
afterEach(() => { for (const sqlite of databases.splice(0)) sqlite.close(); });

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  return sqlite;
}

describe("weekly review commands", () => {
  it("creates, replays, and revises only plain weekly prose with immutable snapshots", async () => {
    const sqlite = setup();
    let sequence = 0;
    const service = createWeeklyReviewService(sqlite, {
      now: () => new Date("2026-08-13T00:00:00.000Z"),
      createId: (prefix) => `${prefix}-${++sequence}`,
    });
    const create = { type: "save-weekly-summary" as const, periodStart: "2026-08-03", periodEndExclusive: "2026-08-10", content: "First prose", expectedRevision: null };
    const first = await service.execute(create, "weekly-key-00000001");
    const replay = await service.execute(create, "weekly-key-00000001");
    expect(replay).toEqual(first);
    expect(first.summary).toEqual({ content: "First prose", revision: 1, updatedAt: "2026-08-13T00:00:00.000Z" });
    const changed = await service.execute({ ...create, content: "Second prose", expectedRevision: 1 }, "weekly-key-00000002");
    expect(changed.summary?.revision).toBe(2);
    expect(sqlite.prepare("select count(*) from review_revisions").pluck().get()).toBe(2);
    await expect(service.execute({ ...create, content: "stale", expectedRevision: 1 }, "weekly-key-00000003")).rejects.toThrow();
    expect(sqlite.prepare("select content from reviews").pluck().get()).toBe("Second prose");
  });

  it("validates live pin targets and changes only an exact target pair", async () => {
    const sqlite = setup();
    sqlite.prepare("insert into knowledge_modules values (?, null, ?, '', '', '', 'learning', 0, 1, ?, ?)")
      .run("module-live", "Live", "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
    const service = createWeeklyReviewService(sqlite, { now: () => new Date("2026-08-13T00:00:00.000Z") });
    const period = { periodStart: "2026-08-10", periodEndExclusive: "2026-08-17" };
    const pinned = await service.execute({ type: "pin-review-target", targetType: "knowledge-module", targetId: "module-live", ...period }, "weekly-key-00000004");
    expect(pinned).toMatchObject(period);
    await service.execute({ type: "unpin-review-target", targetType: "knowledge-module", targetId: "module-live", ...period }, "weekly-key-00000005");
    expect(sqlite.prepare("select count(*) from user_pins").pluck().get()).toBe(0);
    await expect(service.execute({ type: "pin-review-target", targetType: "knowledge-module", targetId: "missing", ...period }, "weekly-key-00000006")).rejects.toThrow();

    sqlite.prepare("insert into manual_skincare_recovery_plans values (?, ?, '', 1, ?, ?)")
      .run("manual-skin-plan", "恢复计划", "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
    await expect(service.execute({ type: "pin-review-target", targetType: "skincare-plan", targetId: "manual-skin-plan", ...period }, "weekly-key-00000007"))
      .resolves.toMatchObject(period);
  });
});
