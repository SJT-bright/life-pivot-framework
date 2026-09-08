import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase } from "@/core/db/migrate";

import type { ManualExerciseCommand } from "./contracts";
import {
  createManualExerciseProgressService,
} from "./progress-service";
import { getManualExerciseProgressSnapshot } from "./progress-query";
import { createManualExerciseService } from "./service";

const databases: Database.Database[] = [];

function template(overrides: Partial<Extract<ManualExerciseCommand, { type: "replace-template" }>> = {}) {
  return {
    type: "replace-template" as const,
    templateId: "progress-template",
    name: "四日循环",
    effectiveFrom: "2026-08-13",
    changeNote: "建立模板",
    expectedTemplateRevision: 0,
    replacementCurrentDayKey: "shoulder",
    days: [{
      dayKey: "shoulder",
      name: "肩",
      bodyPart: "肩",
      isRest: false,
      note: null,
      actions: [{
        actionKey: "press",
        name: "推举",
        plannedSets: 3,
        plannedRepsText: "8",
        plannedWeightText: "20kg",
        targetText: null,
        note: null,
      }],
    }],
    ...overrides,
  };
}

function setup() {
  const sqlite = new Database(":memory:");
  databases.push(sqlite);
  migrateDatabase(sqlite);
  let counter = 0;
  const ids = () => `progress-id-${++counter}`;
  const exercise = createManualExerciseService(sqlite, {
    createId: ids,
    now: () => new Date("2026-08-22T02:00:00.000Z"),
  });
  const progress = createManualExerciseProgressService(sqlite, {
    createId: ids,
    now: () => new Date("2026-08-22T02:00:00.000Z"),
  });
  return { sqlite, exercise, progress };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("manual exercise progress service", () => {
  it("creates pending transitions from adjacent immutable versions and records a decision", async () => {
    const context = setup();
    const first = await context.exercise.execute(template(), "progress-template-0001");
    const second = await context.exercise.execute(template({
      expectedTemplateRevision: 1,
      changeNote: "增加重量和次数",
      days: [{
        ...template().days[0]!,
        actions: [{
          ...template().days[0]!.actions[0]!,
          plannedRepsText: "10",
          plannedWeightText: "22.5kg",
        }],
      }],
    }), "progress-template-0002");
    const targetVersionId = second.template!.versionId;
    const pending = context.progress.getSnapshot({ asOfDate: "2026-08-22", templateId: "progress-template" });
    expect(pending.pending).toHaveLength(1);
    expect(pending.pending[0]).toMatchObject({
      fromVersionId: first.template!.versionId,
      toVersionId: targetVersionId,
      fromRevision: 1,
      toRevision: 2,
    });
    expect(pending.pending[0]!.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "reps", delta: 2 }),
      expect.objectContaining({ metric: "weight", delta: 2.5, unit: "kg" }),
    ]));

    const tracked = await context.progress.execute({
      type: "record-progress-decision",
      templateId: "progress-template",
      templateVersionId: targetVersionId,
      asOfDate: "2026-08-22",
      decision: "tracked",
      expectedDecisionRevision: 0,
    }, "progress-decision-0001");
    expect(tracked.tracked[0]).toMatchObject({
      toVersionId: targetVersionId,
      decision: "tracked",
      decisionRevision: 1,
    });
    expect(await context.progress.execute({
      type: "record-progress-decision",
      templateId: "progress-template",
      templateVersionId: targetVersionId,
      asOfDate: "2026-08-22",
      decision: "tracked",
      expectedDecisionRevision: 0,
    }, "progress-decision-0001")).toEqual(tracked);
  });

  it("does not create a pending transition for a note-only template change", async () => {
    const context = setup();
    const first = await context.exercise.execute(template(), "progress-note-0001");
    const second = await context.exercise.execute(template({
      expectedTemplateRevision: 1,
      changeNote: "只调整备注",
      days: [{
        ...template().days[0]!,
        note: "动作顺序说明",
      }],
    }), "progress-note-0002");
    expect(second.template!.revision).toBe(2);
    expect(getManualExerciseProgressSnapshot(context.sqlite, {
      asOfDate: "2026-08-22",
      templateId: "progress-template",
    })).toMatchObject({
      pending: [],
      tracked: [],
      excluded: [],
    });
  });
});
