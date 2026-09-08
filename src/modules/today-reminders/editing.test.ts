import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { listTodayReminders } from "./query";
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

async function seedReminder(sqlite: Database.Database) {
  const service = createService(sqlite);
  const { reminder } = await service.execute({
    type: "add-today-reminder",
    reminderId: "reminder-editable",
    businessDate: "2026-08-28",
    title: "五点开会",
    scheduledTime: "17:00",
  }, "reminder-edit-key-0001");
  return { service, reminder: reminder! };
}

describe("today reminder editing commands", () => {
  it("updates title and time with a revision bump and audit event", async () => {
    const sqlite = createDatabase();
    const { service, reminder } = await seedReminder(sqlite);

    const { reminder: updated } = await service.execute({
      type: "update-today-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
      title: "五点半开会",
      scheduledTime: "17:30",
    }, "reminder-edit-key-0002");

    expect(updated).toMatchObject({
      title: "五点半开会",
      scheduledTime: "17:30",
      revision: 2,
    });
    const audit = sqlite
      .prepare("select event_type from audit_events where event_type = 'updated'")
      .get();
    expect(audit).toBeDefined();
  });

  it("rejects stale revisions on update", async () => {
    const sqlite = createDatabase();
    const { service, reminder } = await seedReminder(sqlite);

    await expect(service.execute({
      type: "update-today-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision + 5,
      title: "改时间",
      scheduledTime: null,
    }, "reminder-edit-key-0003")).rejects.toThrowError(TodayReminderConflictError);
  });

  it("deletes a reminder and keeps a deleted audit snapshot", async () => {
    const sqlite = createDatabase();
    const { service, reminder } = await seedReminder(sqlite);

    const { reminder: deleted } = await service.execute({
      type: "delete-today-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
    }, "reminder-edit-key-0004");

    expect(deleted.title).toBe("五点开会");
    expect(listTodayReminders(sqlite, { businessDate: "2026-08-28" })).toHaveLength(0);
    expect(
      sqlite.prepare("select resource_id from audit_events where event_type = 'deleted'").get(),
    ).toMatchObject({ resource_id: reminder.id });
  });

  it("reschedules a reminder to another date as completed plus a fresh copy", async () => {
    const sqlite = createDatabase();
    const { service, reminder } = await seedReminder(sqlite);

    const { reminder: original, createdReminder } = await service.execute({
      type: "reschedule-today-reminder",
      reminderId: reminder.id,
      expectedRevision: reminder.revision,
      toBusinessDate: "2026-08-29",
    }, "reminder-edit-key-0005");

    expect(original).toMatchObject({ completed: true, revision: 2 });
    expect(createdReminder).toMatchObject({
      businessDate: "2026-08-29",
      title: "五点开会",
      scheduledTime: "17:00",
      completed: false,
      revision: 1,
    });
    expect(listTodayReminders(sqlite, { businessDate: "2026-08-28" }))
      .toHaveLength(1);
    expect(listTodayReminders(sqlite, { businessDate: "2026-08-29" }))
      .toHaveLength(1);
    expect(
      sqlite.prepare("select event_type from audit_events where event_type = 'rescheduled'").get(),
    ).toBeDefined();
  });
});
