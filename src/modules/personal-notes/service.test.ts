import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";
import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";

import { PersonalNoteConflictError, PersonalNoteDateOccupiedError, PersonalNoteMoveBlockedError, createPersonalNotesService } from "./service";

const databases: Database.Database[] = [];
const baseCommand = {
  type: "save-personal-daily-note" as const,
  noteId: "note-20260812",
  businessDate: "2026-08-12",
  content: "今天整体推进顺利",
  expectedRevision: 0,
};

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
  return createPersonalNotesService(sqlite, {
    now: () => new Date("2026-08-12T10:00:00.000Z"),
    createId: () => `audit-note-${++id}`,
    writeBarrier: { runWrite: async <T>(write: () => T | Promise<T>) => await write() },
  });
}

describe("personal notes service", () => {
  it("creates one note and writes an audit event", async () => {
    const sqlite = createDatabase();
    const result = await createService(sqlite).save(baseCommand, "personal-note-key-0001");

    expect(result).toEqual({
      id: "note-20260812",
      businessDate: "2026-08-12",
      content: "今天整体推进顺利",
      revision: 1,
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    });
    expect(sqlite.prepare(
      "select event_type, resource_type, resource_id from audit_events",
    ).get()).toEqual({
      event_type: "created",
      resource_type: "personal_daily_note",
      resource_id: "note-20260812",
    });
  });

  it("updates with compare-and-swap and accepts empty content as a cleared note", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    await service.save(baseCommand, "personal-note-key-0001");

    const updated = await service.save({
      ...baseCommand,
      content: "",
      expectedRevision: 1,
    }, "personal-note-key-0002");

    expect(updated.content).toBe("");
    expect(updated.revision).toBe(2);
    expect(sqlite.prepare("select count(*) from personal_daily_notes").pluck().get()).toBe(1);
  });

  it("returns the exact stored result for an exact idempotent replay", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    const first = await service.save(baseCommand, "personal-note-key-0001");
    const replay = await service.save(baseCommand, "personal-note-key-0001");

    expect(replay).toEqual(first);
    expect(sqlite.prepare("select count(*) from personal_daily_notes").pluck().get()).toBe(1);
    expect(sqlite.prepare("select count(*) from audit_events").pluck().get()).toBe(1);
  });

  it("rejects a reused key with different bytes", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    await service.save(baseCommand, "personal-note-key-0001");

    await expect(service.save({ ...baseCommand, content: "冲突" }, "personal-note-key-0001"))
      .rejects.toBeInstanceOf(IdempotentCommandConflictError);
  });

  it("rejects stale updates and a second note identifier for the same date", async () => {
    const sqlite = createDatabase();
    const service = createService(sqlite);
    await service.save(baseCommand, "personal-note-key-0001");

    await expect(service.save({ ...baseCommand, content: "stale" }, "personal-note-key-0002"))
      .rejects.toBeInstanceOf(PersonalNoteConflictError);
    await expect(service.save({
      ...baseCommand,
      noteId: "note-duplicate-1",
    }, "personal-note-key-0003")).rejects.toBeInstanceOf(PersonalNoteConflictError);
  });
});

describe("personal notes move", () => {
  const moveCommand = {
    type: "move-personal-daily-note" as const,
    noteId: "note-20260812",
    fromBusinessDate: "2026-08-12",
    toBusinessDate: "2026-08-11",
    expectedRevision: 1,
  };

  async function prepare(sqlite: Database.Database): Promise<ReturnType<typeof createService>> {
    const service = createService(sqlite);
    await service.save(baseCommand, "personal-note-key-0001");
    return service;
  }

  it("moves a note to another date, bumps revision, and audits the move", async () => {
    const sqlite = createDatabase();
    const service = await prepare(sqlite);

    const moved = await service.move(moveCommand, "personal-move-key-0001");

    expect(moved).toEqual({
      id: "note-20260812",
      businessDate: "2026-08-11",
      content: "今天整体推进顺利",
      revision: 2,
      createdAt: "2026-08-12T10:00:00.000Z",
      updatedAt: "2026-08-12T10:00:00.000Z",
    });
    expect(sqlite.prepare(
      "select count(*) from personal_daily_notes where business_date = '2026-08-12'",
    ).pluck().get()).toBe(0);
    const auditPayload = JSON.parse(sqlite.prepare(
      "select payload_json from audit_events where event_type = 'moved'",
    ).pluck().get() as string);
    expect(auditPayload).toEqual({ movedFrom: "2026-08-12", note: moved });
  });

  it("replays an identical move idempotently without another audit event", async () => {
    const sqlite = createDatabase();
    const service = await prepare(sqlite);
    const first = await service.move(moveCommand, "personal-move-key-0001");

    const replay = await service.move(moveCommand, "personal-move-key-0001");

    expect(replay).toEqual(first);
    expect(sqlite.prepare("select count(*) from audit_events where event_type = 'moved'").pluck().get()).toBe(1);
  });

  it("rejects moving onto a date that already has a note", async () => {
    const sqlite = createDatabase();
    const service = await prepare(sqlite);
    await service.save({ ...baseCommand, noteId: "note-20260811", businessDate: "2026-08-11" }, "personal-note-key-0002");

    await expect(service.move(moveCommand, "personal-move-key-0002"))
      .rejects.toBeInstanceOf(PersonalNoteDateOccupiedError);
  });

  it("rejects stale revisions, unknown notes, same-date moves, and future dates", async () => {
    const sqlite = createDatabase();
    const service = await prepare(sqlite);

    await expect(service.move({ ...moveCommand, expectedRevision: 9 }, "personal-move-key-0003"))
      .rejects.toBeInstanceOf(PersonalNoteConflictError);
    await expect(service.move({ ...moveCommand, noteId: "note-unknown-01" }, "personal-move-key-0004"))
      .rejects.toBeInstanceOf(PersonalNoteConflictError);
    await expect(service.move({ ...moveCommand, toBusinessDate: "2026-08-12" }, "personal-move-key-0005"))
      .rejects.toBeInstanceOf(PersonalNoteMoveBlockedError);
    await expect(service.move({ ...moveCommand, toBusinessDate: "2026-08-13" }, "personal-move-key-0006"))
      .rejects.toBeInstanceOf(PersonalNoteMoveBlockedError);
    expect(sqlite.prepare("select business_date from personal_daily_notes").pluck().get()).toBe("2026-08-12");
  });
});
