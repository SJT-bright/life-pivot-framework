import { z } from "zod";

export interface WisdomReminder {
  id: string;
  content: string;
  context: string;
  archivedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export class WisdomReminderValidationError extends Error {
  constructor(message = "Invalid wisdom reminder command.") {
    super(message);
    this.name = "WisdomReminderValidationError";
  }
}

const idSchema = z.string().trim().min(8).max(128);
const contentSchema = z.string().trim().min(1).max(500);
const contextSchema = z.string().trim().max(2000);
const revisionSchema = z.number().int().min(1);

export const wisdomReminderRecordSchema = z.object({
  id: idSchema,
  content: z.string(),
  context: z.string(),
  archivedAt: z.string().nullable(),
  revision: z.number().int().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict();

const baseFields = {
  reminderId: idSchema,
  content: contentSchema,
  context: contextSchema,
};

export const createWisdomReminderSchema = z.object({
  type: z.literal("create-wisdom-reminder"),
  ...baseFields,
}).strict();

export const updateWisdomReminderSchema = z.object({
  type: z.literal("update-wisdom-reminder"),
  ...baseFields,
  expectedRevision: revisionSchema,
}).strict();

export const archiveWisdomReminderSchema = z.object({
  type: z.literal("archive-wisdom-reminder"),
  reminderId: idSchema,
  expectedRevision: revisionSchema,
}).strict();

export const wisdomReminderCommandSchema = z.discriminatedUnion("type", [
  createWisdomReminderSchema,
  updateWisdomReminderSchema,
  archiveWisdomReminderSchema,
]);

export type CreateWisdomReminderCommand = z.output<typeof createWisdomReminderSchema>;
export type UpdateWisdomReminderCommand = z.output<typeof updateWisdomReminderSchema>;
export type ArchiveWisdomReminderCommand = z.output<typeof archiveWisdomReminderSchema>;
export type WisdomReminderCommand = z.output<typeof wisdomReminderCommandSchema>;

export function parseWisdomReminderCommand(value: unknown): WisdomReminderCommand {
  const parsed = wisdomReminderCommandSchema.safeParse(value);
  if (!parsed.success) throw new WisdomReminderValidationError();
  return parsed.data;
}
