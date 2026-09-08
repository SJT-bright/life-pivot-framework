import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import type { ManualExerciseCommand } from "./contracts";
import { getManualExerciseSnapshot } from "./queries";
import { createManualExerciseService } from "./service";

const databases: Database.Database[] = [];

function replacement(revision = 0, effectiveFrom = "2026-08-10"): Extract<ManualExerciseCommand, { type: "replace-template" }> {
  return {
    type: "replace-template", templateId: "manual-cycle", name: "训练循环",
    effectiveFrom, changeNote: revision === 0 ? "初版" : "提高目标",
    expectedTemplateRevision: revision, replacementCurrentDayKey: "shoulder",
    days: [{
      dayKey: "shoulder", name: "肩", bodyPart: "肩", isRest: false, note: null,
      actions: [{
        actionKey: "press", name: "推举", plannedSets: revision === 0 ? 3 : 5,
        plannedRepsText: "8", plannedWeightText: revision === 0 ? "20kg" : "25kg",
        targetText: null, note: "计划说明",
      }],
    }, { dayKey: "rest", name: "休息", bodyPart: null, isRest: true, note: null, actions: [] }],
  };
}

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  return { sqlite, service: createManualExerciseService(sqlite, { now: () => new Date("2026-08-13T02:00:00.000Z") }) };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("manual exercise queries", () => {
  it("returns immutable planned/actual snapshots, prior actual references, history, and template changes", async () => {
    const context = setup();
    await context.service.execute(replacement(), "manual-query-template-1");
    let snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-12", status: "in-progress",
      actions: [{ actionKey: "press", actualSets: 2, actualRepsText: "7", actualWeightText: "18kg", actualText: "稳定", completion: true, note: "实际说明" }],
      creatineTaken: true, proteinPowderTaken: false, supplementNote: "已确认",
      note: "旧记录", completionText: "大部分完成", confirmedDurationMinutes: null,
      expectedDailyRevision: 0,
    }, "manual-query-save");
    snapshot = await context.service.execute({
      type: "finish-and-advance", businessDate: "2026-08-12",
      expectedDailyRevision: snapshot.selectedDay!.revision,
      expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-query-finish");
    const historyBytes = context.sqlite.prepare("select quote(id) || '|' || quote(day_name) || '|' || quote(status) || '|' || quote(note) from manual_exercise_days where business_date = ?").pluck().get("2026-08-12");

    await context.service.execute(replacement(1, "2026-08-13"), "manual-query-template-2");
    const current = getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-13", historyLimit: 5 });
    const old = getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-12", historyLimit: 5 });

    expect(current.selectedDay).toMatchObject({
      materialized: false,
      actions: [{
        actionKey: "press", planned: { sets: 5, weightText: "25kg" }, actual: { sets: 0 },
        previousActualReference: { businessDate: "2026-08-12", sets: 2, repsText: "7", weightText: "18kg" },
      }],
    });
    expect(old.selectedDay).toMatchObject({
      materialized: true, status: "completed",
      actions: [{
        actionKey: "press",
        planned: { sets: 3, weightText: "20kg", note: "计划说明" },
        actual: { sets: 2, weightText: "18kg", note: "实际说明" },
      }],
      supplements: { creatineTaken: true, proteinPowderTaken: false },
    });
    expect(current.history[0]).toMatchObject({ businessDate: "2026-08-12", status: "completed" });
    expect(current.templateHistory.map((item) => item.changeNote)).toEqual(["提高目标", "初版"]);
    expect(context.sqlite.prepare("select quote(id) || '|' || quote(day_name) || '|' || quote(status) || '|' || quote(note) from manual_exercise_days where business_date = ?").pluck().get("2026-08-12")).toBe(historyBytes);
  });

  it("returns the selected Monday-Sunday independently of the newest twenty history records", async () => {
    const context = setup();
    const service = createManualExerciseService(context.sqlite, { now: () => new Date("2026-09-15T02:00:00.000Z") });
    await service.execute(replacement(), "calendar-history-template");
    for (let index = 0; index < 31; index += 1) {
      const date = new Date(Date.UTC(2026, 7, 10 + index)).toISOString().slice(0, 10);
      await service.execute({
        type: "resolve-day", businessDate: date, outcome: index === 1 ? "unrecorded" : "rest",
        note: `日期说明 ${date}`, advanceCycle: false, expectedDailyRevision: 0, expectedCycleRevision: 0,
      }, `calendar-history-day-${index}`);
    }
    const snapshot = getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-12" });
    expect(snapshot.history).toHaveLength(20);
    expect(snapshot.history.some((entry) => entry.businessDate === "2026-08-12")).toBe(false);
    expect(snapshot.calendarRecords?.map((entry) => entry.businessDate)).toEqual([
      "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16",
    ]);
    expect(snapshot.calendarRecords?.[1]).toMatchObject({
      isRest: false, status: "skipped",
      resolution: { outcome: "unrecorded", note: "日期说明 2026-08-11", cycleAdvanced: false },
    });
    const paged = getManualExerciseSnapshot(context.sqlite, {
      businessDate: "2026-08-16", historyLimit: 1, historyOffset: 5,
    });
    expect(paged.history).toHaveLength(1);
    expect(paged.calendarRecords).toEqual(snapshot.calendarRecords);
  });

  it("is a pure bounded read and never materializes an unvisited date", async () => {
    const context = setup();
    await context.service.execute(replacement(), "manual-query-template-3");
    const beforeRows = context.sqlite.prepare(
      `select sum(rows) from (
         select count(*) rows from manual_exercise_days
         union all select count(*) from manual_exercise_day_actions
         union all select count(*) from manual_exercise_cycle_events
       )`,
    ).pluck().get();
    const result = getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-11", historyLimit: 1 });
    expect(result.selectedDay).toMatchObject({ materialized: false, status: "not-started" });
    const afterRows = context.sqlite.prepare(
      `select sum(rows) from (
         select count(*) rows from manual_exercise_days
         union all select count(*) from manual_exercise_day_actions
         union all select count(*) from manual_exercise_cycle_events
       )`,
    ).pluck().get();
    expect(afterRows).toBe(beforeRows);
    expect(context.sqlite.prepare("select count(*) from manual_exercise_days").pluck().get()).toBe(0);
    expect(() => getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-02-30" })).toThrow();
    expect(() => getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-11", historyLimit: 101 })).toThrow();
  });
});
