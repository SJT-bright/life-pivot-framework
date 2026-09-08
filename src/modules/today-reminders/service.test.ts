import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { listIncompletePastReminders, listTodayReminders } from "./query";
import { TodayReminderConflictError, createTodayRemindersService } from "./service";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function createDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite, { applicationVersion: "0.2.0" });
  return sqlite;
}

function createService(sqlite: Database.Database) {
  let auditId = 0;
  return createTodayRemindersService(sqlite, {
    now: () => new Date("2026-08-28T07:00:00.000Z"),
    createId: () => `audit-reminder-${++auditId}`,
    writeBarrier: { runWrite: async <T>(write: () => T | Promise<T>) => await write() },
  });
}

describe("today reminders service", () => {
  it("adds, sorts, completes, and audits reminders", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    await service.execute({
      type: "add-today-reminder",
      reminderId: "reminder-later",
      businessDate: "2026-08-28",
      title: "五点开会",
      scheduledTime: "17:00",
    }, "today-reminder-key-0001");
    await service.execute({
      type: "add-today-reminder",
      reminderId: "reminder-earlier",
      businessDate: "2026-08-28",
      title: "三点准备材料",
      scheduledTime: "15:00",
    }, "today-reminder-key-0002");

    const before = listTodayReminders(sqlite, { businessDate: "2026-08-28" });
    expect(before.map((item) => item.id)).toEqual(["reminder-earlier", "reminder-later"]);

    const { reminder: completed } = await service.execute({
      type: "set-today-reminder-completed",
      reminderId: "reminder-earlier",
      completed: true,
      expectedRevision: before[0]!.revision,
    }, "today-reminder-key-0003");
    expect(completed).toMatchObject({ completed: true, revision: 2 });
    expect(completed.completedAt).toBe("2026-08-28T07:00:00.000Z");
    expect(listTodayReminders(sqlite, { businessDate: "2026-08-28" })[0]?.id)
      .toBe("reminder-later");
    expect(sqlite.prepare("select event_type from audit_events order by rowid").pluck().all())
      .toEqual(["created", "created", "completed"]);
  });

  it("replays identical requests and rejects stale revisions", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    const command = {
      type: "add-today-reminder" as const,
      reminderId: "reminder-replay",
      businessDate: "2026-08-28",
      title: "带电脑",
      scheduledTime: null,
    };
    const firstResult = await service.execute(command, "today-reminder-key-0010");
    const first = firstResult.reminder;
    expect(await service.execute(command, "today-reminder-key-0010")).toEqual(firstResult);
    await service.execute({
      type: "set-today-reminder-completed",
      reminderId: first.id,
      completed: true,
      expectedRevision: first.revision,
    }, "today-reminder-key-0011");
    await expect(service.execute({
      type: "set-today-reminder-completed",
      reminderId: first.id,
      completed: false,
      expectedRevision: first.revision,
    }, "today-reminder-key-0012")).rejects.toBeInstanceOf(TodayReminderConflictError);
  });

  it("lists only unfinished reminders before today, newest date first", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    const inputs = [
      ["past-older", "2026-08-26", null],
      ["past-late", "2026-08-27", "17:00"],
      ["past-early", "2026-08-27", "09:00"],
      ["today", "2026-08-28", "08:00"],
      ["past-completed", "2026-08-25", null],
    ] as const;
    for (const [id, businessDate, scheduledTime] of inputs) {
      await service.execute({
        type: "add-today-reminder",
        reminderId: id,
        businessDate,
        title: id,
        scheduledTime,
      }, `today-reminder-history-${id}`);
    }
    const completedCandidate = listTodayReminders(sqlite, { businessDate: "2026-08-25" })[0]!;
    await service.execute({
      type: "set-today-reminder-completed",
      reminderId: completedCandidate.id,
      completed: true,
      expectedRevision: completedCandidate.revision,
    }, "today-reminder-history-complete");

    expect(listIncompletePastReminders(sqlite, {
      beforeBusinessDate: "2026-08-28",
    }).map((item) => item.id)).toEqual(["past-early", "past-late", "past-older"]);
  });

  it("claims an alert exactly once when a timed reminder is due", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    const { reminder } = await service.execute({
      type: "add-today-reminder",
      reminderId: "reminder-due-now",
      businessDate: "2026-08-28",
      title: "三点开会",
      scheduledTime: "15:00",
    }, "today-reminder-key-0030");

    const claimed = await service.execute({
      type: "claim-today-reminder-alert",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
    }, "today-reminder-key-0031");
    expect(claimed.alertClaimed).toBe(true);
    expect(claimed.reminder.alertedAt).toBe("2026-08-28T07:00:00.000Z");

    const duplicate = await service.execute({
      type: "claim-today-reminder-alert",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
    }, "today-reminder-key-0032");
    expect(duplicate.alertClaimed).toBe(false);
    expect(sqlite.prepare(`select count(*) from audit_events
      where resource_type = 'today_reminder' and resource_id = ? and event_type = 'alerted'`)
      .pluck().get(reminder.id)).toBe(1);
  });

  it("does not claim early, untimed, completed, or previous-day reminders", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    const inputs = [
      ["reminder-future", "2026-08-28", "17:00"],
      ["reminder-untimed", "2026-08-28", null],
      ["reminder-yesterday", "2026-08-27", "14:00"],
    ] as const;
    for (const [id, businessDate, scheduledTime] of inputs) {
      const { reminder } = await service.execute({
        type: "add-today-reminder",
        reminderId: id,
        businessDate,
        title: id,
        scheduledTime,
      }, `today-reminder-add-${id}`);
      const result = await service.execute({
        type: "claim-today-reminder-alert",
        reminderId: reminder.id,
        expectedRevision: reminder.revision,
      }, `today-reminder-claim-${id}`);
      expect(result.alertClaimed).toBe(false);
    }

    const { reminder: completedCandidate } = await service.execute({
      type: "add-today-reminder",
      reminderId: "reminder-completed",
      businessDate: "2026-08-28",
      title: "已经完成",
      scheduledTime: "14:00",
    }, "today-reminder-key-0040");
    const { reminder: completed } = await service.execute({
      type: "set-today-reminder-completed",
      reminderId: completedCandidate.id,
      completed: true,
      expectedRevision: completedCandidate.revision,
    }, "today-reminder-key-0041");
    const result = await service.execute({
      type: "claim-today-reminder-alert",
      reminderId: completed.id,
      expectedRevision: completed.revision,
    }, "today-reminder-key-0042");
    expect(result.alertClaimed).toBe(false);
  });
});
