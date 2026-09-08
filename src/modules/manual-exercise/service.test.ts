import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { IdempotentCommandConflictError } from "@/core/db/idempotent-command";
import { migrateDatabase } from "@/core/db/migrate";
import { RevisionConflictError } from "@/core/mutations/revision";

import type { ManualExerciseCommand } from "./contracts";
import { getManualExerciseSnapshot } from "./queries";
import { getExerciseTrendsSnapshot } from "./trends-query";
import {
  createManualExerciseService,
  ManualExerciseConflictError,
  ManualExerciseValidationError,
} from "./service";

const databases: Database.Database[] = [];

function template(
  overrides: Partial<Extract<ManualExerciseCommand, { type: "replace-template" }>> = {},
): Extract<ManualExerciseCommand, { type: "replace-template" }> {
  return {
    type: "replace-template",
    templateId: "manual-cycle",
    name: "四日循环",
    effectiveFrom: "2026-08-13",
    changeNote: "建立肩腿背休循环",
    expectedTemplateRevision: 0,
    replacementCurrentDayKey: "shoulder",
    days: [
      {
        dayKey: "shoulder", name: "肩", bodyPart: "肩", isRest: false, note: null,
        actions: [{
          actionKey: "press", name: "推举", plannedSets: 3,
          plannedRepsText: "8", plannedWeightText: "20kg", targetText: null, note: null,
        }],
      },
      {
        dayKey: "leg", name: "腿", bodyPart: "腿", isRest: false, note: null,
        actions: [{
          actionKey: "squat", name: "深蹲", plannedSets: 4,
          plannedRepsText: "6", plannedWeightText: "40kg", targetText: null, note: null,
        }],
      },
      {
        dayKey: "back", name: "背", bodyPart: "背", isRest: false, note: null,
        actions: [{
          actionKey: "row", name: "划船", plannedSets: 3,
          plannedRepsText: "10", plannedWeightText: "25kg", targetText: null, note: null,
        }],
      },
      { dayKey: "rest", name: "休息", bodyPart: null, isRest: true, note: null, actions: [] },
    ],
    ...overrides,
  };
}

function setup(initialNow = "2026-08-13T02:00:00.000Z") {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let currentNow = new Date(initialNow);
  const service = createManualExerciseService(sqlite, { now: () => currentNow });
  return {
    sqlite,
    service,
    setNow(value: string) { currentNow = new Date(value); },
  };
}

