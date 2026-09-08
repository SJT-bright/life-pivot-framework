import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { parseWisdomReminderCommand, WisdomReminderValidationError } from "./contracts";
import { listWisdomReminders } from "./query";
import { WisdomReminderConflictError, createWisdomReminderService } from "./service";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function createDatabase(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  return sqlite;
}

function createService(sqlite: Database.Database) {
  let id = 0;
  return createWisdomReminderService(sqlite, {
    now: () => new Date("2026-09-05T10:00:00.000Z"),
    createId: () => `audit-wisdom-${++id}`,
    writeBarrier: { runWrite: async <T>(write: () => T | Promise<T>) => await write() },
  });
}

const createCommand = {
  type: "create-wisdom-reminder" as const,
  reminderId: "wisdom-reminder-01",
  content: "先处理情绪，再处理事情。",
  context: "无意间听到的；以后遇事先停三秒。",
};

describe("wisdom reminder contracts", () => {
  it("parses create, update, and archive commands strictly", () => {
    expect(parseWisdomReminderCommand(createCommand)).toEqual(createCommand);
    expect(parseWisdomReminderCommand({
      type: "update-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      content: "改后的一句话",
      context: "",
      expectedRevision: 1,
    }).type).toBe("update-wisdom-reminder");
    expect(parseWisdomReminderCommand({
      type: "archive-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      expectedRevision: 2,
    }).type).toBe("archive-wisdom-reminder");
  });

  it("rejects empty content, oversized context, short ids, and bad revisions", () => {
    for (const command of [
      { ...createCommand, content: "   " },
      { ...createCommand, content: "字".repeat(501) },
      { ...createCommand, context: "字".repeat(2001) },
      { ...createCommand, reminderId: "short" },
      { type: "update-wisdom-reminder", reminderId: "wisdom-reminder-01", content: "x", context: "", expectedRevision: 0 },
      { type: "archive-wisdom-reminder", reminderId: "wisdom-reminder-01", expectedRevision: 0 },
    ]) {
      expect(() => parseWisdomReminderCommand(command)).toThrow(WisdomReminderValidationError);
    }
  });
});

describe("wisdom reminder service", () => {
  it("creates a reminder, audits it, and lists it first", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    const created = await service.execute(createCommand, "wisdom-create-key-0001");

    expect(created).toMatchObject({
      id: "wisdom-reminder-01",
      content: "先处理情绪，再处理事情。",
      context: "无意间听到的；以后遇事先停三秒。",
      archivedAt: null,
      revision: 1,
    });
    expect(listWisdomReminders(sqlite)).toHaveLength(1);
    expect(sqlite.prepare(
      "select event_type from audit_events where resource_type = 'wisdom_reminder'",
    ).pluck().get()).toBe("created");
  });

  it("updates and archives with compare-and-swap, hiding archived from list", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    await service.execute(createCommand, "wisdom-create-key-0001");

    const updated = await service.execute({
      type: "update-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      content: "改后的提醒",
      context: "",
      expectedRevision: 1,
    }, "wisdom-update-key-0001");
    expect(updated).toMatchObject({ content: "改后的提醒", revision: 2 });

    const archived = await service.execute({
      type: "archive-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      expectedRevision: 2,
    }, "wisdom-archive-key-0001");
    expect(archived.archivedAt).not.toBeNull();
    expect(listWisdomReminders(sqlite)).toHaveLength(0);
  });

  it("rejects duplicate ids, stale revisions, unknown ids, and replays exactly", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    await service.execute(createCommand, "wisdom-create-key-0001");

    await expect(service.execute(createCommand, "wisdom-create-key-0002"))
      .rejects.toBeInstanceOf(WisdomReminderConflictError);
    await expect(service.execute({
      type: "update-wisdom-reminder",
      reminderId: "wisdom-reminder-01",
      content: "stale",
      context: "",
      expectedRevision: 9,
    }, "wisdom-update-key-0002")).rejects.toBeInstanceOf(WisdomReminderConflictError);
    await expect(service.execute({
      type: "archive-wisdom-reminder",
      reminderId: "wisdom-unknown-01",
      expectedRevision: 1,
    }, "wisdom-archive-key-0002")).rejects.toBeInstanceOf(WisdomReminderConflictError);

    const replay = await service.execute(createCommand, "wisdom-create-key-0001");
    expect(replay).toMatchObject({ id: "wisdom-reminder-01" });
    expect(sqlite.prepare("select count(*) from wisdom_reminders").pluck().get()).toBe(1);
  });
});
