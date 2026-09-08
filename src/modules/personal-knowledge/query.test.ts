import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { PersonalKnowledgeValidationError } from "./contracts";
import { getPersonalKnowledgeSnapshot } from "./query";

const databases: Database.Database[] = [];

function setup(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  return sqlite;
}

function insertModule(
  sqlite: Database.Database,
  moduleId: string,
  parentModuleId: string | null,
  ordinal: number,
): void {
  sqlite.prepare(`insert into knowledge_modules
    (module_id, parent_module_id, name, goal, current_focus, description, status,
     ordinal, revision, created_at, updated_at)
    values (?, ?, ?, '', '', '', 'learning', ?, 1, ?, ?)`)
    .run(moduleId, parentModuleId, moduleId, ordinal, "2026-08-13T00:00:00.000Z", "2026-08-13T00:00:00.000Z");
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("personal knowledge snapshot query", () => {
  it("reads a bounded, stable hierarchy/date/item snapshot without writes", () => {
    const sqlite = setup();
    insertModule(sqlite, "module-root-b", null, 0);
    insertModule(sqlite, "module-root-a", null, 0);
    insertModule(sqlite, "module-child-a", "module-root-a", 0);
    sqlite.prepare(`insert into daily_learning_notes
      (note_id, business_date, title, module_id, content, source, personal_understanding,
       open_questions, application, status, revision, created_at, updated_at)
      values (?, '2026-08-13', ?, 'module-root-a', ?, '', '', '', '', 'active', 1, ?, ?)`)
      .run("daily-note-old", "Old", "Old content", "2026-08-13T00:00:00.000Z", "2026-08-13T01:00:00.000Z");
    sqlite.prepare(`insert into daily_learning_notes
      (note_id, business_date, title, module_id, content, source, personal_understanding,
       open_questions, application, status, revision, created_at, updated_at)
      values (?, '2026-08-13', ?, 'module-root-a', ?, '', '', '', '', 'active', 1, ?, ?)`)
      .run("daily-note-new", "New", "New content", "2026-08-13T00:00:00.000Z", "2026-08-13T02:00:00.000Z");
    const changesBefore = sqlite.prepare("select total_changes()").pluck().get();

    const first = getPersonalKnowledgeSnapshot(sqlite, {
      businessDate: "2026-08-13",
      noteLimit: 1,
    });
    const second = getPersonalKnowledgeSnapshot(sqlite, {
      businessDate: "2026-08-13",
      noteLimit: 1,
    });

    expect(first).toEqual(second);
    expect(first.modules.map((module) => module.moduleId)).toEqual([
      "module-root-a",
      "module-child-a",
      "module-root-b",
    ]);
    expect(first.dailyNotes.map((note) => note.noteId)).toEqual(["daily-note-new"]);
    expect(sqlite.prepare("select total_changes()").pluck().get()).toBe(changesBefore);
  });

  it("rejects invalid dates and unsafe or out-of-range limits", () => {
    const sqlite = setup();
    for (const input of [
      { businessDate: "2026-02-30" },
      { businessDate: "2026-08-13", noteLimit: 0 },
      { businessDate: "2026-08-13", noteLimit: 101 },
    ]) {
      expect(() => getPersonalKnowledgeSnapshot(sqlite, input)).toThrow(PersonalKnowledgeValidationError);
    }
  });
});
