import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

const MAX_ID_LENGTH = 128;
const MAX_MODULE_NAME_LENGTH = 160;
const MAX_NOTE_TITLE_LENGTH = 160;
const MAX_MODULE_GOAL_LENGTH = 1_000;
const MAX_MODULE_DESCRIPTION_LENGTH = 4_000;
const MAX_NOTE_DETAIL_LENGTH = 4_000;
const MAX_NOTE_CONTENT_LENGTH = 20_000;

const idSchema = z.string().trim().min(8).max(MAX_ID_LENGTH);
const nullableIdSchema = idSchema.nullable();
const nonnegativeSafeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isBusinessDate);
const nullableBusinessDateSchema = businessDateSchema.nullable();
const timestampSchema = z.string().datetime({ offset: true });
const moduleGoalSchema = z.string().trim().max(MAX_MODULE_GOAL_LENGTH);
const moduleDescriptionSchema = z.string().trim().max(MAX_MODULE_DESCRIPTION_LENGTH);
const noteDetailSchema = z.string().trim().max(MAX_NOTE_DETAIL_LENGTH);
const noteContentSchema = z.string().trim().min(1).max(MAX_NOTE_CONTENT_LENGTH);

export const personalKnowledgeModuleStatusSchema = z.enum([
  "learning",
  "paused",
  "long-term",
  "archived",
]);
export type PersonalKnowledgeModuleStatus = z.infer<
  typeof personalKnowledgeModuleStatusSchema
>;

export const dailyLearningNoteStatusSchema = z.enum(["active", "archived"]);
export type DailyLearningNoteStatus = z.infer<typeof dailyLearningNoteStatusSchema>;

const writableModuleStatusSchema = personalKnowledgeModuleStatusSchema.exclude(["archived"]);

export const savePersonalKnowledgeModuleCommandSchema = z.object({
  type: z.literal("save-module"),
  moduleId: idSchema,
  parentModuleId: nullableIdSchema,
  name: z.string().trim().min(1).max(MAX_MODULE_NAME_LENGTH),
  goal: moduleGoalSchema,
  currentFocus: moduleGoalSchema,
  description: moduleDescriptionSchema,
  status: writableModuleStatusSchema,
  ordinal: nonnegativeSafeIntegerSchema,
  expectedModuleRevision: nonnegativeSafeIntegerSchema,
  expectedParentRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const movePersonalKnowledgeModuleCommandSchema = z.object({
  type: z.literal("move-module"),
  moduleId: idSchema,
  parentModuleId: nullableIdSchema,
  ordinal: nonnegativeSafeIntegerSchema,
  expectedModuleRevision: nonnegativeSafeIntegerSchema,
  expectedOldParentRevision: nonnegativeSafeIntegerSchema,
  expectedNewParentRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const archivePersonalKnowledgeModuleCommandSchema = z.object({
  type: z.literal("archive-module"),
  moduleId: idSchema,
  expectedModuleRevision: nonnegativeSafeIntegerSchema,
  expectedParentRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const saveDailyLearningNoteCommandSchema = z.object({
  type: z.literal("save-daily-learning-note"),
  noteId: idSchema,
  businessDate: businessDateSchema,
  title: z.string().trim().min(1).max(MAX_NOTE_TITLE_LENGTH),
  moduleId: idSchema,
  content: noteContentSchema,
  source: noteDetailSchema,
  personalUnderstanding: noteDetailSchema,
  openQuestions: noteDetailSchema,
  application: noteDetailSchema,
  expectedNoteRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const archiveDailyLearningNoteCommandSchema = z.object({
  type: z.literal("archive-daily-learning-note"),
  noteId: idSchema,
  expectedNoteRevision: nonnegativeSafeIntegerSchema,
}).strict();

export const personalKnowledgeCommandSchema = z.discriminatedUnion("type", [
  savePersonalKnowledgeModuleCommandSchema,
  movePersonalKnowledgeModuleCommandSchema,
  archivePersonalKnowledgeModuleCommandSchema,
  saveDailyLearningNoteCommandSchema,
  archiveDailyLearningNoteCommandSchema,
]);

export type PersonalKnowledgeCommand = z.infer<typeof personalKnowledgeCommandSchema>;

export const personalKnowledgeModuleSchema = z.object({
  moduleId: idSchema,
  parentModuleId: nullableIdSchema,
  name: z.string().trim().min(1).max(MAX_MODULE_NAME_LENGTH),
  goal: moduleGoalSchema,
  currentFocus: moduleGoalSchema,
  description: moduleDescriptionSchema,
  status: personalKnowledgeModuleStatusSchema,
  ordinal: nonnegativeSafeIntegerSchema,
  revision: positiveSafeIntegerSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();
export type PersonalKnowledgeModule = z.infer<typeof personalKnowledgeModuleSchema>;

export const dailyLearningNoteSchema = z.object({
  noteId: idSchema,
  businessDate: businessDateSchema,
  title: z.string().trim().min(1).max(MAX_NOTE_TITLE_LENGTH),
  moduleId: idSchema,
  content: noteContentSchema,
  source: noteDetailSchema,
  personalUnderstanding: noteDetailSchema,
  openQuestions: noteDetailSchema,
  application: noteDetailSchema,
  status: dailyLearningNoteStatusSchema,
  revision: positiveSafeIntegerSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict();
export type DailyLearningNote = z.infer<typeof dailyLearningNoteSchema>;

export const personalKnowledgeSnapshotSchema = z.object({
  businessDate: businessDateSchema,
  modules: z.array(personalKnowledgeModuleSchema),
  dailyNotes: z.array(dailyLearningNoteSchema),
}).strict();
export type PersonalKnowledgeSnapshot = z.infer<typeof personalKnowledgeSnapshotSchema>;

const personalKnowledgeOperationSchema = z.enum([
  "save-module",
  "move-module",
  "archive-module",
  "save-daily-learning-note",
  "archive-daily-learning-note",
]);

export const personalKnowledgeAppliedMutationSchema = z.object({
  operation: personalKnowledgeOperationSchema,
  ownerId: idSchema,
  ownerRevision: nonnegativeSafeIntegerSchema,
  businessDate: nullableBusinessDateSchema,
}).strict();
export type PersonalKnowledgeAppliedMutation = z.infer<
  typeof personalKnowledgeAppliedMutationSchema
>;

export const personalKnowledgeResultSchema = z.object({
  snapshot: personalKnowledgeSnapshotSchema,
  applied: personalKnowledgeAppliedMutationSchema,
}).strict();
export type PersonalKnowledgeResult = z.infer<typeof personalKnowledgeResultSchema>;

export const personalKnowledgeSnapshotResponseSchema = z.object({
  snapshot: personalKnowledgeSnapshotSchema,
}).strict();
export type PersonalKnowledgeSnapshotResponse = z.infer<
  typeof personalKnowledgeSnapshotResponseSchema
>;

export const personalKnowledgeMutationResponseSchema = z.object({
  result: personalKnowledgeResultSchema,
}).strict();
export type PersonalKnowledgeMutationResponse = z.infer<
  typeof personalKnowledgeMutationResponseSchema
>;

export class PersonalKnowledgeValidationError extends Error {
  constructor(message = "Invalid personal knowledge command.") {
    super(message);
    this.name = "PersonalKnowledgeValidationError";
  }
}

export function parsePersonalKnowledgeCommand(value: unknown): PersonalKnowledgeCommand {
  const parsed = personalKnowledgeCommandSchema.safeParse(value);
  if (!parsed.success) throw new PersonalKnowledgeValidationError();
  return parsed.data;
}
