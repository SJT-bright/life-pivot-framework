import { z } from "zod";

import {
  isBusinessDate,
  toShanghaiBusinessDate,
} from "@/core/time/business-date";

export const FEISHU_DAILY_IMPORT_SCHEMA = "life-pivot.daily-import" as const;
export const FEISHU_DAILY_IMPORT_VERSION = 1 as const;
export const FEISHU_DAILY_IMPORT_TIMEZONE = "Asia/Shanghai" as const;

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9._:-]+$/, "ID 只能包含字母、数字、点、下划线、冒号或连字符");

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须为 YYYY-MM-DD")
  .refine(isBusinessDate, "日期不存在");

const offsetDateTimeSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/,
    "时间必须是带时区的 ISO 8601 时间",
  )
  .refine((value) => Number.isFinite(new Date(value).getTime()), "时间不存在");

const sourceFields = {
  sourceMessageId: idSchema.optional(),
  sourceItemId: idSchema,
  occurredAt: offsetDateTimeSchema,
  timePrecision: z.enum(["exact", "estimated", "date-only"]),
  sourceText: z.string().trim().min(1).max(4_000).optional(),
};

const amountFenSchema = z.number().int().positive().max(100_000_000_000);

const mealSchema = z.object({
  ...sourceFields,
  kind: z.literal("meal"),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]),
  foods: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    quantity: z.string().trim().min(1).max(100).optional(),
  }).strict()).min(1).max(50),
  amountFen: amountFenSchema.optional(),
  currency: z.literal("CNY").default("CNY"),
  note: z.string().trim().max(2_000).optional(),
}).strict();

const expenseSchema = z.object({
  ...sourceFields,
  kind: z.literal("expense"),
  amountFen: amountFenSchema,
  currency: z.literal("CNY"),
  category: z.enum([
    "food",
    "transport",
    "shopping",
    "housing",
    "health",
    "learning",
    "entertainment",
    "other",
  ]),
  merchant: z.string().trim().min(1).max(200).optional(),
  note: z.string().trim().max(2_000).optional(),
}).strict();

const activitySchema = z.object({
  ...sourceFields,
  kind: z.literal("activity"),
  title: z.string().trim().min(1).max(500),
  status: z.enum(["done", "planned", "cancelled"]),
  durationMinutes: z.number().int().positive().max(1_440).optional(),
  note: z.string().trim().max(2_000).optional(),
}).strict();

export const feishuDailyImportItemSchema = z.discriminatedUnion("kind", [
  mealSchema,
  expenseSchema,
  activitySchema,
]);

export const feishuDailyImportSchema = z.object({
  schema: z.literal(FEISHU_DAILY_IMPORT_SCHEMA),
  version: z.literal(FEISHU_DAILY_IMPORT_VERSION),
  batchId: idSchema,
  timezone: z.literal(FEISHU_DAILY_IMPORT_TIMEZONE),
  businessDate: businessDateSchema,
  source: z.object({
    platform: z.literal("feishu"),
    chatId: idSchema.optional(),
    summaryMessageId: idSchema.optional(),
    generatedAt: offsetDateTimeSchema,
  }).strict(),
  items: z.array(feishuDailyImportItemSchema).min(1).max(500),
}).strict().superRefine((value, context) => {
  const seenSourceKeys = new Set<string>();

  value.items.forEach((item, index) => {
    if (toShanghaiBusinessDate(new Date(item.occurredAt)) !== value.businessDate) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "occurredAt"],
        message: "按 Asia/Shanghai 换算后必须属于 businessDate",
      });
    }

    const sourceKey = getFeishuImportItemSourceKey(item, value.batchId);
    if (seenSourceKeys.has(sourceKey)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "sourceItemId"],
        message: "同一批次中 sourceMessageId + sourceItemId 不能重复",
      });
    }
    seenSourceKeys.add(sourceKey);
  });
});

export type FeishuDailyImportItem = z.output<typeof feishuDailyImportItemSchema>;
export type FeishuDailyImport = z.output<typeof feishuDailyImportSchema>;

export type FeishuDailyImportReceiptItemStatus = "ready" | "imported" | "skipped";

export interface FeishuDailyImportReceiptItem {
  sourceKey: string;
  kind: FeishuDailyImportItem["kind"];
  status: FeishuDailyImportReceiptItemStatus;
  captureId?: string;
  occurredAt: string;
  text: string;
  reason?: "duplicate";
}

export interface FeishuDailyImportReceipt {
  batchId: string;
  preview: boolean;
  businessDate: string;
  totalCount: number;
  importedCount: number;
  skippedCount: number;
  items: FeishuDailyImportReceiptItem[];
}

export class FeishuDailyImportParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FeishuDailyImportParseError";
  }
}

/**
 * A stable per-fact identity. One Feishu message may contain several facts, so
 * sourceMessageId alone is deliberately insufficient for idempotency.
 */
export function getFeishuImportItemSourceKey(
  item: Pick<FeishuDailyImportItem, "sourceMessageId" | "sourceItemId">,
  batchId?: string,
): string {
  if (item.sourceMessageId) {
    return `feishu:${item.sourceMessageId}:${item.sourceItemId}`;
  }
  if (!batchId) {
    throw new FeishuDailyImportParseError(
      "sourceMessageId 缺失时必须提供 batchId 生成稳定来源键",
    );
  }
  return `feishu:batch:${batchId}:${item.sourceItemId}`;
}

