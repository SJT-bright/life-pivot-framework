import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import { getWeeklyReviewSnapshot } from "./query";

const databases: Database.Database[] = [];
afterEach(() => { for (const sqlite of databases.splice(0)) sqlite.close(); });

function setup(): Database.Database {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  return sqlite;
}

const input = { periodStart: "2026-12-28", periodEndExclusive: "2027-01-04", recentLimit: 10 };
const watchedTables = ["sleep_daily_records", "manual_exercise_days", "manual_skincare_days", "health_checklist_days", "personal_daily_notes", "knowledge_modules", "daily_learning_notes", "reviews", "user_pins"];
function counts(sqlite: Database.Database) {
  return Object.fromEntries(watchedTables.map((table) => [table, sqlite.prepare(`select count(*) from ${table}`).pluck().get()]));
}

describe("weekly review factual reader", () => {
  it("returns an empty current-schema snapshot without materializing any table", () => {
    const sqlite = setup();
    const before = counts(sqlite);
    expect(getWeeklyReviewSnapshot(sqlite, input)).toEqual({
      periodStart: input.periodStart, periodEndExclusive: input.periodEndExclusive,
      recordedDays: [], trainingDays: [], sleepRecords: [], skincareUses: [],
      activeRecoveryCycle: null, healthCompletions: [], knowledgeAdditions: [], summary: null,
      recentEdits: [],
    });
    expect(counts(sqlite)).toEqual(before);
  });

  it("reads half-open facts, excludes empty materialized days, preserves zero duration, and does not write", () => {
    const sqlite = setup();
    const at = "2026-12-30T16:00:00.000Z";
    sqlite.prepare(`insert into sleep_daily_records
      (id, record_date, asleep_time, wake_time, calculated_duration_minutes,
       confirmed_duration_minutes, quality_text, note, revision, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run("sleep-1", "2026-12-31", "23:00", "07:00", 480, 0, "good", "", 1, at, at);
    sqlite.prepare(`insert into manual_exercise_templates values (?, ?, ?, ?, ?)`)
      .run("exercise-1", "Strength", 1, at, "2027-01-02T00:00:00Z");
    sqlite.prepare(`insert into manual_exercise_template_versions values (?, ?, ?, ?, ?, ?)`)
      .run("exercise-version-1", "exercise-1", 1, "2026-12-01", "", at);
    sqlite.prepare(`insert into manual_exercise_days (id,business_date,template_version_id,day_key,day_name,status,started_at,ended_at,accumulated_pause_seconds,calculated_duration_minutes,confirmed_duration_minutes,supplement_note,note,completion_text,revision,created_at,updated_at) values (?,?,?,?,?,?,?,?,0,0,null,'','','',1,?,?)`)
      .run("exercise-day-1", "2027-01-01", "exercise-version-1", "a", "Zero session", "completed", at, at, at, at);
    sqlite.prepare(`insert into manual_skincare_days values (?, ?, null, null, null, '', '', '', '', 1, ?, ?)`)
      .run("skin-empty", "2027-01-02", at, at);
    sqlite.prepare(`insert into health_checklist_templates values (?, ?, ?, ?, ?)`)
      .run("health-template-1", "Health", 1, at, "2027-01-02T00:00:00Z");
    sqlite.prepare(`insert into health_checklist_versions values (?, ?, ?, ?, ?, ?)`)
      .run("health-version-1", "health-template-1", 1, "2026-12-01", "", at);
    sqlite.prepare(`insert into health_checklist_days values (?, ?, ?, '', 1, ?, ?)`)
      .run("health-empty", "2027-01-02", "health-version-1", at, at);
    sqlite.prepare(`insert into personal_daily_notes values (?, ?, ?, ?, ?, ?)`)
      .run("note-blank", "2027-01-02", "   ", 1, at, at);
    sqlite.prepare(`insert into personal_daily_notes values (?, ?, ?, ?, ?, ?)`)
      .run("note-real", "2026-12-29", "remember", 1, at, at);
    const before = counts(sqlite);
    const snapshot = getWeeklyReviewSnapshot(sqlite, input);
    expect(snapshot.recordedDays).toEqual(["2026-12-29", "2026-12-31", "2027-01-01"]);
    expect(snapshot.trainingDays).toEqual([{ id: "exercise-day-1", businessDate: "2027-01-01", name: "Zero session", status: "completed", durationMinutes: 0 }]);
    expect(snapshot.sleepRecords).toEqual([{ recordDate: "2026-12-31", asleepTime: "23:00", wakeTime: "07:00", durationMinutes: 0, qualityText: "good" }]);
    expect(counts(sqlite)).toEqual(before);
  });

  it("reads factual completions, Shanghai additions, prose summaries, and stable live edits only", () => {
    const sqlite = setup();
    const timestamp = "2026-12-31T16:30:00.000Z";
    const updated = "2027-01-02T10:00:00.000Z";
    sqlite.prepare(`insert into manual_exercise_templates values (?, ?, 1, ?, ?)`)
      .run("exercise-1", "Exercise", timestamp, updated);
    sqlite.prepare(`insert into manual_skincare_products
      (id, name, brand, current_purpose, status, added_on, note, revision, created_at, updated_at)
      values (?, ?, '', '', 'active', ?, '', 1, ?, ?)`)
      .run("skin-product-1", "Cleanser", "2026-12-28", timestamp, updated);
    sqlite.prepare(`insert into manual_skincare_products
      (id, name, brand, current_purpose, status, added_on, note, revision, created_at, updated_at)
      values (?, ?, '', '', 'active', ?, '', 1, ?, ?)`)
      .run("skin-product-2", "Skip", "2026-12-28", timestamp, updated);
    sqlite.prepare(`insert into manual_skincare_routine_versions values (?, 1, '', ?)`)
      .run("skin-routine-1", timestamp);
    sqlite.prepare(`insert into manual_skincare_recovery_plans values (?, ?, '', 1, ?, ?)`)
      .run("skin-plan-1", "Plan", timestamp, updated);
    sqlite.prepare(`insert into manual_skincare_recovery_cycles values (?, ?, 0, ?, ?, null, ?, 'active', ?, null, '', 1, ?, ?)`)
      .run("skin-cycle-1", "skin-plan-1", "Active cycle", "goal", "skin-routine-1", "2026-12-28", timestamp, updated);
    sqlite.prepare(`insert into manual_skincare_days values (?, ?, null, null, null, '', '', '', '', 1, ?, ?)`)
      .run("skin-day-1", "2027-01-02", timestamp, timestamp);
    for (const [id, used, name] of [["skin-used", 1, "Cleanser"], ["skin-unused", 0, "Skip"]] as const) {
      sqlite.prepare(`insert into manual_skincare_day_items values (?, 'skin-day-1', ?, 'morning', ?, ?, '', '', ?, ?, ?)`)
        .run(id, id, used === 1 ? "skin-product-1" : "skin-product-2", name, used === 1 ? 0 : 1, used, used === 1 ? timestamp : null);
    }
    sqlite.prepare(`insert into health_checklist_templates values (?, ?, 1, ?, ?)`)
      .run("health-template-1", "Health", timestamp, updated);
    sqlite.prepare(`insert into health_checklist_versions values (?, ?, 1, '2026-12-28', '', ?)`)
      .run("health-version-1", "health-template-1", timestamp);
    sqlite.prepare(`insert into health_checklist_days values (?, ?, ?, '', 1, ?, ?)`)
      .run("health-day-1", "2027-01-02", "health-version-1", timestamp, timestamp);
    for (const [ordinal, [id, completed, name]] of [["health-done", 1, "Water"], ["health-open", 0, "Ignore"]].entries()) {
      sqlite.prepare(`insert into health_checklist_day_items values (?, 'health-day-1', ?, 'body', 'Body', ?, '', '', ?, ?, ?)`)
        .run(id, id, name, ordinal, completed, completed === 1 ? timestamp : null);
    }
    sqlite.prepare(`insert into knowledge_modules values (?, null, ?, '', '', '', 'learning', 0, 1, ?, ?)`)
      .run("module-1", "Module", timestamp, timestamp);
    sqlite.prepare(`insert into daily_learning_notes values (?, ?, ?, ?, ?, '', '', '', '', 'active', 1, ?, ?)`)
      .run("learning-note-1", "2027-01-02", "Daily knowledge", "module-1", "content", timestamp, timestamp);
    sqlite.prepare(`insert into reviews values (?, 'weekly', ?, ?, ?, 2, ?, ?, null)`)
      .run("review-1", input.periodStart, input.periodEndExclusive, JSON.stringify({
        highlights: "Kept", blockers: "", lessons: "Learned", adjustments: "", nextFocus: "Focus",
      }), timestamp, updated);
    sqlite.prepare(`insert into user_pins values ('exercise-template', 'exercise-1', ?), ('knowledge-module', 'module-1', ?), ('health-template', 'missing-target', ?)`)
      .run(timestamp, timestamp, timestamp);
    const before = counts(sqlite);
    const snapshot = getWeeklyReviewSnapshot(sqlite, input);
    expect(snapshot.activeRecoveryCycle).toEqual({ id: "skin-cycle-1", name: "Active cycle" });
    expect(snapshot.skincareUses).toEqual([{ businessDate: "2027-01-02", slot: "morning", productName: "Cleanser" }]);
    expect(snapshot.healthCompletions).toEqual([{ businessDate: "2027-01-02", groupLabel: "Body", name: "Water" }]);
    expect(snapshot.knowledgeAdditions).toEqual([
      { kind: "daily-note", id: "learning-note-1", businessDate: "2027-01-02", title: "Daily knowledge" },
    ]);
    expect(snapshot.summary).toEqual({ content: "亮点：Kept\n经验教训：Learned\n下周重点：Focus", revision: 2, updatedAt: updated });
    expect(snapshot.recentEdits.map((item) => [item.targetType, item.targetId, item.pinned])).toEqual([
      ["exercise-template", "exercise-1", true],
      ["health-template", "health-template-1", false],
      ["skincare-plan", "skin-plan-1", false],
    ]);
    expect(JSON.stringify(snapshot.recentEdits)).not.toContain("missing-target");
    expect(counts(sqlite)).toEqual(before);
  });
});
