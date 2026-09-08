import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { getPersonalDailyNote, listPersonalDailyNotes } from "./query";

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

describe("getPersonalDailyNote", () => {
  it("returns null for an empty date and maps the stored note", () => {
    const sqlite = createDatabase();
    expect(getPersonalDailyNote(sqlite, { businessDate: "2026-08-12" })).toBeNull();

    sqlite.prepare(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?)`)
      .run("note-20260812", "2026-08-12", "整体备注", 2,
        "2026-08-12T01:00:00.000Z", "2026-08-12T02:00:00.000Z");

    expect(getPersonalDailyNote(sqlite, { businessDate: "2026-08-12" })).toEqual({
      id: "note-20260812",
      businessDate: "2026-08-12",
      content: "整体备注",
      revision: 2,
      createdAt: "2026-08-12T01:00:00.000Z",
      updatedAt: "2026-08-12T02:00:00.000Z",
    });
  });

  it("rejects an invalid business date", () => {
    expect(() => getPersonalDailyNote(createDatabase(), { businessDate: "2026-02-30" }))
      .toThrow("Invalid personal note business date");
  });
});

describe("listPersonalDailyNotes", () => {
  it("returns notes ordered by business date descending with a limit", () => {
    const sqlite = createDatabase();
    const insert = sqlite.prepare(`insert into personal_daily_notes
      (id, business_date, content, revision, created_at, updated_at)
      values (?, ?, ?, 1, ?, ?)`);
    for (const [index, date] of ["2026-08-10", "2026-08-11", "2026-08-12"].entries()) {
      insert.run(`note-${index}`, date, `复盘 ${index}`, date, date);
    }

    expect(listPersonalDailyNotes(sqlite).map((note) => note.businessDate))
      .toEqual(["2026-08-12", "2026-08-11", "2026-08-10"]);
    expect(listPersonalDailyNotes(sqlite, { limit: 2 }).map((note) => note.businessDate))
      .toEqual(["2026-08-12", "2026-08-11"]);
    expect(listPersonalDailyNotes(createDatabase())).toEqual([]);
  });
});
