import { z } from "zod";

import { isBusinessDate } from "../../core/time/business-date";

const MAX_REVISION = 2_147_483_647;
const MAX_SETS = 10_000;
const MAX_DURATION_MINUTES = 525_600;
const MAX_TEMPLATE_DAYS = 366;
const MAX_ACTIONS_PER_DAY = 500;

const boundedInteger = (maximum: number) => z.number().int().min(0).max(maximum);
const identifierSchema = z.string().trim().min(1).max(128);
const nameSchema = z.string().trim().min(1).max(200);
const shortTextSchema = z.string().trim().max(1_000).nullable();
const longTextSchema = z.string().trim().max(10_000).nullable();
const requiredChangeNoteSchema = z.string().trim().min(1).max(1_000);
const revisionSchema = boundedInteger(MAX_REVISION);
const setsSchema = boundedInteger(MAX_SETS);
const durationMinutesSchema = boundedInteger(MAX_DURATION_MINUTES);
const businessDateSchema = z
  .string()
  .trim()
  .refine(isBusinessDate, "Invalid business date");

export const manualExerciseStatusSchema = z.enum([
  "not-started",
  "in-progress",
  "partial",
  "completed",
  "skipped",
]);

export const manualExerciseTemplateActionSchema = z.object({
  actionKey: identifierSchema,
  name: nameSchema,
  plannedSets: setsSchema,
  plannedRepsText: shortTextSchema,
  plannedWeightText: shortTextSchema,
  targetText: shortTextSchema,
  note: longTextSchema,
}).strict();

export const manualExerciseTemplateDaySchema = z.object({
  dayKey: identifierSchema,
  name: nameSchema,
  bodyPart: nameSchema.nullable(),
  isRest: z.boolean(),
  note: longTextSchema,
  actions: z.array(manualExerciseTemplateActionSchema).max(MAX_ACTIONS_PER_DAY),
}).strict().superRefine((day, context) => {
  const actionKeys = new Set<string>();
  for (const [index, action] of day.actions.entries()) {
    if (actionKeys.has(action.actionKey)) {
      context.addIssue({
        code: "custom",
        message: "Action keys must be unique within a training day",
        path: ["actions", index, "actionKey"],
      });
    }
    actionKeys.add(action.actionKey);
  }
});

export const manualExerciseActualActionSchema = z.object({
  actionKey: identifierSchema,
  actualSets: setsSchema,
  actualRepsText: shortTextSchema,
  actualWeightText: shortTextSchema,
  actualText: longTextSchema,
  completion: z.boolean(),
  note: longTextSchema,
}).strict();

const replaceTemplateCommandSchema = z.object({
  type: z.literal("replace-template"),
  templateId: identifierSchema,
  name: nameSchema,
  effectiveFrom: businessDateSchema,
  changeNote: requiredChangeNoteSchema,
  expectedTemplateRevision: revisionSchema,
  replacementCurrentDayKey: identifierSchema.nullable().optional(),
  days: z.array(manualExerciseTemplateDaySchema).min(1).max(MAX_TEMPLATE_DAYS),
}).strict().superRefine((command, context) => {
  const dayKeys = new Set<string>();
  for (const [index, day] of command.days.entries()) {
    if (dayKeys.has(day.dayKey)) {
      context.addIssue({
        code: "custom",
        message: "Template day keys must be unique",
        path: ["days", index, "dayKey"],
      });
    }
    dayKeys.add(day.dayKey);
  }

  if (
    command.replacementCurrentDayKey != null
    && !dayKeys.has(command.replacementCurrentDayKey)
  ) {
    context.addIssue({
      code: "custom",
      message: "Replacement current day must exist in the replacement template",
      path: ["replacementCurrentDayKey"],
    });
  }
});

const selectCycleDayCommandSchema = z.object({
  type: z.literal("select-cycle-day"),
  templateId: identifierSchema,
  businessDate: businessDateSchema,
  dayKey: identifierSchema,
  note: longTextSchema,
  expectedCycleRevision: revisionSchema,
}).strict();

const dailyRevisionCommandFields = {
  businessDate: businessDateSchema,
  expectedDailyRevision: revisionSchema,
};

