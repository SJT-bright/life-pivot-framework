import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { parseSearchQuery, searchEverything } from "./search";

const databases: Database.Database[] = [];

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  const timestamp = "2026-08-30T10:00:00.000Z";
  sqlite.prepare(
    `insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
     values ('capture-hit-0001', 'capture', null, '2026-08-30', ?, '学习 SQLite 索引优化', ?)`,
  ).run(timestamp, timestamp);
  sqlite.prepare(
    `insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
     values ('capture-void-0001', 'void', 'capture-hit-0001', '2026-08-30', ?, '已作废', ?)`,
  ).run(timestamp, timestamp);
  sqlite.prepare(
    `insert into capture_items
      (id, event_type, corrects_item_id, business_date, occurred_at, content, created_at)
     values ('capture-clean-0002', 'capture', null, '2026-08-30', ?, '喝水两升打卡', ?)`,
  ).run(timestamp, timestamp);
  sqlite.prepare(
    `insert into knowledge_modules
      (module_id, parent_module_id, name, goal, current_focus, description, status, ordinal, revision, created_at, updated_at)
     values ('module-search-0001', null, '系统设计', '', '', '', 'learning', 0, 1, ?, ?)`,
  ).run(timestamp, timestamp);
  sqlite.prepare(
    `insert into daily_learning_notes
      (note_id, business_date, title, module_id, content, source, personal_understanding, open_questions, application, status, revision, created_at, updated_at)
     values ('note-search-0001', '2026-08-30', '索引原理', 'module-search-0001', 'B 树索引把查找变成对数级', '', '', '', '', 'active', 1, ?, ?)`,
  ).run(timestamp, timestamp);
  sqlite.prepare(
    `insert into health_checklist_templates
      (id, name, current_revision, created_at, updated_at)
     values ('health-template-0001', '每日健康', 1, ?, ?)`,
  ).run(timestamp, timestamp);
  sqlite.prepare(
    `insert into health_checklist_versions
      (id, template_id, revision, effective_from, change_note, created_at)
     values ('health-version-0001', 'health-template-0001', 1, '2026-08-01', '', ?)`,
  ).run(timestamp);
  sqlite.prepare(
    `insert into health_checklist_days
      (id, business_date, note, template_version_id, revision, created_at, updated_at)
     values ('health-day-0001', '2026-08-30', '', 'health-version-0001', 1, ?, ?)`,
  ).run(timestamp, timestamp);
  sqlite.prepare(
    `insert into health_checklist_day_items
      (id, day_id, item_key, group_key, group_label, name, target_text, note, ordinal, completed, completed_at)
     values ('health-item-0001', 'health-day-0001', 'water', 'base', '基础', '喝水2L', '', '', 0, 1, ?)`,
  ).run(timestamp);
  return sqlite;
}

describe("search module", () => {
  it("finds text across captures, learning notes, and health items", () => {
    const sqlite = setup();

    const learning = searchEverything(sqlite, { query: "索引", tag: null });
    expect(learning.hits.map((hit) => hit.type)).toContain("learning");

    const capture = searchEverything(sqlite, { query: "打卡", tag: null });
    expect(capture.hits.map((hit) => hit.type)).toContain("capture");

    const health = searchEverything(sqlite, { query: "喝水", tag: null });
    expect(health.hits.map((hit) => hit.type)).toContain("health");
    expect(health.hits.find((hit) => hit.type === "health")?.title).toBe("喝水2L");
  });

  it("never returns a voided capture", () => {
    const sqlite = setup();
    const result = searchEverything(sqlite, { query: "SQLite", tag: null });
    expect(result.hits.filter((hit) => hit.type === "capture")).toHaveLength(0);
  });

  it("rejects an empty query", () => {
    expect(() => parseSearchQuery("   ")).toThrow();
  });
});
