import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

export interface DailySleepRecord {
  id: string;
  recordDate: string;
  asleepTime: string;
  wakeTime: string;
  calculatedDurationMinutes: number;
  confirmedDurationMinutes: number | null;
  finalDurationMinutes: number;
  deepSleepMinutes: number | null;
  lightSleepMinutes: number | null;
  remSleepMinutes: number | null;
  awakeEpisodes: number | null;
  awakeMinutes: number | null;
  morningFeeling: number | null;
  qualityScore: number | null;
  sleepVariabilityMinutes: number | null;
  score: DailySleepScore;
  qualityText: string;
  note: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface DailySleepScore {
  finalScore: number;
  durationScore: number;
  variabilityScore: number;
  stageConsistencyScore: number;
  morningFeelingScore: number;
  bedVariabilityMinutes: number | null;
  wakeVariabilityMinutes: number | null;
  averageVariabilityMinutes: number | null;
  usedPreviousNaturalDay: boolean;
  disclaimer: string;
}

export class DailySleepValidationError extends Error {
  constructor(message = "Invalid daily sleep command.") {
    super(message);
    this.name = "DailySleepValidationError";
  }
}

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isBusinessDate);

const hhmmSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);

export const saveDailySleepCommandSchema = z.object({
  type: z.literal("save-daily-sleep"),
  recordId: z.string().trim().min(8).max(128),
  recordDate: businessDateSchema,
  asleepTime: hhmmSchema,
  wakeTime: hhmmSchema,
  confirmedDurationMinutes: z.number().int().min(0).max(1440).nullable(),
  deepSleepMinutes: z.number().int().min(0).max(1440).nullable().optional().default(null),
  lightSleepMinutes: z.number().int().min(0).max(1440).nullable().optional().default(null),
  remSleepMinutes: z.number().int().min(0).max(1440).nullable().optional().default(null),
  awakeEpisodes: z.number().int().min(0).max(100).nullable().optional().default(null),
  awakeMinutes: z.number().int().min(0).max(720).nullable().optional().default(null),
  morningFeeling: z.number().int().min(1).max(5).nullable().optional().default(null),
  qualityScore: z.number().int().min(60).max(100).nullable().optional().default(null),
  // Older frozen submissions include this text. New submissions omit it because
  // the service writes a versioned automatic-score summary instead.
  qualityText: z.string().trim().max(500).optional(),
  note: z.string().trim().max(4000),
  expectedRevision: z.number().int().min(0),
}).strict().superRefine((value, context) => {
  const stages = [value.deepSleepMinutes, value.lightSleepMinutes, value.remSleepMinutes];
  const completed = stages.filter((stage) => stage !== null).length;
  if (completed !== 0 && completed !== stages.length) {
    context.addIssue({
      code: "custom",
      message: "Sleep stages must be provided together or omitted together.",
      path: ["deepSleepMinutes"],
    });
  }
});

export type DailySleepCommand = z.infer<typeof saveDailySleepCommandSchema>;

export function parseDailySleepCommand(value: unknown): DailySleepCommand {
  const parsed = saveDailySleepCommandSchema.safeParse(value);
  if (!parsed.success) throw new DailySleepValidationError();
  return parsed.data;
}
