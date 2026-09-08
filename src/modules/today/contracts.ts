import { z } from "zod";

export function canonicalizeIsoInstant(value: string): string {
  return new Date(value).toISOString();
}

const canonicalIsoInstantSchema = z
  .iso.datetime()
  .transform(canonicalizeIsoInstant);

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "记录日期格式不正确")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "记录日期不存在");

const baseFields = {
  businessDate: businessDateSchema,
  recordId: z.string().trim().min(1).optional(),
  revision: z.number().int().nonnegative(),
};

export const entrySectionSchema = z
  .object({
    section: z.literal("entry"),
    draftId: z.string().trim().min(8).max(128),
    businessDate: businessDateSchema,
    occurredAt: canonicalIsoInstantSchema,
    value: z.object({
      text: z.string().trim().min(1, "记录内容不能为空").max(20_000, "记录内容过长"),
    }).strict(),
  })
  .strict();

export const metricSectionSchema = z
  .object({
    ...baseFields,
    section: z.literal("metric"),
    value: z.object({
      metricDefinitionVersionId: z.string().trim().min(1),
      rawValue: z.union([z.number(), z.string(), z.boolean()]),
    }),
  })
  .strict();

export const taskSectionSchema = z
  .object({
    ...baseFields,
    section: z.literal("task"),
    value: z.object({
      actionId: z.string().trim().min(1),
      status: z.enum(["pending", "completed", "skipped"]),
    }),
  })
  .strict();

export const skincareSectionSchema = z
  .object({
    ...baseFields,
    section: z.literal("skincare"),
    value: z.object({
      routineStepId: z.string().trim().min(1),
      status: z.enum(["used", "skipped"]),
      productFormulationId: z.string().trim().min(1).optional(),
    }),
  })
  .strict();

export const todaySectionSchema = z.discriminatedUnion("section", [
  entrySectionSchema,
  metricSectionSchema,
  taskSectionSchema,
  skincareSectionSchema,
]);

export type EntrySectionInput = z.output<typeof entrySectionSchema>;
export type MetricSectionInput = z.output<typeof metricSectionSchema>;
export type TaskSectionInput = z.output<typeof taskSectionSchema>;
export type SkincareSectionInput = z.output<typeof skincareSectionSchema>;
export type TodaySectionInput = z.input<typeof todaySectionSchema>;
export type TodaySection = z.output<typeof todaySectionSchema>["section"];

export interface StoredCapture {
  id: string;
  draftId: string;
  businessDate: string;
  occurredAt: string;
  text: string;
  createdAt: string;
}

export type SectionSaveResult =
  | {
      section: "entry";
      status: "saved";
      item: StoredCapture;
    }
  | {
      section: Exclude<TodaySection, "entry">;
      status: "saved";
      recordId: string;
      revision: number;
    }
  | {
      section: TodaySection;
      status: "invalid";
      message: string;
    }
  | {
      section: TodaySection;
      status: "failed";
      message: string;
    }
  | {
      section: TodaySection;
      status: "conflict";
      message: string;
    };
