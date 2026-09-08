import { z } from "zod";

import { isBusinessDate } from "@/core/time/business-date";

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine(isBusinessDate, "Invalid business date.");

export const healthChecklistItemInputSchema = z.object({
  itemKey: z.string().trim().min(8).max(128),
  groupKey: z.string().trim().min(1).max(64),
  groupLabel: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  targetText: z.string().trim().max(500),
  note: z.string().trim().max(1000),
  ordinal: z.number().int().min(0),
}).strict();

const replaceHealthChecklistCommandSchema = z.object({
  type: z.literal("replace-health-checklist"),
  templateId: z.string().trim().min(8).max(128),
  businessDate: businessDateSchema,
  scope: z.enum(["today-only", "today-and-future"]),
  name: z.string().trim().min(1).max(120),
  changeNote: z.string().trim().max(1000),
  items: z.array(healthChecklistItemInputSchema).max(200),
  // 常驻任务标记：哪些 item 属于每日模板。缺省视为全部都是（旧行为）。
  // today-and-future 时，只有标记过的项会写入模板并出现在之后的每一天，
  // 未标记的项只保留在指定这一天。
  templateItemKeys: z.array(z.string().trim().min(8).max(128)).max(200).optional(),
  expectedTemplateRevision: z.number().int().min(0),
  expectedDayRevision: z.number().int().min(0),
  confirmedRemovedCompletedItemKeys: z.array(
    z.string().trim().min(8).max(128),
  ).max(200),
}).strict().superRefine((value, context) => {
  const itemKeys = new Set<string>();
  const ordinals = new Set<number>();
  for (const [index, item] of value.items.entries()) {
    if (itemKeys.has(item.itemKey)) {
      context.addIssue({
        code: "custom",
        message: "Duplicate item key.",
        path: ["items", index, "itemKey"],
      });
    }
    if (ordinals.has(item.ordinal)) {
      context.addIssue({
        code: "custom",
        message: "Duplicate ordinal.",
        path: ["items", index, "ordinal"],
      });
    }
    itemKeys.add(item.itemKey);
    ordinals.add(item.ordinal);
  }
  const templateItemKeys = value.templateItemKeys ?? [];
  for (const [index, key] of templateItemKeys.entries()) {
    if (!itemKeys.has(key)) {
      context.addIssue({
        code: "custom",
        message: "Template item key must exist in items.",
        path: ["templateItemKeys", index],
      });
    }
  }
  if (new Set(templateItemKeys).size !== templateItemKeys.length) {
    context.addIssue({
      code: "custom",
      message: "Duplicate template item key.",
      path: ["templateItemKeys"],
    });
  }
  const confirmed = new Set(value.confirmedRemovedCompletedItemKeys);
  if (confirmed.size !== value.confirmedRemovedCompletedItemKeys.length) {
    context.addIssue({
      code: "custom",
      message: "Duplicate confirmed removal key.",
      path: ["confirmedRemovedCompletedItemKeys"],
    });
  }
});

const setHealthChecklistItemsCommandSchema = z.object({
  type: z.literal("set-health-checklist-items"),
  businessDate: businessDateSchema,
  itemKeys: z.array(z.string().trim().min(8).max(128)).min(1).max(200),
  completed: z.boolean(),
  expectedDayRevision: z.number().int().min(1),
}).strict().superRefine((value, context) => {
  if (new Set(value.itemKeys).size !== value.itemKeys.length) {
    context.addIssue({
      code: "custom",
      message: "Duplicate item key.",
      path: ["itemKeys"],
    });
  }
});

const saveHealthChecklistNoteCommandSchema = z.object({
  type: z.literal("save-health-checklist-note"),
  businessDate: businessDateSchema,
  note: z.string().trim().max(4000),
  expectedDayRevision: z.number().int().min(1),
}).strict();

export const healthChecklistCommandSchema = z.union([
  replaceHealthChecklistCommandSchema,
  setHealthChecklistItemsCommandSchema,
  saveHealthChecklistNoteCommandSchema,
]);

export type HealthChecklistItemInput = z.infer<typeof healthChecklistItemInputSchema>;
export type HealthChecklistCommand = z.infer<typeof healthChecklistCommandSchema>;

export interface HealthChecklistDayItem {
  readonly id: string;
  readonly itemKey: string;
  readonly groupKey: string;
  readonly groupLabel: string;
  readonly name: string;
  readonly targetText: string;
  readonly note: string;
  readonly ordinal: number;
  readonly completed: boolean;
  readonly completedAt: string | null;
}

export interface HealthChecklistDay {
  readonly id: string;
  readonly businessDate: string;
  readonly templateId: string;
  readonly templateVersionId: string;
  readonly templateRevision: number;
  readonly templateName: string;
  readonly note: string;
  readonly revision: number;
  readonly items: readonly HealthChecklistDayItem[];
  /** 当天清单里属于每日模板（常驻）的 item key；其余为仅当天存在的手动任务。 */
  readonly persistentItemKeys: readonly string[];
}

export function parseHealthChecklistItemInput(value: unknown): HealthChecklistItemInput {
  return healthChecklistItemInputSchema.parse(value);
}

export function parseHealthChecklistCommand(value: unknown): HealthChecklistCommand {
  return healthChecklistCommandSchema.parse(value);
}
