import { describe, expect, it } from "vitest";

import {
  manualExerciseCommandSchema,
  parseManualExerciseCommand,
} from "./contracts";

const templateDays = [
  {
    dayKey: " shoulder ",
    name: " 肩部训练 ",
    bodyPart: " 肩 ",
    isRest: false,
    note: null,
    actions: [
      {
        actionKey: " press ",
        name: " 哑铃推举 ",
        plannedSets: 4,
        plannedRepsText: " 8-10 ",
        plannedWeightText: null,
        targetText: null,
        note: " 保持稳定 ",
      },
    ],
  },
  {
    dayKey: "rest",
    name: "休息",
    bodyPart: null,
    isRest: true,
    note: null,
    actions: [],
  },
];

const validCommands = [
  {
    type: "replace-template",
    templateId: " main-template ",
    name: " 主循环 ",
    effectiveFrom: "2026-08-13",
    changeNote: " 增加休息日 ",
    expectedTemplateRevision: 3,
    replacementCurrentDayKey: " shoulder ",
    days: templateDays,
  },
  {
    type: "select-cycle-day",
    templateId: "main-template",
    businessDate: "2026-08-13",
    dayKey: "rest",
    note: "主动休息",
    expectedCycleRevision: 4,
  },
  {
    type: "start-training",
    businessDate: "2026-08-13",
    expectedDailyRevision: 0,
  },
  {
    type: "pause-training",
    businessDate: "2026-08-13",
    expectedDailyRevision: 1,
  },
  {
    type: "resume-training",
    businessDate: "2026-08-13",
    expectedDailyRevision: 2,
  },
  {
    type: "save-training",
    businessDate: "2026-08-13",
    status: "partial",
    actions: [
      {
        actionKey: " press ",
        actualSets: 0,
        actualRepsText: " 0 ",
        actualWeightText: null,
        actualText: " 未完成 ",
        completion: false,
        note: null,
      },
    ],
    creatineTaken: null,
    proteinPowderTaken: false,
    supplementNote: " 稍后确认 ",
    note: " 状态一般 ",
    completionText: null,
    confirmedDurationMinutes: 0,
    expectedDailyRevision: 3,
  },
  {
    type: "finish-and-advance",
    businessDate: "2026-08-13",
    expectedDailyRevision: 4,
    expectedCycleRevision: 4,
  },
  {
    type: "skip-and-advance",
    businessDate: "2026-08-13",
    note: "身体不适",
    expectedDailyRevision: 0,
    expectedCycleRevision: 5,
  },
] as const;

describe("manualExerciseCommandSchema", () => {
  it("accepts exactly the eight commands and trims reusable string values", () => {
    for (const command of validCommands) {
      expect(manualExerciseCommandSchema.safeParse(command).success).toBe(true);
    }

    const parsed = parseManualExerciseCommand(validCommands[0]);
    expect(parsed.type).toBe("replace-template");
    if (parsed.type !== "replace-template") throw new Error("Unexpected command type");
    expect(parsed.templateId).toBe("main-template");
    expect(parsed.name).toBe("主循环");
    expect(parsed.changeNote).toBe("增加休息日");
    expect(parsed.replacementCurrentDayKey).toBe("shoulder");
    expect(parsed.days[0]).toMatchObject({
      dayKey: "shoulder",
      name: "肩部训练",
      bodyPart: "肩",
    });
    expect(parsed.days[0]!.actions[0]).toMatchObject({
      actionKey: "press",
      name: "哑铃推举",
      plannedRepsText: "8-10",
      note: "保持稳定",
    });
    expect(() => parseManualExerciseCommand({ type: "complete-training" })).toThrow();
  });

  it("rejects unknown fields at the command and nested DTO levels", () => {
    expect(() => parseManualExerciseCommand({
      ...validCommands[2],
      unexpected: true,
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[0],
      days: [{ ...templateDays[0], unexpected: true }],
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[0],
      days: [{
        ...templateDays[0],
        actions: [{ ...templateDays[0]!.actions[0]!, unexpected: true }],
      }],
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[5],
      actions: [{ ...validCommands[5].actions[0], unexpected: true }],
    })).toThrow();
  });

  it("uses real business dates and bounded safe non-negative integers", () => {
    expect(() => parseManualExerciseCommand({
      ...validCommands[2],
      businessDate: "2026-02-30",
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[2],
      expectedDailyRevision: -1,
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[2],
      expectedDailyRevision: Number.MAX_SAFE_INTEGER,
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[5],
      actions: [{ ...validCommands[5].actions[0], actualSets: 10_001 }],
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[5],
      confirmedDurationMinutes: -1,
    })).toThrow();
  });

  it("rejects blank identifiers, duplicate keys, and invalid replacement keys", () => {
    expect(() => parseManualExerciseCommand({
      ...validCommands[0],
      templateId: "   ",
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[0],
      days: [templateDays[0], { ...templateDays[0], name: "重复日" }],
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[0],
      days: [{
        ...templateDays[0],
        actions: [templateDays[0]!.actions[0], templateDays[0]!.actions[0]],
      }],
    })).toThrow();
    expect(() => parseManualExerciseCommand({
      ...validCommands[0],
      replacementCurrentDayKey: "missing",
    })).toThrow();
  });

  it("keeps nullable supplements and confirmed duration distinct from status", () => {
    const parsed = parseManualExerciseCommand(validCommands[5]);
    expect(parsed).toMatchObject({
      type: "save-training",
      status: "partial",
      creatineTaken: null,
      proteinPowderTaken: false,
      confirmedDurationMinutes: 0,
    });
    expect(() => parseManualExerciseCommand({
      ...validCommands[5],
      status: "completed",
    })).toThrow();
  });
});
