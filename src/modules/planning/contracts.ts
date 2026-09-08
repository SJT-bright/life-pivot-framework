import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

const idSchema = z.string().trim().min(8).max(128);
const titleSchema = z.string().trim().min(1).max(500);
const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isBusinessDate);

const optionalIdSchema = idSchema.nullish();
const optionalBusinessDateSchema = businessDateSchema.nullish();

export const planningCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create-goal"),
    id: idSchema,
    lifeAreaId: idSchema,
    parentGoalId: optionalIdSchema,
    goalType: z.enum(["long-term", "stage"]),
    title: titleSchema,
    description: z.string().max(20_000).default(""),
    startDate: optionalBusinessDateSchema,
    targetDate: optionalBusinessDateSchema,
  }).strict(),
  z.object({
    type: z.literal("update-goal"),
    id: idSchema,
    revision: z.number().int().positive(),
    title: titleSchema,
    description: z.string().max(20_000),
    status: z.enum(["active", "completed", "paused", "archived"]),
    progressPercent: z.number().int().min(0).max(100),
  }).strict(),
  z.object({
    type: z.literal("create-action"),
    id: idSchema,
    goalId: optionalIdSchema,
    parentActionId: optionalIdSchema,
    actionType: z.enum(["weekly", "today"]),
    businessDate: optionalBusinessDateSchema,
    title: titleSchema,
    priority: z.enum(["low", "normal", "high"]),
    estimatedMinutes: z.number().int().min(1).max(1440).nullish(),
    notes: z.string().max(20_000),
  }).strict(),
  z.object({
    type: z.literal("set-action-status"),
    actionId: idSchema,
    revision: z.number().int().positive(),
    businessDate: businessDateSchema,
    status: z.enum(["pending", "completed", "skipped"]),
  }).strict(),
  z.object({
    type: z.literal("reschedule-action"),
    actionId: idSchema,
    revision: z.number().int().positive(),
    fromBusinessDate: businessDateSchema,
    toBusinessDate: businessDateSchema,
  }).strict(),
]);

export type PlanningCommand = z.output<typeof planningCommandSchema>;

export interface PlanningAction {
  id: string;
  goalId: string | null;
  parentActionId: string | null;
  actionType: "weekly" | "today";
  businessDate: string | null;
  title: string;
  status: "pending" | "completed" | "skipped" | "archived";
  priority: "low" | "normal" | "high";
  estimatedMinutes: number | null;
  notes: string;
  revision: number;
}

export interface PlanningSnapshot {
  businessDate: string;
  lifeAreas: ReadonlyArray<{ id: string; name: string }>;
  goals: ReadonlyArray<{
    id: string;
    lifeAreaId: string;
    parentGoalId: string | null;
    goalType: "long-term" | "stage";
    title: string;
    description: string;
    status: "active" | "completed" | "paused" | "archived";
    progressPercent: number;
    revision: number;
  }>;
  weeklyActions: ReadonlyArray<PlanningAction>;
  todayActions: ReadonlyArray<PlanningAction>;
  overdueActions: ReadonlyArray<PlanningAction>;
  unassignedActions: ReadonlyArray<PlanningAction>;
}

export class PlanningValidationError extends Error {
  constructor(message = "Invalid planning command.") {
    super(message);
    this.name = "PlanningValidationError";
  }
}

export function parsePlanningCommand(value: unknown): PlanningCommand {
  const parsed = planningCommandSchema.safeParse(value);
  if (!parsed.success) throw new PlanningValidationError();
  return parsed.data;
}

export function parsePlanningBusinessDate(value: string): string {
  if (!isBusinessDate(value)) throw new PlanningValidationError("Invalid planning date.");
  return value;
}