function extractSingleJsonPayload(input: string): string {
  const fences = [...input.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (fences.length > 1) {
    throw new FeishuDailyImportParseError("只能导入一个 JSON 代码块");
  }
  if (fences.length === 1) return fences[0]?.[1]?.trim() ?? "";

  const trimmed = input.trim();
  if (trimmed.startsWith("```") || trimmed.includes("```")) {
    throw new FeishuDailyImportParseError("请使用 ```json 代码块");
  }
  return trimmed;
}

/**
 * Accepts authoritative raw JSON or a human-readable message containing one
 * authoritative ```json block. Prose outside the block is ignored; prose is
 * never heuristically converted into money or timestamps.
 */
export function parseFeishuDailyImport(input: string | unknown): FeishuDailyImport {
  let candidate = input;
  if (typeof input === "string") {
    try {
      candidate = JSON.parse(extractSingleJsonPayload(input));
    } catch (error) {
      if (error instanceof FeishuDailyImportParseError) throw error;
      throw new FeishuDailyImportParseError("没有找到可读取的飞书汇总 JSON", {
        cause: error,
      });
    }
  }

  const parsed = feishuDailyImportSchema.safeParse(candidate);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const path = firstIssue?.path.length ? `${firstIssue.path.join(".")}: ` : "";
    throw new FeishuDailyImportParseError(
      `${path}${firstIssue?.message ?? "导入格式不正确"}`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

/** 可直接复制给飞书机器人的 v1 汇总指令。 */
export const FEISHU_DAILY_IMPORT_BOT_PROMPT = [
  "你是「个人积累库」的飞书日记录整理机器人。请把我当天零散发送的饮食、消费和事项整理成一个可导入批次。",
  "输出规则：",
  "1. 只输出一个 JSON 代码块，代码块外不要输出任何文字。",
  "2. timezone 必须是 Asia/Shanghai；occurredAt/generatedAt 必须是带 +08:00 的完整 ISO 8601 时间，且用户后续可修改 occurredAt。",
  "3. 能取得时，每条保留真实的 sourceMessageId。如果当前自动化没有提供消息 ID，就省略该字段，不要伪造；此时软件使用稳定 batchId 作为后备来源。同一条消息拆出多个事实时，用稳定且不重复的 sourceItemId（例如 meal-1、expense-1）。重试时不得改变 batchId、sourceMessageId 或 sourceItemId。",
  "4. 消费金额统一换算为人民币分 amountFen，只能是正整数（例如 23.50 元写 2350），currency 固定为 CNY；不得用浮点元。",
  "5. 时间明确用 exact，时间大致用 estimated，只知道日期时用当日 12:00:00+08:00 并标记 date-only。不确定的餐量、商家、时长等可选值应省略，不要猜。",
  "6. meal 必须含 mealType 和至少一个 foods；如果这顿饭同时记录了付款，把 amountFen 直接写在 meal，不要另建一条重复 expense。expense 必须含 amountFen/currency/category；activity 必须含 title/status。",
  "7. businessDate 必须等于每条 occurredAt 按 Asia/Shanghai 换算后的日期。不同日期要分成不同批次。",
  "",
  "```json",
  "{",
  `  \"schema\": \"${FEISHU_DAILY_IMPORT_SCHEMA}\",`,
  `  \"version\": ${FEISHU_DAILY_IMPORT_VERSION},`,
  "  \"batchId\": \"batch-20260830-001\",",
  `  \"timezone\": \"${FEISHU_DAILY_IMPORT_TIMEZONE}\",`,
  "  \"businessDate\": \"2026-08-30\",",
  "  \"source\": {",
  "    \"platform\": \"feishu\",",
  "    \"chatId\": \"oc_replace_with_real_chat_id\",",
  "    \"summaryMessageId\": \"om_replace_if_available\",",
  "    \"generatedAt\": \"2026-08-30T22:00:00+08:00\"",
  "  },",
  "  \"items\": [",
  "    {",
  "      \"kind\": \"meal\",",
  "      \"sourceMessageId\": \"om_real_source_message_1\",",
  "      \"sourceItemId\": \"meal-1\",",
  "      \"occurredAt\": \"2026-08-30T08:15:00+08:00\",",
  "      \"timePrecision\": \"exact\",",
  "      \"mealType\": \"breakfast\",",
  "      \"foods\": [{ \"name\": \"鸡蛋\", \"quantity\": \"2 个\" }],",
  "      \"currency\": \"CNY\",",
  "      \"sourceText\": \"早上8:15吃了两个鸡蛋\"",
  "    },",
  "    {",
  "      \"kind\": \"expense\",",
  "      \"sourceMessageId\": \"om_real_source_message_2\",",
  "      \"sourceItemId\": \"expense-1\",",
  "      \"occurredAt\": \"2026-08-30T12:30:00+08:00\",",
  "      \"timePrecision\": \"exact\",",
  "      \"amountFen\": 2350,",
  "      \"currency\": \"CNY\",",
  "      \"category\": \"food\",",
  "      \"merchant\": \"午餐店\",",
  "      \"sourceText\": \"午饭花23.5元\"",
  "    },",
  "    {",
  "      \"kind\": \"activity\",",
  "      \"sourceMessageId\": \"om_real_source_message_3\",",
  "      \"sourceItemId\": \"activity-1\",",
  "      \"occurredAt\": \"2026-08-30T19:00:00+08:00\",",
  "      \"timePrecision\": \"estimated\",",
  "      \"title\": \"健身\",",
  "      \"status\": \"done\",",
  "      \"durationMinutes\": 45,",
  "      \"sourceText\": \"晚上健身45分钟\"",
  "    }",
  "  ]",
  "}",
  "```",
].join("\n");