const startTrainingCommandSchema = z.object({
  type: z.literal("start-training"),
  ...dailyRevisionCommandFields,
}).strict();

const pauseTrainingCommandSchema = z.object({
  type: z.literal("pause-training"),
  ...dailyRevisionCommandFields,
}).strict();

const resumeTrainingCommandSchema = z.object({
  type: z.literal("resume-training"),
  ...dailyRevisionCommandFields,
}).strict();

const saveTrainingCommandSchema = z.object({
  type: z.literal("save-training"),
  businessDate: businessDateSchema,
  status: z.enum(["in-progress", "partial"]),
  actions: z.array(manualExerciseActualActionSchema).max(MAX_ACTIONS_PER_DAY),
  creatineTaken: z.boolean().nullable(),
  proteinPowderTaken: z.boolean().nullable(),
  supplementNote: longTextSchema,
  note: longTextSchema,
  completionText: longTextSchema,
  confirmedDurationMinutes: durationMinutesSchema.nullable(),
  expectedDailyRevision: revisionSchema,
}).strict().superRefine((command, context) => {
  const actionKeys = new Set<string>();
  for (const [index, action] of command.actions.entries()) {
    if (actionKeys.has(action.actionKey)) {
      context.addIssue({
        code: "custom",
        message: "Actual action keys must be unique",
        path: ["actions", index, "actionKey"],
      });
    }
    actionKeys.add(action.actionKey);
  }
});

const finishAndAdvanceCommandSchema = z.object({
  type: z.literal("finish-and-advance"),
  businessDate: businessDateSchema,
  expectedDailyRevision: revisionSchema,
  expectedCycleRevision: revisionSchema,
}).strict();

const skipAndAdvanceCommandSchema = z.object({
  type: z.literal("skip-and-advance"),
  businessDate: businessDateSchema,
  note: longTextSchema,
  expectedDailyRevision: revisionSchema,
  expectedCycleRevision: revisionSchema,
}).strict();

export const manualExerciseDayOutcomeSchema = z.enum(["rest", "skipped", "unrecorded"]);

const resolveDayCommandSchema = z.object({
  type: z.literal("resolve-day"),
  ...dailyRevisionCommandFields,
  outcome: manualExerciseDayOutcomeSchema,
  note: z.string().trim().max(4_000).nullable(),
  advanceCycle: z.boolean(),
  expectedCycleRevision: revisionSchema,
}).strict();

const reopenDayCommandSchema = z.object({
  type: z.literal("reopen-day"),
  ...dailyRevisionCommandFields,
}).strict();

export const manualExerciseCommandSchema = z.discriminatedUnion("type", [
  replaceTemplateCommandSchema,
  selectCycleDayCommandSchema,
  startTrainingCommandSchema,
  pauseTrainingCommandSchema,
  resumeTrainingCommandSchema,
  saveTrainingCommandSchema,
  finishAndAdvanceCommandSchema,
  skipAndAdvanceCommandSchema,
  resolveDayCommandSchema,
  reopenDayCommandSchema,
]);

export function parseManualExerciseCommand(input: unknown): ManualExerciseCommand {
  return manualExerciseCommandSchema.parse(input);
}

export type ManualExerciseStatus = z.infer<typeof manualExerciseStatusSchema>;
export type ManualExerciseDayOutcome = z.infer<typeof manualExerciseDayOutcomeSchema>;
export type ManualExerciseTemplateActionDto = z.infer<
  typeof manualExerciseTemplateActionSchema
>;
export type ManualExerciseTemplateDayDto = z.infer<
  typeof manualExerciseTemplateDaySchema
>;
export type ManualExerciseActualActionDto = z.infer<
  typeof manualExerciseActualActionSchema
>;
export type ManualExerciseCommand = z.infer<typeof manualExerciseCommandSchema>;

export interface ManualExerciseTimerState {
  startedAt: string | null;
  pausedAt: string | null;
  accumulatedPauseSeconds: number;
  endedAt: string | null;
  confirmedDurationMinutes: number | null;
}

export interface ManualExerciseElapsed {
  elapsedSeconds: number;
  calculatedDurationMinutes: number;
  confirmedDurationMinutes: number | null;
}
