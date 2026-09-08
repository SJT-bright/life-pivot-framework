import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

export interface PersonalDailyNote {
  id: string;
  businessDate: string;
  content: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确")
  .refine(isBusinessDate, "日期不存在");

export const savePersonalDailyNoteSchema = z.object({
  type: z.literal("save-personal-daily-note"),
  noteId: z.string().trim().min(8).max(128),
  businessDate: businessDateSchema,
  content: z.string().max(20_000),
  expectedRevision: z.number().int().min(0),
}).strict();

export type SavePersonalDailyNoteCommand = z.output<typeof savePersonalDailyNoteSchema>;

export const movePersonalDailyNoteSchema = z.object({
  type: z.literal("move-personal-daily-note"),
  noteId: z.string().trim().min(8).max(128),
  fromBusinessDate: businessDateSchema,
  toBusinessDate: businessDateSchema,
  expectedRevision: z.number().int().min(1),
}).strict();

export type MovePersonalDailyNoteCommand = z.output<typeof movePersonalDailyNoteSchema>;

export function parsePersonalDailyNoteCommand(value: unknown): SavePersonalDailyNoteCommand {
  return savePersonalDailyNoteSchema.parse(value);
}

export function parseMovePersonalDailyNoteCommand(value: unknown): MovePersonalDailyNoteCommand {
  return movePersonalDailyNoteSchema.parse(value);
}