function count(sqlite: Database.Database, table: string): number {
  return sqlite.prepare(`select count(*) from ${table}`).pluck().get() as number;
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("manual exercise service", () => {
  it("advances only by the ordered template nodes and ignores natural date changes", async () => {
    const context = setup();
    let snapshot = await context.service.execute(template(), "manual-template-0001");
    expect(snapshot.cycle).toMatchObject({ currentDayKey: "shoulder", revision: 1 });

    expect(getManualExerciseSnapshot(context.sqlite, {
      businessDate: "2026-08-14",
    }).cycle?.currentDayKey).toBe("shoulder");

    snapshot = await context.service.execute({
      type: "start-training", businessDate: "2026-08-13", expectedDailyRevision: 0,
    }, "manual-start-shoulder");
    snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-13", status: "in-progress",
      actions: [{ actionKey: "press", actualSets: 3, actualRepsText: "8", actualWeightText: "20kg", actualText: null, completion: true, note: null }],
      creatineTaken: true, proteinPowderTaken: null, supplementNote: null,
      note: null, completionText: "完成", confirmedDurationMinutes: null,
      expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "manual-save-shoulder");
    snapshot = await context.service.execute({
      type: "finish-and-advance", businessDate: "2026-08-13",
      expectedDailyRevision: snapshot.selectedDay!.revision,
      expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-finish-shoulder");
    expect(snapshot.cycle?.currentDayKey).toBe("leg");

    context.setNow("2026-08-14T02:00:00.000Z");
    snapshot = await context.service.execute({
      type: "skip-and-advance", businessDate: "2026-08-14", note: "膝盖不适",
      expectedDailyRevision: 0, expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-skip-leg");
    expect(snapshot.selectedDay?.status).toBe("skipped");
    expect(snapshot.cycle?.currentDayKey).toBe("back");

    context.setNow("2026-08-15T02:00:00.000Z");
    snapshot = await context.service.execute({
      type: "skip-and-advance", businessDate: "2026-08-15", note: null,
      expectedDailyRevision: 0, expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-skip-back");
    expect(snapshot.cycle?.currentDayKey).toBe("rest");

    context.setNow("2026-08-16T02:00:00.000Z");
    snapshot = await context.service.execute({
      type: "finish-and-advance", businessDate: "2026-08-16",
      expectedDailyRevision: 0, expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-finish-rest");
    expect(snapshot.cycle?.currentDayKey).toBe("shoulder");
  });

  it("does not advance for partial, zero-set, or historical completion", async () => {
    const context = setup("2026-08-15T02:00:00.000Z");
    let snapshot = await context.service.execute(template({ effectiveFrom: "2026-08-10" }), "manual-template-0002");
    snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-15", status: "partial",
      actions: [{ actionKey: "press", actualSets: 0, actualRepsText: null, actualWeightText: null, actualText: null, completion: false, note: null }],
      creatineTaken: null, proteinPowderTaken: false, supplementNote: null,
      note: null, completionText: null, confirmedDurationMinutes: null,
      expectedDailyRevision: 0,
    }, "manual-partial-0001");
    expect(snapshot.cycle?.currentDayKey).toBe("shoulder");
    await expect(context.service.execute({
      type: "finish-and-advance", businessDate: "2026-08-15",
      expectedDailyRevision: snapshot.selectedDay!.revision,
      expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-zero-finish")).rejects.toBeInstanceOf(ManualExerciseValidationError);

    snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-12", status: "in-progress",
      actions: [{ actionKey: "press", actualSets: 2, actualRepsText: "8", actualWeightText: null, actualText: null, completion: true, note: null }],
      creatineTaken: null, proteinPowderTaken: null, supplementNote: null,
      note: null, completionText: null, confirmedDurationMinutes: null,
      expectedDailyRevision: 0,
    }, "manual-history-save");
    const historical = await context.service.execute({
      type: "finish-and-advance", businessDate: "2026-08-12",
      expectedDailyRevision: snapshot.selectedDay!.revision,
      expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-history-finish");
    expect(historical.selectedDay?.status).toBe("completed");
    expect(historical.cycle?.currentDayKey).toBe("shoulder");
  });

  it("uses daily and cycle CAS so duplicate completion cannot advance twice", async () => {
    const context = setup();
    await context.service.execute(template(), "manual-template-0003");
    const saved = await context.service.execute({
      type: "save-training", businessDate: "2026-08-13", status: "in-progress",
      actions: [{ actionKey: "press", actualSets: 1, actualRepsText: null, actualWeightText: null, actualText: null, completion: true, note: null }],
      creatineTaken: null, proteinPowderTaken: null, supplementNote: null,
      note: null, completionText: null, confirmedDurationMinutes: null,
      expectedDailyRevision: 0,
    }, "manual-save-cas");
    const command = {
      type: "finish-and-advance" as const, businessDate: "2026-08-13",
      expectedDailyRevision: saved.selectedDay!.revision,
      expectedCycleRevision: saved.cycle!.revision,
    };
    const first = await context.service.execute(command, "manual-finish-cas-1");
    const replay = await context.service.execute(structuredClone(command), "manual-finish-cas-1");
    expect(replay).toEqual(first);
    await expect(context.service.execute(command, "manual-finish-cas-2"))
      .rejects.toBeInstanceOf(RevisionConflictError);
    await expect(context.service.execute({ ...command, businessDate: "2026-08-14" }, "manual-finish-cas-1"))
      .rejects.toBeInstanceOf(IdempotentCommandConflictError);
    expect(getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-13" }).cycle?.currentDayKey).toBe("leg");
  });

  it("reconstructs timer pauses and keeps calculated and confirmed minutes separate", async () => {
    const context = setup("2026-08-13T10:00:00.000Z");
    await context.service.execute(template(), "manual-template-0004");
    let snapshot = await context.service.execute({ type: "start-training", businessDate: "2026-08-13", expectedDailyRevision: 0 }, "manual-timer-start");
    context.setNow("2026-08-13T10:10:00.000Z");
    snapshot = await context.service.execute({ type: "pause-training", businessDate: "2026-08-13", expectedDailyRevision: snapshot.selectedDay!.revision }, "manual-timer-pause");
    context.setNow("2026-08-13T10:15:00.000Z");
    snapshot = await context.service.execute({ type: "resume-training", businessDate: "2026-08-13", expectedDailyRevision: snapshot.selectedDay!.revision }, "manual-timer-resume");
    snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-13", status: "in-progress",
      actions: [{ actionKey: "press", actualSets: 3, actualRepsText: null, actualWeightText: null, actualText: null, completion: true, note: null }],
      creatineTaken: false, proteinPowderTaken: true, supplementNote: null,
      note: null, completionText: null, confirmedDurationMinutes: null,
      expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "manual-timer-save");
    context.setNow("2026-08-13T10:30:00.000Z");
    snapshot = await context.service.execute({
      type: "finish-and-advance", businessDate: "2026-08-13",
      expectedDailyRevision: snapshot.selectedDay!.revision,
      expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-timer-finish");
    expect(snapshot.selectedDay?.timer).toMatchObject({
      accumulatedPauseSeconds: 300,
      calculatedDurationMinutes: 25,
      confirmedDurationMinutes: null,
    });
    snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-13", status: "partial",
      actions: [{ actionKey: "press", actualSets: 3, actualRepsText: null, actualWeightText: null, actualText: null, completion: true, note: null }],
      creatineTaken: false, proteinPowderTaken: true, supplementNote: null,
      note: null, completionText: null, confirmedDurationMinutes: 27,
      expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "manual-timer-confirm");
    expect(snapshot.selectedDay).toMatchObject({
      status: "completed",
      timer: { calculatedDurationMinutes: 25, confirmedDurationMinutes: 27 },
      supplements: { creatineTaken: false, proteinPowderTaken: true },
    });
  });

  it("records manual selection and rolls back facts, cycle, event, and idempotency together", async () => {
    const context = setup();
    let snapshot = await context.service.execute(template(), "manual-template-0005");
    snapshot = await context.service.execute({
      type: "select-cycle-day", templateId: "manual-cycle", businessDate: "2026-08-13",
      dayKey: "back", note: "手动回退", expectedCycleRevision: snapshot.cycle!.revision,
    }, "manual-select-back");
    expect(snapshot.cycle?.currentDayKey).toBe("back");
    expect(context.sqlite.prepare("select event_type, note from manual_exercise_cycle_events order by rowid desc limit 1").get())
      .toEqual({ event_type: "corrected", note: "手动回退" });

    context.sqlite.exec(`
      create trigger reject_manual_skip before insert on manual_exercise_cycle_events
      when NEW.note = 'rollback' begin select raise(abort, 'injected'); end
    `);
    const beforeRevision = snapshot.cycle!.revision;
    context.setNow("2026-08-14T02:00:00.000Z");
    await expect(context.service.execute({
      type: "skip-and-advance", businessDate: "2026-08-14", note: "rollback",
      expectedDailyRevision: 0, expectedCycleRevision: beforeRevision,
    }, "manual-rollback-key")).rejects.toThrow("injected");
    expect(count(context.sqlite, "manual_exercise_days")).toBe(0);
    expect(count(context.sqlite, "manual_exercise_day_actions")).toBe(0);
    expect(count(context.sqlite, "manual_exercise_cycle_events")).toBe(2);
    expect(count(context.sqlite, "idempotency_keys")).toBe(2);
    expect(getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-14" }).cycle?.revision).toBe(beforeRevision);
  });

  it("records rest separately, keeps the plan, and closes paused timers without counting the pause", async () => {
    const context = setup();
    await context.service.execute(template(), "resolution-rest-template");
    let snapshot = await context.service.execute({
      type: "start-training", businessDate: "2026-08-13", expectedDailyRevision: 0,
    }, "resolution-rest-start");
    context.setNow("2026-08-13T02:10:00.000Z");
    snapshot = await context.service.execute({
      type: "pause-training", businessDate: "2026-08-13", expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "resolution-rest-pause");
    context.setNow("2026-08-13T03:00:00.000Z");
    const command = {
      type: "resolve-day" as const, businessDate: "2026-08-13", outcome: "rest" as const,
      note: "今天不适，休息", advanceCycle: false,
      expectedDailyRevision: snapshot.selectedDay!.revision, expectedCycleRevision: snapshot.cycle!.revision,
    };
    const resolved = await context.service.execute(command, "resolution-rest-close");
    expect(resolved.selectedDay).toMatchObject({
      status: "skipped", resolution: { outcome: "rest", note: "今天不适，休息", cycleAdvanced: false },
      timer: { pausedAt: null, endedAt: "2026-08-13T03:00:00.000Z", calculatedDurationMinutes: 10 },
    });
    expect(resolved.cycle).toEqual(snapshot.cycle);
    expect(resolved.history[0]?.resolution?.outcome).toBe("rest");
    context.setNow("2026-08-13T04:00:00.000Z");
    expect(getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-13" }).selectedDay?.timer.calculatedDurationMinutes).toBe(10);
    expect(await context.service.execute(command, "resolution-rest-close")).toEqual(resolved);
    await expect(context.service.execute({
      type: "start-training", businessDate: "2026-08-13", expectedDailyRevision: resolved.selectedDay!.revision,
    }, "resolution-rest-terminal")).rejects.toBeInstanceOf(ManualExerciseConflictError);
  });

  it("reconstructs a past plan from dated cycle events and never advances live state for backfill", async () => {
    const context = setup();
    let snapshot = await context.service.execute(template(), "resolution-history-template");
    snapshot = await context.service.execute({
      type: "resolve-day", businessDate: "2026-08-13", outcome: "skipped", note: "出差",
      advanceCycle: true, expectedDailyRevision: 0, expectedCycleRevision: snapshot.cycle!.revision,
    }, "resolution-history-first");
    context.setNow("2026-08-16T02:00:00.000Z");
    snapshot = await context.service.execute({
      type: "select-cycle-day", templateId: "manual-cycle", businessDate: "2026-08-16",
      dayKey: "back", note: "今天练背", expectedCycleRevision: snapshot.cycle!.revision,
    }, "resolution-history-live-change");
    expect(getManualExerciseSnapshot(context.sqlite, { businessDate: "2026-08-14" }).selectedDay?.dayKey).toBe("leg");
    const closed = await context.service.execute({
      type: "resolve-day", businessDate: "2026-08-14", outcome: "unrecorded", note: "练过，组数没记清",
      advanceCycle: true, expectedDailyRevision: 0, expectedCycleRevision: 0,
    }, "resolution-history-backfill");
    expect(closed.selectedDay).toMatchObject({ dayKey: "leg", resolution: { outcome: "unrecorded", cycleAdvanced: false } });
    expect(closed.cycle).toEqual(snapshot.cycle);
    await expect(context.service.execute({
      type: "select-cycle-day", templateId: "manual-cycle", businessDate: "2026-08-14",
      dayKey: "shoulder", note: null, expectedCycleRevision: snapshot.cycle!.revision,
    }, "resolution-history-cursor-guard")).rejects.toBeInstanceOf(ManualExerciseValidationError);
  });

  it("reopens skipped days without rewinding or consuming the live cycle a second time", async () => {
    const context = setup();
    let snapshot = await context.service.execute(template(), "resolution-reopen-template");
    snapshot = await context.service.execute({
      type: "resolve-day", businessDate: "2026-08-13", outcome: "skipped", note: "临时有事",
      advanceCycle: true, expectedDailyRevision: 0, expectedCycleRevision: snapshot.cycle!.revision,
    }, "resolution-reopen-skip");
    const advancedCycle = snapshot.cycle;
    snapshot = await context.service.execute({
      type: "reopen-day", businessDate: "2026-08-13", expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "resolution-reopen-open");
    expect(snapshot.selectedDay?.resolution).toBeNull();
    expect(snapshot.cycle).toEqual(advancedCycle);
    snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-13", status: "partial",
      actions: [{ actionKey: "press", actualSets: 2, actualRepsText: "8", actualWeightText: "20kg", actualText: null, completion: true, note: null }],
      creatineTaken: true, proteinPowderTaken: false, supplementNote: "保留", note: "补记", completionText: null,
      confirmedDurationMinutes: 30, expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "resolution-reopen-save");
    snapshot = await context.service.execute({
      type: "finish-and-advance", businessDate: "2026-08-13", expectedDailyRevision: snapshot.selectedDay!.revision,
      expectedCycleRevision: snapshot.cycle!.revision,
    }, "resolution-reopen-finish");
    expect(snapshot.cycle).toEqual(advancedCycle);
    expect(snapshot.selectedDay).toMatchObject({ status: "completed", timer: { startedAt: null, endedAt: null, confirmedDurationMinutes: 30 } });
    const corrected = await context.service.execute({
      type: "save-training", businessDate: "2026-08-13", status: "partial",
      actions: [{ actionKey: "press", actualSets: 3, actualRepsText: "8", actualWeightText: "20kg", actualText: null, completion: true, note: null }],
      creatineTaken: true, proteinPowderTaken: false, supplementNote: "保留", note: "更正", completionText: null,
      confirmedDurationMinutes: 35, expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "resolution-reopen-correct");
    expect(corrected.selectedDay).toMatchObject({ status: "completed", actions: [{ actual: { sets: 3 } }], timer: { confirmedDurationMinutes: 35 } });
    expect(corrected.cycle).toEqual(advancedCycle);
  });

  it("preserves existing actuals and supplements and excludes uncertain data until explicitly reopened", async () => {
    const context = setup();
    await context.service.execute(template(), "resolution-preserve-template");
    let snapshot = await context.service.execute({
      type: "save-training", businessDate: "2026-08-13", status: "partial",
      actions: [{ actionKey: "press", actualSets: 2, actualRepsText: "8", actualWeightText: "20kg", actualText: "可能不准", completion: true, note: "动作备注" }],
      creatineTaken: true, proteinPowderTaken: false, supplementNote: "补剂备注", note: "训练备注", completionText: null,
      confirmedDurationMinutes: 25, expectedDailyRevision: 0,
    }, "resolution-preserve-save");
    const original = snapshot.selectedDay!;
    for (const outcome of ["rest", "skipped"] as const) {
      await expect(context.service.execute({
        type: "resolve-day", businessDate: "2026-08-13", outcome, note: "不要清空",
        advanceCycle: false, expectedDailyRevision: original.revision, expectedCycleRevision: snapshot.cycle!.revision,
      }, `resolution-preserve-guard-${outcome}`)).rejects.toBeInstanceOf(ManualExerciseConflictError);
    }
    snapshot = await context.service.execute({
      type: "resolve-day", businessDate: "2026-08-13", outcome: "unrecorded", note: "数字记不清",
      advanceCycle: false, expectedDailyRevision: original.revision, expectedCycleRevision: 0,
    }, "resolution-preserve-uncertain");
    expect(snapshot.selectedDay!.actions).toEqual(original.actions);
    expect(snapshot.selectedDay!.supplements).toEqual(original.supplements);
    expect(snapshot.selectedDay!.note).toBe(original.note);
    expect(snapshot.selectedDay!.timer.confirmedDurationMinutes).toBe(25);
    const trends = getExerciseTrendsSnapshot(context.sqlite, { asOfDate: "2026-08-13" });
    expect(trends.recentSessions).toEqual([]);
    expect(trends.series).toEqual([]);
    snapshot = await context.service.execute({
      type: "reopen-day", businessDate: "2026-08-13", expectedDailyRevision: snapshot.selectedDay!.revision,
    }, "resolution-preserve-reopen");
    expect(snapshot.selectedDay!.actions).toEqual(original.actions);
    expect(snapshot.selectedDay!.status).toBe("partial");
  });

  it("rejects future actuals and timers on historical dates without materializing records", async () => {
    const context = setup();
    await context.service.execute(template(), "resolution-date-template");
    await expect(context.service.execute({
      type: "resolve-day", businessDate: "2026-08-14", outcome: "rest", note: null,
      advanceCycle: false, expectedDailyRevision: 0, expectedCycleRevision: 1,
    }, "resolution-future-rest")).rejects.toBeInstanceOf(ManualExerciseValidationError);
    await expect(context.service.execute({
      type: "start-training", businessDate: "2026-08-12", expectedDailyRevision: 0,
    }, "resolution-history-timer")).rejects.toBeInstanceOf(ManualExerciseValidationError);
    expect(count(context.sqlite, "manual_exercise_days")).toBe(0);
  });

  it("requires an explicit replacement key when a template removes the current node", async () => {
    const context = setup();
    await context.service.execute(template(), "manual-template-0006");
    const { replacementCurrentDayKey: _omitted, ...replacement } = template({
      expectedTemplateRevision: 1,
      effectiveFrom: "2026-08-14",
      changeNote: "移除肩日",
      days: template().days.slice(1),
    });
    await expect(context.service.execute(replacement, "manual-template-replace-invalid"))
      .rejects.toBeInstanceOf(ManualExerciseConflictError);
    expect(count(context.sqlite, "manual_exercise_template_versions")).toBe(1);
    expect(count(context.sqlite, "idempotency_keys")).toBe(1);
  });
});
