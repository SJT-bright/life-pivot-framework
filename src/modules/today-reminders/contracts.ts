import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

export interface TodayReminder {
  id: string;
  businessDate: string;
  title: string;
  scheduledTime: string | null;
  completed: boolean;
  completedAt: string | null;
  alertedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式不正确")
  .refine(isBusinessDate, "日期不存在");

const reminderIdSchema = z.string().trim().min(8).max(128);
const scheduledTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "提醒时间格式不正确")
  .nullable();

export const addTodayReminderSchema = z.object({
  type: z.literal("add-today-reminder"),
  reminderId: reminderIdSchema,
  businessDate: businessDateSchema,
  title: z.string().trim().min(1, "写下要记住的事").max(240, "最多输入 240 个字"),
  scheduledTime: scheduledTimeSchema,
}).strict();

export const setTodayReminderCompletedSchema = z.object({
  type: z.literal("set-today-reminder-completed"),
  reminderId: reminderIdSchema,
  completed: z.boolean(),
  expectedRevision: z.number().int().min(1),
}).strict();

export const claimTodayReminderAlertSchema = z.object({
  type: z.literal("claim-today-reminder-alert"),
  reminderId: reminderIdSchema,
  expectedRevision: z.number().int().min(1),
}).strict();

export const updateTodayReminderSchema = z.object({
  type: z.literal("update-today-reminder"),
  reminderId: reminderIdSchema,
  expectedRevision: z.number().int().min(1),
  title: z.string().trim().min(1, "写下要记住的事").max(240, "最多输入 240 个字"),
  scheduledTime: scheduledTimeSchema,
}).strict();

export const deleteTodayReminderSchema = z.object({
  type: z.literal("delete-today-reminder"),
  reminderId: reminderIdSchema,
  expectedRevision: z.number().int().min(1),
}).strict();

export const rescheduleTodayReminderSchema = z.object({
  type: z.literal("reschedule-today-reminder"),
  reminderId: reminderIdSchema,
  expectedRevision: z.number().int().min(1),
  toBusinessDate: businessDateSchema,
}).strict();

export const todayReminderCommandSchema = z.discriminatedUnion("type", [
  addTodayReminderSchema,
  setTodayReminderCompletedSchema,
  claimTodayReminderAlertSchema,
  updateTodayReminderSchema,
  deleteTodayReminderSchema,
  rescheduleTodayReminderSchema,
]);

export type AddTodayReminderCommand = z.output<typeof addTodayReminderSchema>;
export type SetTodayReminderCompletedCommand = z.output<typeof setTodayReminderCompletedSchema>;
export type ClaimTodayReminderAlertCommand = z.output<typeof claimTodayReminderAlertSchema>;
export type UpdateTodayReminderCommand = z.output<typeof updateTodayReminderSchema>;
export type DeleteTodayReminderCommand = z.output<typeof deleteTodayReminderSchema>;
export type RescheduleTodayReminderCommand = z.output<typeof rescheduleTodayReminderSchema>;
export type TodayReminderCommand = z.output<typeof todayReminderCommandSchema>;

export interface TodayReminderCommandResult {
  reminder: TodayReminder;
  createdReminder?: TodayReminder;
  alertClaimed?: boolean;
}
